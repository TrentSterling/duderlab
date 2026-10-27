#!/usr/bin/env python3
"""Render matched shoulder/underarm A/B views and diagnostic weight maps.

Surface images replay production GLSL; weight images only change replay color.
This is Mesa software GLES verification, not a browser or hardware FPS test.
"""
import argparse
import ctypes as C
import importlib.util
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent
BG='#f4f1e9'

def font(size):
    try:return ImageFont.truetype('DejaVuSans.ttf',size)
    except OSError:return ImageFont.load_default()

def sheet(output,cases,name,title,subtitle,columns=3,legend=False):
    if not cases:return
    w=h=512;gutter=14;header=106;label=38
    rows=(len(cases)+columns-1)//columns
    footer=52 if legend else 0
    canvas=Image.new('RGB',(columns*w+(columns+1)*gutter,header+rows*(h+label+gutter)+footer),BG)
    draw=ImageDraw.Draw(canvas);draw.text((20,15),title,font=font(27),fill='#172129');draw.text((20,55),subtitle,font=font(17),fill='#56636b')
    for i,case in enumerate(cases):
        x=gutter+i%columns*(w+gutter);y=header+i//columns*(h+label+gutter)
        canvas.paste(Image.open(output/(case['name']+'.png')).convert('RGB'),(x,y))
        draw.text((x+10,y+h+8),case['version'].upper()+'  /  '+case['label'],font=font(18),fill='#172129')
    if legend:
        y=canvas.height-43
        for i,(color,labeltext)in enumerate([('#a8b8c4','0% arm / torso'),('#26b8e6','25% arm'),('#ffd445','50% arm'),('#f24029','100% arm')]):
            x=20+i*340;draw.rectangle((x,y+2,x+24,y+25),fill=color);draw.text((x+34,y+1),labeltext,font=font(18),fill='#172129')
    canvas.save(output/name)

