#!/usr/bin/env python3
"""Render capture-leg-study.mjs cases into a reproducible before/after sheet."""
import argparse,importlib.util,json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
p=argparse.ArgumentParser();p.add_argument('directory',type=Path);a=p.parse_args()
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('duder_render',root/'render-capture.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
manifest=json.loads((a.directory/'manifest.json').read_text());cases=manifest['cases'];names=list(dict.fromkeys(c['name'] for c in cases));versions=list(dict.fromkeys(c['version'] for c in cases))
font=ImageFont.load_default(size=17)
sheet=Image.new('RGB',(480*len(versions),480*len(names)),(245,243,237));draw=ImageDraw.Draw(sheet);renderer=m.EGLRenderer(480,440);reports=[]
try:
 for case in cases:
  trace=json.loads((a.directory/(case['tag']+'.trace.json')).read_text());out=a.directory/(case['tag']+'.png')
  result=renderer.render(trace,out);reports.append({'case':case['tag'],'stats':case['stats'],'sourceHashes':case['sourceHashes'],'renderer':result['renderer'],'draws':result['draws'][-len(trace['draws']):]})
  x=versions.index(case['version'])*480;y=names.index(case['name'])*480
  sheet.paste(Image.open(out),(x,y+40));draw.text((x+16,y+12),case['label']+' / '+case['version'].upper(),font=font,fill=(30,40,48))
finally:renderer.close()
sheet.save(a.directory/'leg-before-after.png')
(a.directory/'leg-render-report.json').write_text(json.dumps({'scope':manifest['scope'],'cases':reports},indent=2)+'\n')
print(json.dumps({'image':str(a.directory/'leg-before-after.png'),'renders':len(reports)}))
