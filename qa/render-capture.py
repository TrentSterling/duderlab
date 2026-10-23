#!/usr/bin/env python3
"""Replay captured WebGL2 draw calls with Mesa EGL/GLES3, without a browser.

Usage: python3 render-capture.py trace.json output.png
The trace contains the actual application's shaders, vertex arrays, uniforms,
texture bytes and state. This validates GLSL compilation and GPU draw behavior
on llvmpipe software OpenGL ES; it does not validate browser input or speed.
"""
from __future__ import annotations

import argparse
import base64
import ctypes as C
import io
import json
import os
from pathlib import Path
import sys
import time

os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")
os.environ.setdefault("EGL_PLATFORM", "surfaceless")
os.environ.setdefault("MESA_SHADER_CACHE_DISABLE", "true")

from PIL import Image

GL_FALSE=0
GL_TRUE=1
GL_FLOAT=0x1406
GL_UNSIGNED_BYTE=0x1401
GL_UNSIGNED_SHORT=0x1403
GL_UNSIGNED_INT=0x1405
GL_TRIANGLES=0x0004
GL_RGBA=0x1908
GL_RGBA32F=0x8814
GL_COLOR_BUFFER_BIT=0x4000
GL_DEPTH_BUFFER_BIT=0x0100
GL_ARRAY_BUFFER=0x8892
GL_ELEMENT_ARRAY_BUFFER=0x8893
GL_STATIC_DRAW=0x88E4
GL_TEXTURE_2D=0x0DE1
GL_TEXTURE0=0x84C0
GL_DEPTH_TEST=0x0B71
GL_CULL_FACE=0x0B44
GL_BLEND=0x0BE2
GL_SCISSOR_TEST=0x0C11
GL_VERTEX_SHADER=0x8B31
GL_FRAGMENT_SHADER=0x8B30
GL_COMPILE_STATUS=0x8B81
GL_LINK_STATUS=0x8B82
GL_INFO_LOG_LENGTH=0x8B84
EGL_NONE=0x3038


