/* Duder Lab V3.4.3 — deterministic, looping seven-bone motion clips.
 * Every matrix maps the immutable rest mesh into the current pose. The same
 * matrices can initialize the rigid bodies when a clip is released to physics.
 */
(function(root){
  'use strict';
  const C=root.DuderCore,TAU=Math.PI*2;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const multiply=(a,b)=>{const m=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)m[c*4+r]+=a[k*4+r]*b[c*4+k];return m;};
  function around(point,axis,angle){
    const m=identity(),n=Math.hypot(...axis);if(n<1e-10||Math.abs(angle)<1e-10)return m;
    const [x,y,z]=axis.map(v=>v/n),c=Math.cos(angle),s=Math.sin(angle),t=1-c;
    m.set([t*x*x+c,t*x*y+s*z,t*x*z-s*y,0,t*x*y-s*z,t*y*y+c,t*y*z+s*x,0,t*x*z+s*y,t*y*z-s*x,t*z*z+c,0,0,0,0,1]);
    for(let i=0;i<3;i++)m[12+i]=point[i]-(m[i]*point[0]+m[4+i]*point[1]+m[8+i]*point[2]);
    return m;
  }
  const clips=Object.freeze([
    Object.freeze({id:'idle',label:'Idle',duration:3.2}),
    Object.freeze({id:'walk',label:'Walk',duration:1.1}),
    Object.freeze({id:'wave',label:'Wave',duration:4.0}),
    Object.freeze({id:'dance',label:'Dance',duration:1.8})
  ]);
  const shapeKeys=['height','width','depth','belly','armLength','armSpread','armThickness','armGap','feet','blend'];
  const cache=new Map();
  function greetingFrame(rig){
    // Aim the forearm upward for this recipe, with a little forward presentation.
    // The shoulder first rolls around the upper arm, then swings outward. The
    // elbow uses exactly the same rest axis as the ragdoll; no per-pose hinge
    // changes, stretching, extra wrist, or disconnected hand are needed.
    const upper=rig.parts[1],lower=rig.parts[2],hinge=rig.joints.find(j=>j.child===2);
    const direction=upper.b.map((v,k)=>v-upper.a[k]),n=Math.hypot(...direction),axis=direction.map(v=>v/n);
    const forearm=lower.b.map((v,k)=>v-lower.a[k]),length=Math.hypot(...forearm);
    // The straight A-pose needs less elbow flex than the old bent bind mesh.
    // Solve the shoulder again so the mitten still presents beside the face.
    let flex=1.36,roll=0,swing=0;
    for(let attempt=0;attempt<3;attempt++){
      const v=C.transformVector(around([0,0,0],hinge.axis,flex),forearm);
      const dot=axis.reduce((s,x,k)=>s+x*v[k],0),a=v[2]-axis[2]*dot,b=axis[0]*v[1]-axis[1]*v[0],c=axis[2]*dot;
      const phase=Math.atan2(b,a),offset=Math.acos(clamp((length*.12-c)/Math.max(1e-8,Math.hypot(a,b)),-1,1));
      const wrap=x=>Math.atan2(Math.sin(x),Math.cos(x));
      const candidates=[wrap(phase+offset),wrap(phase-offset)].sort((x,y)=>Math.abs(x)-Math.abs(y));
      roll=clamp(candidates[0],-.60,.60);
      const upright=C.transformVector(around([0,0,0],axis,roll),v);
      swing=Math.atan2(upright[0],upright[1]);
      if(Math.abs(swing)<=.97)break;
      flex=Math.min(2.02,flex+Math.abs(swing)-.97);
    }
    return{axis,roll,swing:clamp(swing,-.99,.99),flex,stroke:Math.min(.22,2.12-flex)};
  }
  function definition(recipe){
    const key=shapeKeys.map(k=>recipe[k]).join('/');let cached=cache.get(key);
    if(!cached){const rig=C.rigDefinition(recipe),hips=rig.parts.slice(5).map(p=>p.a);cached={rig,hips,root:hips[0].map((v,k)=>(v+hips[1][k])*.5),greeting:greetingFrame(rig)};if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(key,cached);}
    return cached;
  }
  // Minimum posed Y of the flattened, flat-soled rest capsule. Restricting the
  // support to rest Y >= 0 preserves the actual sole cut as the foot rotates.
  // The capsule is a sweep of equal-radius ellipsoids; its support is affine
  // off the sole and has one possible stationary point on the clipped arc.
  function footMinimum(part,m,depth){
    const a=part.a,b=part.b,r=Math.max(part.ra,part.rb),d=[m[1],m[5],m[9]],delta=b.map((v,k)=>v-a[k]);
    const radial=Math.hypot(d[0],d[2]*depth),length=Math.hypot(radial,d[1]),candidates=[0,1];
    const addY=y=>{if(Math.abs(delta[1])>1e-12){const s=(y-a[1])/delta[1];if(s>0&&s<1)candidates.push(s);}};
    addY(r*d[1]/Math.max(1e-12,length));
    const v=d[0]*delta[0]+d[2]*delta[2],k=radial*delta[1];
    if(Math.abs(k)>1e-12)addY(-r*v*Math.sign(k)/Math.hypot(v,k));
    let result=Infinity;
    for(const s of candidates){const q=a.map((v,k)=>v+s*delta[k]);let y;
      if(q[1]-r*d[1]/Math.max(1e-12,length)>=0)y=d[0]*q[0]+d[1]*q[1]+d[2]*q[2]-r*length;
      else y=d[0]*q[0]+d[2]*q[2]-radial*Math.sqrt(Math.max(0,r*r-q[1]*q[1]));
      result=Math.min(result,y+m[13]);
    }
    return result;
  }
  function sample(recipe,clipId='idle',time=0,options={}){
    const clip=clips.find(c=>c.id===clipId)||clips[0],amplitude=clamp(Number.isFinite(options.amplitude)?options.amplitude:1,0,1.25);
    const t=Number.isFinite(time)?time:0,u=((t/clip.duration)%1+1)%1,p=u*TAU,s=Math.sin(p),c=Math.cos(p);
    const {rig,root:rootPoint,greeting}=definition(recipe);
    const rotations=Array.from({length:7},()=>[0,0,0]);let lean=[0,0,0],shift=[0,0,0],bounce=0;
    const elbows=[0,0];let waveShoulder=null;
    if(clip.id==='idle'){
      lean=[.012*s,.022*s,.015*c];
      rotations[1]=[.028*s,0,-.035-.025*s];rotations[3]=[-.028*s,0,.035+.025*s];
      elbows[0]=.10+.055*Math.sin(p+.6);elbows[1]=.10+.055*Math.sin(p-.6);
      rotations[5]=[-lean[0],0,-lean[2]];rotations[6]=[-lean[0],0,-lean[2]];
    }else if(clip.id==='walk'){
      // Short rigid legs make this a deliberate bean waddle, with opposing arm
      // swing and a rolling hip weight shift. The clip runs in place.
      lean=[-.045,.055*s,.050*s];shift=[.032*s,0,0];
      rotations[5]=[.53*s,0,-.035*s];rotations[6]=[-.53*s,0,-.035*s];
      rotations[1]=[-.34*s,0,-.055];rotations[3]=[.34*s,0,.055];
      elbows[0]=.20+.16*Math.max(0,-s);elbows[1]=.20+.16*Math.max(0,s);
      bounce=.006*(1-Math.cos(p*2));
    }else if(clip.id==='wave'){
      const lift=smooth(.10,.29,u)*(1-smooth(.83,.98,u));
      const ready=smooth(.02,.08,u)*(1-smooth(.10,.22,u));
      const q=clamp((u-.32)/.44,0,1),wave=Math.sin(q*TAU*2)*smooth(0,.10,q)*(1-smooth(.90,1,q));
      const reach=Math.min(1,amplitude),follow=smooth(.14,.34,u)*(1-smooth(.83,.99,u));
      lean=[-.018*follow,.015*follow,-.035*follow];
      rotations[3]=[.015*s*lift,0,.035*lift];elbows[1]=.08*lift;
      // The greeting is on the viewer's left, as in the concept sheet. Hold
      // its elbow still through both sweeps; only the forearm makes the wave.
      // Amplitude above one adds sweep energy, without over-raising the arm.
      waveShoulder={swing:greeting.swing*lift*reach+.035*ready*reach,roll:greeting.roll*lift*reach};
      elbows[0]=(greeting.flex*lift+.12*ready)*reach-greeting.stroke*wave*lift*Math.min(amplitude,1.15);
      rotations[5]=[-lean[0],0,-lean[2]];rotations[6]=[-lean[0],0,-lean[2]];
    }else{
      const beat=Math.sin(p*2),left=Math.max(0,s),right=Math.max(0,-s);
      lean=[-.055+.035*c,.23*s,.115*s];shift=[-.060*s,0,.018*c];
      rotations[1]=[-.18*beat,0,-(.30+.20*right)];rotations[3]=[.18*beat,0,.30+.20*left];
      elbows[0]=.65+.32*Math.sin(p+.5);elbows[1]=.65+.32*Math.sin(p+Math.PI+.5);
      rotations[5]=[.24*s,0,-.12*left];rotations[6]=[-.24*s,0,.12*right];
      bounce=.024*(1-Math.cos(p*2));
    }
    // Rotation-vector limits stay inside the existing shoulder/hip cone limits,
    // including when the amplitude control is pushed above its default value.
    const localRotation=(point,angles,maxAngle)=>{let r=angles.map(v=>v*amplitude),a=Math.hypot(...r);if(a>maxAngle){r=r.map(v=>v*maxAngle/a);a=maxAngle;}return around(point,r,a);};
    const transforms=Array.from({length:7},identity);
    transforms[0]=localRotation(rootPoint,lean,.36);
    transforms[0][12]+=shift[0]*amplitude;transforms[0][14]+=shift[2]*amplitude;
    for(const j of rig.joints){
      let local;
      if(j.type==='hinge')local=around(j.point,j.axis,clamp(elbows[j.child===2?0:1]*(waveShoulder&&j.child===2?1:amplitude),0,Math.min(j.upper-.025,waveShoulder&&j.child===2?2.12:2.05)));
      else if(waveShoulder&&j.child===1)local=multiply(around(j.point,[0,0,1],waveShoulder.swing),around(j.point,greeting.axis,waveShoulder.roll));
      else local=localRotation(j.point,rotations[j.child],j.child>=5?.64:.99);
      transforms[j.child]=multiply(transforms[j.parent],local);
    }
    const lowest=Math.min(footMinimum(rig.parts[5],transforms[5],rig.depth),footMinimum(rig.parts[6],transforms[6],rig.depth));
    // A few millimetres avoid subpixel floor flicker; dance intentionally has a
    // small hop. No frame integrates or accumulates its grounding correction.
    const lift=.003-lowest+bounce*amplitude;
    for(const m of transforms)m[13]+=lift;
    const parts=rig.parts.map((part,i)=>({...part,a:C.transformPoint(transforms[i],part.a),b:C.transformPoint(transforms[i],part.b)}));
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<7;i++){const part=parts[i],m=transforms[i],r=Math.max(part.ra,part.rb);
      for(let k=0;k<3;k++){const radius=r*Math.hypot(m[k],m[4+k],m[8+k]*rig.depth);min[k]=Math.min(min[k],part.a[k]-radius,part.b[k]-radius);max[k]=Math.max(max[k],part.a[k]+radius,part.b[k]+radius);}
    }
    min[1]=Math.min(footMinimum(rig.parts[5],transforms[5],rig.depth),footMinimum(rig.parts[6],transforms[6],rig.depth));
    const center=parts[0].a.map((v,k)=>(v+parts[0].b[k])*.5),joints=rig.joints.map(j=>({a:C.transformPoint(transforms[j.parent],j.point),b:C.transformPoint(transforms[j.child],j.point)}));
    return{transforms,inverses:transforms.map(C.rigidInverse),parts,rigid:transforms[0],torso:transforms[0],center,bounds:{min,max,center:min.map((v,k)=>(v+max[k])*.5)},joints,clip:clip.id,time:t,phase:u,duration:clip.duration,groundClearance:min[1],amplitude};
  }
  root.DuderAnimation=Object.freeze({clips,sample});
})(typeof window!=='undefined'?window:globalThis);
