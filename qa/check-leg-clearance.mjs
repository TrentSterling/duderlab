/** Regress the readable two-leg silhouette, including the narrow/large-foot bug.
 * Checks the actual SDF and horizontal slices of the welded, posed triangle mesh.
 * The requirement is neutral/idle clearance; ragdoll contacts may touch naturally.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--source',path.join(path.dirname(fileURLToPath(import.meta.url)),'..')));
const reportPath=path.resolve(arg('--report',path.join(root,'qa/leg-clearance-report.json')));
const context={TextEncoder,performance};vm.createContext(context);
const sourceHashes={};
for(const name of ['core','shell','geometry','animation']){
 const source=fs.readFileSync(path.join(root,'src',name+'.js'),'utf8');sourceHashes[name+'.js']=crypto.createHash('sha256').update(source).digest('hex');
 vm.runInContext(source,context);
}
const testSha256=crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
const {DuderCore:C,DuderShell:S,DuderGeometry:G,DuderAnimation:A}=context;
const recipes=[];
for(let mask=0;mask<32;mask++)recipes.push(C.sanitizeRecipe({...C.baseDefaults(),name:'proportion-corner-'+mask,height:mask&1?.75:1.3,width:mask&2?.75:1.3,belly:mask&4?.8:1.2,feet:mask&8?.7:1.3,blend:mask&16?.03:.22,facets:mask%3===0?8:mask%3===1?12:16,hat:'none',glasses:'none',pattern:0}));
for(let i=0;i<256;i++)recipes.push(C.sanitizeRecipe({...C.randomRecipe(i*10789),name:'seed-'+i*10789,hat:'none',glasses:'none',pattern:0}));
const failures=[];let minField=Infinity,fieldSamples=0,minMeshGap=Infinity,meshSlices=0,meshRecipes=0,posedBakes=0,maxRefinements=0;
const worst={field:null,mesh:null},checks=[];
// A true air corridor must survive smoothing below the torso; front-view
// projection checks all Z, rather than sampling only the bean's center plane.
for(const r of recipes){
 const parts=C.primitives(r);let localMin=Infinity;
 for(const x of [-.04*r.width,0,.04*r.width])for(const y of [.025,.06,.10,.14])for(let zi=-10;zi<=10;zi++){
  const d=C.field([x,y,zi*.03],parts,r.blend);fieldSamples++;localMin=Math.min(localMin,d);
 }
 if(localMin<minField){minField=localMin;worst.field={recipe:r.name,distance:localMin};}
 if(localMin<=.002)failures.push({check:'SDF air corridor',recipe:r.name,minDistance:localMin});
}
function gapAt(positions,height){
 let left=-Infinity,right=Infinity,blocked=false;
 for(let i=0;i<positions.length;i+=9){
  const tri=[0,1,2].map(k=>Array.from(positions.slice(i+k*3,i+k*3+3)));
  const intersections=[];
  for(let k=0;k<3;k++){
   const a=tri[k],b=tri[(k+1)%3],da=a[1]-height,db=b[1]-height;
   if((da<=0&&db>0)||(db<=0&&da>0)){const t=da/(da-db);intersections.push(a[0]+t*(b[0]-a[0]));}
  }
  if(intersections.length>=2){
   const lo=Math.min(...intersections),hi=Math.max(...intersections);
   if(lo<=0&&hi>=0)blocked=true;
   else if(hi<0)left=Math.max(left,hi);else if(lo>0)right=Math.min(right,lo);
  }
 }
 return blocked?0:Number.isFinite(left)&&Number.isFinite(right)?right-left:NaN;
}
function lowerMesh(geometry){
 // Keep complete source triangles with a generous margin above the slice band.
 // Idle rotations are tiny; upper-body shading is irrelevant to leg clearance.
 const attributes={positions:3,normals:3,colors:3,meta:4,skinIndices:4,skinWeights:4};
 const data=Object.fromEntries(Object.keys(attributes).map(key=>[key,[]]));
 for(let i=0;i<geometry.positions.length/3;i+=3){
  if(Math.min(...[0,1,2].map(k=>geometry.positions[(i+k)*3+1]))>.30)continue;
  for(const [key,size]of Object.entries(attributes))for(let k=0;k<3;k++)data[key].push(...geometry[key].subarray((i+k)*size,(i+k+1)*size));
 }
 return Object.fromEntries(Object.entries(data).map(([key,values])=>[key,new Float32Array(values)]));
}
function connectedShell(s){
 const n=s.indexedPositions.length/3,neighbors=Array.from({length:n},()=>[]),edges=new Map();
 for(let i=0;i<s.indices.length;i+=3)for(let k=0;k<3;k++){
  const a=s.indices[i+k],b=s.indices[i+(k+1)%3],key=a<b?a+','+b:b+','+a;
  edges.set(key,(edges.get(key)||0)+1);neighbors[a].push(b);neighbors[b].push(a);
 }
 const seen=new Set([0]),stack=[0];while(stack.length)for(const b of neighbors[stack.pop()])if(!seen.has(b)){seen.add(b);stack.push(b);}
 return seen.size===n&&[...edges.values()].every(n=>n===2);
}
// Full corners exercise large feet, tiny/large bodies, thick blend and all three
// mesh densities. Seeded cases catch non-extreme recipes with the same failure.
for(const r of [...recipes.slice(0,32),...recipes.slice(32,48)]){
 let recipeMin=Infinity;
 try{
  const shell=S.build(r);maxRefinements=Math.max(maxRefinements,shell.stats.refinements);meshRecipes++;
  if(!connectedShell(shell))throw Error('Leg change detached a component or opened an edge');
  const geometry=lowerMesh(G.build(r));
  for(const [clip,phase] of [['wave',0],['idle',0],['idle',.25],['idle',.5],['idle',.75]]){
   const duration=A.clips.find(c=>c.id===clip).duration,pose=A.sample(r,clip,phase*duration),baked=C.bake(geometry,r,true,pose),unpose=C.rigidInverse(pose.transforms[0]);posedBakes++;
   const local=new Float64Array(baked.positions.length);for(let i=0;i<local.length;i+=3)local.set(C.transformPoint(unpose,Array.from(baked.positions.slice(i,i+3))),i);
   for(const y of [.035,.07,.105,.14]){
    const gap=gapAt(local,y);meshSlices++;recipeMin=Math.min(recipeMin,gap);
    if(gap<minMeshGap){minMeshGap=gap;worst.mesh={recipe:r.name,clip,phase,height:y,gap};}
    if(!Number.isFinite(gap)||gap<.055*r.width)failures.push({check:'Posed mesh silhouette gap',recipe:r.name,clip,phase,height:y,gap,minimum:.055*r.width});
   }
  }
  checks.push({recipe:r.name,meshGap:recipeMin,triangles:shell.triangleCount,refinements:shell.stats.refinements});
  if(meshRecipes%12===0)console.log(JSON.stringify({progress:meshRecipes,total:48,minMeshGap,failures:failures.length}));
 }catch(error){failures.push({check:'Mesh construction',recipe:r.name,message:error.message});}
}
// Editing Blend changes foot spacing while all other shape controls stay fixed.
// Exercise both cache directions so the idle rig cannot retain stale foot centers.
let cacheCases=0,maxCachePointError=0;
for(const blend of [.03,.22,.03,.16,.22]){
 const r=C.sanitizeRecipe({...C.baseDefaults(),width:.75,feet:1.3,blend}),pose=A.sample(r,'idle',.37),rig=C.rigDefinition(r);
 for(let bone=0;bone<7;bone++)for(const endpoint of ['a','b']){
  const expected=C.transformPoint(pose.transforms[bone],rig.parts[bone][endpoint]);
  const error=Math.hypot(...expected.map((v,k)=>v-pose.parts[bone][endpoint][k]));maxCachePointError=Math.max(maxCachePointError,error);cacheCases++;
  if(error>1e-6)failures.push({check:'Blend edit invalidates animation bind cache',blend,bone,endpoint,error});
 }
}
const report={source:root,sourceHashes,testSha256,coreVersion:C.version,cacheCases,maxCachePointError,scope:'Clear legs in neutral and mild idle; arbitrary collision poses may touch.',recipes:recipes.length,fieldSamples,minFieldDistance:minField,meshRecipes,posedBakes,meshSlices,minMeshGap,maxRefinements,worst,checks,failures};
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,checks:undefined,failures:failures.slice(0,12),failureCount:failures.length}));
if(failures.length)process.exitCode=1;
