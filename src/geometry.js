/* Duder Lab geometry. Parametric profile meshes; no external dependencies. */
(function (global) {
  'use strict';
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const num = (r, k, d) => Number.isFinite(r[k]) ? r[k] : d;
  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm = v => { const d=Math.hypot(...v); return d>1e-12?v.map(x=>x/d):[0,1,0]; };
  const mixCol = (a,b,t) => a.map((x,i)=>x+(b[i]-x)*t);
  const validCol = (v, fallback) => Array.isArray(v)&&v.length>=3 ? v.slice(0,3).map(x=>clamp(Number(x)||0,0,1)) : fallback;
  const DARK = [0.025,0.032,0.045];

  function metrics(recipe) {
    const r=recipe||{}, h=num(r,'height',1), w=num(r,'width',1), depth=num(r,'depth',1);
    const belly=num(r,'belly',1), ra=.50*w*belly, rb=.40*w;
    const lift=Math.max(0,.20-(.72*h-ra)), aY=lift+.72*h, bY=lift+1.36*h;
    const length=Math.max(.05,bY-aY), slope=clamp((ra-rb)/length,-.95,.95), side=Math.sqrt(1-slope*slope);
    function radiusAt(y) {
      const ly=y-aY;
      if(ly < slope*ra) return Math.sqrt(Math.max(0,ra*ra-ly*ly));
      if(ly > length+slope*rb) {const t=ly-length;return Math.sqrt(Math.max(0,rb*rb-t*t));}
      return Math.max(0,(ra-slope*ly)/side);
    }
    function faceFront(x,y) {const R=radiusAt(y);return Math.sqrt(Math.max(.0001,R*R-x*x))*depth;}
    return {h,w,depth,belly,lift,aY,bY,bodyA:[0,aY,0],bodyB:[0,bY,0],radiusA:ra,radiusB:rb,
      top:bY+rb,faceY:lift+1.33*h,eyeX:.17*w*num(r,'eyeSpace',1),radiusAt,faceFront};
  }

  class Builder {
    constructor(id) {this.id=id;this.p=[];this.n=[];this.c=[];this.m=[];this.b=[];this.outlineScale=1;this.outlineGroup=0;this.outlineScales=[];this.outlineGroups=[];this.shellTriangles=0;this.accessoryTriangles=0;this.eyeTriangles=0;}
    tri(a,b,c,color,kind=1,rough=.7,pid=-1,smooth=null,outlineWeights=null) {
      const n=cross(sub(b,a),sub(c,a));
      if(dot(n,n)<1e-18) return;
      const N=norm(n), vs=[a,b,c];
      for(let i=0;i<3;i++){
        this.p.push(...vs[i]);this.n.push(...(smooth?smooth[i]:N));this.c.push(...color);
        this.m.push(this.id,pid,kind,rough);this.b.push(i===0?1:0,i===1?1:0,i===2?1:0);
        this.outlineScales.push(kind===2||kind===3?0:this.outlineScale*(outlineWeights?outlineWeights[i]:1));this.outlineGroups.push(this.outlineGroup);
      }
      if(pid>=0)this.shellTriangles++;else if(kind===2)this.eyeTriangles++;else this.accessoryTriangles++;
    }
    triFacing(a,b,c,dir,color,kind=1,rough=.7,pid=-1,smooth=null,outlineWeights=null) {
      if(dot(cross(sub(b,a),sub(c,a)),dir)<0){const t=b;b=c;c=t;if(smooth)smooth=[smooth[0],smooth[2],smooth[1]];if(outlineWeights)outlineWeights=[outlineWeights[0],outlineWeights[2],outlineWeights[1]];}
      this.tri(a,b,c,color,kind,rough,pid,smooth,outlineWeights);
    }
    quad(a,b,c,d,dir,color,kind=1,rough=.7,outlineWeights=null) {
      this.triFacing(a,b,c,dir,color,kind,rough,-1,null,outlineWeights?[outlineWeights[0],outlineWeights[1],outlineWeights[2]]:null);
      this.triFacing(a,c,d,dir,color,kind,rough,-1,null,outlineWeights?[outlineWeights[0],outlineWeights[2],outlineWeights[3]]:null);
    }
    finish() {
      // Canonicalize coincident positions before calculating either lighting or
      // hull normals. Keep material/color splits, but give both sides of every
      // such split exactly the same position and smooth extrusion direction.
      // Body coordinates are in unscaled SDF space; accessories are already in
      // physical space, so those surfaces must not share a position bucket.
      const count=this.p.length/3,keys=new Array(count),welded=new Map();
      for(let i=0;i<count;i++){
        const off=i*3,key=this.outlineGroups[i]+':'+this.m[i*4+2]+':'+this.p.slice(off,off+3).map(x=>Math.round(x*1e6)).join(',');
        keys[i]=key;
        if(!welded.has(key))welded.set(key,{p:this.p.slice(off,off+3).map(x=>Math.abs(x)<1e-10?0:Math.fround(x)),n:[0,0,0],fallback:norm(this.n.slice(off,off+3))});
        const p=welded.get(key).p;for(let j=0;j<3;j++)this.p[off+j]=p[j];
      }
      for(let tri=0;tri<count;tri+=3){
        const pts=[0,1,2].map(i=>this.p.slice((tri+i)*3,(tri+i)*3+3));
        const face=norm(cross(sub(pts[1],pts[0]),sub(pts[2],pts[0])));
        for(let j=0;j<3;j++){
          const a=norm(sub(pts[(j+1)%3],pts[j])),b=norm(sub(pts[(j+2)%3],pts[j]));
          const angle=Math.acos(clamp(dot(a,b),-1,1)),n=welded.get(keys[tri+j]).n;
          for(let k=0;k<3;k++)n[k]+=face[k]*angle;
        }
      }
      const outline=new Float32Array(count*4);
      for(let i=0;i<count;i++){
        const shared=welded.get(keys[i]);
        // Preserve the body's smooth SDF gradient; angle-weight every CAD/gear
        // surface, including poles, caps and material boundaries.
        const n=this.m[i*4+1]>=0||Math.hypot(...shared.n)<1e-10?shared.fallback:norm(shared.n);
        for(let j=0;j<3;j++)this.n[i*3+j]=n[j];
        outline.set([...n,this.outlineScales[i]],i*4);
      }
      return {positions:new Float32Array(this.p),normals:new Float32Array(this.n),colors:new Float32Array(this.c),
        meta:new Float32Array(this.m),bary:new Float32Array(this.b),outline,
        counts:{triangles:this.p.length/9,vertices:this.p.length/3,shellTriangles:this.shellTriangles,
          accessoryTriangles:this.accessoryTriangles,eyeTriangles:this.eyeTriangles,uniquePositions:welded.size}};
    }
  }

  function indexedGeometry(geometry) {
    // WebGL indexes complete vertex records. A color/roughness boundary still
    // needs separate records, while the canonical position and smooth normal
    // remain identical. Barycentrics deliberately stay in the expanded copy for
    // the optional wireframe view; they must not prevent normal-mode welding.
    const attributes=[['positions',3],['normals',3],['colors',3],['meta',4],['skinIndices',4],['skinWeights',4],['outline',4]];
    const packed=Object.fromEntries(attributes.map(([name])=>[name,[]]));
    const count=geometry.positions.length/3,indices=new Uint32Array(count),seen=new Map();
    for(let i=0;i<count;i++){
      const key=attributes.map(([name,size])=>Array.from(geometry[name].subarray(i*size,(i+1)*size)).join(',')).join(';');
      let index=seen.get(key);
      if(index===undefined){
        index=seen.size;seen.set(key,index);
        for(const [name,size]of attributes)for(let j=0;j<size;j++)packed[name].push(geometry[name][i*size+j]);
      }
      indices[i]=index;
    }
    const out=Object.fromEntries(attributes.map(([name])=>[name,new Float32Array(packed[name])]));
    out.indices=indices;
    out.counts={...geometry.counts,vertices:seen.size,indices:indices.length,expandedVertices:count,weldedVerticesRemoved:count-seen.size};
    return out;
  }

  function sphere(B,center,scale,sides,rings,col,kind,rough,pid=-1,smooth=false) {
    function point(i,j) {if(i===0)return [0,1,0];if(i===rings)return [0,-1,0];const t=PI*i/rings,a=TAU*(j%sides)/sides;return [Math.sin(t)*Math.cos(a),Math.cos(t),Math.sin(t)*Math.sin(a)];}
    function emit(ua,ub,uc){
      const un=[ua,ub,uc],vs=un.map(q=>q.map((x,i)=>center[i]+x*scale[i]));
      const dir=vs[0].map((_,i)=>(vs[0][i]+vs[1][i]+vs[2][i])/3-center[i]);
      const ns=smooth?un.map(q=>norm(q.map((x,i)=>x/scale[i]))):null;
      B.triFacing(vs[0],vs[1],vs[2],dir,col,kind,rough,pid,ns);
    }
    for(let i=0;i<rings;i++)for(let j=0;j<sides;j++){
      const a=point(i,j),b=point(i+1,j),c=point(i+1,j+1),d=point(i,j+1);
      if(i>0)emit(a,b,d);if(i<rings-1)emit(b,c,d);
    }
  }

  // Closed profile in (radius,height), revolved about Y. A closed profile
  // includes the inner skin so the hat brim/crown has real thickness.
  function lathe(B,profile,sides,depth,col,rough=.72,offsetY=0,outline=true,outlineWeights=null,edgeColors=null,warp=null) {
    const previousStroke=B.outlineScale;if(!outline)B.outlineScale=0;
    // Profiles are oriented; use the right-hand outward normal of their 2D edge.
    let area=0;for(let i=0;i<profile.length;i++){const a=profile[i],b=profile[(i+1)%profile.length];area+=a[0]*b[1]-b[0]*a[1];}
    const orient=area>=0?1:-1;
    for(let k=0;k<profile.length;k++){
      const a=profile[k],b=profile[(k+1)%profile.length],dr=b[0]-a[0],dy=b[1]-a[1];
      if(Math.abs(dr)+Math.abs(dy)<1e-8)continue;
      for(let i=0;i<sides;i++){
        const t=TAU*i/sides,tn=TAU*(i+1)/sides,tm=(t+tn)/2;
        const p=(v,t)=>{const radius=Math.abs(v[0])<1e-10?0:v[0],angle=t===TAU?0:t,q=[radius*Math.cos(angle),v[1]+offsetY,radius*Math.sin(angle)*depth];return warp?warp(q,angle,v):q;};
        const outward=[orient*dy*Math.cos(tm),-orient*dr,orient*dy*Math.sin(tm)/depth];
        // Keep the hollow hat's inner/contact loop fixed while the exterior
        // expands. Moving both edges of a thin underside annulus by a constant
        // pixel width can detach its stroke from the visible hem over the head.
        const wa=outlineWeights?outlineWeights[k]:1,wb=outlineWeights?outlineWeights[(k+1)%profile.length]:1;
        B.quad(p(a,t),p(a,tn),p(b,tn),p(b,t),outward,edgeColors?.[k]||col,1,rough,[wa,wa,wb,wb]);
      }
    }
    B.outlineScale=previousStroke;
  }

  function tube(B,points,radius,col,rough=.6,sides=6) {
    const rings=points.map((p,i)=>{
      const tangent=norm(sub(points[Math.min(i+1,points.length-1)],points[Math.max(0,i-1)]));
      const ref=Math.abs(tangent[1])>.85?[0,0,1]:[0,1,0];
      const u=norm(cross(tangent,ref)),v=norm(cross(tangent,u));
      return Array.from({length:sides},(_,j)=>{const a=TAU*j/sides;return p.map((x,k)=>x+radius*(Math.cos(a)*u[k]+Math.sin(a)*v[k]));});
    });
    for(let i=0;i<rings.length-1;i++)for(let j=0;j<sides;j++){
      const j1=(j+1)%sides,a=rings[i][j],b=rings[i][j1],c=rings[i+1][j1],d=rings[i+1][j];
      const midpoint=a.map((x,k)=>(x+b[k]+c[k]+d[k])/4-(points[i][k]+points[i+1][k])/2);
      B.quad(a,b,c,d,midpoint,col,1,rough);
    }
    for(let e=0;e<2;e++){
      const i=e?rings.length-1:0,dir=norm(sub(points[i],points[e?i-1:1]));
      for(let j=0;j<sides;j++)B.triFacing(points[i],rings[i][j],rings[i][(j+1)%sides],dir,col,1,rough);
    }
  }

  function eyes(B,m,r) {
    const size=num(r,'eyeSize',1.18),rx=.034*m.w*size,ry=.060*m.w*size,rz=.025*m.w*m.depth;
    for(const sign of [-1,1]){
      const x=sign*m.eyeX,y=m.faceY,z=m.faceFront(x,y)+.008*m.w;
      sphere(B,[x,y,z],[rx,ry,rz],12,8,[.016,.023,.033],2,.20,-1,true);
      if(r.glasses==='none'||r.glasses==='round'||!r.glasses)
        sphere(B,[x-.010*m.w*size,y+.021*m.w*size,z+.021*m.w*m.depth],[.009*m.w*size,.012*m.w*size,.005*m.w],8,4,[.88,.94,1],2,.14,-1,true);
    }
  }

  // The eyes and opaque lenses are separate low-poly surfaces. Their centers
  // can clear while the curved lens fan crosses an eye near an edge. Maximize
  // their depth difference over exact projected triangle intersections, not
  // just vertices or a sampling grid. A linear difference reaches its maximum
  // at a vertex of the clipped overlap polygon. This runs only on rebuild.
  function eyewearClearance(B,front,back,w) {
    function plane(t) {
      const [a,b,c]=t,det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      if(Math.abs(det)<1e-12*w*w)return null;
      const x=((b[2]-a[2])*(c[1]-a[1])-(c[2]-a[2])*(b[1]-a[1]))/det;
      const y=((b[0]-a[0])*(c[2]-a[2])-(c[0]-a[0])*(b[2]-a[2]))/det;
      return {t:det>0?t:[a,c,b],det,x,y,z:a[2]-x*a[0]-y*a[1],
        minX:Math.min(a[0],b[0],c[0]),maxX:Math.max(a[0],b[0],c[0]),minY:Math.min(a[1],b[1],c[1]),maxY:Math.max(a[1],b[1],c[1])};
    }
    const eyes=[];
    for(let i=0;i<B.p.length;i+=9)if(B.m[i/3*4+2]===2){
      const e=plane([B.p.slice(i,i+3),B.p.slice(i+3,i+6),B.p.slice(i+6,i+9)]);
      if(e&&e.det>0)eyes.push(e);
    }
    function overlap(triangles) {
      let greatest=-Infinity;
      for(const t of triangles){const f=plane(t);if(!f)continue;
        for(const e of eyes){
          if(e.maxX<f.minX||f.maxX<e.minX||e.maxY<f.minY||f.maxY<e.minY)continue;
          let polygon=e.t;
          for(let i=0;i<3&&polygon.length;i++){
            const a=f.t[i],b=f.t[(i+1)%3],side=q=>(b[0]-a[0])*(q[1]-a[1])-(b[1]-a[1])*(q[0]-a[0]),clipped=[];
            for(let j=0;j<polygon.length;j++){
              const u=polygon[j],v=polygon[(j+1)%polygon.length],du=side(u),dv=side(v);
              if(du>=0)clipped.push(u);
              if((du>=0)!==(dv>=0)){const s=du/(du-dv);clipped.push(u.map((q,k)=>q+s*(v[k]-q)));}
            }
            polygon=clipped;
          }
          for(const p of polygon)greatest=Math.max(greatest,p[2]-(f.x*p[0]+f.y*p[1]+f.z));
        }
      }
      return greatest;
    }
    const visibleOverlap=overlap(front),penetration=Math.max(0,visibleOverlap);
    if(!penetration)return 0;
    // A fixed thickness/margin at activation would make the glasses pop. Ramp
    // extra clearance from zero, up to the full rear-surface separation plus
    // a small tolerance. Existing hidden rear contact near onset is retained;
    // this corrects visible breakthrough, not a boolean union of all solids.
    return penetration+Math.min(Math.max(0,overlap(back)-visibleOverlap)+.0005*w,penetration);
  }

  function eyewear(B,m,r) {
    const type=r.glasses||'none';if(type==='none')return;
    const w=m.w,space=num(r,'eyeSpace',1),frame=validCol(r.glassesColor,validCol(r.accessoryColor,DARK)),lens=[.032,.050,.072];
    const isRound=type==='round';
    const shape=[];
    if(type==='square'){
      const pts=[[1,.58],[.75,1],[-.75,1],[-1,.58],[-1,-.58],[-.75,-1],[.75,-1],[1,-.58]];
      for(const p of pts)shape.push([p[0]*.145*w*space,p[1]*.111*w]);
    }else if(type==='catEye'){
      const pts=[[1.12,.86],[.24,.65],[-.76,.62],[-.97,.22],[-.80,-.64],[-.18,-.94],[.58,-.68],[.90,-.05]];
      for(const p of pts)shape.push([p[0]*.141*w*space,p[1]*.114*w]);
    }else if(type==='aviator'){
      for(let i=0;i<12;i++){const a=TAU*i/12,c=Math.cos(a),s=Math.sin(a);shape.push([c*.136*w*space,s*.124*w*(s<0?1.12:.90)]);}
    }else{
      for(let i=0;i<12;i++){const a=TAU*i/12;shape.push([Math.cos(a)*.127*w*space,Math.sin(a)*.135*w]);}
    }
    const rims=[-1,1].map(sign=>{
      const cx=sign*m.eyeX,cy=m.faceY,xy=shape.map(p=>[cx+(type==='catEye'?sign*p[0]:p[0]),cy+p[1]]);
      let area=0;for(let i=0;i<xy.length;i++){const a=xy[i],b=xy[(i+1)%xy.length];area+=a[0]*b[1]-b[0]*a[1];}if(area<0)xy.reverse();
      const inner=xy.map(p=>[cx+(p[0]-cx)*.77,cy+(p[1]-cy)*.77]);
      return {sign,cx,cy,xy,inner};
    });
    const basePoint=(p,offset)=>[p[0],p[1],m.faceFront(p[0],p[1])+.050*w+offset];
    let clearance=0;
    if(!isRound){
      const front=[],back=[];
      for(const {cx,cy,xy,inner}of rims)for(let i=0;i<xy.length;i++){
        const j=(i+1)%xy.length;
        for(const [triangles,offset]of [[front,.015*w],[back,-.014*w]]){
          const A=basePoint(xy[i],offset),B1=basePoint(xy[j],offset),C=basePoint(inner[j],offset),D=basePoint(inner[i],offset);
          triangles.push([A,B1,C],[A,C,D]);
        }
        const center=[cx,cy,m.faceFront(cx,cy)+.053*w];
        front.push([center,basePoint(inner[i],.004*w),basePoint(inner[j],.004*w)]);
        back.push([[cx,cy,center[2]-.009*w],basePoint(inner[i],-.006*w),basePoint(inner[j],-.006*w)]);
      }
      clearance=eyewearClearance(B,front,back,w);
    }
    // Preserve the old arithmetic path exactly when no clearance is required.
    const shifted=p=>{if(clearance)p[2]+=clearance;return p;};
    const point=(p,offset)=>shifted(basePoint(p,offset));
    for(const {sign,cx,cy,xy,inner}of rims){
      const n=xy.length;
      for(let i=0;i<n;i++){
        const j=(i+1)%n,A=point(xy[i],.015*w),B1=point(xy[j],.015*w),C=point(inner[j],.015*w),D=point(inner[i],.015*w);
        const a=point(xy[i],-.014*w),b=point(xy[j],-.014*w),c=point(inner[j],-.014*w),d=point(inner[i],-.014*w);
        B.quad(A,B1,C,D,[0,0,1],frame,1,.46);B.quad(a,b,c,d,[0,0,-1],frame,1,.46);
        const outward=[(xy[i][0]+xy[j][0])/2-cx,(xy[i][1]+xy[j][1])/2-cy,0];
        B.quad(A,a,b,B1,outward,frame,1,.46);B.quad(D,C,c,d,outward.map(x=>-x),frame,1,.46);
        if(!isRound){
          const center=shifted([cx,cy,m.faceFront(cx,cy)+.053*w]);
          const surfaceNormal=p=>{
            const e=.001*w;
            const dx=(m.faceFront(p[0]+e,p[1])-m.faceFront(p[0]-e,p[1]))/(2*e);
            const dy=(m.faceFront(p[0],p[1]+e)-m.faceFront(p[0],p[1]-e))/(2*e);
            return norm([-dx,-dy,1]);
          };
          const front=[center,point(inner[i],.004*w),point(inner[j],.004*w)];
          const back=[[center[0],center[1],center[2]-.009*w],point(inner[i],-.006*w),point(inner[j],-.006*w)];
          B.triFacing(...front,[0,0,1],lens,3,.18,-1,front.map(surfaceNormal));
          B.triFacing(...back,[0,0,-1],lens,3,.18,-1,back.map(p=>surfaceNormal(p).map(v=>-v)));
          // The perimeter is buried inside the frame, but must still close the
          // lens solid so its front/back surfaces share one watertight boundary.
          B.quad(front[1],back[1],back[2],front[2],outward,lens,3,.18);
        }
      }
      const maxX=xy.reduce((v,p)=>Math.max(v,sign*p[0]),0),sideX=Math.max(m.radiusAt(cy)+.028*w,maxX+.020*w);
      // Intersect the actual rim at the temple height. The maximum-width point
      // of a cat-eye sits above this height; using it left the arm detached.
      const hingeY=cy+.025*w;let edgeX=-Infinity,edge=0,edgeT=0;
      for(let i=0;i<xy.length;i++){
        const a=xy[i],b=xy[(i+1)%xy.length];
        if(Math.abs(b[1]-a[1])<1e-10||hingeY<Math.min(a[1],b[1])||hingeY>Math.max(a[1],b[1]))continue;
        const t=(hingeY-a[1])/(b[1]-a[1]),x=sign*(a[0]+t*(b[0]-a[0]));
        if(x>edgeX){edgeX=x;edge=i;edgeT=t;}
      }
      // Use the rim's actual triangulation halfway between its front/back faces,
      // rather than resampling the curved head, which can miss a coarse rim.
      const j=(edge+1)%n,A=point(xy[edge],.0005*w),B1=point(xy[j],.0005*w),C=point(inner[j],.0005*w),D=point(inner[edge],.0005*w),inset=.18,t=edgeT;
      const hinge=t>=inset?A.map((v,k)=>(1-t)*v+(t-inset)*B1[k]+inset*C[k]):A.map((v,k)=>(1-inset)*v+t*C[k]+(inset-t)*D[k]);
      // Shallow, widely spaced frames can put the hinge behind the old fixed
      // bend. Keep the path moving rearward so its six-sided rings cannot flip.
      const sideZ=Math.min(.105*w*m.depth,hinge[2]-.060*w*m.depth);
      tube(B,[hinge,[sign*sideX,cy+.015*w,sideZ],[sign*(sideX-.018*w),cy-.025*w,-.16*w*m.depth]],.016*w,frame,.48,6);
    }
    const bridgeY=m.faceY+.018*w,bridgeZ=m.faceFront(0,bridgeY)+.065*w+(clearance||0);
    tube(B,[[-.050*w*space,bridgeY,bridgeZ-.005*w],[0,bridgeY+.017*w,bridgeZ],[.050*w*space,bridgeY,bridgeZ-.005*w]],.014*w,frame,.46,6);
    if(type==='aviator')tube(B,[[-.067*w*space,bridgeY+.065*w,bridgeZ-.005*w],[.067*w*space,bridgeY+.065*w,bridgeZ-.005*w]],.009*w,frame,.40,6);
  }

  function hats(B,m,r,sides) {
    const type=r.hat||'none';if(type==='none')return;
    const w=m.w,d=m.depth,col=validCol(r.hatColor,validCol(r.accessoryColor,[.94,.89,.77]));
    const y=m.top-.17*w,profile=[];
    const P=p=>p.map(v=>[v[0]*w,v[1]*w]);
    if(type==='cap'){
      const outerR=.435,innerR=.405,centerY=-.23;
      // Close the shell on the underside lip, following the bean's upper dome.
      for(const a of [Math.asin(.23/outerR),.80,1.02,1.25,PI/2])profile.push([Math.cos(a)*outerR*w,(centerY+Math.sin(a)*outerR)*w]);
      for(const a of [PI/2,1.25,1.02,.80,Math.asin(.23/innerR)])profile.push([Math.cos(a)*innerR*w,(centerY+Math.sin(a)*innerR)*w]);
      lathe(B,profile,sides,d,col,.74,y,true,[1,1,1,1,1,0,0,0,0,0]);
      const rim=Array.from({length:11},(_,i)=>{
        const a=-PI/2+PI*i/10,c=i===0||i===10?0:Math.max(0,Math.cos(a)),ri=.350*w,ro=ri+.30*w*Math.pow(c,.7);
        const inner=[Math.sin(a)*ri,y+.004*w,c*ri*d];
        // A visor tapers to one shared vertex at either end. Previously the
        // inner/outer heights differed there, creating collinear open edges
        // that no nondegenerate end cap could close.
        return {inner,outer:c===0?inner.slice():[Math.sin(a)*ro,y+.004*w-.064*w*c,c*ro*d],outlineWeight:c===0?0:1};
      });
      for(let i=0;i<rim.length-1;i++){
        const a=rim[i],b=rim[i+1],down=p=>[p[0],p[1]-.025*w,p[2]];
        // Anchor the visor's contact arc and coincident tapered endpoints too;
        // its top/underside stretch to the moving outer edge as one hull.
        const weights=[0,a.outlineWeight,b.outlineWeight,0];
        B.quad(a.inner,a.outer,b.outer,b.inner,[0,1,0],col,1,.77,weights);
        B.quad(down(a.inner),down(a.outer),down(b.outer),down(b.inner),[0,-1,0],mixCol(col,DARK,.10),1,.8,weights);
        const dir=[(a.outer[0]+b.outer[0])/2,0,(a.outer[2]+b.outer[2])/2];
        B.quad(a.outer,down(a.outer),down(b.outer),b.outer,dir,col,1,.75,[a.outlineWeight,a.outlineWeight,b.outlineWeight,b.outlineWeight]);
        B.quad(a.inner,b.inner,down(b.inner),down(a.inner),dir.map(x=>-x),col,1,.75,[0,0,0,0]);
      }
      sphere(B,[0,m.top+.039*w,0],[.034*w,.020*w,.034*w*d],6,3,mixCol(col,DARK,.12),1,.75);
    }else if(type==='bucket'){
      lathe(B,P([[.340,0],[.590,-.080],[.605,-.045],[.400,.025],[.320,.300],[0,.300],[0,.267],[.290,.267],[.365,.025]]),sides,d,col,.82,y,true,[0,1,1,1,1,1,0,0,0]);
      lathe(B,P([[.391,.052],[.383,.082],[.387,.084],[.396,.054]]),sides,d,mixCol(col,DARK,.13),.83,y,false);
    }else if(type==='beanie'){
      const base=m.top-.245*w;
      // Joined crown/cuff profiles form one closed surface, with microscopic
      // intersection notches removed. The bottom outer crease uses 75% of
      // the shell width to stay covered by the cuff; the interior is fixed.
      const shape=[[.377,0],[.424,0],[.438,.010],[.443,.078],[.432,.094],[.411,.130],[.376,.229],[.295,.340],[.166,.412],[0,.439],[0,.400],[.146,.378],[.264,.312],[.342,.210],[.377,.109]];
      const tint=mixCol(col,DARK,.08),edgeColors=shape.map((_,i)=>i>=1&&i<=3?tint:col);
      lathe(B,P(shape),sides,d,col,.94,base,true,[0,.75,1,1,1,1,1,1,1,1,0,0,0,0,0],edgeColors);
    }else if(type==='bowler'){
      lathe(B,P([[.340,0],[.555,-.010],[.577,.021],[.549,.046],[.410,.040],[.409,.144],[.364,.248],[.247,.319],[0,.346],[0,.314],[.220,.289],[.330,.222],[.375,.122],[.375,.023]]),sides,d,col,.64,y,true,[0,1,1,1,1,1,1,1,1,0,0,0,0,0]);
      lathe(B,P([[.409,.054],[.414,.056],[.410,.108],[.404,.110]]),sides,d,mixCol(col,DARK,.55),.8,y,false);
    }else if(type==='sunhat'){
      lathe(B,P([[.340,0],[.755,-.056],[.777,-.033],[.760,-.004],[.410,.025],[.380,.198],[.313,.275],[0,.278],[0,.244],[.291,.242],[.348,.181],[.377,.025]]),sides,d,col,.88,y,true,[0,1,1,1,1,1,1,1,0,0,0,0]);
      lathe(B,P([[.402,.060],[.408,.062],[.399,.117],[.392,.119]]),sides,d,mixCol(col,[.17,.105,.06],.66),.85,y,false);
    }else if(type==='cowboy'){
      // One closed shell: side-curled brim and a pinched, softly dented crown.
      const warp=(q,a,v)=>{
        const radius=v[0]/w,h=v[1]/w,brim=clamp((radius-.42)/.30,0,1);
        q[1]+=.145*w*brim*brim*Math.pow(Math.cos(a),4);
        const pinch=clamp((h-.12)/.30,0,1)*.10;
        q[0]*=1-pinch;
        return q;
      };
      lathe(B,P([[.340,0],[.720,-.035],[.755,-.012],[.730,.025],[.410,.050],[.425,.230],[.365,.390],[.255,.430],[0,.400],[0,.365],[.235,.395],[.335,.360],[.392,.220],[.377,.040]]),sides,d,col,.83,y,true,[0,1,1,1,1,1,1,1,1,0,0,0,0,0],null,warp);
      lathe(B,P([[.415,.070],[.421,.072],[.427,.134],[.421,.136]]),sides,d,mixCol(col,DARK,.47),.85,y,false,null,null,warp);
    }else if(type==='wizard'){
      // The cone bends with height, while both skins share the same displacement.
      const bend=(q,a,v)=>{const t=clamp(v[1]/(.98*w),0,1);q[0]-=.27*w*t*t;q[2]-=.045*w*t*t*d;return q;};
      lathe(B,P([[.340,0],[.620,-.025],[.642,.008],[.610,.040],[.400,.075],[.350,.280],[.270,.520],[.180,.740],[.090,.900],[0,.980],[0,.940],[.070,.865],[.150,.710],[.240,.490],[.320,.260],[.365,.070]]),sides,d,col,.87,y,true,[0,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0],null,bend);
      lathe(B,P([[.395,.104],[.400,.106],[.385,.166],[.379,.168]]),sides,d,mixCol(col,[.96,.72,.35],.68),.84,y,false,null,null,bend);
    }else if(type==='chef'){
      // A continuous cuff-to-puff shell; six gentle lobes imply gathered fabric.
      const shape=[[.340,0],[.390,.015],[.400,.200],[.480,.270],[.560,.430],[.520,.600],[.400,.690],[.200,.740],[0,.760],[0,.720],[.180,.700],[.370,.650],[.480,.560],[.520,.430],[.445,.290],[.365,.215],[.360,.035]];
      const pleat=(q,a,v)=>{const h=v[1]/w,t=clamp((h-.20)/.12,0,1),f=1+.055*t*Math.cos(6*a);q[0]*=f;q[2]*=f;return q;};
      const tint=mixCol(col,DARK,.09),colors=shape.map((_,i)=>i===1?tint:col);
      lathe(B,P(shape),Math.ceil(sides/12)*12,d,col,.93,y,true,[0,.75,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0],colors,pleat);
    }else if(type==='crown'){
      // Six points belong to one thick open ring, with a pinned lower contact.
      const points=(q,a,v)=>{if(v[1]/w>.19)q[1]+=.185*w*Math.max(0,Math.cos(6*a));return q;};
      lathe(B,P([[.360,0],[.405,0],[.413,.070],[.405,.200],[.370,.200],[.365,.070]]),Math.ceil(sides/12)*12,d,col,.52,y,true,[0,.75,1,1,1,0],null,points);
      const stroke=B.outlineScale;B.outlineScale=0;
      const jewel=mixCol(validCol(r.accent,[.20,.55,.64]),[.8,.95,1],.18);
      sphere(B,[0,y+.105*w,.410*w*d],[.046*w,.052*w,.018*w*d],8,4,jewel,1,.32);
      B.outlineScale=stroke;
    }else if(type==='beret'){
      // Lean the crown as one shell; the contact ring stays centered on the head.
      const lean=(q,a,v)=>{const t=clamp(v[1]/(.30*w),0,1);q[0]+=.10*w*t;q[1]+=.10*q[0]*t;return q;};
      lathe(B,P([[.340,0],[.390,.015],[.510,.095],[.590,.200],[.540,.300],[.370,.370],[0,.390],[0,.355],[.350,.335],[.500,.270],[.550,.200],[.470,.120],[.360,.045]]),sides,d,col,.94,y,true,[0,.75,1,1,1,1,1,0,0,0,0,0,0],null,lean);
      lathe(B,P([[0,.385],[.026,.385],[.029,.435],[.018,.452],[0,.452]]),12,d,mixCol(col,DARK,.15),.94,y,true,null,null,lean);
    }else if(type==='topHat'){
      lathe(B,P([[.340,0],[.570,-.015],[.590,.010],[.560,.040],[.405,.040],[.390,.200],[.430,.600],[.440,.640],[0,.640],[0,.605],[.405,.605],[.356,.200],[.372,.045]]),sides,d,col,.76,y,true,[0,1,1,1,1,1,1,1,1,0,0,0,0]);
      lathe(B,P([[.402,.071],[.408,.073],[.398,.170],[.392,.172]]),sides,d,mixCol(col,[.80,.38,.29],.60),.83,y,false);
    }
  }

  function build(recipe,characterId=0) {
    const r=recipe||{},B=new Builder(characterId),m=metrics(r);
    const sides=num(r,'facets',12)<=8?8:num(r,'facets',12)>=16?16:12;
    const rings=sides===8?6:sides===16?10:8;
    const base=validCol(r.color,[.20,.45,.94]),rough=clamp(num(r,'roughness',.7),.05,1);
    if(global.DuderShell&&typeof global.DuderShell.build==='function'){
      // One coherent rest shell removes the internal overlapping triangles of
      // per-primitive sphere templates. The vertex shader still projects every
      // vertex against the live seven-primitive SDF, preserving blend-shell motion.
      const shell=global.DuderShell.build(r),p=shell.positions,n=shell.normals;
      for(let i=0;i<p.length;i+=9){
        const a=Array.from(p.subarray(i,i+3)),b=Array.from(p.subarray(i+3,i+6)),c=Array.from(p.subarray(i+6,i+9));
        const ns=[Array.from(n.subarray(i,i+3)),Array.from(n.subarray(i+3,i+6)),Array.from(n.subarray(i+6,i+9))];
        const outward=ns[0].map((v,k)=>v+ns[1][k]+ns[2][k]);
        B.triFacing(a,b,c,outward,base,0,rough,7,ns);
      }
    }else{
      // Development fallback only; the standalone build includes shell.js.
      for(let pid=0;pid<7;pid++)sphere(B,[0,0,0],[1,1,1],sides,rings,base,0,rough,pid,true);
    }
    B.outlineGroup=1;eyes(B,m,r);
    B.outlineGroup=2;B.outlineScale=.60;eyewear(B,m,r);
    // Curved wearables get twice the circumferential sampling of the body
    // setting. Their existing closed profiles and anchored contact loops stay.
    B.outlineGroup=3;B.outlineScale=1;hats(B,m,r,sides*2);
    const out=B.finish();
    const parts=global.DuderCore.primitives(global.DuderCore.sanitizeRecipe(r)),vertices=out.positions.length/3;
    out.skinIndices=new Float32Array(vertices*4);out.skinWeights=new Float32Array(vertices*4);
    for(let i=0;i<vertices;i++){
      if(out.meta[i*4+1]<0){out.skinWeights[i*4]=1;continue;}
      const p=Array.from(out.positions.subarray(i*3,i*3+3)),skin=global.DuderCore.skinWeightsForPoint(p,parts,num(r,'blend',.16));
      out.skinIndices.set(skin.indices,i*4);out.skinWeights.set(skin.weights,i*4);
    }
    out.counts.parts=7;out.counts.hat=r.hat||'none';out.counts.glasses=r.glasses||'none';
    out.indexed=indexedGeometry(out);return out;
  }
  global.DuderGeometry={build,metrics,version:'3.4.5',hatNames:['none','cap','bucket','beanie','bowler','sunhat','cowboy','wizard','chef','crown','beret','topHat'],glassesNames:['none','square','round','aviator','catEye']};
})(typeof window!=='undefined'?window:globalThis);
