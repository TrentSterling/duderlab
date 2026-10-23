#!/usr/bin/env python3
"""Encode front, three-quarter and side wave motion from actual application GLSL.

The three cameras share the same frame time and constant framing. Source hashes,
all rendered frame counts and draw/GL checks accompany the MP4. Mesa software
GLES replay is not a browser-interaction or hardware-performance benchmark.
"""
import argparse,ctypes as C,importlib.util,json,subprocess,time
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('duder_egl',HERE/'render-capture.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def font(size):
    try:return ImageFont.truetype('DejaVuSans.ttf',size)
    except OSError:return ImageFont.load_default()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path);parser.add_argument('--fps',type=int,default=24);parser.add_argument('--loops',type=int,default=2)
    args=parser.parse_args();args.output.parent.mkdir(parents=True,exist_ok=True);partial=args.output.with_name(args.output.stem+'.partial'+args.output.suffix)
    source=subprocess.Popen(['node',str(HERE/'capture-wave-study.mjs'),'--stream','--fps',str(args.fps),'--loops',str(args.loops)],stdout=subprocess.PIPE,text=True)
    renderer=None;encoder=None;traces=None;count=0;samples=[];started=time.perf_counter();width,height=1456,536
    try:
        for line in source.stdout:
            packet=json.loads(line)
            if 'traces'in packet:
                traces=packet['traces'];renderer=module.EGLRenderer(480,440)
                encoder=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{width}x{height}','-r',str(args.fps),'-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(partial)],stdin=subprocess.PIPE)
            else:
                for j,patch in enumerate(packet['patches']):
                    for i,changes in enumerate(patch.pop('draws')):traces[j]['draws'][i].update(changes)
                    traces[j].update(patch)
            canvas=Image.new('RGB',(width,height),'#f4f1e9');draw=ImageDraw.Draw(canvas);draw.text((16,12),'DUDER V3.2 — WAVE / ACTUAL CODE',font=font(24),fill='#172129')
            draw.text((1100,17),f"{packet['frame']/args.fps:.2f}s",font=font(18),fill='#56636b')
            frame_errors=[];draws=[]
            for j,trace in enumerate(traces):
                renderer.draw_report=[];clear=trace.get('clear',{})
                renderer.glViewport(0,0,480,440);renderer.glDepthMask(True);renderer.glDisable(module.GL_SCISSOR_TEST);renderer.glClearColor(*clear.get('color',[.95,.95,.92,1]));renderer.glClearDepthf(clear.get('depth',1));renderer.glClear(module.GL_COLOR_BUFFER_BIT|module.GL_DEPTH_BUFFER_BIT)
                for i,command in enumerate(trace['draws']):renderer.draw(command,i)
                pixels=(C.c_ubyte*(480*440*4))();renderer.glPixelStorei(0x0D05,1);renderer.glReadPixels(0,0,480,440,module.GL_RGBA,module.GL_UNSIGNED_BYTE,pixels)
                errors=renderer.errors();frame_errors.extend(errors);draws.append(len(trace['draws']))
                if errors or len(trace['draws'])!=3:raise RuntimeError(f'Unexpected draw/GL result frame{count}: {errors}')
                im=Image.frombytes('RGBA',(480,440),bytes(pixels)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).convert('RGB');x=4+j*484;canvas.paste(im,(x,52));draw.text((x+12,501),packet['labels'][j],font=font(18),fill='#172129')
            encoder.stdin.write(canvas.tobytes());samples.append({'frame':count,'time':packet['frame']/args.fps,'drawCallsPerView':draws,'glErrors':frame_errors})
            if count in [0,round(packet['duration']*.4*args.fps),packet['frames']-1]:canvas.save(args.output.with_name(args.output.stem+f'-frame-{count:03}.png'))
            count+=1
            if count%24==0:print(json.dumps({'renderedFrames':count,'totalFrames':packet['frames']}),flush=True)
        if source.wait()!=0:raise RuntimeError('Wave capture failed')
        if count!=packet['frames']:raise RuntimeError('Incomplete wave capture')
        encoder.stdin.close()
        if encoder.wait()!=0:raise RuntimeError('MP4 encoding failed')
        partial.replace(args.output)
        report={'passed':True,'verificationScope':__doc__.strip(),'frames':count,'fps':args.fps,'duration':count/args.fps,'clipDuration':packet['duration'],'views':packet['labels'],'width':width,'height':height,'sourceHashes':traces[0]['sourceHashes'],'renderer':renderer.info,'shaderValidation':renderer.compile_report,'samples':samples,'video':args.output.name,'bytes':args.output.stat().st_size,'elapsedSeconds':round(time.perf_counter()-started,2)}
        args.output.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passed':True,'video':str(args.output),'frames':count,'bytes':report['bytes']}),flush=True)
    finally:
        if renderer:renderer.close()
        if source.poll()is None:source.terminate()
        if encoder and encoder.poll()is None:encoder.terminate()

if __name__=='__main__':main()
