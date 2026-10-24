/** Regression for the pictured elbow bite: detect local posed face reversals.
 * This complements visual shader replay. A positive result alone cannot prove
 * a pleasing silhouette; finite normals and welded vertices alone missed it.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--source',path.join(here,'..'))),output=path.resolve(arg('--report',path.join(here,'elbow-deformation-report.json')));
const sourceHashes={},context={Float32Array,Uint32Array};vm.createContext(context);
for(const name of ['core','shell','geometry','animation']){
  const source=fs.readFileSync(path.join(root,'src',name+'.js'),'utf8');
  sourceHashes[name+'.js']=crypto.createHash('sha256').update(source).digest('hex');vm.runInContext(source,context);
}
const C=context.DuderCore,A=context.DuderAnimation,sub=(a,b)=>a.map((v,k)=>v-b[k]);
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const cases=[],failures=[],phases=[0,.20,.29,.375,.485,.595,.705,.80,.94];
const sourceRecipe=C.randomRecipe(1702468274);
for(const facets of [8,12,16]){
  const recipe=C.sanitizeRecipe({...sourceRecipe,facets,pattern:0,hat:'none',glasses:'none'}),g=context.DuderGeometry.build(recipe),parts=C.primitives(recipe);
  for(const phase of phases){
    const pose=A.sample(recipe,'wave',phase*4),baked=C.bake(g,recipe,true,pose),inverse=pose.transforms.map(C.rigidInverse);
    function field(p){
      let d=1e9;const scale=Math.min(1,recipe.depth);
      for(let i=0;i<7;i++){
        const q=C.transformPoint(inverse[i],p);q[2]/=recipe.depth;
        let di=C.sdRC(q,parts[i]);if(i>=5)di=Math.max(di,-q[1]);di*=scale;
        const k=Math.max(1e-4,recipe.blend*C.blendScales[i]*scale),h=clamp(.5+.5*(di-d)/k,0,1);d=di+(d-di)*h-k*h*(1-h);
      }return d;
    }
    let triangles=0,reversals=0,minimumAlignment=1,minimumFieldAlignment=1,minimumAreaRatio=Infinity;const worst=[];
    for(let i=0;i<g.positions.length;i+=9){
      if(g.meta[i/3*4+1]<0)continue;
      const rest=[0,1,2].map(k=>Array.from(g.positions.slice(i+k*3,i+k*3+3))),restCenter=[0,1,2].map(k=>(rest[0][k]+rest[1][k]+rest[2][k])/3);
      const local=parts[2],radius=local.ra;
      if(Math.hypot(...sub(restCenter,local.a))>radius*2.5)continue;
      const vertices=[0,1,2].map(k=>Array.from(baked.positions.slice(i+k*3,i+k*3+3))),center=[0,1,2].map(k=>(vertices[0][k]+vertices[1][k]+vertices[2][k])/3);
      const face=cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])),n=[0,1,2].map(k=>baked.normals[i+k]+baked.normals[i+3+k]+baked.normals[i+6+k]),area=Math.hypot(...face);
      const restPhysical=rest.map(p=>[p[0],p[1],p[2]*recipe.depth]),restArea=Math.hypot(...cross(sub(restPhysical[1],restPhysical[0]),sub(restPhysical[2],restPhysical[0]))),alignment=dot(face,n)/Math.max(1e-15,area*Math.hypot(...n));
      const e=.001,gradient=[0,1,2].map(k=>{const p=center.slice(),q=center.slice();p[k]+=e;q[k]-=e;return field(p)-field(q);});
      const fieldAlignment=dot(face,gradient)/Math.max(1e-15,area*Math.hypot(...gradient));
      triangles++;if(alignment<-.1)reversals++;
      minimumAlignment=Math.min(minimumAlignment,alignment);minimumFieldAlignment=Math.min(minimumFieldAlignment,fieldAlignment);minimumAreaRatio=Math.min(minimumAreaRatio,area/restArea);
      worst.push({triangle:i/9,alignment,fieldAlignment,areaRatio:area/restArea,center});
    }
    const result={facets,phase,triangles,reversals,minimumAlignment,minimumFieldAlignment,minimumAreaRatio,worst:worst.sort((a,b)=>a.alignment-b.alignment).slice(0,3)};
    cases.push(result);if(reversals)failures.push(`facets=${facets} phase=${phase}: ${reversals} local face reversal(s)`);
    console.log(JSON.stringify({facets,phase,reversals,minimumAlignment,minimumFieldAlignment}));
  }
}
const report={passed:failures.length===0,scope:'Exact screenshot seed across all three facet levels and wave extremes. Flag local triangle winding that opposes the smoothed outward normals by more than 0.1. Independent posed SDF-gradient alignment and area ratios are recorded as diagnostics. Visual close-ups are also required.',sourceHashes,seed:1702468274,phases,failures,cases};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,cases:cases.length,failures,report:output}));
if(failures.length)process.exitCode=1;