class EGLRenderer:
    def __init__(self, width: int, height: int):
        self.width, self.height = width, height
        self.egl=C.CDLL("libEGL.so.1")
        self.egl_functions={}
        self.gl_functions={}
        self.resources=[]
        self.programs={}
        self.compile_report=[]
        self.draw_report=[]
        self._egl_bindings()
        self.display=self.egl.eglGetDisplay(None)
        major,minor=C.c_int(),C.c_int()
        if not self.egl.eglInitialize(self.display,C.byref(major),C.byref(minor)):
            raise RuntimeError(f"eglInitialize failed: {self.egl.eglGetError():#x}")
        self.egl_version=f"{major.value}.{minor.value}"
        if not self.egl.eglBindAPI(0x30A0):
            raise RuntimeError("eglBindAPI(EGL_OPENGL_ES_API) failed")
        attrs=(C.c_int*17)(0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3025,24,0x3026,0,EGL_NONE)
        config,n=C.c_void_p(),C.c_int()
        if not self.egl.eglChooseConfig(self.display,attrs,C.byref(config),1,C.byref(n)) or n.value<1:
            raise RuntimeError(f"No EGL ES3 pbuffer config: {self.egl.eglGetError():#x}")
        self.surface=self.egl.eglCreatePbufferSurface(self.display,config,(C.c_int*5)(0x3057,width,0x3056,height,EGL_NONE))
        if not self.surface:raise RuntimeError(f"eglCreatePbufferSurface failed: {self.egl.eglGetError():#x}")
        self.context=self.egl.eglCreateContext(self.display,config,None,(C.c_int*3)(0x3098,3,EGL_NONE))
        if not self.context:raise RuntimeError(f"eglCreateContext ES3 failed: {self.egl.eglGetError():#x}")
        if not self.egl.eglMakeCurrent(self.display,self.surface,self.surface,self.context):
            raise RuntimeError(f"eglMakeCurrent failed: {self.egl.eglGetError():#x}")
        self._gl_bindings()
        self.info={k:(self.glGetString(v) or b'').decode() for k,v in [
            ('vendor',0x1F00),('renderer',0x1F01),('version',0x1F02),('shading_language',0x8B8C)]}
        self.info['egl_version']=self.egl_version

    def _egl_bindings(self):
        signatures={
            'eglGetDisplay':(C.c_void_p,[C.c_void_p]),
            'eglInitialize':(C.c_uint,[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_int)]),
            'eglGetError':(C.c_uint,[]),
            'eglBindAPI':(C.c_uint,[C.c_uint]),
            'eglChooseConfig':(C.c_uint,[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_void_p),C.c_int,C.POINTER(C.c_int)]),
            'eglCreatePbufferSurface':(C.c_void_p,[C.c_void_p,C.c_void_p,C.POINTER(C.c_int)]),
            'eglCreateContext':(C.c_void_p,[C.c_void_p,C.c_void_p,C.c_void_p,C.POINTER(C.c_int)]),
            'eglMakeCurrent':(C.c_uint,[C.c_void_p,C.c_void_p,C.c_void_p,C.c_void_p]),
            'eglGetProcAddress':(C.c_void_p,[C.c_char_p]),
            'eglDestroyContext':(C.c_uint,[C.c_void_p,C.c_void_p]),
            'eglDestroySurface':(C.c_uint,[C.c_void_p,C.c_void_p]),
            'eglTerminate':(C.c_uint,[C.c_void_p]),
        }
        for name,(restype,argtypes) in signatures.items():
            fn=getattr(self.egl,name);fn.restype=restype;fn.argtypes=argtypes

    def glfn(self,name,restype,*argtypes):
        p=self.egl.eglGetProcAddress(name.encode())
        if not p:raise RuntimeError(f"Missing OpenGL function {name}")
        fn=C.CFUNCTYPE(restype,*argtypes)(p)
        self.gl_functions[name]=fn
        setattr(self,name,fn)

    def _gl_bindings(self):
        u,i,f,b,p,s=C.c_uint,C.c_int,C.c_float,C.c_ubyte,C.c_void_p,C.c_ssize_t
        ip,up,fp=C.POINTER(i),C.POINTER(u),C.POINTER(f)
        for name,ret,args in [
            ('glGetString',C.c_char_p,[u]),('glGetError',u,[]),
            ('glCreateShader',u,[u]),('glShaderSource',None,[u,i,C.POINTER(C.c_char_p),ip]),
            ('glCompileShader',None,[u]),('glGetShaderiv',None,[u,u,ip]),
            ('glGetShaderInfoLog',None,[u,i,ip,p]),('glDeleteShader',None,[u]),
            ('glCreateProgram',u,[]),('glAttachShader',None,[u,u]),('glLinkProgram',None,[u]),
            ('glGetProgramiv',None,[u,u,ip]),('glGetProgramInfoLog',None,[u,i,ip,p]),
            ('glUseProgram',None,[u]),('glGetUniformLocation',i,[u,C.c_char_p]),
            ('glUniform1i',None,[i,i]),('glUniform1f',None,[i,f]),('glUniform2f',None,[i,f,f]),
            ('glUniform3f',None,[i,f,f,f]),('glUniform4f',None,[i,f,f,f,f]),
            ('glUniform1fv',None,[i,i,fp]),('glUniform2fv',None,[i,i,fp]),
            ('glUniform3fv',None,[i,i,fp]),('glUniform4fv',None,[i,i,fp]),
            ('glUniform1iv',None,[i,i,ip]),('glUniform2iv',None,[i,i,ip]),
            ('glUniform3iv',None,[i,i,ip]),('glUniform4iv',None,[i,i,ip]),
            ('glUniformMatrix2fv',None,[i,i,b,fp]),('glUniformMatrix3fv',None,[i,i,b,fp]),
            ('glUniformMatrix4fv',None,[i,i,b,fp]),
            ('glGenVertexArrays',None,[i,up]),('glBindVertexArray',None,[u]),
            ('glGenBuffers',None,[i,up]),('glBindBuffer',None,[u,u]),('glBufferData',None,[u,s,p,u]),
            ('glEnableVertexAttribArray',None,[u]),('glVertexAttribPointer',None,[u,i,u,b,i,p]),
            ('glGenTextures',None,[i,up]),('glBindTexture',None,[u,u]),('glActiveTexture',None,[u]),
            ('glTexParameteri',None,[u,u,i]),('glPixelStorei',None,[u,i]),
            ('glTexImage2D',None,[u,i,i,i,i,i,u,u,p]),
            ('glEnable',None,[u]),('glDisable',None,[u]),('glDepthMask',None,[b]),
            ('glDepthFunc',None,[u]),('glCullFace',None,[u]),('glFrontFace',None,[u]),
            ('glBlendFunc',None,[u,u]),('glViewport',None,[i,i,i,i]),('glScissor',None,[i,i,i,i]),
            ('glClearColor',None,[f,f,f,f]),('glClearDepthf',None,[f]),('glClear',None,[u]),
            ('glDrawArrays',None,[u,i,i]),('glDrawElements',None,[u,i,u,p]),('glFinish',None,[]),
            ('glReadPixels',None,[i,i,i,i,u,u,p]),
        ]:self.glfn(name,ret,*args)

    def errors(self):
        result=[]
        while True:
            e=self.glGetError()
            if not e:break
            result.append(hex(e))
        return result

    def _log(self,obj,shader=True):
        length=C.c_int()
        (self.glGetShaderiv if shader else self.glGetProgramiv)(obj,GL_INFO_LOG_LENGTH,C.byref(length))
        if length.value<=1:return ''
        out=C.create_string_buffer(length.value)
        (self.glGetShaderInfoLog if shader else self.glGetProgramInfoLog)(obj,length.value,None,out)
        return out.value.decode(errors='replace')

    def shader(self,source,kind):
        shader=self.glCreateShader(kind)
        raw=source.encode();src=C.c_char_p(raw);length=C.c_int(len(raw))
        self.glShaderSource(shader,1,C.byref(src),C.byref(length));self.glCompileShader(shader)
        ok=C.c_int();self.glGetShaderiv(shader,GL_COMPILE_STATUS,C.byref(ok))
        log=self._log(shader)
        self.compile_report.append({'stage':'vertex' if kind==GL_VERTEX_SHADER else 'fragment','compiled':bool(ok.value),'log':log})
        if not ok.value:raise RuntimeError(f"Shader compile failed:\n{log}\n"+'\n'.join(f'{i+1}: {line}' for i,line in enumerate(source.splitlines())))
        return shader

    def program(self,vs,fs):
        key=(vs,fs)
        if key in self.programs:return self.programs[key]
        p=self.glCreateProgram();v=self.shader(vs,GL_VERTEX_SHADER);f=self.shader(fs,GL_FRAGMENT_SHADER)
        self.glAttachShader(p,v);self.glAttachShader(p,f);self.glLinkProgram(p)
        ok=C.c_int();self.glGetProgramiv(p,GL_LINK_STATUS,C.byref(ok));log=self._log(p,False)
        self.compile_report.append({'stage':'link','linked':bool(ok.value),'log':log})
        if not ok.value:raise RuntimeError(f"Program link failed: {log}")
        self.glDeleteShader(v);self.glDeleteShader(f);self.programs[key]=p
        return p

    def uniform(self,p,name,spec):
        loc=self.glGetUniformLocation(p,name.encode())
        if loc<0:return
        typ=spec['type'];value=spec.get('value',[])
        vals=value if isinstance(value,list) else [value]
        fn=getattr(self,'glUniform'+typ)
        if typ.startswith('Matrix'):
            side=int(typ[6]);arr=(C.c_float*len(vals))(*vals)
            fn(loc,len(vals)//(side*side),bool(spec.get('transpose',False)),arr)
        elif typ.endswith('fv'):
            side=int(typ[0]);arr=(C.c_float*len(vals))(*vals);fn(loc,len(vals)//side,arr)
        elif typ.endswith('iv'):
            side=int(typ[0]);arr=(C.c_int*len(vals))(*vals);fn(loc,len(vals)//side,arr)
        else:fn(loc,*vals)

    def texture(self,spec):
        tex=C.c_uint();self.glGenTextures(1,C.byref(tex));self.resources.append(tex.value)
        unit=int(spec.get('unit',0));target=int(spec.get('target',GL_TEXTURE_2D))
        self.glActiveTexture(GL_TEXTURE0+unit);self.glBindTexture(target,tex)
        self.glPixelStorei(0x0CF5,1)
        raw=base64.b64decode(spec['data'].split(',',1)[-1])
        encoding=spec.get('encoding','float32')
        if encoding=='png':
            image=Image.open(io.BytesIO(raw)).convert('RGBA')
            if spec.get('flipY',False):image=image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            width,height=image.size;raw=image.tobytes()
            dtype=GL_UNSIGNED_BYTE;internal=int(spec.get('internalFormat',GL_RGBA))
        else:
            width,height=int(spec['width']),int(spec['height'])
            dtype=int(spec.get('type',GL_FLOAT if encoding=='float32' else GL_UNSIGNED_BYTE))
            internal=int(spec.get('internalFormat',GL_RGBA32F if dtype==GL_FLOAT else GL_RGBA))
        buf=C.create_string_buffer(raw)
        self.glTexImage2D(target,0,internal,width,height,0,int(spec.get('format',GL_RGBA)),dtype,buf)
        parameters=spec.get('parameters',{})
        if not parameters:parameters={0x2801:0x2600,0x2800:0x2600,0x2802:0x812F,0x2803:0x812F}
        for key,val in parameters.items():self.glTexParameteri(target,int(key),int(val))

    def state(self,s):
        self.glViewport(*s.get('viewport',[0,0,self.width,self.height]))
        for key,enum in [('depthTest',GL_DEPTH_TEST),('cullFaceEnabled',GL_CULL_FACE),('blend',GL_BLEND),('scissorTest',GL_SCISSOR_TEST)]:
            (self.glEnable if s.get(key,False) else self.glDisable)(enum)
        self.glDepthMask(bool(s.get('depthMask',True)))
        self.glDepthFunc(s.get('depthFunc',0x0201));self.glCullFace(s.get('cullFace',0x0405))
        self.glFrontFace(s.get('frontFace',0x0901))
        self.glBlendFunc(*s.get('blendFunc',[0x0302,0x0303]))
        if s.get('scissorTest',False):self.glScissor(*s.get('scissor',[0,0,self.width,self.height]))

    def draw(self,d,index):
        p=self.program(d['vs'],d['fs']);self.glUseProgram(p)
        vao=C.c_uint();self.glGenVertexArrays(1,C.byref(vao));self.glBindVertexArray(vao)
        for a in d.get('attributes',[]):
            raw=base64.b64decode(a['data']);buf=C.create_string_buffer(raw)
            vbo=C.c_uint();self.glGenBuffers(1,C.byref(vbo));self.glBindBuffer(GL_ARRAY_BUFFER,vbo)
            self.glBufferData(GL_ARRAY_BUFFER,len(raw),buf,GL_STATIC_DRAW)
            self.glEnableVertexAttribArray(int(a['loc']))
            self.glVertexAttribPointer(int(a['loc']),int(a['size']),int(a.get('type',GL_FLOAT)),bool(a.get('normalized',False)),0,None)
        indexed=d.get('method')=='drawElements'
        if indexed:
            elements=d['indices'];index_type=int(elements['type']);offset=int(elements.get('offset',0))
            item_size={GL_UNSIGNED_BYTE:1,GL_UNSIGNED_SHORT:2,GL_UNSIGNED_INT:4}.get(index_type)
            raw=base64.b64decode(elements['data'])
            if not item_size or offset<0 or offset%item_size or offset+int(d['count'])*item_size>len(raw):
                raise ValueError(f'Invalid element buffer in draw {index}')
            buf=C.create_string_buffer(raw);ebo=C.c_uint();self.glGenBuffers(1,C.byref(ebo))
            self.glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,ebo)
            self.glBufferData(GL_ELEMENT_ARRAY_BUFFER,len(raw),buf,GL_STATIC_DRAW)
        for t in d.get('textures',[]):self.texture(t)
        for name,spec in d.get('uniforms',{}).items():self.uniform(p,name,spec)
        self.state(d.get('state',{}))
        before=self.errors()
        if before:raise RuntimeError(f"OpenGL state/upload error before draw {index}: {before}")
        start=time.perf_counter()
        if indexed:self.glDrawElements(int(d.get('mode',GL_TRIANGLES)),int(d['count']),index_type,C.c_void_p(offset))
        else:self.glDrawArrays(int(d.get('mode',GL_TRIANGLES)),int(d.get('first',0)),int(d['count']))
        self.glFinish();errors=self.errors()
        self.draw_report.append({'index':index,'method':'drawElements' if indexed else 'drawArrays',
            'vertices':d.get('vertexCount',d['count']),'unique_vertices':d.get('uniqueVertices',d['count']),
            'indices':d['count'] if indexed else 0,'submitted_vertices':d['count'],
            'mode':d.get('mode',GL_TRIANGLES),'elapsed_ms':round((time.perf_counter()-start)*1000,2),'errors':errors})
        if errors:raise RuntimeError(f"OpenGL draw {index} failed: {errors}")

    def render(self,trace,outpath):
        clear=trace.get('clear',{})
        self.glViewport(0,0,self.width,self.height);self.glDepthMask(True)
        self.glClearColor(*clear.get('color',[.95,.95,.92,1]));self.glClearDepthf(clear.get('depth',1))
        self.glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT)
        for i,d in enumerate(trace['draws']):self.draw(d,i)
        self.glFinish()
        pixels=(C.c_ubyte*(self.width*self.height*4))()
        self.glPixelStorei(0x0D05,1)
        self.glReadPixels(0,0,self.width,self.height,GL_RGBA,GL_UNSIGNED_BYTE,pixels)
        errors=self.errors()
        if errors:raise RuntimeError(f"glReadPixels failed: {errors}")
        image=Image.frombytes('RGBA',(self.width,self.height),bytes(pixels)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).convert('RGB')
        image.save(outpath)
        return {'renderer':self.info,'width':self.width,'height':self.height,'draw_calls':len(trace['draws']),
            'source_hashes':trace.get('sourceHashes',{}),
            'vertices':sum(d['count'] for d in trace['draws']),
            'attribute_vertices':sum(d.get('vertexCount',d['count']) for d in trace['draws']),
            'indexed_draw_calls':sum(d.get('method')=='drawElements' for d in trace['draws']),
            'triangles':sum(d['count']//3 for d in trace['draws'] if d.get('mode',4)==4),
            'programs':len(self.programs),'shader_validation':self.compile_report,'draws':self.draw_report,
            'image':str(Path(outpath).resolve()),'verification_scope':'Actual captured application GLSL and draw calls on Mesa llvmpipe GLES3; not browser interaction or hardware performance.'}

    def close(self):
        self.egl.eglMakeCurrent(self.display,None,None,None)
        self.egl.eglDestroyContext(self.display,self.context);self.egl.eglDestroySurface(self.display,self.surface)
        self.egl.eglTerminate(self.display)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trace',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--report',type=Path)
    args=parser.parse_args()
    trace=json.loads(args.trace.read_text())
    args.output.parent.mkdir(parents=True,exist_ok=True)
    renderer=EGLRenderer(int(trace.get('width',1440)),int(trace.get('height',1000)))
    try:
        report=renderer.render(trace,args.output)
        report_path=args.report or args.output.with_suffix('.json')
        report_path.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
    finally:renderer.close()


if __name__=='__main__':main()
