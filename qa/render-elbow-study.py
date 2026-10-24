#!/usr/bin/env python3
"""Actual GLSL replay close-ups for the elbow pinch regression.

The pass flag verifies shader execution and draw counts, not aesthetic quality.
Inspect the front, side and back images and full sweep before accepting a fix.
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

def sheet(output,cases,name,title,subtitle,columns):
    if not cases:return
    w,h=640,640;gutter=16;header=98;label=36
    rows=(len(cases)+columns-1)//columns
    canvas=Image.new('RGB',(columns*w+(columns+1)*gutter,header+rows*(h+label+gutter)),'#f4f1e9')
    draw=ImageDraw.Draw(canvas);draw.text((20,14),title,font=font(28),fill='#172129');draw.text((20,54),subtitle,font=font(16),fill='#56636b')
    for i,case in enumerate(cases):
        x=gutter+(i%columns)*(w+gutter);y=header+(i//columns)*(h+label+gutter)
        canvas.paste(Image.open(output/(case['name']+'.png')).convert('RGB'),(x,y))
        draw.text((x+10,y+h+7),case['label'],font=font(19),fill='#172129')
    canvas.save(output/name)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',type=Path)
    parser.add_argument('--output',type=Path,default=HERE.parent/'output/elbow-study')
    parser.add_argument('--quick',action='store_true')
    parser.add_argument('--reuse-captures',action='store_true')
    args=parser.parse_args();output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    if not args.reuse_captures:
        command=['node',str(HERE/'capture-elbow-study.mjs'),'--output',str(output)]
        if args.baseline:command+=['--baseline',str(args.baseline.resolve())]
        if args.quick:command+=['--quick']
        subprocess.run(command,check=True)
    manifest=json.loads((output/'elbow-manifest.json').read_text())
    spec=importlib.util.spec_from_file_location('duder_egl',HERE/'render-capture.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    renderer=module.EGLRenderer(manifest['width'],manifest['height']);results=[];failures=[]
    try:
        for case in manifest['cases']:
            trace=json.loads((output/(case['name']+'.trace.json')).read_text())
            renderer.draw_report=[];renderer.compile_report=[]
            report=renderer.render(trace,output/(case['name']+'.png'))
            errors=[error for draw in report['draws'] for error in draw['errors']]
            if errors or report['draw_calls']!=3 or report['indexed_draw_calls']!=2:failures.append(case['name'])
            results.append({**case,'drawCalls':report['draw_calls'],'indexedDrawCalls':report['indexed_draw_calls'],'glErrors':errors,'shaderValidation':report['shader_validation']})
            print(json.dumps({'rendered':case['name'],'drawCalls':report['draw_calls'],'glErrors':errors}),flush=True)
        renderer_info=renderer.info
    finally:renderer.close()
    comparison=[]
    for view in ['front','threequarter','side','back']:
        for version in ['before','after']:
            case=next((c for c in results if c['name']==f'{version}-elbow-{view}'),None)
            if case:comparison.append({**case,'label':version.upper()+' / '+case['label']})
    sheet(output,comparison,'elbow-before-after.png','ELBOW / BEFORE & AFTER','Exact screenshot recipe. Identical fixed camera; actual indexed shader rendering.',2)
    sheet(output,[c for c in comparison if c['view']=='front'],'elbow-front-before-after.png','ELBOW / FRONT COMPARISON','Same seed, held wave phase 0.80, smooth shell and outline.',2)
    sheet(output,[c for c in results if '-wave-' in c['name']],'elbow-wave-frames.png','ELBOW / WAVE EXTREMES','Both inward sweeps and both outward sweeps, followed by the held pose.',3)
    report={'passed':not failures,'failures':failures,'scope':__doc__.strip(),'renderer':renderer_info,'recipe':manifest['recipe'],'cases':results}
    (output/'elbow-render-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passed':not failures,'cases':len(results),'output':str(output)}))
    if failures:raise SystemExit(1)

if __name__=='__main__':main()
