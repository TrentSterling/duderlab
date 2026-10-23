import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const name of ['core','shell','geometry','animation'])vm.runInThisContext(fs.readFileSync(path.join(root,'src',name+'.js'),'utf8'),{filename:name+'.js'});
const C=globalThis.DuderCore,A=globalThis.DuderAnimation,G=globalThis.DuderGeometry;
const assert=(v,m)=>{if(!v)throw Error(m);},distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const normalized=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);},dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const recipes=[C.baseDefaults(),C.sanitizeRecipe({...C.baseDefaults(),height:.75,width:1.3,belly:1.2,depth:.62,armLength:1.4,armGap:0,armThickness:1.35,feet:1.3}),C.sanitizeRecipe({...C.baseDefaults(),height:1.3,width:.75,belly:.8,depth:1.24,armLength:.7,armGap:.24,armThickness:.65,feet:.7})];
const report={clips:A.clips.map(c=>c.id),samples:0,bakedSamples:0,maxJointGap:0,maxRigidError:0,maxLoopError:0,maxShoulderSwing:0,maxHipSwing:0,minBakedY:Infinity,maxBounds:0,clipTravel:{}};
for(const recipe of recipes){
 const rig=C.rigDefinition(recipe),geometry=G.build(recipe);
 for(const clip of A.clips){
  const p0=A.sample(recipe,clip.id,0,{amplitude:1.25}),p1=A.sample(recipe,clip.id,clip.duration,{amplitude:1.25});
  for(let i=0;i<7;i++)for(let k=0;k<16;k++)report.maxLoopError=Math.max(report.maxLoopError,Math.abs(p0.transforms[i][k]-p1.transforms[i][k]));
  const motion=Array.from({length:7},()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}));
  for(let f=0;f<64;f++){
   const pose=A.sample(recipe,clip.id,clip.duration*f/64,{amplitude:1.25});report.samples++;
   for(const m of pose.transforms){assert([...m].every(Number.isFinite),'Nonfinite transform');for(let i=0;i<3;i++)for(let j=0;j<3;j++){let q=0;for(let k=0;k<3;k++)q+=m[i*4+k]*m[j*4+k];report.maxRigidError=Math.max(report.maxRigidError,Math.abs(q-(i===j?1:0)));}}
   for(const j of pose.joints)report.maxJointGap=Math.max(report.maxJointGap,distance(j.a,j.b));
   for(const j of rig.joints)if(j.type==='cone'){
    const part=rig.parts[j.child],restDirection=part.b.map((v,k)=>v-part.a[k]),a=normalized(C.transformVector(pose.transforms[j.parent],restDirection)),b=normalized(C.transformVector(pose.transforms[j.child],restDirection)),angle=Math.acos(Math.max(-1,Math.min(1,dot(a,b))));
    if(j.child<5)report.maxShoulderSwing=Math.max(report.maxShoulderSwing,angle);else report.maxHipSwing=Math.max(report.maxHipSwing,angle);
    assert(angle<j.angle+1e-5,'Cone limit exceeded');
   }
   for(let i=0;i<7;i++)for(let k=0;k<3;k++){motion[i].min[k]=Math.min(motion[i].min[k],pose.parts[i].b[k]);motion[i].max[k]=Math.max(motion[i].max[k],pose.parts[i].b[k]);}
   assert(pose.groundClearance>=.00299,'Analytic foot penetrated floor');
   report.maxBounds=Math.max(report.maxBounds,...pose.bounds.max.map(Math.abs),...pose.bounds.min.map(Math.abs));
   if(f%16===0){const baked=C.bake(geometry,recipe,false,pose);report.bakedSamples++;assert([...baked.positions,...baked.normals].every(Number.isFinite),'Nonfinite posed mesh');for(let k=1;k<baked.positions.length;k+=3)report.minBakedY=Math.min(report.minBakedY,baked.positions[k]);}
  }
  if(recipe===recipes[0])report.clipTravel[clip.id]=motion.map(m=>m.max.map((v,k)=>v-m.min[k]));
 }
}
assert(report.maxJointGap<1e-5,'Joint disconnect');assert(report.maxRigidError<1e-5,'Nonrigid matrix');assert(report.maxLoopError<1e-6,'Loop discontinuity');assert(report.minBakedY>-.005,'Posed shell penetrated floor');
assert(report.clipTravel.walk[5][2]>.15&&report.clipTravel.walk[6][2]>.15,'Walk stride too small');assert(report.clipTravel.wave[4][1]>.15,'Wave hand raise too small');assert(report.clipTravel.dance[0][0]>.15,'Dance sway too small');
fs.writeFileSync(path.join(root,'qa','animation-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
