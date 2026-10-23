#!/usr/bin/env python3
"""Render an actual application wave study with the shipped GLSL on Mesa GLES.

This provides fixed-camera keyframes, a held-pose turntable, and optional
before/after proof. It is not browser interaction or a hardware FPS benchmark.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent

def font(size):
    try:return ImageFont.truetype('DejaVuSans.ttf',size)
    except OSError:return ImageFont.load_default()

def sheet(output,cases,name,title,subtitle,columns=4):
    if not cases:return
    w,h=480,440;gutter=14;header=100;label=36
    rows=(len(cases)+columns-1)//columns
    canvas=Image.new('RGB',(columns*w+(columns+1)*gutter,header+rows*(h+label+gutter)), '#f4f1e9')
    draw=ImageDraw.Draw(canvas);draw.text((20,16),title,font=font(28),fill='#172129');draw.text((20,56),subtitle,font=font(16),fill='#56636b')
    for i,case in enumerate(cases):
        x=gutter+(i%columns)*(w+gutter);y=header+(i//columns)*(h+label+gutter)
        canvas.paste(Image.open(output/(case['name']+'.png')).convert('RGB'),(x,y))
        draw.text((x+10,y+h+8),case['label'],font=font(18),fill='#172129')
    canvas.save(output/name)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',type=Path)
    parser.add_argument('--baseline-only',action='store_true')
    parser.add_argument('--held-only',action='store_true')
    parser.add_argument('--projection-strength',default='.55')
    parser.add_argument('--output',type=Path,default=HERE.parent/'output/wave-study')
    parser.add_argument('--held-phase',default='.80')
    parser.add_argument('--phases',default='0,.08,.22,.375,.485,.595,.705,.94')
    parser.add_argument('--reuse-captures',action='store_true')
    args=parser.parse_args();output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    if not args.reuse_captures:
        command=['node',str(HERE/'capture-wave-study.mjs'),'--output',str(output),'--held-phase',args.held_phase,'--phases',args.phases,'--projection-strength',args.projection_strength]
        if args.baseline:command+=['--baseline',str(args.baseline.resolve())]
        if args.baseline_only:command+=['--baseline-only']
        if args.held_only:command+=['--held-only']
        subprocess.run(command,check=True)
    manifest=json.loads((output/'manifest.json').read_text())
    spec=importlib.util.spec_from_file_location('duder_egl',HERE/'render-capture.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    renderer=module.EGLRenderer(480,440);results=[];failures=[]
    try:
        for case in manifest['cases']:
            trace=json.loads((output/(case['name']+'.trace.json')).read_text())
            renderer.draw_report=[];renderer.compile_report=[]
            report=renderer.render(trace,output/(case['name']+'.png'))
            errors=[e for draw in report['draws'] for e in draw['errors']]
            expected=4 if case['showRig'] else 3
            if errors or report['draw_calls']!=expected or report['indexed_draw_calls']!=2:failures.append(case['name'])
            results.append({**case,'drawCalls':report['draw_calls'],'indexedDrawCalls':report['indexed_draw_calls'],'glErrors':errors,'shaderValidation':report['shader_validation']})
            print(json.dumps({'rendered':case['name'],'drawCalls':report['draw_calls'],'glErrors':errors}),flush=True)
        renderer_info=renderer.info
    finally:renderer.close()
    after=[c for c in results if c['version']=='after' and not c['showRig']]
    sheet(output,after,'v3-2-wave-study.png','DUDER — WAVE STUDY / ACTUAL CODE','Held greeting turntable + fixed-camera wave keyframes. Smooth seven-bone mesh; existing shell outlines.')
    beforeafter=[]
    for version in ['before','after']:
        for view in ['front','threequarter','side']:
            case=next((c for c in results if c['name']==f'{version}-held-{view}'),None)
            if case:beforeafter.append({**case,'label':('V3.1.1' if version=='before' else 'V3.2')+' / '+case['label']})
    sheet(output,beforeafter,'v3-2-wave-before-after.png','WAVE / BEFORE & AFTER','Same recipe, camera, scale, and normalized held phase. Actual application shader replay.',3)
    rigs=[c for c in results if c['showRig']]
    sheet(output,rigs,'v3-2-wave-rig.png','WAVE / RIG VIEW','The same seven bones drive the surface and initialize the ragdoll bodies.',3)
    report={'passed':not failures,'failures':failures,'verificationScope':__doc__.strip(),'renderer':renderer_info,'seed':manifest['seed'],'recipe':manifest['recipe'],'heldPhase':manifest['heldPhase'],'phases':manifest['phases'],'cases':results}
    (output/'wave-study-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passed':not failures,'cases':len(results),'output':str(output)}))
    if failures:raise SystemExit(1)

if __name__=='__main__':main()
