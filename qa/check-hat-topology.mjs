/** Actual baked hat topology: position welding, closed oriented edge incidence,
 * post-Float32 degeneracy, connected solid volumes, and same-component T junctions.
 * Separate overlapping trim/visor solids are reported; this is not a CSG test.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const arg=process.argv.indexOf('--source');
const root=arg>=0?path.resolve(process.argv[arg+1]):path.resolve(here,'..');
const c={console};c.window=c;c.globalThis=c;vm.createContext(c);
for(const name of ['core.js','shell.js','geometry.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',name),'utf8'),c,{filename:name});
const sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const eps=1e-6,checks=[],failures=[];
for(const hat of c.DuderGeometry.hatNames.filter(x=>x!=='none'))for(const facets of [8,12,16])for(const depth of [.62,1,1.24]){
  const r={...c.DuderCore.baseDefaults(),hat,glasses:'none',facets,depth};
  const g=c.DuderGeometry.build(r),lookup=new Map(),points=[],faces=[],edges=new Map();let degenerate=0;
  const sourceIndices=g.indices||Array.from({length:g.positions.length/3},(_,i)=>i);
  function weld(i){const p=Array.from(g.positions.slice(i*3,i*3+3)),key=p.map(x=>Math.round(x/eps)).join(',');if(!lookup.has(key)){lookup.set(key,points.length);points.push(p);}return lookup.get(key);}
  for(let i=0;i<sourceIndices.length;i+=3){
    const src=Array.from(sourceIndices.slice(i,i+3));if(src.some(v=>g.meta[v*4+2]!==1))continue;
    const f=src.map(weld),p=f.map(x=>points[x]);
    if(new Set(f).size<3||Math.hypot(...cross(sub(p[1],p[0]),sub(p[2],p[0])))<1e-10){degenerate++;continue;}
    const id=faces.length;faces.push(f);
    for(let k=0;k<3;k++){const a=f[k],b=f[(k+1)%3],key=Math.min(a,b)+','+Math.max(a,b);if(!edges.has(key))edges.set(key,{a:Math.min(a,b),b:Math.max(a,b),faces:[],orientation:0});const e=edges.get(key);e.faces.push(id);e.orientation+=a<b?1:-1;}
  }
  const badEdges=[...edges.values()].filter(e=>e.faces.length!==2),badWinding=[...edges.values()].filter(e=>e.faces.length===2&&e.orientation!==0);
  const adjacency=faces.map(()=>new Set());for(const e of edges.values())for(const a of e.faces)for(const b of e.faces)if(a!==b)adjacency[a].add(b);
  const remaining=new Set(faces.map((_,i)=>i)),components=[];let tJunctions=0;
  while(remaining.size){const seed=remaining.values().next().value,stack=[seed],ids=[],vertexSet=new Set();remaining.delete(seed);let volume=0;
    while(stack.length){const f=stack.pop();ids.push(f);for(const v of faces[f])vertexSet.add(v);const [a,b,d]=faces[f].map(v=>points[v]);volume+=dot(a,cross(b,d))/6;for(const n of adjacency[f])if(remaining.delete(n))stack.push(n);}
    const componentFaces=new Set(ids),componentEdges=[...edges.values()].filter(e=>componentFaces.has(e.faces[0]));
    for(const e of componentEdges){const a=points[e.a],ab=sub(points[e.b],a),len2=dot(ab,ab);for(const v of vertexSet){if(v===e.a||v===e.b)continue;const av=sub(points[v],a),t=dot(av,ab)/len2;if(t<eps||t>1-eps)continue;const delta=av.map((x,k)=>x-t*ab[k]);if(dot(delta,delta)<eps*eps)tJunctions++;}}
    components.push({triangles:ids.length,vertices:vertexSet.size,signedVolume:volume});
  }
  const entry={hat,facets,depth,triangles:faces.length,vertices:points.length,components,openOrNonmanifoldEdges:badEdges.length,inconsistentWindingEdges:badWinding.length,degenerateTriangles:degenerate,tJunctions};
  checks.push(entry);
  if(badEdges.length||badWinding.length||degenerate||tJunctions||components.some(x=>x.signedVolume<=0))failures.push({...entry,badEdgeSamples:badEdges.slice(0,6).map(e=>({a:points[e.a],b:points[e.b],incidence:e.faces.length})),windingSamples:badWinding.slice(0,6).map(e=>({a:points[e.a],b:points[e.b]}))});
}
const report={sourceRoot:root,checks:checks.length,passed:failures.length===0,failures,results:checks};
const output=path.join(here,root.endsWith('duder-lab-v3')?'hat-topology-v3-baseline.json':'hat-topology-report.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:checks.length,passed:report.passed,failures:failures.map(({hat,facets,depth,openOrNonmanifoldEdges,inconsistentWindingEdges,degenerateTriangles,tJunctions,components})=>({hat,facets,depth,openOrNonmanifoldEdges,inconsistentWindingEdges,degenerateTriangles,tJunctions,volumes:components.map(x=>x.signedVolume)})),report:output}));
if(failures.length)process.exitCode=1;
