#!/usr/bin/env python3
"""Matched shoulder surface and wireframe proof from unmodified production GLSL."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
CAPTURE = r'''
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[1]),out=path.resolve(process.argv[2]);
fs.mkdirSync(out,{recursive:true});
const {createCaptureSession}=await import(pathToFileURL(path.join(root,'qa/capture-frame.mjs')));
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),context);
const recipe=context.DuderCore.sanitizeRecipe({...context.DuderCore.randomRecipe(1702468274),pattern:0,outfit:'none',hat:'beanie',glasses:'none'});
const cases=[['bind-wire',0,false,true,-.5],['raised-surface',1.88,true,false,-.5],['raised-wire',1.88,true,true,-.5],['raised-back',1.88,true,false,Math.PI+.5],['settled-surface',3.76,true,false,-.5]];
for(const[name,time,motion,wireframe,yaw]of cases){
 const session=await createCaptureSession({mode:'focus',motionClip:motion?'wave':null,selected:0,onlyScene:true,animate:false,smooth:true,wireframe,outlines:!wireframe,showRig:false,yaw,pitch:.03,zoom:2.7,width:640,height:640,recipe});
 session.renderer.target=[-.47,1.15,.02];session.renderer.restRadius=1.2;
 fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(session.frame(time)));
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=HERE.parent/'output/shoulder-closeups')
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location('duder_egl', HERE/'render-capture.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    renderer = module.EGLRenderer(640, 640)
    reports = []
    try:
        for version, root in [('before', args.baseline.resolve()), ('after', HERE.parent)]:
            folder = output/version
            subprocess.run(['node', '--input-type=module', '-e', CAPTURE, str(root), str(folder)], check=True)
            for name in ['bind-wire', 'raised-surface', 'raised-wire', 'raised-back', 'settled-surface']:
                trace = json.loads((folder/(name+'.json')).read_text())
                renderer.draw_report = []
                renderer.compile_report = []
                rendered = renderer.render(trace, folder/(name+'.png'))
                errors = [error for draw in rendered['draws'] for error in draw['errors']]
                expected = 2 if name.endswith('wire') else 3
                if errors or rendered['draw_calls'] != expected:
                    raise RuntimeError(f'{version}/{name}: GL errors or unexpected draws')
                reports.append({'version': version, 'view': name, 'sourceHashes': trace['sourceHashes'],
                                'stats': trace['stats'], 'render': rendered})
    finally:
        renderer.close()
    canvas = Image.new('RGB', (1304, 1378), '#f4f1e9')
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype('DejaVuSans.ttf', 22)
    except OSError:
        font = ImageFont.load_default()
    for row, name in enumerate(['raised-surface', 'raised-wire']):
        for column, version in enumerate(['before', 'after']):
            x, y = 8+column*648, 42+row*680
            label = ('BEFORE / V3.4.5' if version == 'before' else 'AFTER / V3.4.6')
            if row:
                label += ' / WIREFRAME'
            draw.text((x+6, y-32), label, font=font, fill='#172129')
            canvas.paste(Image.open(output/version/(name+'.png')).convert('RGB'), (x, y))
    canvas.save(output/'shoulder-closeup-before-after.png')
    report = {'passed': True, 'scope': __doc__, 'baseline': str(args.baseline.resolve()),
              'time': 1.88, 'camera': {'yaw': -.5, 'pitch': .03, 'zoom': 2.7, 'target': [-.47, 1.15, .02]},
              'captures': reports}
    (output/'shoulder-closeups-report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'passed': True, 'captures': len(reports), 'output': str(output)}))


if __name__ == '__main__':
    main()
