import {fileURLToPath} from 'node:url';import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const f of ['core','shell','geometry'])vm.runInThisContext(fs.readFileSync(path.join(root,'src',f+'.js'),'utf8'));
const C=globalThis.DuderCore,S=globalThis.DuderShell,G=globalThis.DuderGeometry;
const shapes=[...([8,12,16].map(facets=>({...C.baseDefaults(),facets})))];
for(let mask=0;mask<32;mask++)shapes.push(C.sanitizeRecipe({...C.baseDefaults(),height:mask&1?.75:1.3,width:mask&2?.75:1.3,armLength:mask&4?.7:1.4,armThickness:mask&8?.65:1.35,armGap:mask&16?0:.24,belly:mask%3===0?1.2:.8,blend:mask%3===0?.03:.22,feet:mask%4===0?1.3:.7}));
let totalTriangles=0,maxMs=0,maxRefinements=0,failed=[],checks=[];
for(let index=0;index<shapes.length;index++){
 const r=shapes[index],start=performance.now();
 try{const s=S.build(r),n=s.indexedPositions.length/3,adj=Array.from({length:n},()=>new Set()),edges=new Map();
 for(let i=0;i<s.indices.length;i+=3){let tri=Array.from(s.indices.slice(i,i+3));for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;edges.set(key,(edges.get(key)||0)+1);adj[a].add(b);adj[b].add(a);}}
 const visited=new Set([0]),stack=[0];while(stack.length){let a=stack.pop();for(const b of adj[a])if(!visited.has(b)){visited.add(b);stack.push(b);}}
 if(visited.size!==n)throw Error(`Disconnected shell ${visited.size}/${n}`);if([...edges.values()].some(c=>c!==2))throw Error('Nonmanifold edge');if([...s.positions,...s.normals].some(v=>!Number.isFinite(v)))throw Error('Nonfinite shell');
 let minY=Infinity;for(let i=1;i<s.positions.length;i+=3)minY=Math.min(minY,s.positions[i]);if(Math.abs(minY)>1e-6)throw Error('Sole not grounded');
 const g=G.build(r),weights=g.skinWeights;for(let i=0;i<weights.length;i+=4){let sum=0;for(let k=0;k<4;k++){sum+=weights[i+k];if(weights[i+k]<0||!Number.isFinite(weights[i+k])||g.skinIndices[i+k]<0||g.skinIndices[i+k]>6)throw Error('Bad skin data');}if(Math.abs(sum-1)>1e-6)throw Error('Weights do not sum to one');}
 totalTriangles+=s.triangleCount;maxRefinements=Math.max(maxRefinements,s.stats.refinements);const ms=performance.now()-start;maxMs=Math.max(maxMs,ms);checks.push({index,triangles:s.triangleCount,refinements:s.stats.refinements,ms:+ms.toFixed(2)});
 }catch(e){failed.push({index,message:e.message,recipe:r});}
}
const r=C.baseDefaults(),parts=C.primitives(r),gap=C.field([.60,.73,.02],parts,r.blend),neutral=G.build(r),bake=C.bake(neutral,r),glb=C.glb(bake,r);if(gap<.025)failed.push({message:'Underarm void missing',gap});
const report={shapes:shapes.length,totalTriangles,maxRefinements,maxMs:+maxMs.toFixed(2),defaultUnderarmSignedDistance:gap,neutralGlbBytes:glb.byteLength,checks,failed};
fs.writeFileSync(path.join(root,'qa','shell-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failed.length)process.exitCode=1;
