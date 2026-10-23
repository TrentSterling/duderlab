import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..'),context={console};context.window=context;context.globalThis=context;vm.createContext(context);
for(const name of ['core.js','shell.js','geometry.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',name),'utf8'),context,{filename:name});
const recipes=context.DuderCore.presets();let shapes=0,shared=0,hardLightingSeams=0,maxWeldDelta=0,hiddenSmallParts=0;
for(const facets of [8,12,16])for(const hat of context.DuderGeometry.hatNames)for(const glasses of context.DuderGeometry.glassesNames){
 const r={...recipes[0],hat,glasses,facets},g=context.DuderGeometry.build(r,0),seen=new Map();
 assert.equal(g.outline.length,g.positions.length/3*4);
 for(let i=0;i<g.positions.length/3;i++){
  const kind=g.meta[i*4+2],v=Array.from(g.outline.slice(i*4,i*4+4));assert(v.every(Number.isFinite));
  assert(Math.abs(Math.hypot(...v.slice(0,3))-1)<1e-5,'Unit extrusion normal');
  if(kind===2||kind===3){assert.equal(v[3],0);hiddenSmallParts++;continue;}
  if(kind!==1)continue;
  const key=Array.from(g.positions.slice(i*3,i*3+3)).map(x=>Math.round(x*1e5)).join(',');
  const previous=seen.get(key),normal=Array.from(g.normals.slice(i*3,i*3+3));
  if(previous){const delta=Math.hypot(...v.slice(0,3).map((x,j)=>x-previous.v[j]));maxWeldDelta=Math.max(maxWeldDelta,delta);assert(delta<1e-5,'Shared accessory vertex has one extrusion direction');shared++;if(Math.hypot(...normal.map((x,j)=>x-previous.n[j]))>.1)hardLightingSeams++;}
  else seen.set(key,{v,n:normal});
 }
 shapes++;
}
const report={shapes,sharedAccessoryVertices:shared,preservedHardLightingSeams:hardLightingSeams,maxWeldDelta,suppressedEyeAndLensVertices:hiddenSmallParts};fs.writeFileSync(path.join(here,'outline-weld-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
