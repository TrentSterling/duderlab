/* Duder Lab — deterministic recipes, Critters-derived SDF blend-shell math, static GLB bake.
 * Projection technique adapted from TrentSterling/critters (index.html), whose provenance
 * credits GOOBERS by u/AntiqueFeedback7447 and visual inspiration from RujiK the Comatose.
 * A projected shell is a visual mesh; this exporter does not perform a manifold boolean union.
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const fract = x => x - Math.floor(x);
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const norm = a => { const l = Math.hypot(...a); return l > 1e-12 ? a.map(x=>x/l) : [0,1,0]; };
  const smooth = (a, b, x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
  const hex = s => { s=s.replace('#',''); return [0,2,4].map(i=>parseInt(s.slice(i,i+2),16)/255); };
  const hats = ['none','cap','bucket','beanie','bowler','sunhat','cowboy','wizard','chef','crown','beret','topHat'];
  const glasses = ['none','square','round','aviator','catEye'];
  const patterns = ['Solid','Freckles','Clouds','Stars','Spots','Seeds','Patchwork','Cow'];
  const ranges = {
    height:[.75,1.30], width:[.75,1.30], depth:[.62,1.24], belly:[.80,1.20],
    armLength:[.70,1.40], armSpread:[-.15,.22], armThickness:[.65,1.35], armGap:[0,.24], feet:[.70,1.30], blend:[.03,.22],
    facets:[8,16], eyeSpace:[.70,1.30], eyeSize:[.75,1.45], patternScale:[.60,2], roughness:[.15,.95]
  };

  function baseDefaults() {
    return {name:'Blue Duder',seed:1001,height:1,width:1,depth:.88,belly:1,
      armLength:1,armSpread:.08,armThickness:1,armGap:.10,feet:1,blend:.16,facets:12,eyeSpace:1,
      color:hex('2374EF'),accent:hex('153B92'),pattern:0,patternScale:1,
      roughness:.78,eyeSize:1.18,outfit:'none',outfitColor:hex('345E78'),hat:'none',glasses:'square',accessoryColor:hex('18232D')};
  }
  function sanitizeRecipe(obj) {
    const d=baseDefaults(), s=obj&&typeof obj==='object'?obj:{};
    for(const [key,[lo,hi]] of Object.entries(ranges)) {
      const v=Number(s[key]); if(Number.isFinite(v)) d[key]=clamp(v,lo,hi);
    }
    d.facets=[8,12,16].reduce((best,n)=>Math.abs(n-d.facets)<Math.abs(best-d.facets)?n:best,8);
    // Optional gear overrides stay absent in legacy recipes and presets. Invalid
    // or cleared overrides inherit accessoryColor instead of inventing a color.
    for(const key of ['color','accent','accessoryColor','outfitColor','hatColor','glassesColor']) {
      let c=s[key];
      if(typeof c==='string' && /^#?[0-9a-f]{6}$/i.test(c)) c=hex(c);
      const optional=key==='hatColor'||key==='glassesColor';
      // Check optional RGB component types before coercion: JSON nulls (including
      // serialized NaN/Infinity), booleans, strings and nested arrays are not RGB.
      // Keep the established coercion behavior for the four legacy color fields.
      if((Array.isArray(c)||ArrayBuffer.isView(c)) && c.length>=3 && [c[0],c[1],c[2]].every(v=>optional?typeof v==='number'&&Number.isFinite(v):Number.isFinite(Number(v))))
        d[key]=[0,1,2].map(i=>clamp(Number(c[i]),0,1));
    }
    const pat=typeof s.pattern==='string'&&!/^\d+$/.test(s.pattern)?patterns.findIndex(p=>p.toLowerCase()===s.pattern.toLowerCase()):Number(s.pattern);
    if(Number.isFinite(pat)&&pat>=0) d.pattern=clamp(Math.round(pat),0,7);
    if(hats.includes(s.hat)) d.hat=s.hat;
    if(glasses.includes(s.glasses)) d.glasses=s.glasses;
    if(['none','overalls','tee'].includes(s.outfit)) d.outfit=s.outfit;
    if(Number.isFinite(Number(s.seed))) d.seed=Number(s.seed)>>>0;
    if(typeof s.name==='string') d.name=s.name.replace(/[\x00-\x1f<>]/g,'').trim().slice(0,48)||'Duder';
    return d;
  }
  function presets() {
    const rows=[
      ['Blue Shift','2374EF','153B92',0,'none','square','18232D'],
      ['Coral Cap','FF7663','ED4E47',0,'cap','none','F2E2BE'],
      ['Sunshine','F8C837','E7A61C',0,'none','round','22252B'],
      ['Mint Bucket','67CFA0','339E77',0,'bucket','none','F5F2E8'],
      ['Lilac Nap','AD82DB','8054AD',0,'beanie','none','65377E'],
      ['Orange Pilot','FF962D','DB651C',0,'none','aviator','24252B'],
      ['Teal Bowler','42C9BE','218F8D',0,'bowler','none','25262B'],
      ['Pink Pop','EE72B1','C84786',0,'none','catEye','FFF4DC'],
      ['Cookie Crumb','F1DDB1','9D6539',1,'none','round','68482D'],
      ['Cloud Nine','77BEED','F7F4E4',2,'cap','none','286ED5'],
      ['Star Gazer','8949C6','F8D455',3,'none','square','24202B'],
      ['Lime Safari','B0D942','628A30',4,'sunhat','none','D1B17B'],
      ['Berry Buddy','EE607B','9F304D',5,'cap','none','419A60'],
      ['Caramel Patch','D8A064','794C2C',6,'none','round','34312F'],
      ['Cyan Static','4C545D','44BFD5',6,'beanie','none','36ACC5'],
      ['Cowabunga','F4EBD6','25272A',7,'bucket','none','ED4B45']
    ];
    const proportions=[
      [1,1],[.96,1.04],[1.06,.92],[.91,1.10],[1.10,.93],[1.04,1],
      [1.09,.94],[.94,1.06],[.91,1.08],[1.03,.96],[1.10,.92],[1,.99],
      [.96,1.02],[.92,1.08],[1.08,.95],[.97,1.04]
    ];
    return rows.map((a,i)=>sanitizeRecipe({ ...baseDefaults(),name:a[0],color:hex(a[1]),accent:hex(a[2]),pattern:a[3],hat:a[4],glasses:a[5],accessoryColor:hex(a[6]),seed:1001+i*977,
      height:proportions[i][0],width:proportions[i][1],
      outfit:[1,3,13].includes(i)?'overalls':[4,6].includes(i)?'tee':'none',
      outfitColor:hex(i===1?'356E7B':i===3?'345C57':i===4?'F1CB7D':i===6?'F0DAB7':'5C6C93') }));
  }
  function rng(seed) {
    let a=seed>>>0; return ()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};
  }
  function randomRecipe(seed=1) {
    seed=seed>>>0;const r=rng(seed), all=presets(), b=all[Math.floor(r()*all.length)];
    const d={...b,name:'Duder '+seed,seed,height:mix(.90,1.17,r()),width:mix(.86,1.14,r()),depth:mix(.72,1.04,r()),belly:mix(.91,1.08,r()),armLength:mix(.80,1.20,r()),armSpread:mix(.02,.15,r()),feet:mix(.86,1.15,r()),eyeSpace:mix(.82,1.19,r()),blend:mix(.11,.21,r()),patternScale:mix(.80,1.24,r())};
    if(r()<.48){d.hat=hats[1+Math.floor(r()*(hats.length-1))];d.glasses='none';}
    else {d.hat='none';d.glasses=glasses[1+Math.floor(r()*(glasses.length-1))];}
    if(r()<.20)d.pattern=Math.floor(r()*patterns.length);
    return sanitizeRecipe(d);
  }

  // Stable bone order: torso, left upper/forearm, right upper/forearm, left/right leg.
  const boneNames=['Torso','Left upper arm','Left forearm','Right upper arm','Right forearm','Left leg','Right leg'];
  const blendScales=[1,.60,.42,.60,.42,.85,.85];
  function primitives(recipe,time=0,animate=false) {
    const r=recipe,h=r.height,w=r.width,ra=.50*w*r.belly,rb=.40*w;
    const lift=Math.max(0,.20-(.72*h-ra)),aY=lift+.72*h,bY=lift+1.36*h;
    const out=[{a:[0,aY,0],b:[0,bY,0],ra,rb}];
    const length=bY-aY,slope=clamp((ra-rb)/length,-.95,.95),side=Math.sqrt(1-slope*slope);
    const radiusAt=y=>{const ly=y-aY;if(ly<slope*ra)return Math.sqrt(Math.max(0,ra*ra-ly*ly));if(ly>length+slope*rb){const t=ly-length;return Math.sqrt(Math.max(0,rb*rb-t*t));}return Math.max(0,(ra-slope*ly)/side);};
    const thick=(r.armThickness===undefined?1:r.armThickness),gap=(r.armGap===undefined?.10:r.armGap),armR=.112*w*thick;
    for(const sign of [-1,1]) {
      // Bind in an open A-pose, with the forearm on the upper arm's axis.
      // Building a bent elbow into the shell makes its inner crease fold when
      // the greeting bends the other way. Keep the same arm lengths/clearance.
      const shoulderY=lift+1.15*h,elbowY=shoulderY-.30*h*r.armLength,wristY=elbowY-.255*h*r.armLength;
      const shoulderX=Math.max(.25*w,radiusAt(shoulderY)-armR*.43);
      const widest=Math.max(radiusAt(elbowY),radiusAt(wristY),(aY>=wristY&&aY<=elbowY)?ra:0);
      const clearanceX=widest+armR*1.20+gap*w+.018;
      const elbowX=Math.max(shoulderX+.23*w*r.armLength+r.armSpread*.35,clearanceX);
      const wave=animate?Math.sin(time*1.9+sign*.72)*.035:0;
      const shoulder=[sign*shoulderX,shoulderY,0];
      const elbow=[sign*elbowX,elbowY+wave*.3,.012];
      const upper=norm(sub(elbow,shoulder));
      const forearmLength=Math.hypot(Math.max(clearanceX,elbowX+.035*w+r.armSpread*.35)-elbowX,wristY-elbowY,.028);
      const wrist=elbow.map((v,k)=>v+upper[k]*forearmLength);

      out.push({a:shoulder,b:elbow,ra:armR,rb:armR*.98});
      out.push({a:elbow.slice(),b:wrist,ra:armR*.98,rb:armR*1.20});
    }
    // Keep a real lower-leg air gap even for narrow beans with large feet.
    // Two equally distant leg fields grow by k/4 under the smooth union.
    const footR=.16*r.feet,footY=footR*.75,footX=Math.max(.23*w,footR+.075*w+.25*r.blend*.85);
    for(const sign of [-1,1]) {
      const sway=animate?Math.sin(time*1.9+sign*.8)*.025:0;
      out.push({a:[sign*footX,Math.max(footY+.035,lift+.72*h-ra*.65),.035],b:[sign*footX,footY,.08+sway],ra:footR,rb:footR});
    }
    return out;
  }
  function rigDefinition(recipe) {
    const r=sanitizeRecipe(recipe),raw=primitives(r),physical=p=>[p[0],p[1],p[2]*r.depth];
    const parts=raw.map((p,i)=>({a:physical(p.a),b:physical(p.b),ra:p.ra,rb:p.rb,name:boneNames[i]}));
    const joints=[];
    for(const [upper,lower,sign]of [[1,2,-1],[3,4,1]]){
      joints.push({parent:0,child:upper,point:parts[upper].a.slice(),type:'cone',angle:1.05,twist:.70});
      const upperDirection=sub(parts[upper].b,parts[upper].a),forearm=sub(parts[lower].b,parts[lower].a);
      // A straight bind elbow has no reliable upper/forearm cross product.
      // Build its hinge plane from the upper arm and the lateral reference.
      const up=norm(upperDirection);
      let frontal=norm([0,-up[2],up[1]]);
      if(frontal[2]*sign<0)frontal=frontal.map(v=>-v);
      const forward=norm(cross(forearm,[0,0,1]));
      // One stable elbow frame is shared by animation and physics. This partly
      // outward bend needs only a modest shoulder roll to present the mitten
      // to the camera, while retaining forward bend in walk/idle poses.
      const axis=norm(frontal.map((v,k)=>v*.80+forward[k]*.60));
      joints.push({parent:upper,child:lower,point:parts[lower].a.slice(),type:'hinge',axis,lower:-.12,upper:2.15});
    }
    for(const leg of [5,6])joints.push({parent:0,child:leg,point:parts[leg].a.slice(),type:'cone',angle:.70,twist:.42});
    return {parts,joints,names:boneNames.slice(),depth:r.depth};
  }
  // Treat each complete arm as one region before splitting it at the elbow.
  // The body may share an arm only through its local shoulder attachment;
  // proximity to a hanging forearm must not pull the ribs into a wave.
  // All envelopes are immutable bind-space functions, shared by render/export.
  const armWeightFrames=new WeakMap();
  function skinWeightsForPoint(p,parts,blend=.16) {
    const distances=parts.map(part=>sdRC(p,part));
    const regions=[distances[0],Math.min(distances[1],distances[2]),Math.min(distances[3],distances[4]),distances[5],distances[6]];
    const nearest=Math.min(...regions),span=Math.max(.065,blend*.72),weights=Array(7).fill(0);
    const regionWeights=regions.map(d=>{const t=clamp(1-(d-nearest)/span,0,1);return t*t*(3-2*t);});
    weights[0]=regionWeights[0];weights[5]=regionWeights[3];weights[6]=regionWeights[4];
    let frames=armWeightFrames.get(parts);
    if(!frames){
      frames=[[1,2],[3,4]].map(([upper,lower])=>{
        const a=norm(sub(parts[upper].b,parts[upper].a)),b=norm(sub(parts[lower].b,parts[lower].a));
        return{upper,lower,point:parts[lower].a,axis:norm(a.map((v,k)=>v+b[k])),halfWidth:parts[lower].ra*2.05,shoulder:parts[upper].a,radius:parts[upper].ra};
      });armWeightFrames.set(parts,frames);
    }
    for(const {upper,lower,point,axis,halfWidth,shoulder,radius}of frames){
      const region=(upper+1)/2,raw=regionWeights[region];if(raw===0)continue;
      // Feather from the attachment into a small local collar. Starting the
      // smoothstep just inside its center avoids a flat plateau/hard rim.
      // The outer body becomes exactly torso-owned beyond the collar.
      const portal=1-smooth(-radius*.5,radius*3.5,Math.hypot(...sub(p,shoulder)));
      // Outside the collar, an arm must actually own the surface: a nearby
      // arm across the underarm air gap cannot borrow a torso vertex.
      const armSide=smooth(0,radius*.55,distances[0]-regions[region]);
      const gate=portal+(1-portal)*armSide,total=raw*gate;
      weights[0]+=raw-total;
      const f=smooth(-halfWidth,halfWidth,dot(sub(p,point),axis));
      weights[upper]=total*(1-f);weights[lower]=total*f;
    }
    const ids=weights.map((v,i)=>i).sort((a,b)=>weights[b]-weights[a]).slice(0,4),sum=ids.reduce((s,i)=>s+weights[i],0)||1;
    return {indices:ids,weights:ids.map(i=>weights[i]/sum)};
  }
  function sdRC(p,part) {
    const {a,b,ra:r1,rb:r2}=part,ba=sub(b,a),l2=dot(ba,ba),pa=sub(p,a);
    if(l2<1e-10)return Math.hypot(...pa)-Math.max(r1,r2);
    const rr=r1-r2,a2=l2-rr*rr;
    if(a2<=1e-10) return r1>=r2?Math.hypot(...pa)-r1:Math.hypot(...sub(p,b))-r2;
    const il2=1/l2,y=dot(pa,ba),z=y-l2,xv=pa.map((v,i)=>v*l2-ba[i]*y),x2=dot(xv,xv),y2=y*y*l2,z2=z*z*l2,k=Math.sign(rr)*rr*rr*x2;
    if(Math.sign(z)*a2*z2>k)return Math.sqrt(x2+z2)*il2-r2;
    if(Math.sign(y)*a2*y2<k)return Math.sqrt(x2+y2)*il2-r1;
    return (Math.sqrt(Math.max(0,x2*a2*il2))+y*rr)*il2-r1;
  }
  function field(p,parts,blend=.16) {
    let d=1e9;
    for(let i=0;i<parts.length;i++){const k=Math.max(blend*(blendScales[i]||1),1e-4),di=sdRC(p,parts[i]),h=clamp(.5+.5*(di-d)/k,0,1);d=mix(di,d,h)-k*h*(1-h);}
    // Intersect the union with the upper half-space to give every foot a flat
    // sole, while preserving its rounded upper silhouette.
    return Math.max(d,-p[1]);
  }
  function gradient(p,parts,blend=.16) {
    const e=.006,offsets=[[e,-e,-e],[-e,-e,e],[-e,e,-e],[e,e,e]],v=[0,0,0];
    for(const off of offsets){const d=field(p.map((x,i)=>x+off[i]),parts,blend);for(let j=0;j<3;j++)v[j]+=off[j]*d;}
    return norm(v);
  }
  function projectVertex(unit,part,parts,blend=.16) {
    const pr=typeof part==='number'?parts[part]:part,ba=sub(pr.b,pr.a),len=Math.hypot(...ba),y=len>1e-5?ba.map(x=>x/len):[0,1,0],up=Math.abs(y[1])>.95?[1,0,0]:[0,1,0],x=norm(cross(up,y)),z=cross(x,y),t=clamp(unit[1]*.5+.5,0,1),rt=mix(pr.ra,pr.rb,t);
    const p=pr.a.map((v,i)=>(v+pr.b[i])*.5+x[i]*unit[0]*rt+z[i]*unit[2]*rt+y[i]*unit[1]*(len*.5+rt));
    const d0=field(p,parts,blend),bury=smooth(.70,1.25,-d0/Math.max(rt,.02)),iso=-rt*.06*bury,maxStep=Math.max(rt*1.5,.12);
    let g=gradient(p,parts,blend),step=clamp(d0-iso,-maxStep,maxStep);
    for(let j=0;j<3;j++)p[j]-=g[j]*step;
    g=gradient(p,parts,blend);step=clamp(field(p,parts,blend)-iso,-maxStep,maxStep);
    for(let j=0;j<3;j++)p[j]-=g[j]*step;
    step=clamp(field(p,parts,blend)-iso,-maxStep,maxStep);
    for(let j=0;j<3;j++)p[j]-=g[j]*step;
    return {p,n:gradient(p,parts,blend)};
  }
  // Coherent shell vertices already begin near the union. Project onto iso=0,
  // without the internal-part burial used by the original overlapping shells.
  function projectSurfaceVertex(position,parts,blend=.16) {
    const p=[position[0],position[1],position[2]],maxStep=.24;
    let g=gradient(p,parts,blend),step=clamp(field(p,parts,blend),-maxStep,maxStep);
    for(let j=0;j<3;j++)p[j]-=g[j]*step;
    g=gradient(p,parts,blend);step=clamp(field(p,parts,blend),-maxStep,maxStep);
    for(let j=0;j<3;j++)p[j]-=g[j]*step;
    step=clamp(field(p,parts,blend),-maxStep,maxStep);
    for(let j=0;j<3;j++)p[j]-=g[j]*step;
    return {p,n:gradient(p,parts,blend)};
  }

  // Integer avalanche hash is identical in JS and GLSL, unlike sin-based hashes.
  function hash2(x,y,seed) {
    let h=(Math.imul(x|0,0x1f123bb5)^Math.imul(y|0,0x5f356495)^(seed>>>0))>>>0;
    h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;h^=h>>>15;h=Math.imul(h,0x846ca68b)>>>0;h^=h>>>16;
    return (h>>>8)/16777216;
  }
  function starDistance(q) {
    let inside=false,minD=1e9;
    for(let i=0;i<10;i++){
      const j=(i+1)%10,a=TAU*i/10+Math.PI*.5,b=TAU*j/10+Math.PI*.5,ra=i%2?.119:.275,rb=j%2?.119:.275,A=[Math.cos(a)*ra,Math.sin(a)*ra],B=[Math.cos(b)*rb,Math.sin(b)*rb],e=[B[0]-A[0],B[1]-A[1]],v=[q[0]-A[0],q[1]-A[1]],t=clamp((v[0]*e[0]+v[1]*e[1])/(e[0]*e[0]+e[1]*e[1]),0,1);
      minD=Math.min(minD,Math.hypot(v[0]-e[0]*t,v[1]-e[1]*t));
      if((A[1]>q[1])!==(B[1]>q[1]) && q[0]<(B[0]-A[0])*(q[1]-A[1])/(B[1]-A[1])+A[0])inside=!inside;
    }
    return inside?-minD:minD;
  }
  function patternColor(p,recipe) {
    const r=recipe,id=Math.round(r.pattern),base=r.color,accent=r.accent;if(id===0)return base.slice();
    const uv=[Math.atan2(p[0],p[2])/TAU+.5,p[1]/2.1],scale=r.patternScale,seed=r.seed%997;
    const freq=id===2?[4,3]:id===3?[5,3]:id===5?[6,4]:[6,4],g=[uv[0]*freq[0]*scale,uv[1]*freq[1]*scale],c=g.map(Math.floor),h=hash2(c[0],c[1],seed),q=[fract(g[0])-.5+(h-.5)*.20,fract(g[1])-.5+(hash2(c[0]+19,c[1]-7,seed)-.5)*.18];
    let mask=0;
    if(id===1){const d=Math.hypot(...q)-mix(.07,.12,h);mask=(1-smooth(-.01,.01,d))*(h>.18?1:0);}
    if(id===2){const d=Math.min(Math.hypot(q[0]+.14,q[1]+.035)-.17,Math.hypot(q[0],q[1]-.055)-.22,Math.hypot(q[0]-.17,q[1]+.035)-.16);mask=(1-smooth(-.008,.008,d))*(h>.22?1:0);}
    if(id===3){mask=(1-smooth(-.008,.008,starDistance(q)))*(h>.17?1:0);}
    if(id===4||id===7){const f=(id===7?6.0:9.5)*scale,X=p[0]*f,Y=p[1]*f,Z=p[2]*f,s=(seed%251)*.017,n=Math.sin(X+.85*Math.sin(Y*.87+s))*Math.cos(Y*.76-Z*.47+s)+.36*Math.sin(Z*1.47+X*.59-s);mask=smooth(id===7?.05:.24,id===7?.13:.32,n);}
    if(id===5){const d=Math.hypot(q[0]/.075,q[1]/.17)-1;mask=(1-smooth(-.06,.06,d))*(h>.14?1:0);}
    if(id===6){const X=Math.floor(p[0]*3.7*scale+Math.sin(p[1]*4)*.24),Y=Math.floor(p[1]*3.7*scale+Math.sin(p[2]*4)*.24),Z=Math.floor(p[2]*3.7*scale+Math.cos(p[0]*4)*.24);mask=hash2(X+Z*17,Y,seed)>.68?1:0;}
    return base.map((x,i)=>mix(x,accent[i],mask));
  }
  // Fitted color-block garments are evaluated in the immutable bind space.
  // The GPU and posed export use this same coordinate convention. No floating
  // duplicate shell, new skin weights, transparency, or physics body is needed.
  function outfitColor(p,r,base) {
    if(!r.outfit||r.outfit==='none')return base;
    const lift=Math.max(0,.20-(.72*r.height-.50*r.width*r.belly));
    const x=Math.abs(p[0]/r.width),y=(p[1]-lift)/r.height,z=Math.abs(p[2]/(r.depth*r.width));
    const inside=(v,b)=>1-smooth(b-.012,b+.012,v),front=smooth(.12,.22,z);
    let mask=0,pocket=0,button=0;
    if(r.outfit==='overalls'){
      const waist=inside(y,.66)*inside(x,.55*r.belly);
      const bib=inside(x,.24)*inside(y,1.07-.025*smooth(.15,.24,x))*front;
      const strapY=1.065+.115*smooth(.18,.43,x);
      const straps=inside(Math.abs(y-strapY),.036)*smooth(.13,.17,x);
      mask=Math.max(waist,bib,straps);
      // A rounded inset pocket and two brass fasteners remain quiet at distance.
      const qx=Math.max(x-.102,0),qy=Math.max(Math.abs(y-.91)-.048,0);
      const sd=Math.hypot(qx,qy)-.028;
      pocket=inside(sd,0)*front*smooth(.66,.72,y);
      button=inside(Math.hypot(x-.18,y-1.065),.018)*front;
    }else{
      const neck=1.19-.10*Math.exp(-x*x*42);
      mask=inside(y,neck)*smooth(.60,.62,y)*inside(x,.64);
      pocket=inside(Math.hypot((p[0]/r.width-.19)*.85,y-.92),.055)*front;
    }
    const fabric=r.outfitColor||[.20,.37,.47];
    const garment=fabric.map((v,i)=>mix(v,v*.76+.12,pocket*.75));
    const brass=[.95,.76,.37];
    return base.map((v,i)=>mix(v,mix(garment[i],brass[i],button),mask));
  }
  function skinColor(p,r){return outfitColor(p,r,patternColor(p,r));}
  const skinGLSL=`
float garmentInside(float v,float b){return 1.-smoothstep(b-.012,b+.012,v);}
vec3 duderOutfit(vec3 p,vec3 base,vec4 shape,vec4 outfit){
  if(outfit.a<.5)return base;
  float lift=max(0.,.20-(.72*shape.x-.50*shape.y*shape.w));
  float x=abs(p.x/shape.y),y=(p.y-lift)/shape.x,z=abs(p.z/(shape.z*shape.y));
  float front=smoothstep(.12,.22,z),mask=0.,pocket=0.,button=0.;
  if(outfit.a<1.5){
    float waist=garmentInside(y,.66)*garmentInside(x,.55*shape.w);
    float bib=garmentInside(x,.24)*garmentInside(y,1.07-.025*smoothstep(.15,.24,x))*front;
    float strapY=1.065+.115*smoothstep(.18,.43,x);
    float straps=garmentInside(abs(y-strapY),.036)*smoothstep(.13,.17,x);
    mask=max(waist,max(bib,straps));
    float sd=length(vec2(max(x-.102,0.),max(abs(y-.91)-.048,0.)))-.028;
    pocket=garmentInside(sd,0.)*front*smoothstep(.66,.72,y);
    button=garmentInside(length(vec2(x-.18,y-1.065)),.018)*front;
  }else{
    float neck=1.19-.10*exp(-x*x*42.);
    mask=garmentInside(y,neck)*smoothstep(.60,.62,y)*garmentInside(x,.64);
    pocket=garmentInside(length(vec2((p.x/shape.y-.19)*.85,y-.92)),.055)*front;
  }
  vec3 garment=mix(outfit.rgb,outfit.rgb*.76+.12,pocket*.75);
  return mix(base,mix(garment,vec3(.95,.76,.37),button),mask);
}
float duderHash(vec2 c,float seed){
  uint h=uint(int(c.x))*0x1f123bb5u ^ uint(int(c.y))*0x5f356495u ^ uint(seed);
  h^=h>>16u;h*=0x7feb352du;h^=h>>15u;h*=0x846ca68bu;h^=h>>16u;
  return float(h>>8u)/16777216.;
}
float duderStar(vec2 q){
  bool inside=false;float md=1e9;
  for(int i=0;i<10;i++){
    int j=(i+1)%10;float a=6.28318530718*float(i)/10.+1.57079632679,b=6.28318530718*float(j)/10.+1.57079632679;
    float ra=(i%2==0)?.275:.119,rb=(j%2==0)?.275:.119;
    vec2 A=vec2(cos(a),sin(a))*ra,B=vec2(cos(b),sin(b))*rb,e=B-A,v=q-A;
    float t=clamp(dot(v,e)/dot(e,e),0.,1.);md=min(md,length(v-e*t));
    if((A.y>q.y)!=(B.y>q.y)){if(q.x<(B.x-A.x)*(q.y-A.y)/(B.y-A.y)+A.x)inside=!inside;}
  }return inside?-md:md;
}
vec3 skinColor(vec3 p,vec3 base,vec3 accent,float pattern,float scale,float seed){
  int id=int(pattern+.5);if(id==0)return base;seed=mod(seed,997.);
  vec2 uv=vec2(atan(p.x,p.z)/6.28318530718+.5,p.y/2.1);
  vec2 freq=id==2?vec2(4.,3.):id==3?vec2(5.,3.):vec2(6.,4.);
  vec2 grid=uv*freq*scale,c=floor(grid);float h=duderHash(c,seed);
  vec2 q=fract(grid)-.5+vec2((h-.5)*.20,(duderHash(c+vec2(19.,-7.),seed)-.5)*.18);float mask=0.;
  if(id==1){float d=length(q)-mix(.07,.12,h);mask=(1.-smoothstep(-.01,.01,d))*step(.18,h);}
  if(id==2){float d=min(min(length(q+vec2(.14,.035))-.17,length(q-vec2(0.,.055))-.22),length(q-vec2(.17,-.035))-.16);mask=(1.-smoothstep(-.008,.008,d))*step(.22,h);}
  if(id==3)mask=(1.-smoothstep(-.008,.008,duderStar(q)))*step(.17,h);
  if(id==4||id==7){float f=(id==7?6.:9.5)*scale;vec3 w=p*f;float s=mod(seed,251.)*.017;float n=sin(w.x+.85*sin(w.y*.87+s))*cos(w.y*.76-w.z*.47+s)+.36*sin(w.z*1.47+w.x*.59-s);mask=smoothstep(id==7?.05:.24,id==7?.13:.32,n);}
  if(id==5){float d=length(q/vec2(.075,.17))-1.;mask=(1.-smoothstep(-.06,.06,d))*step(.14,h);}
  if(id==6){vec3 c3=floor(p*3.7*scale+vec3(sin(p.y*4.),sin(p.z*4.),cos(p.x*4.))*.24);mask=step(.68,duderHash(vec2(c3.x+c3.z*17.,c3.y),seed));}
  return mix(base,accent,mask);
}`;

  const transformPoint=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
  const transformVector=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2],m[1]*p[0]+m[5]*p[1]+m[9]*p[2],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]];
  function rigidInverse(m){
    const v=[m[0],m[4],m[8],0,m[1],m[5],m[9],0,m[2],m[6],m[10],0,0,0,0,1],t=transformVector(v,[m[12],m[13],m[14]]);
    v[12]=-t[0];v[13]=-t[1];v[14]=-t[2];return v;
  }
  function dualQuaternion(m){
    // xyzw real quaternion followed by .5 * translationQuaternion * real.
    // Store these beside the existing matrices, once per bone, not per vertex.
    const trace=m[0]+m[5]+m[10];let x,y,z,w,s;
    if(trace>0){s=Math.sqrt(trace+1)*2;x=(m[6]-m[9])/s;y=(m[8]-m[2])/s;z=(m[1]-m[4])/s;w=s*.25;}
    else if(m[0]>m[5]&&m[0]>m[10]){s=Math.sqrt(1+m[0]-m[5]-m[10])*2;x=s*.25;y=(m[4]+m[1])/s;z=(m[8]+m[2])/s;w=(m[6]-m[9])/s;}
    else if(m[5]>m[10]){s=Math.sqrt(1+m[5]-m[0]-m[10])*2;x=(m[4]+m[1])/s;y=s*.25;z=(m[9]+m[6])/s;w=(m[8]-m[2])/s;}
    else{s=Math.sqrt(1+m[10]-m[0]-m[5])*2;x=(m[8]+m[2])/s;y=(m[9]+m[6])/s;z=s*.25;w=(m[1]-m[4])/s;}
    const length=Math.hypot(x,y,z,w);x/=length;y/=length;z/=length;w/=length;
    const a=m[12],b=m[13],c=m[14];
    return [x,y,z,w,.5*(a*w+b*z-c*y),.5*(b*w+c*x-a*z),.5*(c*w+a*y-b*x),-.5*(a*x+b*y+c*z)];
  }
  function skinDualQuaternion(p,n,skin,palette){
    const reference=palette[skin.indices[0]],q=Array(8).fill(0);
    for(let i=0;i<4;i++)if(skin.weights[i]>0){
      const d=palette[skin.indices[i]],sign=d.slice(0,4).reduce((s,v,k)=>s+v*reference[k],0)<0?-1:1;
      for(let k=0;k<8;k++)q[k]+=d[k]*skin.weights[i]*sign;
    }
    const length=Math.max(1e-8,Math.hypot(...q.slice(0,4)));for(let k=0;k<8;k++)q[k]/=length;
    const parallel=q.slice(0,4).reduce((s,v,k)=>s+v*q[k+4],0);for(let k=0;k<4;k++)q[k+4]-=q[k]*parallel;
    const r=q.slice(0,3),d=q.slice(4,7),translation=cross(r,d).map((v,k)=>2*(v+q[3]*d[k]-q[7]*r[k]));
    const rotate=v=>{const c=cross(r,v),d=cross(r,c.map((x,k)=>x+q[3]*v[k]));return v.map((x,k)=>x+2*d[k]);};
    return{p:rotate(p).map((v,k)=>v+translation[k]),n:rotate(n)};
  }
  function bake(geometry,recipe,smoothNormals=true,pose=null) {
    const r=sanitizeRecipe(recipe),parts=primitives(r),src=geometry.positions,ns=geometry.normals,cs=geometry.colors,meta=geometry.meta;
    if(!src||src.length%9!==0||!meta||meta.length!==src.length/3*4)throw new Error('Expected non-indexed DuderGeometry positions and vec4 meta.');
    const transforms=pose&&pose.transforms,posed=Array.isArray(transforms)&&transforms.length>=7,inv=posed?transforms.map(rigidInverse):null,palette=posed?transforms.map(dualQuaternion):null;
    const strength=clamp(pose?.projectionStrength===undefined?.55:pose.projectionStrength,0,1),distanceScale=Math.min(1,r.depth);
    function posedField(p){
      let d=1e9;
      for(let i=0;i<7;i++){
        const local=transformPoint(inv[i],p);local[2]/=r.depth;
        let di=sdRC(local,parts[i]);if(i>=5)di=Math.max(di,-local[1]);di*=distanceScale;
        const k=Math.max(1e-4,r.blend*blendScales[i]*distanceScale),h=clamp(.5+.5*(di-d)/k,0,1);d=mix(di,d,h)-k*h*(1-h);
      }return d;
    }
    function posedGradient(p){
      const e=.006,offsets=[[e,-e,-e],[-e,-e,e],[-e,e,-e],[e,e,e]],g=[0,0,0];
      for(const off of offsets){const d=posedField(p.map((v,k)=>v+off[k]));for(let k=0;k<3;k++)g[k]+=off[k]*d;}return norm(g);
    }
    const positions=[],normals=[],colors=[];
    function emit(vs,body,flat,level,kind){
      if(level>0){
        const midpoint=(a,b)=>({p:a.p.map((v,i)=>(v+b.p[i])*.5),rest:a.rest.map((v,i)=>(v+b.rest[i])*.5),n:norm(a.n.map((v,i)=>v+b.n[i])),c:a.c.map((v,i)=>(v+b.c[i])*.5),joint:(a.joint+b.joint)*.5});
        const ab=midpoint(vs[0],vs[1]),bc=midpoint(vs[1],vs[2]),ca=midpoint(vs[2],vs[0]);
        emit([vs[0],ab,ca],body,flat,level-1,kind);emit([ab,vs[1],bc],body,flat,level-1,kind);emit([ca,bc,vs[2]],body,flat,level-1,kind);emit([ab,bc,ca],body,flat,level-1,kind);return;
      }
      for(const v of vs){
        const n=!smoothNormals?(body?norm(flat.map((x,i)=>mix(x,v.n[i],v.joint*.97))):kind===1?flat:v.n):v.n;
        positions.push(...v.p);normals.push(...n);colors.push(...(body?skinColor(v.rest,r):v.c));
      }
    }
    for(let vi=0;vi<src.length/3;vi+=3){
      const vs=[];let body=true;
      for(let k=0;k<3;k++){
        const i=vi+k,part=Math.round(meta[i*4+1]),isBody=part>=0&&part<=8;body=body&&isBody;
        let p=Array.from(src.slice(i*3,i*3+3)),n=ns?Array.from(ns.slice(i*3,i*3+3)):[0,1,0],joint=0;
        const rest=isBody?[p[0],p[1],p[2]*r.depth]:p.slice();
        if(isBody){
          const skin=geometry.skinWeights?{indices:Array.from(geometry.skinIndices.slice(i*4,i*4+4)),weights:Array.from(geometry.skinWeights.slice(i*4,i*4+4))}:skinWeightsForPoint(p,parts,r.blend);
          joint=clamp((1-Math.max(...skin.weights))*4,0,1);
          if(posed){
            const skinned=skinDualQuaternion(rest,norm([n[0],n[1],n[2]/r.depth]),skin,palette);p=skinned.p;n=norm(skinned.n);
            if(part<8&&joint>0){for(let q=0;q<2;q++){const g=posedGradient(p),step=clamp(posedField(p),-.035*strength*joint,.035*strength*joint);for(let j=0;j<3;j++)p[j]-=g[j]*step;}}
            const g=posedGradient(p);n=norm(n.map((v,j)=>mix(v,g[j],joint*.8)));
          }else{
            const q=part>=7?{p,n}:projectVertex(p,part,parts,r.blend);p=q.p;p[2]*=r.depth;n=norm([q.n[0],q.n[1],q.n[2]/r.depth]);
          }
        }else if(posed){p=transformPoint(transforms[0],p);n=norm(transformVector(transforms[0],n));}
        const c=cs?Array.from(cs.slice(i*3,i*3+3)):r.color.slice();vs.push({p,n,c,rest,joint});
      }
      let flat=norm(cross(sub(vs[1].p,vs[0].p),sub(vs[2].p,vs[0].p)));
      if(body && dot(flat,vs[0].n)<0)flat=flat.map(x=>-x);
      // Garment edges and fasteners need eight samples per base edge; the
      // earlier four-sample bake left sawtooth color seams in reloaded GLBs.
      // Uniform subdivision preserves shared edges and does not change shape.
      emit(vs,body,flat,body?(r.outfit!=='none'?3:r.pattern!==0?2:0):0,meta[vi*4+2]);
    }
    return {positions:new Float32Array(positions),normals:new Float32Array(normals),colors:new Float32Array(colors),triangles:positions.length/9,poseApplied:posed};
  }
  function glb(baked,recipe) {
    const r=sanitizeRecipe(recipe),source=[baked.positions,baked.normals,baked.colors],sourceCount=source[0].length/3;
    if(!Number.isInteger(sourceCount)||source.some(a=>a.length!==source[0].length))throw new Error('GLB attributes must have equal vertex counts.');
    // The bake remains expanded for per-triangle pattern subdivision and QA.
    // Compact the final POSITION/NORMAL/COLOR records for the exported mesh,
    // preserving intentional color or normal seams without moving vertices.
    const packed=[[],[],[]],indices=new Uint32Array(sourceCount),seen=new Map();
    for(let i=0;i<sourceCount;i++){
      const values=source.flatMap(a=>Array.from(a.subarray(i*3,i*3+3)));
      if(!values.every(Number.isFinite))throw new Error('Non-finite export attribute.');
      const key=values.join(',');let index=seen.get(key);
      if(index===undefined){index=seen.size;seen.set(key,index);for(let a=0;a<3;a++)packed[a].push(...values.slice(a*3,a*3+3));}
      indices[i]=index;
    }
    const [pos,nor,col]=packed.map(a=>new Float32Array(a)),count=pos.length/3;
    const linear=new Float32Array(col.length);for(let i=0;i<col.length;i++){const c=clamp(col[i],0,1);linear[i]=c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);}
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<pos.length;i++){if(!Number.isFinite(pos[i]))throw new Error('Non-finite export vertex.');min[i%3]=Math.min(min[i%3],pos[i]);max[i%3]=Math.max(max[i%3],pos[i]);}
    const arrays=[pos,nor,linear,indices],total=arrays.reduce((s,a)=>s+a.byteLength,0),views=[];let off=0;
    const binary=new Uint8Array(total);
    for(const a of arrays){binary.set(new Uint8Array(a.buffer,a.byteOffset,a.byteLength),off);views.push({buffer:0,byteOffset:off,byteLength:a.byteLength,target:a===indices?34963:34962});off+=a.byteLength;}
    const json={asset:{version:'2.0',generator:'Duder Lab 3.4.7'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:r.name,mesh:0}],meshes:[{name:r.name,primitives:[{attributes:{POSITION:0,NORMAL:1,COLOR_0:2},indices:3,material:0,mode:4}]}],materials:[{name:'Duder shared vertex-color material',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:r.roughness},doubleSided:false}],buffers:[{byteLength:total}],bufferViews:views,accessors:[{bufferView:0,byteOffset:0,componentType:5126,count,type:'VEC3',min,max},{bufferView:1,byteOffset:0,componentType:5126,count,type:'VEC3'},{bufferView:2,byteOffset:0,componentType:5126,count,type:'VEC3'},{bufferView:3,byteOffset:0,componentType:5125,count:indices.length,type:'SCALAR',min:[0],max:[count-1]}],extras:{recipe:r,notes:'Static indexed Surface Nets body with smooth welded accessory surfaces. Rigid accessories remain separate closed components; this is not a boolean union, CAD B-rep or a rig. Color and normal seams retain separate vertex records at matching positions. Patterned faces are linearly subdivided for vertex color fidelity. The current pose is baked when supplied; runtime bones and physics constraints are not exported.'}};
    const encoded=new TextEncoder().encode(JSON.stringify(json)),jsonLen=(encoded.length+3)&~3,binLen=(total+3)&~3,buffer=new ArrayBuffer(12+8+jsonLen+8+binLen),view=new DataView(buffer),bytes=new Uint8Array(buffer);
    view.setUint32(0,0x46546C67,true);view.setUint32(4,2,true);view.setUint32(8,buffer.byteLength,true);
    view.setUint32(12,jsonLen,true);view.setUint32(16,0x4E4F534A,true);bytes.fill(32,20,20+jsonLen);bytes.set(encoded,20);
    const binHeader=20+jsonLen;view.setUint32(binHeader,binLen,true);view.setUint32(binHeader+4,0x004E4942,true);bytes.set(binary,binHeader+8);
    return buffer;
  }
  root.DuderCore=Object.freeze({version:'3.4.7',baseDefaults,presets,sanitizeRecipe,randomRecipe,primitives,rigDefinition,boneNames,blendScales,skinWeightsForPoint,dualQuaternion,skinDualQuaternion,transformPoint,transformVector,rigidInverse,sdRC,field,gradient,projectVertex,projectSurfaceVertex,skinColor,skinGLSL,bake,glb,patterns,hats,glasses,ranges,hex});
})(typeof window!=='undefined'?window:globalThis);
