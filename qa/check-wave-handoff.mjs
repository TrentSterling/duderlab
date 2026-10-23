// Exercise the actual cannon-es joint frames, including transported shoulder
// twist, when the deterministic wave hands its current pose to seven bodies.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
globalThis.window=globalThis;
const sourceHashes={};
for(const name of ['vendor-cannon','core','collision-shapes','animation','physics']){
  const source=fs.readFileSync(path.join(root,'src',name+'.js'),'utf8');
  sourceHashes[name+'.js']=crypto.createHash('sha256').update(source).digest('hex');
  vm.runInThisContext(source,{filename:name+'.js'});
}
const C=DuderCore,A=DuderAnimation,dt=1/120,failures=[],releases=[];
const check=(ok,message)=>{if(!ok&&!failures.includes(message))failures.push(message);};
const matrixError=(a,b)=>Math.max(...a.flatMap((m,i)=>Array.from(m,(v,k)=>Math.abs(v-b[i][k]))));
const finite=p=>p.rigs.every(r=>r.bodies.every(b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.velocity.toArray(),...b.angularVelocity.toArray()].every(Number.isFinite)));
const variants=[
  ['default',{}],
  ['short-wide',{height:.75,width:1.3,belly:1.2,depth:.62,armLength:1.4,armThickness:1.35,armGap:0,armSpread:.22,feet:1.3}],
  ['tall-thin',{height:1.3,width:.75,belly:.8,depth:1.24,armLength:.7,armThickness:.65,armGap:.24,armSpread:-.15,feet:.7}],
  ['short-thick-tight',{height:1.3,width:.75,belly:1.2,depth:1.24,armLength:.7,armThickness:1.35,armGap:0,armSpread:-.15,feet:.7}],
  ['long-thin-wide',{height:1.3,width:1.3,belly:.8,depth:.62,armLength:1.4,armThickness:.65,armGap:.24,armSpread:.22,feet:.7}],
  ['short-wide-tight',{height:.75,width:1.3,belly:1.2,depth:1.24,armLength:.7,armThickness:1.35,armGap:0,armSpread:-.15,feet:1.3}],
  ['long-slim-tight',{height:1.3,width:.75,belly:.8,depth:.62,armLength:1.4,armThickness:.65,armGap:0,armSpread:-.15,feet:.7}]
];
const duration=A.clips.find(c=>c.id==='wave').duration;
const metrics={poseSamples:0,releaseSamples:0,maxTransformError:0,maxInitialJointGap:0,maxShoulderSwing:0,maxShoulderTwist:0,minHingeAngle:Infinity,maxHingeAngle:-Infinity,maxSeamPositionGap:0,maxSeamVelocityJump:0,maxReleaseJointGap:0,maxReleaseSpeed:0,maxFirstStepCenterTravel:0,initialForearmTorsoContacts:0,maxInitialForearmTorsoPenetration:0};
for(const [name,overrides]of variants){
  const recipe=C.sanitizeRecipe({...C.baseDefaults(),...overrides});
  for(const amplitude of [0,1,1.25]){
    const opts={amplitude},eps=1e-4;
    const before=A.sample(recipe,'wave',duration-eps,opts),at=A.sample(recipe,'wave',0,opts),after=A.sample(recipe,'wave',eps,opts);
    const seamPosition=matrixError(before.transforms,after.transforms);
    let seamVelocity=0;
    for(let i=0;i<7;i++)for(let k=0;k<16;k++)seamVelocity=Math.max(seamVelocity,Math.abs((at.transforms[i][k]-before.transforms[i][k])/eps-(after.transforms[i][k]-at.transforms[i][k])/eps));
    metrics.maxSeamPositionGap=Math.max(metrics.maxSeamPositionGap,seamPosition);
    metrics.maxSeamVelocityJump=Math.max(metrics.maxSeamVelocityJump,seamVelocity);
    check(seamPosition<.001,`${name}/${amplitude}: wave loop jumps at the seam`);
    check(seamVelocity<.05,`${name}/${amplitude}: wave velocity jumps at the seam`);
    for(let sample=0;sample<32;sample++){
      const phase=sample/32,time=duration*phase,pose=A.sample(recipe,'wave',time,opts),previous=A.sample(recipe,'wave',time-dt,opts),p=new DuderPhysics();
      p.resetFromPose(recipe,pose,{previousPose:previous,poseDt:dt});
      const transferred=p.poseTransforms(),error=matrixError(pose.transforms,transferred.transforms);
      metrics.poseSamples++;metrics.maxTransformError=Math.max(metrics.maxTransformError,error);metrics.maxInitialJointGap=Math.max(metrics.maxInitialJointGap,p.stats.maxJointError);
      check(error<1e-6,`${name}/${amplitude}: release changed the current pose`);
      check(p.stats.maxJointError<1e-5,`${name}/${amplitude}: release disconnected a joint`);
      for(const {constraint:q,definition:j}of p.rigs[0].joints){
        q.update();
        if(j.type==='hinge'){
          metrics.minHingeAngle=Math.min(metrics.minHingeAngle,q.currentAngle);metrics.maxHingeAngle=Math.max(metrics.maxHingeAngle,q.currentAngle);
          check(q.currentAngle>=j.lower-1e-5&&q.currentAngle<=j.upper+1e-5,`${name}/${amplitude}: animated elbow exceeds its physics stop`);
        }else{
          const a=q.bodyA.vectorToWorldFrame(q.axisA),b=q.bodyB.vectorToWorldFrame(q.axisB),swing=Math.acos(Math.max(-1,Math.min(1,a.dot(b))));
          const stops=q.equations.filter(eq=>Number.isFinite(eq.angle)&&Number.isFinite(eq.limit)&&eq.axis);
          check(stops.length===2,'Transported cone twist stops were not available to verify');
          const twist=stops.length?Math.abs(stops[0].angle):Infinity;
          if(j.child<5){metrics.maxShoulderSwing=Math.max(metrics.maxShoulderSwing,swing);metrics.maxShoulderTwist=Math.max(metrics.maxShoulderTwist,twist);}
          check(swing<=j.angle+1e-5,`${name}/${amplitude}: animated shoulder or hip exceeds its cone`);
          check(twist<=j.twist+1e-5,`${name}/${amplitude}: animated shoulder or hip exceeds transported twist`);
        }
      }
      // Forearms are not directly connected to the torso, so these pairs really
      // collide on release. Query the production narrow phase before integrating
      // to catch a greeting pose that starts with a buried forearm collider.
      const bodies=p.rigs[0].bodies,contacts=[];
      p.world.narrowphase.getContacts([bodies[0],bodies[0]],[bodies[2],bodies[4]],p.world,contacts,[],[],[]);
      metrics.initialForearmTorsoContacts+=contacts.length;
      for(const contact of contacts){
        const a=contact.bi.position.vadd(contact.ri),b=contact.bj.position.vadd(contact.rj),penetration=Math.max(0,-b.vsub(a).dot(contact.ni));
        metrics.maxInitialForearmTorsoPenetration=Math.max(metrics.maxInitialForearmTorsoPenetration,penetration);
        check(penetration<.003,`${name}/${amplitude}/${phase}: forearm starts inside the torso collider`);
      }
      // Release during lift, both sweep directions, and settle. Amplitude zero
      // already exercises exact rest-frame constraints above; no duplicate drop.
      if(amplitude>0&&[4,10,16,22,28].includes(sample)){
        metrics.releaseSamples++;
        let maxGap=0,maxSpeed=0,firstStepTravel=0;
        const initialCenters=p.rigs[0].bodies.map(b=>b.position.clone());
        for(let step=0;step<120;step++){
          p.step(dt);check(finite(p),`${name}/${amplitude}/${phase}: released physics became nonfinite`);
          maxGap=Math.max(maxGap,p.stats.maxJointError);maxSpeed=Math.max(maxSpeed,p.stats.maxSpeed);
          if(step===0)firstStepTravel=Math.max(...p.rigs[0].bodies.map((b,i)=>b.position.distanceTo(initialCenters[i])));
        }
        metrics.maxReleaseJointGap=Math.max(metrics.maxReleaseJointGap,maxGap);metrics.maxReleaseSpeed=Math.max(metrics.maxReleaseSpeed,maxSpeed);metrics.maxFirstStepCenterTravel=Math.max(metrics.maxFirstStepCenterTravel,firstStepTravel);
        check(maxGap<.05,`${name}/${amplitude}/${phase}: released joints separate more than 5cm`);
        check(maxSpeed<10,`${name}/${amplitude}/${phase}: released physics gains excessive speed`);
        check(firstStepTravel<.08,`${name}/${amplitude}/${phase}: first physics step visibly snaps`);
        releases.push({recipe:name,amplitude,phase,maxJointGap:maxGap,maxSpeed,firstStepTravel});
      }
    }
  }
}
const report={passed:failures.length===0,scope:'Actual cannon-es constraint frames and one-second wave-to-ragdoll releases; not a browser or hardware performance benchmark.',sourceHashes,failures,metrics,releases};
fs.writeFileSync(path.join(root,'qa/wave-handoff-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failures,metrics},null,2));
if(failures.length)process.exitCode=1;