def renderer_module():
    spec=importlib.util.spec_from_file_location('duder_egl',HERE/'render-capture.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def render_video(module,output,baseline,fps):
    source=subprocess.Popen(['node',str(HERE/'capture-arm-study.mjs'),'--baseline',str(baseline),'--stream','--fps',str(fps)],stdout=subprocess.PIPE,text=True)
    renderer=None;encoder=None;traces=None;frames=0;samples=[];video=output/'arm-wave-before-after.mp4'
    partial=video.with_name(video.stem+'.partial.mp4');w=h=512;vw,vh=1052,612
    try:
        for line in source.stdout:
            packet=json.loads(line)
            if 'traces'in packet:
                traces=packet['traces'];renderer=module.EGLRenderer(w,h)
                encoder=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{vw}x{vh}','-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(partial)],stdin=subprocess.PIPE)
            else:
                for j,patch in enumerate(packet['patches']):
                    for i,delta in enumerate(patch['draws']):traces[j]['draws'][i].update(delta)
                    for key,value in patch.items():
                        if key!='draws':traces[j][key]=value
            canvas=Image.new('RGB',(vw,vh),BG);draw=ImageDraw.Draw(canvas)
            draw.text((18,12),'DUDERLAB / ARM WEIGHTS / SAME WAVE',font=font(24),fill='#172129')
            draw.text((880,17),f"{frames/fps:.2f}s",font=font(18),fill='#56636b')
            for j,trace in enumerate(traces):
                renderer.draw_report=[];clear=trace.get('clear',{})
                renderer.glViewport(0,0,w,h);renderer.glDepthMask(True);renderer.glDisable(module.GL_SCISSOR_TEST)
                renderer.glClearColor(*clear.get('color',[.95,.95,.92,1]));renderer.glClearDepthf(clear.get('depth',1));renderer.glClear(module.GL_COLOR_BUFFER_BIT|module.GL_DEPTH_BUFFER_BIT)
                for i,command in enumerate(trace['draws']):renderer.draw(command,i)
                pixels=(C.c_ubyte*(w*h*4))();renderer.glPixelStorei(0x0D05,1);renderer.glReadPixels(0,0,w,h,module.GL_RGBA,module.GL_UNSIGNED_BYTE,pixels)
                errors=renderer.errors()
                if errors or len(trace['draws'])!=3:raise RuntimeError(f'Frame {frames} {packet["labels"][j]}: draw/GL error {errors}')
                im=Image.frombytes('RGBA',(w,h),bytes(pixels)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).convert('RGB')
                x=9+j*522;canvas.paste(im,(x,52));draw.text((x+14,576),packet['labels'][j],font=font(20),fill='#172129')
                samples.append({'frame':frames,'version':packet['labels'][j].lower(),'drawCalls':len(trace['draws']),'glErrors':errors})
            encoder.stdin.write(canvas.tobytes());frames+=1
            if frames%16==0:print(json.dumps({'videoFrames':frames,'total':packet['frames']}),flush=True)
        if source.wait()!=0 or frames!=packet['frames']:raise RuntimeError('Incomplete A/B wave stream')
        encoder.stdin.close()
        if encoder.wait()!=0:raise RuntimeError('ffmpeg failed')
        partial.replace(video)
        report={'passed':True,'scope':__doc__.strip(),'frames':frames,'fps':fps,'duration':frames/fps,'width':vw,'height':vh,'sourceHashes':{label.lower():trace['sourceHashes'] for label,trace in zip(packet['labels'],traces)},'renderer':renderer.info,'shaderValidation':renderer.compile_report,'samples':samples,'video':video.name,'bytes':video.stat().st_size}
        (output/'arm-wave-video-report.json').write_text(json.dumps(report,indent=2)+'\n')
    finally:
        if renderer:renderer.close()
        if source.poll()is None:source.terminate()
        if encoder and encoder.poll()is None:encoder.terminate()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',type=Path)
    parser.add_argument('--output',type=Path,default=HERE.parent/'output/arm-study')
    parser.add_argument('--phase',default='.485')
    parser.add_argument('--reuse-captures',action='store_true')
    parser.add_argument('--video',action='store_true')
    parser.add_argument('--fps',type=int,default=16)
    args=parser.parse_args();output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    baseline=args.baseline.resolve()if args.baseline else None
    if not args.reuse_captures:
        command=['node',str(HERE/'capture-arm-study.mjs'),'--output',str(output),'--phase',args.phase]
        if baseline:command+=['--baseline',str(baseline)]
        subprocess.run(command,check=True)
    manifest=json.loads((output/'arm-study-manifest.json').read_text());module=renderer_module()
    renderer=module.EGLRenderer(manifest['width'],manifest['height']);results=[];failures=[]
    try:
        for case in manifest['cases']:
            trace=json.loads((output/(case['name']+'.trace.json')).read_text())
            renderer.draw_report=[];renderer.compile_report=[]
            report=renderer.render(trace,output/(case['name']+'.png'))
            errors=[error for draw in report['draws'] for error in draw['errors']]
            if errors or report['draw_calls']!=3 or report['indexed_draw_calls']!=2:failures.append(case['name'])
            results.append({**case,'drawCalls':report['draw_calls'],'indexedDrawCalls':report['indexed_draw_calls'],'glErrors':errors,'shaderValidation':report['shader_validation']})
            print(json.dumps({'rendered':case['name'],'glErrors':errors}),flush=True)
        renderer_info=renderer.info
    finally:renderer.close()
    def ordered(kind):
        return[c for version in ['before','after']for c in results if c['version']==version and c['kind']==kind]
    sheet(output,ordered('surface'),'arm-surface-before-after.png','DUDERLAB / SHOULDERS + UNDERARMS','Production shaders. Same recipe, pose, camera and scale; baseline above, current below.')
    sheet(output,ordered('weights'),'arm-weights-before-after.png','DUDERLAB / WAVING ARM INFLUENCE','Bind pose. Diagnostic colors show the actual combined upper-arm + forearm weights.',legend=True)
    sheet(output,ordered('motion'),'arm-wave-keyframes.png','DUDERLAB / WAVE DEFORMATION','Matched lift, wave-in, wave-out and settle frames. Baseline above; current below.',columns=4)
    report={'passed':not failures,'scope':__doc__.strip(),'failures':failures,'renderer':renderer_info,'recipe':manifest['recipe'],'phase':manifest['phase'],'cases':results}
    (output/'arm-study-report.json').write_text(json.dumps(report,indent=2)+'\n')
    if failures:raise SystemExit(1)
    if args.video:
        if not baseline:raise ValueError('--video requires --baseline')
        render_video(module,output,baseline,args.fps)
    print(json.dumps({'passed':True,'cases':len(results),'output':str(output)}),flush=True)

if __name__=='__main__':main()
