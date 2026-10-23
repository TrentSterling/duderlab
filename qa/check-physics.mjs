import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
globalThis.window=globalThis;
for(const name of ['vendor-cannon.js','core.js','collision-shapes.js','physics.js'])vm.runInThisContext(fs.readFileSync(path.join(root,'src',name),'utf8'),{filename:name});
const results=[],failures=[];
function check(ok,message){if(!ok)failures.push(message);}
function finite(physics){return physics.rigs.every(r=>r.bodies.every(b=>[...Object.values(b.position),...Object.values(b.quaternion),...Object.values(b.velocity),...Object.values(b.angularVelocity)].every(Number.isFinite)));}
function step(physics,seconds){let maxError=0,maxSpeed=0;for(let i=0;i<seconds*120;i++){physics.step(1/120);maxError=Math.max(maxError,physics.stats.maxJointError);maxSpeed=Math.max(maxSpeed,physics.stats.maxSpeed);check(finite(physics),'Nonfinite physics state');}return{maxError,maxSpeed};}
const presets=DuderCore.presets();
for(const [name,overrides] of [['default',{}],['short-wide',{height:.75,width:1.3,belly:1.2,depth:.62}],['tall-thin',{height:1.3,width:.75,belly:.8,depth:1.24}],['long-arms',{armLength:1.4,armThickness:1.35,armGap:.24,armSpread:.22}]]){
  const recipe=DuderCore.sanitizeRecipe({...presets[0],...overrides}),physics=new DuderPhysics();physics.reset(recipe,{height:1.0,tumble:true});const metrics=step(physics,4),pose=physics.poseTransforms();
  check(metrics.maxError<.05,name+' joint separation exceeded5cm');check(metrics.maxSpeed<10,name+' excessive energy after drop');check(pose.transforms.length===7&&pose.transforms.every(m=>Array.from(m).every(Number.isFinite)),name+' transforms invalid');
  check(Math.abs(pose.center[0])<5&&Math.abs(pose.center[2])<5,name+' escaped practical range');
  results.push({name,...metrics,final:physics.stats,center:pose.center});
}
const grabbed=new DuderPhysics();grabbed.reset(presets[0],{height:.02});const elapsed=grabbed.elapsed;grabbed.setPaused(true);grabbed.step(.1);check(grabbed.elapsed===elapsed,'Pause advanced');grabbed.setPaused(false);
check(grabbed.beginGrab([0,1.15,5],[0,0,-1]),'Grab missed torso');
for(let i=0;i<240;i++){grabbed.moveGrab([Math.sin(i/70)*.6,1.4+Math.sin(i/110)*.8,5],[0,0,-1]);grabbed.step(1/120);check(finite(grabbed),'Grab nonfinite');}
grabbed.endGrab();check(!grabbed.grab,'Grab not released');grabbed.kick();const kick=step(grabbed,2);check(kick.maxError<.08,'Kick/drag joint separation exceeded8cm');results.push({name:'grab-release-kick',...kick,final:grabbed.stats});
const sumo=new DuderPhysics();sumo.startSumo(presets[0],presets[1]);let contactFrames=0,roundResolved=false,maxError=0,roundSeen=1,maxTravel=0;
for(let i=0;i<720;i++){sumo.step(1/120);check(finite(sumo),'Sumo nonfinite');if(sumo.world.contacts.some(c=>c.bi._duderRig!==undefined&&c.bj._duderRig!==undefined&&c.bi._duderRig!==c.bj._duderRig))contactFrames++;roundResolved ||= sumo.winner!==-1;roundSeen=Math.max(roundSeen,sumo.round);maxError=Math.max(maxError,sumo.stats.maxJointError);maxTravel=Math.max(maxTravel,Math.abs(sumo.rigs[0].bodies[0].position.x+.94));}
check(contactFrames>50,'Sumo did not make sustained contact');sumo.elapsed=18.01;sumo.winner=-1;sumo.step(1/120);check(sumo.winner===-2&&sumo.status==='Draw','Standing time limit did not draw');roundResolved=true;step(sumo,2.5);roundSeen=Math.max(roundSeen,sumo.round);check(roundSeen>1,'Sumo did not restart after draw');check(maxError<.08,'Sumo joint separation exceeded8cm');
results.push({name:'sumo6s+timeoutTransition',contactFrames,roundResolved,roundSeen,maxError,maxTravel,final:sumo.stats});
const report={passed:failures.length===0,failures:[...new Set(failures)],results};fs.writeFileSync(path.join(root,'qa/physics-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(failures.length)process.exitCode=1;
