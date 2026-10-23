import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceHashes={};
for(const name of ['core','shell','geometry','animation']){const source=fs.readFileSync(path.join(root,'src',name+'.js'),'utf8');sourceHashes[name+'.js']=crypto.createHash('sha256').update(source).digest('hex');vm.runInThisContext(source,{filename:name+'.js'});}
const C=globalThis.DuderCore,A=globalThis.DuderAnimation,G=globalThis.DuderGeometry;
const assert=(v,m)=>{if(!v)throw Error(m);},distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const normalized=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);},dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const recipes=[C.baseDefaults(),C.sanitizeRecipe({...C.baseDefaults(),height:.75,width:1.3,belly:1.2,depth:.62,armLength:1.4,armGap:0,armThickness:1.35,feet:1.3}),C.sanitizeRecipe({...C.baseDefaults(),height:1.3,width:.75,belly:.8,depth:1.24,armLength:.7,armGap:.24,armThickness:.65,feet:.7})];
const report={sourceHashes,clips:A.clips.map(c=>c.id),samples:0,bakedSamples:0,maxJointGap:0,maxRigidError:0,maxLoopError:0,maxShoulderSwing:0,maxHipSwing:0,minBakedY:Infinity,maxBounds:0,clipTravel:{}};
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
assert(report.clipTravel.walk[5][2]>.15&&report.clipTravel.walk[6][2]>.15,'Walk stride too small');assert(report.clipTravel.wave[2][1]>.15,'Wave hand raise too small');assert(report.clipTravel.dance[0][0]>.15,'Dance sway too small');

