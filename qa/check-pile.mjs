import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
globalThis.window=globalThis;
for(const name of ['vendor-cannon.js','core.js','collision-shapes.js','animation.js','physics.js'])vm.runInThisContext(fs.readFileSync(path.join(root,'src',name),'utf8'),{filename:name});
const failures=[],results=[],presets=DuderCore.presets(),H=1/120;
function check(condition,message){if(!condition&&!failures.includes(message))failures.push(message);}
function finite(p){return p.rigs.every(r=>r.bodies.every(b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.velocity.toArray(),...b.angularVelocity.toArray()].every(Number.isFinite)));}
function simulate(p,seconds){
  let interRigFrames=0,maxTop=0,maxSpeed=0,maxGap=0,minFloor=Infinity;
  const start=performance.now();
  for(let i=0;i<Math.round(seconds/H);i++){
    p.step(H);const s=p.stats;maxTop=Math.max(maxTop,s.bounds.max[1]);maxSpeed=Math.max(maxSpeed,s.maxSpeed);maxGap=Math.max(maxGap,s.maxJointError);minFloor=Math.min(minFloor,s.bounds.min[1]);
    if(p.world.contacts.some(c=>c.bi._duderRig!==undefined&&c.bj._duderRig!==undefined&&c.bi._duderRig!==c.bj._duderRig))interRigFrames++;
    check(finite(p),'Physics became nonfinite');
  }
  return{seconds,wallMs:performance.now()-start,interRigFrames,maxTop,maxSpeed,maxGap,minFloor,final:p.stats};
}

for(const count of [8,16]){
  const p=new DuderPhysics();p.startPile(presets.slice(0,count),{count});
  check(p.rigs.length===1&&p.stats.pending===count-1,'Pile must start with one safe drop');
  const seconds=count===8?8:12,metrics=simulate(p,seconds);
  check(p.rigs.length===count&&p.stats.pending===0,`${count}-bean spawn queue did not finish`);
  check(p.stats.bodies===count*7&&p.stats.joints===count*6,`${count}-bean body/joint totals wrong`);
  check(metrics.interRigFrames>300,`${count}-bean pile did not sustain inter-rig contacts`);
  check(metrics.maxGap<.05,`${count}-bean pile exceeded5cm joint separation`);
  check(metrics.maxSpeed<12,`${count}-bean pile gained excessive energy`);
  check(metrics.maxTop<5.5,`${count}-bean spawn rose outside bounded view`);
  check(metrics.minFloor>-.05,`${count}-bean floor penetration exceeded5cm`);
  check(p.stats.bounds.max[1]<3.8,`${count}-bean pile did not fall onto floor`);
  check(Math.max(...p.stats.bounds.min.map(Math.abs),...p.stats.bounds.max.map(Math.abs))<7,`${count}-bean pile escaped practical view`);
  const pausedPositions=p.rigs.flatMap(r=>r.bodies.flatMap(b=>b.position.toArray())),pausedTime=p.elapsed;
  p.setPaused(true);p.step(.1);check(p.elapsed===pausedTime&&pausedPositions.every((x,i)=>x===p.rigs.flatMap(r=>r.bodies.flatMap(b=>b.position.toArray()))[i]),'Paused pile moved');p.setPaused(false);
  results.push({name:`pile-${count}`,...metrics});
  if(count===8){
    const index=p.rigs.reduce((best,r,i)=>r.bodies[0].position.y>p.rigs[best].bodies[0].position.y?i:best,0),b=p.rigs[index].bodies[0],origin=[b.position.x,7,b.position.z];
    check(p.beginGrab(origin,[0,-1,0]),'Pile top-down body grab missed');
    for(let i=0;i<60;i++){p.moveGrab([origin[0]+i*.006,7,origin[2]+i*.004],[0,-1,0]);p.step(H);}
    p.endGrab();p.kick(index);const interaction=simulate(p,1.0);
    check(interaction.maxGap<.06,'Grab/release/kick broke pile joints');check(!p.grab,'Pile grab failed to release');results.push({name:'pile-grab-release-kick',...interaction});
    p.drop();check(p.mode==='pile'&&p.rigs.length===1&&p.stats.pending===7&&p.elapsed===0,'Pile drop failed to refill');
  }
}

for(const clip of DuderAnimation.clips){
  const recipe=presets[0],time=clip.duration*.36,dt=1/60,pose=DuderAnimation.sample(recipe,clip.id,time,{amplitude:1.25}),previous=DuderAnimation.sample(recipe,clip.id,time-dt,{amplitude:1.25}),p=new DuderPhysics();
  p.reset(recipe,{pose,previousPose:previous,poseDt:dt});const transferred=p.poseTransforms(),matrixError=Math.max(...pose.transforms.flatMap((m,i)=>Array.from(m,(x,j)=>Math.abs(x-transferred.transforms[i][j]))));
  check(matrixError<1e-6,`${clip.id} handoff snapped away from current pose`);check(p.stats.maxJointError<1e-5,`${clip.id} handoff separated joint pivots`);
  check(p.rigs[0].bodies.some(b=>b.velocity.length()+b.angularVelocity.length()>.01),`${clip.id} handoff lost animation velocity`);
  for(const j of p.rigs[0].joints)if(j.definition.type==='hinge'){j.constraint.update();check(j.constraint.currentAngle>=j.constraint.lower-.03&&j.constraint.currentAngle<=j.constraint.upper+.03,`${clip.id} handoff changed hinge zero/limits`);}
  const metrics=simulate(p,2);
  check(metrics.maxGap<.05,`${clip.id} handoff unstable after release`);
  results.push({name:`handoff-${clip.id}`,matrixError,...metrics});
}
const report={passed:failures.length===0,failures,results};
fs.writeFileSync(path.join(root,'qa/pile-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(failures.length)process.exitCode=1;
