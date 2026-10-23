#!/usr/bin/env python3
"""Compare the unmodified production vertex shader with the CPU posed bake.

The node companion supplies actual application draw captures and CPU positions/
normals. GLES transform feedback records vWorld/vNormal before rasterization.
This checks software GLES correctness, not browser behavior or hardware speed.
"""
import array
import base64
import ctypes as C
import importlib.util
import json
import math
from pathlib import Path
import sys
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('duder_egl',HERE/'render-capture.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
GL_TRANSFORM_FEEDBACK=0x8E22
GL_TRANSFORM_FEEDBACK_BUFFER=0x8C8E
GL_INTERLEAVED_ATTRIBS=0x8C8C
GL_RASTERIZER_DISCARD=0x8C89
GL_STREAM_READ=0x88E1
GL_MAP_READ_BIT=0x0001
GL_POINTS=0

def main():
    data=json.loads(Path(sys.argv[1]).read_text());renderer=module.EGLRenderer(64,64)
    report={'passed':True,'scope':__doc__.strip(),'renderer':renderer.info,'cases':[],'vertices':0,'maxPositionError':0,'maxNormalError':0,'failures':[]}
    try:
        u,i,p,s=C.c_uint,C.c_int,C.c_void_p,C.c_ssize_t
        for name,ret,args in [
            ('glTransformFeedbackVaryings',None,[u,i,C.POINTER(C.c_char_p),u]),
            ('glGenTransformFeedbacks',None,[i,C.POINTER(u)]),('glBindTransformFeedback',None,[u,u]),
            ('glBindBufferBase',None,[u,u,u]),('glBeginTransformFeedback',None,[u]),('glEndTransformFeedback',None,[]),
            ('glMapBufferRange',p,[u,s,s,u]),('glUnmapBuffer',C.c_ubyte,[u])
        ]:renderer.glfn(name,ret,*args)
        programs={}
        for case in data['cases']:
            draw=case['draw'];key=(draw['vs'],draw['fs'])
            if key not in programs:
                program=renderer.glCreateProgram();vertex=renderer.shader(draw['vs'],module.GL_VERTEX_SHADER);fragment=renderer.shader(draw['fs'],module.GL_FRAGMENT_SHADER)
                renderer.glAttachShader(program,vertex);renderer.glAttachShader(program,fragment)
                names=(C.c_char_p*2)(b'vWorld',b'vNormal');renderer.glTransformFeedbackVaryings(program,2,names,GL_INTERLEAVED_ATTRIBS);renderer.glLinkProgram(program)
                ok=C.c_int();renderer.glGetProgramiv(program,module.GL_LINK_STATUS,C.byref(ok));log=renderer._log(program,False)
                renderer.compile_report.append({'stage':'transform-feedback-link','linked':bool(ok.value),'log':log})
                if not ok.value:raise RuntimeError('Transform-feedback link failed: '+log)
                renderer.glDeleteShader(vertex);renderer.glDeleteShader(fragment);programs[key]=program
            program=programs[key];renderer.glUseProgram(program)
            vao=C.c_uint();renderer.glGenVertexArrays(1,C.byref(vao));renderer.glBindVertexArray(vao)
            for attribute in draw['attributes']:
                raw=base64.b64decode(attribute['data']);buffer=C.create_string_buffer(raw);vbo=C.c_uint();renderer.glGenBuffers(1,C.byref(vbo));renderer.glBindBuffer(module.GL_ARRAY_BUFFER,vbo)
                renderer.glBufferData(module.GL_ARRAY_BUFFER,len(raw),buffer,module.GL_STATIC_DRAW);renderer.glEnableVertexAttribArray(attribute['loc']);renderer.glVertexAttribPointer(attribute['loc'],attribute['size'],module.GL_FLOAT,False,0,None)
            for texture in draw['textures']:renderer.texture(texture)
            for name,value in draw['uniforms'].items():renderer.uniform(program,name,value)
            count=case['vertexCount'];size=count*6*4
            feedback=C.c_uint();renderer.glGenTransformFeedbacks(1,C.byref(feedback));renderer.glBindTransformFeedback(GL_TRANSFORM_FEEDBACK,feedback)
            output=C.c_uint();renderer.glGenBuffers(1,C.byref(output));renderer.glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,output);renderer.glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER,size,None,GL_STREAM_READ);renderer.glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,output)
            errors=renderer.errors()
            if errors:raise RuntimeError('Upload/feedback setup errors: '+str(errors))
            renderer.glEnable(GL_RASTERIZER_DISCARD);renderer.glBeginTransformFeedback(GL_POINTS);renderer.glDrawArrays(GL_POINTS,0,count);renderer.glEndTransformFeedback();renderer.glDisable(GL_RASTERIZER_DISCARD);renderer.glFinish()
            errors=renderer.errors()
            if errors:raise RuntimeError('Transform-feedback draw errors: '+str(errors))
            address=renderer.glMapBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,size,GL_MAP_READ_BIT)
            if not address:raise RuntimeError('Transform-feedback readback map failed: '+str(renderer.errors()))
            values=array.array('f');values.frombytes(C.string_at(address,size))
            if not renderer.glUnmapBuffer(GL_TRANSFORM_FEEDBACK_BUFFER):raise RuntimeError('Transform-feedback readback was invalidated')
            expected=case['expected'];position_error=0;normal_error=0
            for vertex in range(count):
                offset=vertex*6
                if not all(math.isfinite(v) for v in values[offset:offset+6]):raise RuntimeError('Nonfinite GPU vertex: '+case['name'])
                position_error=max(position_error,math.dist(values[offset:offset+3],expected[offset:offset+3]));normal_error=max(normal_error,math.dist(values[offset+3:offset+6],expected[offset+3:offset+6]))
            report['vertices']+=count;report['maxPositionError']=max(report['maxPositionError'],position_error);report['maxNormalError']=max(report['maxNormalError'],normal_error)
            result={'name':case['name'],'vertices':count,'maxPositionError':position_error,'maxNormalError':normal_error,'glErrors':renderer.errors()};report['cases'].append(result)
            # CPU math is double precision; the vertex shader and packed palette
            # are float32. Bounded SDF gradients amplify tiny rounding differences.
            if position_error>2e-4 or normal_error>5e-3 or result['glErrors']:
                report['failures'].append(case['name']+': CPU/GPU posed mesh mismatch')
            renderer.glBindTransformFeedback(GL_TRANSFORM_FEEDBACK,0)
        report['shaderValidation']=renderer.compile_report;report['passed']=not report['failures']
    except Exception as error:
        report['passed']=False;report['failures'].append(str(error))
    finally:
        renderer.close()
    Path(sys.argv[2]).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'gpuPassed':report['passed'],'vertices':report['vertices'],'maxPositionError':report['maxPositionError'],'maxNormalError':report['maxNormalError'],'failures':report['failures']}),flush=True)
    return 0 if report['passed'] else 1
if __name__=='__main__':sys.exit(main())
