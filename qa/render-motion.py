#!/usr/bin/env python3
"""Stream actual application WebGL captures into one cached software GLES context and MP4.

This records actual fixed-step physics and shipped GLSL, not a browser, mock animation,
or hardware FPS benchmark. Only the first frame carries static geometry/shaders;
subsequent frames carry changed uniforms, textures, rig/UI vertices and state.
"""
import argparse, ctypes as C, importlib.util, json, os, subprocess, sys, time
from pathlib import Path
from PIL import Image
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('duder_egl',HERE/'render-capture.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('output',type=Path)
    p.add_argument('--mode',choices=['sumo','ragdoll','pile','idle','walk','wave','dance'],default='sumo')
    p.add_argument('--frames',type=int,default=96)
    p.add_argument('--fps',type=int,default=12)
    p.add_argument('--width',type=int,default=800)
    p.add_argument('--height',type=int,default=600)
    p.add_argument('--scene-only',action='store_true')
    args=p.parse_args();args.output.parent.mkdir(parents=True,exist_ok=True);encoded_path=args.output.with_name(args.output.stem+'.partial'+args.output.suffix)
    env=dict(os.environ,DUDER_CAPTURE_FRAMES=str(args.frames),DUDER_CAPTURE_FPS=str(args.fps),DUDER_CAPTURE_WIDTH=str(args.width),DUDER_CAPTURE_HEIGHT=str(args.height),DUDER_CAPTURE_SCENE_ONLY='1' if args.scene_only else '0')
    source=subprocess.Popen(['node',str(HERE/'capture-frame.mjs'),'--stream',args.mode],stdout=subprocess.PIPE,text=True,env=env)
    ffmpeg=None;renderer=None;trace=None;count=0;samples=[];start=time.perf_counter();source_hashes=None
    try:
        for line in source.stdout:
            packet=json.loads(line)
            if 'trace' in packet:
                trace=packet['trace'];width,height=trace['width'],trace['height'];source_hashes=trace['sourceHashes'];renderer=module.EGLRenderer(width,height)
                ffmpeg=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{width}x{height}','-r',str(args.fps),'-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(encoded_path)],stdin=subprocess.PIPE)
            else:
                patch=packet['patch']
                for i,changes in enumerate(patch.pop('draws')):trace['draws'][i].update(changes)
                trace.update(patch)
            renderer.draw_report=[]
            clear=trace.get('clear',{})
            renderer.glViewport(0,0,width,height);renderer.glDepthMask(True);renderer.glDisable(module.GL_SCISSOR_TEST)
            renderer.glClearColor(*clear.get('color',[.95,.95,.92,1]));renderer.glClearDepthf(clear.get('depth',1));renderer.glClear(module.GL_COLOR_BUFFER_BIT|module.GL_DEPTH_BUFFER_BIT)
            for i,draw in enumerate(trace['draws']):renderer.draw(draw,i)
            pixels=(C.c_ubyte*(width*height*4))();renderer.glPixelStorei(0x0D05,1)
            renderer.glReadPixels(0,0,width,height,module.GL_RGBA,module.GL_UNSIGNED_BYTE,pixels)
            errors=renderer.errors()
            if errors:raise RuntimeError(f'Readback GL error: {errors}')
            image=Image.frombytes('RGBA',(width,height),bytes(pixels)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).convert('RGB')
            ffmpeg.stdin.write(image.tobytes())
            if count in [0,args.frames//3,2*args.frames//3,args.frames-1]:image.save(args.output.with_name(args.output.stem+f'-frame-{count:03}.png'))
            samples.append({'frame':count,'simulation_time':trace['simulationTime'],'draw_calls':len(trace['draws']),'physics':trace.get('physicsStats'),'gl_errors':errors})
            count+=1
            if count%12==0:print(json.dumps({'rendered_frames':count,'simulation_time':trace['simulationTime']}),flush=True)
        if source.wait()!=0:raise RuntimeError('Capture subprocess failed')
        if count!=args.frames:raise RuntimeError(f'Expected {args.frames} frames, got {count}')
        ffmpeg.stdin.close()
        if ffmpeg.wait()!=0:raise RuntimeError('ffmpeg encode failed')
        encoded_path.replace(args.output)
        report={'verification_scope':'Actual fixed-step cannon-es physics and captured application GLSL replayed on software GLES; not browser execution or a hardware FPS benchmark.','mode':args.mode,'frames':count,'playback_fps':args.fps,'duration_seconds':count/args.fps,'width':width,'height':height,'source_hashes':source_hashes,'renderer':renderer.info,'programs':len(renderer.programs),'shader_validation':renderer.compile_report,'samples':samples,'elapsed_wall_seconds':round(time.perf_counter()-start,2),'video':str(args.output.resolve()),'bytes':args.output.stat().st_size}
        args.output.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'video':report['video'],'frames':count,'draw_calls':sorted(set(s['draw_calls']for s in samples)),'bytes':report['bytes'],'elapsed_seconds':report['elapsed_wall_seconds']}),flush=True)
    finally:
        if renderer:renderer.close()
        if source.poll() is None:source.terminate()
        if ffmpeg and ffmpeg.poll() is None:ffmpeg.terminate()

if __name__=='__main__':main()
