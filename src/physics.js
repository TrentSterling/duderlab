/* Duder Lab V3 — actual cannon-es rigid bodies, constrained ragdolls, bean piles and active sumo.
 * Physics runs at 120 Hz. The render rig consumes rest-world -> posed-world matrices.
 * Sumo is an active ragdoll: bounded balance torques, grounded support and drive forces.
 */
(function(root){
  'use strict';
  const C=root.CANNON, H=1/120, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  if(!C)throw Error('Embedded cannon-es physics is missing');
  const v=a=>new C.Vec3(a[0],a[1],a[2]), arr=p=>[p.x,p.y,p.z];
  const direction=(a,b)=>{const d=b.vsub(a);d.normalize();return d;};
  const identity=()=>new C.Quaternion();
  function matrix(q,p){
    const x=q.x,y=q.y,z=q.z,w=q.w,x2=x+x,y2=y+y,z2=z+z;
    return new Float32Array([1-y*y2-z*z2,x*y2+w*z2,x*z2-w*y2,0,
      x*y2-w*z2,1-x*x2-z*z2,y*z2+w*x2,0,
      x*z2+w*y2,y*z2-w*x2,1-x*x2-y*y2,0,p.x,p.y,p.z,1]);
  }
  function transform(m,p){return[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];}
  function inverseRigid(m){return new Float32Array([m[0],m[4],m[8],0,m[1],m[5],m[9],0,m[2],m[6],m[10],0,-m[0]*m[12]-m[1]*m[13]-m[2]*m[14],-m[4]*m[12]-m[5]*m[13]-m[6]*m[14],-m[8]*m[12]-m[9]*m[13]-m[10]*m[14],1]);}
  function rotationOf(m){
    const trace=m[0]+m[5]+m[10],q=new C.Quaternion();let s;
    if(trace>0){s=Math.sqrt(trace+1)*2;q.set((m[6]-m[9])/s,(m[8]-m[2])/s,(m[1]-m[4])/s,s*.25);}
    else if(m[0]>m[5]&&m[0]>m[10]){s=Math.sqrt(1+m[0]-m[5]-m[10])*2;q.set(s*.25,(m[4]+m[1])/s,(m[8]+m[2])/s,(m[6]-m[9])/s);}
    else if(m[5]>m[10]){s=Math.sqrt(1+m[5]-m[0]-m[10])*2;q.set((m[4]+m[1])/s,s*.25,(m[9]+m[6])/s,(m[8]-m[2])/s);}
    else{s=Math.sqrt(1+m[10]-m[0]-m[5])*2;q.set((m[8]+m[2])/s,(m[9]+m[6])/s,s*.25,(m[1]-m[4])/s);}
    q.normalize();return q;
  }
  const validPose=p=>p?.transforms?.length===7&&p.transforms.every(m=>m?.length===16&&Array.from(m).every(Number.isFinite));

  // Stock hinges have no finite angle stops. These unilateral angular equations
  // constrain only the forbidden side and preserve free motion inside the range.
  class AngularStop extends C.Equation{
    constructor(a,b,sign){super(a,b,0,120);this.sign=sign;this.angle=0;this.limit=0;this.axis=new C.Vec3();this.setSpookParams(2e6,4,H);}
    computeB(h){const s=this.sign;this.axis.scale(-s,this.jacobianElementA.rotational);this.axis.scale(s,this.jacobianElementB.rotational);const g=s*(this.angle-this.limit);return-clamp(g,-.3,.3)*this.a-this.computeGW()*this.b-h*this.computeGiMf();}
    computeGiMGt(){const a=this.jacobianElementA.rotational,b=this.jacobianElementB.rotational;return a.dot(this.bi.invInertiaWorldSolve.vmult(a))+b.dot(this.bj.invInertiaWorldSolve.vmult(b));}
  }
  class LimitedHinge extends C.HingeConstraint{
    constructor(a,b,options,axisWorld,lower,upper){
      super(a,b,options);let ref=new C.Vec3();axisWorld.tangents(ref,new C.Vec3());
      this.refA=a.vectorToLocalFrame(ref);this.refB=b.vectorToLocalFrame(ref);this.lower=lower;this.upper=upper;
      this.low=new AngularStop(a,b,1);this.high=new AngularStop(a,b,-1);this.equations.push(this.low,this.high);this.currentAngle=0;
    }
    update(){super.update();const axis=this.bodyA.vectorToWorldFrame(this.axisA),a=this.bodyA.vectorToWorldFrame(this.refA),b=this.bodyB.vectorToWorldFrame(this.refB);this.currentAngle=Math.atan2(axis.dot(a.cross(b)),clamp(a.dot(b),-1,1));
      for(const e of [this.low,this.high]){e.axis.copy(axis);e.angle=this.currentAngle;}
      this.low.limit=this.lower;this.high.limit=this.upper;
    }
  }

  class DuderPhysics{
    constructor(recipe){this.gravity=9.81;this.damping=.18;this.paused=false;this.elapsed=0;this.accumulator=0;this.rigs=[];this.mode='ragdoll';this.round=1;this.winner=-1;this.status='';this._roundPause=0;this._statsCache=null;if(recipe)this.reset(recipe);}
    _world(ring=false){
      this.endGrab();this.world=new C.World({gravity:new C.Vec3(0,-this.gravity,0),allowSleep:true});this.world.solver.iterations=28;this.world.solver.tolerance=1e-7;
      this.world.broadphase=new C.NaiveBroadphase();this.world.quatNormalizeSkip=0;this.world.quatNormalizeFast=false;
      this.world.narrowphase.enableFrictionReduction=true;
      this.world.defaultContactMaterial.friction=ring?.12:.58;this.world.defaultContactMaterial.restitution=.035;
      this.world.defaultContactMaterial.contactEquationStiffness=2e7;this.world.defaultContactMaterial.contactEquationRelaxation=4;
      this.world.defaultContactMaterial.frictionEquationStiffness=1e7;this.world.defaultContactMaterial.frictionEquationRelaxation=4;
      this.floor=new C.Body({mass:0,collisionFilterGroup:1,collisionFilterMask:2});
      if(ring){this.floor.addShape(new C.Cylinder(2.2,2.2,.16,40));this.floor.position.y=-.08;}
      else{this.floor.addShape(new C.Plane());this.floor.quaternion.setFromEuler(-Math.PI/2,0,0);}
      this.world.addBody(this.floor);this.rigs=[];this.elapsed=0;this.accumulator=0;this.grab=null;this.peakJointError=0;this._statsCache=null;this._pileNextAt=0;
      if(ring){this.catchFloor=new C.Body({mass:0,collisionFilterGroup:1,collisionFilterMask:2});this.catchFloor.addShape(new C.Plane());this.catchFloor.quaternion.setFromEuler(-Math.PI/2,0,0);this.catchFloor.position.y=-.25;this.world.addBody(this.catchFloor);}else this.catchFloor=null;
    }
    _makeRig(recipe,offset=[0,0,0],rotation=identity()){
      const definition=root.DuderCore.rigDefinition(recipe),rig={recipe,definition,bodies:[],joints:[],rest:[],index:this.rigs.length,grounded:false,fallen:false,shoveTimer:.8};
      const masses=[3.2,.30,.24,.30,.24,.55,.55];
      definition.parts.forEach((part,i)=>{
        const a=v(part.a),b=v(part.b),center=a.vadd(b).scale(.5),delta=b.vsub(a),length=Math.max(.025,delta.length());delta.normalize();
        const restQ=new C.Quaternion();restQ.setFromVectors(C.Vec3.UNIT_Y,delta);
        const body=new C.Body({mass:masses[i],allowSleep:true,sleepSpeedLimit:.11,sleepTimeLimit:.8,linearDamping:.16,angularDamping:.26,collisionFilterGroup:2,collisionFilterMask:3});
        body.addShape(root.DuderCollision.shape(part,recipe.depth||1,center,restQ,i,this.mode==='pile'?{sides:6,bands:i===0?2:1}:undefined));
        body.position.copy(rotation.vmult(center).vadd(v(offset)));body.quaternion.copy(rotation.mult(restQ));body._duderRig=rig.index;body._duderPart=i;
        body.updateMassProperties();body.updateBoundingRadius();this.world.addBody(body);rig.bodies.push(body);rig.rest.push({center,q:restQ,qi:restQ.inverse(),part});
      });
      for(const j of definition.joints){
        const a=rig.bodies[j.parent],b=rig.bodies[j.child],point=rotation.vmult(v(j.point)).vadd(v(offset));
        const options={pivotA:a.pointToLocalFrame(point),pivotB:b.pointToLocalFrame(point),maxForce:3500,collideConnected:false};let constraint;
        if(j.type==='hinge'){
          const ax=rotation.vmult(v(j.axis||[0,0,1]));options.axisA=a.vectorToLocalFrame(ax);options.axisB=b.vectorToLocalFrame(ax);
          constraint=new LimitedHinge(a,b,options,ax,j.lower??-.12,j.upper??2.15);
        }else{
          const child=definition.parts[j.child],axis=rotation.vmult(direction(v(child.a),v(child.b)));options.axisA=a.vectorToLocalFrame(axis);options.axisB=b.vectorToLocalFrame(axis);options.angle=j.angle??1.05;options.twistAngle=j.twist??.7;
          constraint=new C.ConeTwistConstraint(a,b,options);
          // The stock tangent-dot twist constraint couples swing into twist and
          // becomes singular near opposing tangents. Parallel-transport the
          // child reference before measuring the signed twist angle instead.
          constraint.twistEquation.enabled=false;
          let tangent=new C.Vec3();axis.tangents(tangent,new C.Vec3());const refA=a.vectorToLocalFrame(tangent),refB=b.vectorToLocalFrame(tangent),baseUpdate=constraint.update;
          const low=new AngularStop(a,b,1),high=new AngularStop(a,b,-1);low.limit=-options.twistAngle;high.limit=options.twistAngle;constraint.equations.push(low,high);
          constraint.update=function(){baseUpdate.call(this);const axisA=this.bodyA.vectorToWorldFrame(this.axisA),axisB=this.bodyB.vectorToWorldFrame(this.axisB),ta=this.bodyA.vectorToWorldFrame(refA),tb=this.bodyB.vectorToWorldFrame(refB),transport=new C.Quaternion();transport.setFromVectors(axisB,axisA);const aligned=transport.vmult(tb),angle=Math.atan2(axisA.dot(ta.cross(aligned)),clamp(ta.dot(aligned),-1,1));for(const eq of [low,high]){eq.axis.copy(axisA);eq.angle=angle;}};
        }
        for(const eq of constraint.equations)eq.setSpookParams(eq instanceof AngularStop?3e5:2e7,eq instanceof AngularStop?8:4,H);
        this.world.addConstraint(constraint);rig.joints.push({constraint,definition:j});
      }
      rig.mass=masses.reduce((a,b)=>a+b,0);rig.targetY=rig.rest[0].center.y;rig.initialQ=rotation.clone();
      this.rigs.push(rig);this.setDamping(this.damping);this._statsCache=null;return rig;
    }
    reset(recipe,options={}){
      this.mode='ragdoll';this.recipe=recipe;this._world(false);const q=new C.Quaternion();
      if(options.tumble)q.setFromEuler(.23,-.12,.16);
      const rig=this._makeRig(recipe,options.pose?[0,0,0]:[0,options.height??.8,0],options.pose?identity():q);
      // Constraints are constructed in the rest frame first, preserving their
      // anatomical pivots and angle limits when animation hands off to physics.
      if(options.pose)this._applyPose(rig,options.pose,options.previousPose,options.poseDt);
      this.paused=false;this.winner=-1;this.status='Ragdoll';return this;
    }
    _applyPose(rig,pose,previousPose,poseDt){
      if(!validPose(pose))throw Error('Ragdoll handoff needs seven finite bone transforms');
      const previous=validPose(previousPose)?previousPose:null,dt=clamp(Number(poseDt)||1/60,1/240,.1);
      for(let i=0;i<7;i++){
        const b=rig.bodies[i],rest=rig.rest[i],m=pose.transforms[i],q=rotationOf(m),center=arr(rest.center);
        b.position.copy(v(transform(m,center)));b.quaternion.copy(q.mult(rest.q));
        b.previousPosition.copy(b.position);b.interpolatedPosition.copy(b.position);b.previousQuaternion.copy(b.quaternion);b.interpolatedQuaternion.copy(b.quaternion);
        b.velocity.set(0,0,0);b.angularVelocity.set(0,0,0);
        if(previous){
          b.position.vsub(v(transform(previous.transforms[i],center)),b.velocity);b.velocity.scale(1/dt,b.velocity);
          const dq=q.mult(rotationOf(previous.transforms[i]).inverse());if(dq.w<0){dq.x=-dq.x;dq.y=-dq.y;dq.z=-dq.z;dq.w=-dq.w;}
          const sin=Math.hypot(dq.x,dq.y,dq.z),scale=sin>1e-8?2*Math.atan2(sin,clamp(dq.w,-1,1))/(sin*dt):2/dt;
          b.angularVelocity.set(dq.x*scale,dq.y*scale,dq.z*scale);
          const speed=b.velocity.length(),spin=b.angularVelocity.length();if(speed>8)b.velocity.scale(8/speed,b.velocity);if(spin>18)b.angularVelocity.scale(18/spin,b.angularVelocity);
        }
        b.aabbNeedsUpdate=true;b.updateInertiaWorld(true);b.wakeUp();
      }
      this.world.broadphase.dirty=true;this._statsCache=null;
    }
    resetFromPose(recipe,pose,options={}){return this.reset(recipe,{...options,pose});}
    startPile(recipes,options={}){
      if(!Array.isArray(recipes)||!recipes.length)throw Error('A bean pile needs at least one recipe');
      const count=clamp(Math.round(Number(options.count)||8),4,16);
      this.mode='pile';this.pileCount=count;this.pileRecipes=Array.from({length:count},(_,i)=>recipes[i%recipes.length]);this._world(false);
      this.world.broadphase=new C.SAPBroadphase(this.world);this.world.broadphase.axisIndex=1;this.world.broadphase.useBoundingBoxes=true;this.world.solver.iterations=20;
      this.paused=false;this.winner=-1;this.status='Dropping beans';this._spawnPileRig();this._pileNextAt=.55;return this;
    }
    _spawnPileRig(){
      const index=this.rigs.length;if(index>=this.pileCount)return false;
      const angle=index*2.399963229728653,recipe=this.pileRecipes[index],q=new C.Quaternion();q.setFromEuler(.28+Math.sin(index*1.9)*.28,angle,.30*Math.cos(index*1.7));
      const def=root.DuderCore.rigDefinition(recipe),center=v(def.parts[0].a).vadd(v(def.parts[0].b)).scale(.5),target=new C.Vec3(Math.cos(angle)*.58,3.15+Math.sin(index)*.08,Math.sin(angle)*.58),offset=target.vsub(q.vmult(center));
      const rig=this._makeRig(recipe,arr(offset),q),bounds=this._rigBounds(rig);let lift=Math.max(0,.15-bounds.min[1]);
      // Never insert a new collider inside an existing bean. The conservative
      // AABB test raises the incoming rig above any occupied spawn column.
      for(let pass=0;pass<this.rigs.length;pass++){
        let next=lift;
        for(const other of this.rigs){if(other===rig)continue;for(const b of other.bodies){if(b.aabbNeedsUpdate)b.updateAABB();const lo=b.aabb.lowerBound,hi=b.aabb.upperBound;
          if(bounds.max[0]<lo.x-.06||bounds.min[0]>hi.x+.06||bounds.max[2]<lo.z-.06||bounds.min[2]>hi.z+.06)continue;
          if(bounds.min[1]+lift<=hi.y+.08&&bounds.max[1]+lift>=lo.y-.08)next=Math.max(next,hi.y+.10-bounds.min[1]);
        }}
        if(next===lift)break;lift=next;
      }
      if(bounds.max[1]+lift>5.4){
        // A full spawn column waits for room instead of building a tall tower
        // or teleporting a new body into a pile (also useful at low gravity).
        for(const j of rig.joints)this.world.removeConstraint(j.constraint);for(const b of rig.bodies)this.world.removeBody(b);this.rigs.pop();this._statsCache=null;this.status='Waiting for space';return false;
      }
      for(const b of rig.bodies){b.position.y+=lift;b.previousPosition.copy(b.position);b.interpolatedPosition.copy(b.position);b.velocity.set(-target.x*.35,-1.1,-target.z*.35);b.angularVelocity.set(Math.sin(angle)*.35,.18,Math.cos(angle)*.30);b.aabbNeedsUpdate=true;}
      this.world.broadphase.dirty=true;this._statsCache=null;
      this.status=this.rigs.length===this.pileCount?'Bean pile':'Dropping beans';return true;
    }
    _rigBounds(rig){
      const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      for(const b of rig.bodies){if(b.aabbNeedsUpdate)b.updateAABB();const lo=arr(b.aabb.lowerBound),hi=arr(b.aabb.upperBound);for(let k=0;k<3;k++){min[k]=Math.min(min[k],lo[k]);max[k]=Math.max(max[k],hi[k]);}}
      return{min,max,center:min.map((x,i)=>(x+max[i])*.5)};
    }
    startSumo(a,b,options={}){
      this.mode='sumo';this.sumoRecipes=[a,b];if(!options.keepRound)this.round=1;this._world(true);
      const qa=new C.Quaternion(),qb=new C.Quaternion();qa.setFromEuler(0,Math.PI*.5,0);qb.setFromEuler(0,-Math.PI*.5,0);
      this._makeRig(a,[-.94,.065,0],qa);this._makeRig(b,[.94,.065,0],qb);this.paused=false;this.winner=-1;this.status='Engage';this._roundPause=0;return this;
    }
    setGravity(value){this.gravity=clamp(Number(value)||0,0,15);if(this.world)this.world.gravity.set(0,-this.gravity,0);this.wake();}
    setDamping(value){this.damping=clamp(Number(value)||0,0,.6);for(const r of this.rigs)for(const b of r.bodies){b.linearDamping=this.damping*.65+.04;b.angularDamping=this.damping+.06;}}
    setPaused(value){this.paused=!!value;this.accumulator=0;this._statsCache=null;}
    wake(){for(const r of this.rigs)for(const b of r.bodies)b.wakeUp();this._statsCache=null;}
    drop(){if(this.mode==='sumo'){this.round++;this.startSumo(...this.sumoRecipes,{keepRound:true});return;}if(this.mode==='pile'){this.startPile(this.pileRecipes,{count:this.pileCount});return;}this.reset(this.recipe,{height:1.8,tumble:true});}
    kick(index=0){const r=this.rigs[clamp(index|0,0,this.rigs.length-1)];if(!r)return;this.wake();const dir=this.mode==='sumo'?(r.index===0?1:-1):1;r.bodies[0].applyImpulse(new C.Vec3(dir*3.3,2.6,-1.3),new C.Vec3(.12,.18,.15));r.bodies[0].angularVelocity.z+=dir*.6;this._statsCache=null;}
    _torque(body,target,k,d,max){
      const q=target.mult(body.quaternion.inverse());if(q.w<0){q.x=-q.x;q.y=-q.y;q.z=-q.z;q.w=-q.w;}
      const t=new C.Vec3(2*k*q.x-d*body.angularVelocity.x,2*k*q.y-d*body.angularVelocity.y,2*k*q.z-d*body.angularVelocity.z),len=t.length();if(len>max)t.scale(max/len,t);body.torque.vadd(t,body.torque);
    }
    _driveSumo(){
      if(this.winner!==-1)return;const contacts=this.world.contacts,touching=contacts.some(c=>c.bi._duderRig!==undefined&&c.bj._duderRig!==undefined&&c.bi._duderRig!==c.bj._duderRig);
      for(const r of this.rigs){
        const other=this.rigs[1-r.index],torso=r.bodies[0],up=torso.quaternion.vmult(new C.Vec3(0,1,0));
        r.grounded=contacts.some(c=>(c.bi===this.floor&&r.bodies.slice(5).includes(c.bj))||(c.bj===this.floor&&r.bodies.slice(5).includes(c.bi)));
        const axis=r.rest[0].q.vmult(C.Vec3.UNIT_Y);const realUp=torso.quaternion.vmult(r.rest[0].qi.vmult(new C.Vec3(0,1,0)));
        r.fallen=realUp.y<.58||torso.position.y<r.targetY*.57;
        if(r.fallen)continue;
        for(const body of r.bodies)body.wakeUp();
        const to=other.bodies[0].position.vsub(torso.position);to.y=0;const distance=to.length();to.normalize();
        const yaw=Math.atan2(to.x,to.z),facing=new C.Quaternion();facing.setFromEuler(0,yaw,0);
        const lunge=Math.max(0,r.lunge||0);r.lunge=Math.max(0,lunge-H);if(touching&&!r.engaged)r.shoveTimer=r.index===this.round%2?.1:.7;r.engaged=r.engaged||touching;
        this._torque(torso,facing.mult(r.rest[0].q),lunge>0?6:r.engaged?8.5:20,r.engaged?1.5:3.3,lunge>0?7:r.engaged?10:22);
        // Grounded support represents legs actively resisting compression, never
        // an airborne or knocked-down levitation force.
        if(r.grounded){
          torso.force.y+=clamp(r.mass*this.gravity+40*(r.targetY+.04-torso.position.y)-12*torso.velocity.y,0,r.mass*this.gravity*1.32);
          const speed=r.index===this.round%2?.95:.55,ax=clamp((to.x*speed-torso.velocity.x)*12,-10,10),az=clamp((to.z*speed-torso.velocity.z)*12,-10,10);
          for(const body of r.bodies){body.force.x+=body.mass*ax;body.force.z+=body.mass*az;}
        }
        for(let i=1;i<7;i++){
          let target;
          if(i<5){const sign=i<3?-1:1,isFore=i%2===0,pulse=Math.sin(this.elapsed*4.5+r.index*2.2+sign*.8);let d=new C.Vec3(sign*(isFore?.03:.20),(isFore?-.05:-.20)+.035*pulse,(isFore?.32:.38)+.06*pulse);d.normalize();const q=new C.Quaternion();q.setFromVectors(C.Vec3.UNIT_Y,d);target=facing.mult(q);}
          else target=facing.mult(r.rest[i].q);
          this._torque(r.bodies[i],target,i<5?1.15:3.5,i<5?.18:.7,i<5?1.8:4.2);
        }
        r.shoveTimer-=H;
        if(touching&&r.grounded&&r.shoveTimer<=0){torso.applyImpulse(to.scale(3.2),new C.Vec3(0,.65,0));r.shoveTimer=1.5+(r.index*.23);r.lunge=.24;this.status='Shoving';}
      }
    }
    _roundCheck(){
      if(this.winner!==-1){this._roundPause+=H;if(this._roundPause>2.25){this.round++;this.startSumo(...this.sumoRecipes,{keepRound:true});}return;}
      if(this.elapsed<1.05)return;
      for(const r of this.rigs){const b=r.bodies[0],out=Math.hypot(b.position.x,b.position.z)>2.22||b.position.y<-.35;
        if(out||r.fallen){r.lossTime=(r.lossTime||0)+H;if(out||r.lossTime>.32){this.winner=1-r.index;this.status=out?'Ring out':'Knockdown';this._roundPause=0;return;}}
        else r.lossTime=0;
      }
      if(this.elapsed>18){this.winner=-2;this.status='Draw';}
    }
    step(dt){
      if(!this.world||this.paused)return;this.accumulator+=clamp(Number(dt)||0,0,.1);let n=0;
      while(this.accumulator>=H&&n++<12){if(this.mode==='pile'&&this.rigs.length<this.pileCount&&this.elapsed>=this._pileNextAt){this._pileNextAt=this._spawnPileRig()?this._pileNextAt+.55:this.elapsed+.12;}if(this.mode==='sumo')this._driveSumo();this.world.step(H);this.elapsed+=H;this.accumulator-=H;this._statsCache=null;
        for(const r of this.rigs)for(const b of r.bodies){const speed=b.velocity.length(),spin=b.angularVelocity.length();if(speed>18)b.velocity.scale(18/speed,b.velocity);if(spin>25)b.angularVelocity.scale(25/spin,b.angularVelocity);}
        const st=this._stats();this.peakJointError=Math.max(this.peakJointError,st.maxJointError);if(this.mode==='sumo')this._roundCheck();
      }
    }
    _stats(){if(this._statsCache)return{...this._statsCache,peakJointError:this.peakJointError,status:this.status,winner:this.winner,grabbed:!!this.grab};let error=0,sleeping=0,maxSpeed=0;const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const r of this.rigs){for(const j of r.joints){const c=j.constraint,a=c.bodyA.pointToWorldFrame(c.pivotA),b=c.bodyB.pointToWorldFrame(c.pivotB);error=Math.max(error,a.distanceTo(b));}for(const b of r.bodies){if(b.sleepState===C.Body.SLEEPING)sleeping++;maxSpeed=Math.max(maxSpeed,b.velocity.length());}const bounds=this._rigBounds(r);for(let k=0;k<3;k++){min[k]=Math.min(min[k],bounds.min[k]);max[k]=Math.max(max[k],bounds.max[k]);}}
      const bounds=this.rigs.length?{min,max,center:min.map((x,i)=>(x+max[i])*.5)}:null;
      return this._statsCache={bodies:this.rigs.length*7,joints:this.rigs.length*6,rigCount:this.rigs.length,spawnCount:this.mode==='pile'?this.pileCount:this.rigs.length,pending:this.mode==='pile'?this.pileCount-this.rigs.length:0,bounds,maxJointError:error,peakJointError:this.peakJointError,sleeping,maxSpeed,elapsed:this.elapsed,round:this.round,winner:this.winner,status:this.status,mode:this.mode,grabbed:!!this.grab};}
    poseTransforms(index=0,includeWire=false){
      const r=this.rigs[index];if(!r)return null;const transforms=r.bodies.map((b,i)=>{const q=b.quaternion.mult(r.rest[i].qi),p=b.position.vsub(q.vmult(r.rest[i].center));return matrix(q,p);});
      const parts=r.definition.parts.map((p,i)=>({...p,a:transform(transforms[i],p.a),b:transform(transforms[i],p.b)}));
      const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of parts)for(const x of [p.a,p.b])for(let k=0;k<3;k++){min[k]=Math.min(min[k],x[k]-Math.max(p.ra,p.rb));max[k]=Math.max(max[k],x[k]+Math.max(p.ra,p.rb));}
      const pose={parts,transforms,inverses:transforms.map(inverseRigid),rigid:transforms[0],torso:transforms[0],center:arr(r.bodies[0].position),bounds:{min,max,center:min.map((v,i)=>(v+max[i])*.5)},joints:r.joints.map(j=>({a:arr(j.constraint.bodyA.pointToWorldFrame(j.constraint.pivotA)),b:arr(j.constraint.bodyB.pointToWorldFrame(j.constraint.pivotB))})),stats:this._stats(),index};
      if(includeWire)pose.colliderLines=this.collisionWire(index);return pose;
    }
    collisionWire(index=0){const rig=this.rigs[index];if(!rig)return[];const out=[];for(const body of rig.bodies){const shape=body.shapes[0];if(!shape._wireEdges){const set=new Set(),edges=[];for(const face of shape.faces)for(let i=0;i<face.length;i++){const a=face[i],b=face[(i+1)%face.length],key=Math.min(a,b)+','+Math.max(a,b);if(!set.has(key)){set.add(key);edges.push([a,b]);}}shape._wireEdges=edges;}const vertices=shape.vertices.map(p=>arr(body.pointToWorldFrame(p)));for(const [a,b]of shape._wireEdges)out.push(...vertices[a],...vertices[b]);}return out;}
    beginGrab(origin,direction){
      if(!this.world)return false;this.endGrab();const from=v(origin),dir=v(direction);dir.normalize();const to=from.vadd(dir.scale(40)),result=new C.RaycastResult();
      if(!this.world.raycastClosest(from,to,{collisionFilterMask:2,skipBackfaces:true},result)||!result.body)return false;
      const anchor=new C.Body({mass:0,type:C.Body.KINEMATIC,collisionFilterGroup:0,collisionFilterMask:0});anchor.position.copy(result.hitPointWorld);this.world.addBody(anchor);
      const constraint=new C.PointToPointConstraint(result.body,result.body.pointToLocalFrame(result.hitPointWorld),anchor,new C.Vec3(),160);
      for(const eq of constraint.equations)eq.setSpookParams(5e4,5,H);this.world.addConstraint(constraint);
      this.grab={body:result.body,anchor,constraint,normal:dir.clone(),point:result.hitPointWorld.clone()};this.wake();return true;
    }
    moveGrab(origin,direction){if(!this.grab)return false;const o=v(origin),d=v(direction),g=this.grab,den=d.dot(g.normal);if(Math.abs(den)<1e-5)return true;const t=g.point.vsub(o).dot(g.normal)/den,p=o.vadd(d.scale(clamp(t,0,30)));p.x=clamp(p.x,-5,5);p.y=clamp(p.y,.12,5);p.z=clamp(p.z,-5,5);g.anchor.position.copy(p);g.body.wakeUp();return true;}
    endGrab(){if(this.grab&&this.world){this.world.removeConstraint(this.grab.constraint);this.world.removeBody(this.grab.anchor);}this.grab=null;}
    getDebugGeometry(index=0){const p=this.poseTransforms(index);if(!p)return[];return p.parts.flatMap(x=>[...x.a,...x.b]);}
    get stats(){return this._stats();}
  }
  root.DuderPhysics=DuderPhysics;
})(typeof window!=='undefined'?window:globalThis);