// The old wave satisfied every rigid-joint test above while its forearm pointed
// into the camera. Check the visible greeting separately, without generating a
// mesh for every sample. These are readability requirements, not exact poses.
const waveRecipes=[C.baseDefaults(),...C.presets(),...[
 {name:'short-wide',height:.75,width:1.3,belly:1.2,depth:.62,armLength:1.4,armGap:0,armThickness:1.35,feet:1.3},
 {name:'tall-thin',height:1.3,width:.75,belly:.8,depth:1.24,armLength:.7,armGap:.24,armThickness:.65,feet:.7},
 {name:'short-thick-arms',armLength:.7,armThickness:1.35,armGap:0,blend:.22},
 {name:'long-wide-spread',armLength:1.4,armThickness:1.35,armGap:.24,armSpread:.22},
 {name:'short-wide-short-arms',height:.75,width:1.3,belly:1.2,armLength:.7,armThickness:1.35,armGap:0,armSpread:-.15,blend:.22},
 {name:'tall-thin-long-arms',height:1.3,width:.75,belly:.8,armLength:1.4,armThickness:.65,armGap:0,armSpread:-.15,blend:.03}
].map(r=>C.sanitizeRecipe({...C.baseDefaults(),...r}))];
// The zero-clearance, narrowest silhouette needs the shell's rare refinement
// fallback. Keep its greeting covered as well as its static welded geometry.
waveRecipes.push(C.sanitizeRecipe({...C.baseDefaults(),...Object.fromEntries(Object.entries(C.ranges).map(([key,range])=>[key,range[0]])),name:'all-minimum-dimensions'}));
const waveClip=A.clips.find(c=>c.id==='wave'),amplitudes=[0,1,1.25];
const waveReport=report.waveReadability={recipes:waveRecipes.map(r=>r.name),amplitudes,numericSamples:0,heldSamples:0,minForearmUp:Infinity,maxForearmForward:0,minProjectedHandClearanceByWidth:Infinity,minLateralSweepByForearmLength:Infinity,maxElbowToHandTravel:0,maxArmLengthError:0,maxZeroAmplitudeMotion:0,maxNearSeamStep:0,cases:[]};
const travel=points=>Math.hypot(...[0,1,2].map(k=>Math.max(...points.map(p=>p[k]))-Math.min(...points.map(p=>p[k]))));
for(const recipe of waveRecipes){
 const rig=C.rigDefinition(recipe);
 for(const amplitude of amplitudes){
  const first=A.sample(recipe,'wave',0,{amplitude});
  for(let f=0;f<=64;f++){
   const pose=A.sample(recipe,'wave',waveClip.duration*f/64,{amplitude});waveReport.numericSamples++;
   for(const i of [1,2,3,4]){
    const error=Math.abs(distance(pose.parts[i].a,pose.parts[i].b)-distance(rig.parts[i].a,rig.parts[i].b));waveReport.maxArmLengthError=Math.max(waveReport.maxArmLengthError,error);
    assert(error<1e-5,'Wave stretched an arm: '+recipe.name);
   }
   if(amplitude===0)for(let i=0;i<7;i++)for(let k=0;k<16;k++)waveReport.maxZeroAmplitudeMotion=Math.max(waveReport.maxZeroAmplitudeMotion,Math.abs(pose.transforms[i][k]-first.transforms[i][k]));
  }
  // Crossing the wrap must be a small time step. Testing exactly t=duration
  // against t=0 alone would miss a discontinuity immediately before the wrap.
  for(const clip of A.clips){
   const eps=.001,before=A.sample(recipe,clip.id,clip.duration-eps,{amplitude}),after=A.sample(recipe,clip.id,eps,{amplitude});
   for(let i=0;i<7;i++)for(const end of ['a','b']){
    const step=distance(before.parts[i][end],after.parts[i][end]);waveReport.maxNearSeamStep=Math.max(waveReport.maxNearSeamStep,step);
    assert(step<.015,'Loop wrap jumps: '+recipe.name+' / '+clip.id);
   }
  }
  if(amplitude===0)continue;
  const hands=[],elbows=[],entry={recipe:recipe.name,amplitude,minUp:1,maxForward:0,minHandClearanceByWidth:Infinity};
  for(let f=0;f<=40;f++){
   const pose=A.sample(recipe,'wave',waveClip.duration*(.34+.01*f),{amplitude}),forearm=pose.parts[2],direction=normalized(forearm.b.map((v,k)=>v-forearm.a[k]));
   const torso=pose.parts[0],torsoMatrix=pose.transforms[0];
   // The largest XY radius of the depth-scaled ellipsoid bounds the torso
   // even when its lean exposes a little of its local depth in the front view.
   const torsoScale=Math.sqrt(Math.max(1,1+(recipe.depth**2-1)*(torsoMatrix[8]**2+torsoMatrix[9]**2)));
   const projectedTorso={...torso,a:[torso.a[0],torso.a[1],0],b:[torso.b[0],torso.b[1],0],ra:torso.ra*torsoScale,rb:torso.rb*torsoScale};
   // Screen-space XY is the front view. The larger radial extent is a
   // conservative hand envelope, including recipes deeper than they are wide.
   const clearance=(C.sdRC([forearm.b[0],forearm.b[1],0],projectedTorso)-forearm.rb*Math.max(1,recipe.depth))/recipe.width;
   entry.minUp=Math.min(entry.minUp,direction[1]);entry.maxForward=Math.max(entry.maxForward,Math.abs(direction[2]));entry.minHandClearanceByWidth=Math.min(entry.minHandClearanceByWidth,clearance);
   hands.push(forearm.b);elbows.push(forearm.a);waveReport.heldSamples++;
   assert(direction[1]>=.70,'Wave forearm is not upright: '+recipe.name);
   assert(Math.abs(direction[2])<=.50,'Wave forearm points into the camera: '+recipe.name);
   assert(clearance>=.03,'Wave hand overlaps the face silhouette: '+recipe.name);
   assert(forearm.b[0]<torso.a[0],'Wave moved to the opposite side of the face: '+recipe.name);
  }
  entry.lateralSweepByForearmLength=(Math.max(...hands.map(p=>p[0]))-Math.min(...hands.map(p=>p[0])))/distance(rig.parts[2].a,rig.parts[2].b);
  entry.elbowToHandTravel=travel(elbows)/Math.max(1e-8,travel(hands));
  assert(entry.lateralSweepByForearmLength>=.12,'Wave has no readable lateral sweep: '+recipe.name);
  assert(entry.elbowToHandTravel<=.30,'Wave elbow moves as much as the hand: '+recipe.name);
  waveReport.minForearmUp=Math.min(waveReport.minForearmUp,entry.minUp);waveReport.maxForearmForward=Math.max(waveReport.maxForearmForward,entry.maxForward);waveReport.minProjectedHandClearanceByWidth=Math.min(waveReport.minProjectedHandClearanceByWidth,entry.minHandClearanceByWidth);waveReport.minLateralSweepByForearmLength=Math.min(waveReport.minLateralSweepByForearmLength,entry.lateralSweepByForearmLength);waveReport.maxElbowToHandTravel=Math.max(waveReport.maxElbowToHandTravel,entry.elbowToHandTravel);waveReport.cases.push(entry);
 }
}
assert(waveReport.maxZeroAmplitudeMotion<1e-7,'Zero amplitude still animates');
fs.writeFileSync(path.join(root,'qa','animation-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
