/* Duder Lab V2 — convex collision proxies in the exact visual rest frame.
 * Build round cones before depth scaling, cut foot soles at world-rest Y=0,
 * and only then convert to each physics body's local coordinates.
 */
(function(root){
  'use strict';
  const C=root.CANNON, EPS=1e-9;
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function cleanFace(face,vertices){
    const out=[];for(const id of face)if(out.at(-1)!==id)out.push(id);
    if(out.length>1&&out[0]===out.at(-1))out.pop();
    let changed=true;
    while(changed&&out.length>=3){changed=false;for(let i=0;i<out.length;i++){
      const a=vertices[out[(i+out.length-1)%out.length]],b=vertices[out[i]],c=vertices[out[(i+1)%out.length]],n=cross(sub(b,a),sub(c,b));
      if(dot(n,n)<1e-20){out.splice(i,1);changed=true;break;}
    }}return out;
  }
  function clipSole(vertices,faces){
    if(vertices.every(p=>p[1]>=-EPS))return{vertices,faces};
    const output=[],mapped=new Map(),cutEdges=new Map(),polygons=[];
    const addOriginal=i=>{if(mapped.has(i))return mapped.get(i);const p=vertices[i].slice();if(Math.abs(p[1])<EPS)p[1]=0;const id=output.length;output.push(p);mapped.set(i,id);return id;};
    function intersection(a,b){
      if(Math.abs(vertices[a][1])<EPS)return addOriginal(a);if(Math.abs(vertices[b][1])<EPS)return addOriginal(b);
      const key=a<b?a+','+b:b+','+a;if(cutEdges.has(key))return cutEdges.get(key);
      const A=vertices[a],B=vertices[b],t=A[1]/(A[1]-B[1]),id=output.length;
      output.push([A[0]+(B[0]-A[0])*t,0,A[2]+(B[2]-A[2])*t]);cutEdges.set(key,id);return id;
    }
    for(const face of faces){
      const poly=[];
      for(let i=0;i<face.length;i++){
        const a=face[i],b=face[(i+1)%face.length],insideA=vertices[a][1]>=-EPS,insideB=vertices[b][1]>=-EPS;
        if(insideA&&insideB)poly.push(addOriginal(b));
        else if(insideA&&!insideB)poly.push(intersection(a,b));
        else if(!insideA&&insideB)poly.push(intersection(a,b),addOriginal(b));
      }
      const cleaned=cleanFace(poly,output);if(cleaned.length>=3)polygons.push(cleaned);
    }
    const cut=[];for(let i=0;i<output.length;i++)if(Math.abs(output[i][1])<EPS)cut.push(i);
    if(cut.length>=3){
      const center=[0,0,0];for(const i of cut)for(let k=0;k<3;k++)center[k]+=output[i][k]/cut.length;
      // Ascending angle in XZ yields an outward -Y normal on the sole cap.
      cut.sort((a,b)=>Math.atan2(output[a][2]-center[2],output[a][0]-center[0])-Math.atan2(output[b][2]-center[2],output[b][0]-center[0]));
      const cap=cleanFace(cut,output);if(cap.length>=3)polygons.push(cap);
    }
    return{vertices:output,faces:polygons};
  }
  function shape(part,depth,restCenter,restQ,index=0,quality={}){
    if(!C)throw Error('DuderCollision requires embedded cannon-es');
    depth=Math.max(.01,Number(depth)||1);
    const a=new C.Vec3(part.a[0],part.a[1],part.a[2]/depth),b=new C.Vec3(part.b[0],part.b[1],part.b[2]/depth),delta=b.vsub(a),length=Math.max(1e-5,delta.length()),center=a.vadd(b).scale(.5);
    delta.normalize();const rawQ=new C.Quaternion();rawQ.setFromVectors(C.Vec3.UNIT_Y,delta);
    const ra=part.ra,rb=part.rb,slope=Math.max(-.99,Math.min(.99,(ra-rb)/length)),join=Math.acos(slope),vertices=[],faces=[],rings=[],sides=Math.max(4,Math.round(quality.sides||8)),steps=Math.max(1,Math.round(quality.bands||2));
    function add(p){const w=rawQ.vmult(new C.Vec3(...p)).vadd(center);vertices.push([w.x,w.y,w.z*depth]);return vertices.length-1;}
    const bottom=add([0,-length*.5-ra,0]);
    function ring(angle,y,r){const ids=[];for(let i=0;i<sides;i++){const t=i*Math.PI*2/sides;ids.push(add([Math.sin(angle)*r*Math.cos(t),y+Math.cos(angle)*r,Math.sin(angle)*r*Math.sin(t)]));}rings.push(ids);}
    for(let i=1;i<=steps;i++)ring(Math.PI+(join-Math.PI)*i/steps,-length*.5,ra);
    for(let i=0;i<steps;i++)ring(join*(1-i/steps),length*.5,rb);
    const top=add([0,length*.5+rb,0]);
    for(let j=0;j<sides;j++)faces.push([bottom,rings[0][j],rings[0][(j+1)%sides]]);
    for(let k=0;k<rings.length-1;k++)for(let j=0;j<sides;j++)faces.push([rings[k][j],rings[k+1][j],rings[k+1][(j+1)%sides],rings[k][(j+1)%sides]]);
    for(let j=0;j<sides;j++)faces.push([rings.at(-1)[j],top,rings.at(-1)[(j+1)%sides]]);
    const clipped=index>=5?clipSole(vertices,faces):{vertices,faces},qi=restQ.inverse(),origin=restCenter;
    const local=clipped.vertices.map(p=>qi.vmult(new C.Vec3(p[0]-origin.x,p[1]-origin.y,p[2]-origin.z)));
    const points=local.map(p=>[p.x,p.y,p.z]),valid=[];
    for(const face of clipped.faces){
      const f=cleanFace(face,points);if(f.length<3)continue;
      const n=cross(sub(points[f[1]],points[f[0]]),sub(points[f[2]],points[f[0]])),center=[0,0,0];
      for(const i of f)for(let k=0;k<3;k++)center[k]+=points[i][k]/f.length;
      if(dot(n,center)<0)f.reverse();valid.push(f);
    }
    const result=new C.ConvexPolyhedron({vertices:local,faces:valid});result.duderSoleClipped=index>=5;return result;
  }
  root.DuderCollision=Object.freeze({shape,version:'2.0'});
})(typeof window!=='undefined'?window:globalThis);
