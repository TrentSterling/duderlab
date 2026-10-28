/* Duder Lab — one welded body with explicit shoulder and arm loops.
 * Surface Nets supplies the torso and legs. Elliptical shoulder openings are
 * stitched to a curved collar and longitudinal arm rings with fixed weights.
 */
(function(root){
  'use strict';
  const torsoCache=new Map(),CACHE_LIMIT=64;
  const shapeKeys=['height','width','belly','armLength','armSpread','armThickness','armGap','feet','blend','facets'];
  const corners=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  const edges=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const faces=[[[0,1,3,2],[0,5,1,4]],[[4,5,7,6],[2,7,3,6]],[[0,1,5,4],[0,9,2,8]],[[2,3,7,6],[1,11,3,10]],[[0,2,6,4],[4,10,6,8]],[[1,3,7,5],[5,11,7,9]]];
  const sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

  function buildTorso(recipe,attempt=0){
    const C=root.DuderCore;if(!C)throw Error('DuderCore must load before DuderShell.');
    const r=C.sanitizeRecipe(recipe),key=shapeKeys.map(k=>r[k]).join('|');
    if(torsoCache.has(key)){const hit=torsoCache.get(key);torsoCache.delete(key);torsoCache.set(key,hit);return hit;}
    // Mesh the torso and legs first. Arm sockets are cut and stitched below.
    const parts=C.primitives(r),center=parts[0].a;
    for(const i of [1,2,3,4])parts[i]={a:center.slice(),b:center.slice(),ra:0,rb:0};
    const step=(r.facets<=8?.105:r.facets>=16?.065:.085)*Math.min(1,Math.max(.62,r.width*r.armThickness/.88))*Math.pow(.82,attempt),margin=r.blend+.11;
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(const p of parts)for(const [point,radius]of [[p.a,p.ra],[p.b,p.rb]])for(let k=0;k<3;k++){
      lo[k]=Math.min(lo[k],point[k]-radius-margin);hi[k]=Math.max(hi[k],point[k]+radius+margin);
    }
    // A fixed fractional offset avoids coincident grid nodes on exact sphere
    // extrema; it is deterministic and does not depend on skins or accessories.
    const latticeOffset=[.371,.173,.293];
    for(let k=0;k<3;k++){lo[k]=(Math.floor(lo[k]/step)-latticeOffset[k])*step;hi[k]=Math.ceil(hi[k]/step)*step;}
    const dims=lo.map((v,k)=>Math.ceil((hi[k]-v)/step)+1),[nx,ny,nz]=dims,cx=nx-1,cy=ny-1,cz=nz-1;
    const node=(x,y,z)=>x+nx*(y+ny*z),cell=(x,y,z)=>x+cx*(y+cy*z);
    const field=new Float64Array(nx*ny*nz),ids=new Int32Array(cx*cy*cz*12);ids.fill(-1);
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)
      field[node(x,y,z)]=C.field([lo[0]+x*step,lo[1]+y*step,lo[2]+z*step],parts,r.blend);
    const vertices=[],normals=[],indices=[];
    for(let z=0;z<cz;z++)for(let y=0;y<cy;y++)for(let x=0;x<cx;x++){
      const values=corners.map(c=>field[node(x+c[0],y+c[1],z+c[2])]);
      let mask=0;for(let i=0;i<8;i++)if(values[i]<0)mask|=1<<i;
      if(mask===0||mask===255)continue;
      const crossing=edges.map(([a,b])=>(values[a]<0)!==(values[b]<0)),graph=edges.map(()=>[]);
      const connect=(a,b)=>{graph[a].push(b);graph[b].push(a);};
      for(const [fc,fe]of faces){
        const active=fe.filter(e=>crossing[e]);
        if(active.length===2)connect(active[0],active[1]);
        else if(active.length===4){
          const center=[x,y,z].map((v,k)=>lo[k]+(v+fc.reduce((sum,i)=>sum+corners[i][k],0)/4)*step),inside=C.field(center,parts,r.blend)<0;
          if((values[fc[0]]<0)!==inside){connect(fe[3],fe[0]);connect(fe[1],fe[2]);}
          else {connect(fe[0],fe[1]);connect(fe[2],fe[3]);}
        }
      }
      // A saddle can contain two disconnected local patches. Give each its own
      // vertex; merging them would create a four-face nonmanifold dual edge.
      const visited=new Set();
      for(let start=0;start<12;start++)if(crossing[start]&&!visited.has(start)){
        const component=[],pending=[start];visited.add(start);
        while(pending.length){const e=pending.pop();component.push(e);for(const next of graph[e])if(!visited.has(next)){visited.add(next);pending.push(next);}}
        const p=[0,0,0];
        for(const e of component){const [a,b]=edges[e],t=values[a]/(values[a]-values[b]);for(let k=0;k<3;k++)p[k]+=corners[a][k]+t*(corners[b][k]-corners[a][k]);}
        for(let k=0;k<3;k++)p[k]=lo[k]+([x,y,z][k]+p[k]/component.length)*step;
        const projected=C.projectSurfaceVertex(p,parts,r.blend),id=vertices.length;
        for(const e of component)ids[cell(x,y,z)*12+e]=id;
        vertices.push(projected.p);normals.push(projected.n);
      }
    }
    function tri(a,b,c){
      const A=vertices[a],B=vertices[b],D=vertices[c],n=cross(sub(B,A),sub(D,A));
      const center=A.map((v,k)=>(v+B[k]+D[k])/3),g=C.gradient(center,parts,r.blend);
      if(dot(n,g)<0){const tmp=b;b=c;c=tmp;}
      indices.push(a,b,c);
    }
    function quad(a,b,c,d,positive){
      if(a<0||b<0||c<0||d<0)throw Error('Surface Nets boundary escaped its margin.');
      if(!positive){const tmp=b;b=d;d=tmp;}
      const ac=sub(vertices[a],vertices[c]),bd=sub(vertices[b],vertices[d]);
      // The crossing direction supplies consistent winding through concave joins.
      if(dot(ac,ac)<=dot(bd,bd))indices.push(a,b,c,a,c,d);else indices.push(a,b,d,b,c,d);
    }
    // Emit each dual quad once around a sign-changing lattice edge.
    for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=0;x<nx-1;x++)
      if((field[node(x,y,z)]<0)!==(field[node(x+1,y,z)]<0))
        quad(ids[cell(x,y-1,z-1)*12+3],ids[cell(x,y,z-1)*12+2],ids[cell(x,y,z)*12],ids[cell(x,y-1,z)*12+1],field[node(x,y,z)]<0);
    for(let z=1;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=1;x<nx-1;x++)
      if((field[node(x,y,z)]<0)!==(field[node(x,y+1,z)]<0))
        quad(ids[cell(x-1,y,z-1)*12+7],ids[cell(x-1,y,z)*12+5],ids[cell(x,y,z)*12+4],ids[cell(x,y,z-1)*12+6],field[node(x,y,z)]<0);
    for(let z=0;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++)
      if((field[node(x,y,z)]<0)!==(field[node(x,y,z+1)]<0))
        quad(ids[cell(x-1,y-1,z)*12+11],ids[cell(x,y-1,z)*12+10],ids[cell(x,y,z)*12+8],ids[cell(x-1,y,z)*12+9],field[node(x,y,z)]<0);

    function topologyValid(checkGeometry=false){
      const counts=new Map();
      for(let i=0;i<indices.length;i+=3){
        const a=indices[i],b=indices[i+1],c=indices[i+2];
        if(checkGeometry){
          const n=cross(sub(vertices[b],vertices[a]),sub(vertices[c],vertices[a]));
          if(!Number.isFinite(dot(n,n))||dot(n,n)<4e-20)return false;
          const center=vertices[a].map((v,k)=>(v+vertices[b][k]+vertices[c][k])/3);
          if(dot(n,C.gradient(center,parts,r.blend))<=0)return false;
        }
        for(const [v,w]of [[a,b],[b,c],[c,a]]){
          const key=v<w?v+','+w:w+','+v,old=counts.get(key)||[0,0];
          old[0]++;old[1]+=v<w?1:-1;counts.set(key,old);
        }
      }
      return [...counts.values()].every(v=>v[0]===2&&v[1]===0);
    }
    function refine(reason){
      // Very short, thin arms at minimum blend leave an underarm gap smaller
      // than the coarse lattice. Allow two extra retries for that rare shape;
      // ordinary recipes keep their original resolution and cached mesh.
      if(attempt>=6)throw Error('Cannot build a regular closed shell: '+reason);
      return buildTorso(recipe,attempt+1);
    }
    if(!topologyValid())return refine('ambiguous lattice cell');

    // Remove the visual lattice bias without moving the surface: only the
    // tangential component of each neighbor average is applied before reprojection.
    const neighbors=vertices.map(()=>new Set());
    for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){
      const a=indices[i+j],b=indices[i+(j+1)%3];neighbors[a].add(b);neighbors[b].add(a);
    }
    for(let pass=0;pass<2;pass++){
      const next=vertices.map((p,i)=>{
        const avg=[0,0,0];for(const j of neighbors[i])for(let k=0;k<3;k++)avg[k]+=vertices[j][k]/neighbors[i].size;
        const delta=sub(avg,p),g=normals[i],normalComponent=dot(delta,g);
        return C.projectSurfaceVertex(p.map((v,k)=>v+.36*(delta[k]-g[k]*normalComponent)),parts,r.blend);
      });
      for(let i=0;i<vertices.length;i++){vertices[i]=next[i].p;normals[i]=next[i].n;}
    }

    // Add one true sole contact to each foot. Splitting the containing bottom
    // face (or both faces sharing an edge) preserves the closed topology.
    for(const foot of parts.slice(5,7)){
      const projected=C.projectSurfaceVertex([foot.b[0],foot.b[1]-foot.rb,foot.b[2]],parts,r.blend),P=projected.p;
      let best=-1,bestDistance=Infinity,bestWeights=null;
      for(let i=0;i<indices.length;i+=3){
        const A=vertices[indices[i]],B=vertices[indices[i+1]],D=vertices[indices[i+2]],n=cross(sub(B,A),sub(D,A));
        if(n[1]>=0)continue;
        const den=(B[2]-D[2])*(A[0]-D[0])+(D[0]-B[0])*(A[2]-D[2]);if(Math.abs(den)<1e-12)continue;
        const a=((B[2]-D[2])*(P[0]-D[0])+(D[0]-B[0])*(P[2]-D[2]))/den;
        const b=((D[2]-A[2])*(P[0]-D[0])+(A[0]-D[0])*(P[2]-D[2]))/den,c=1-a-b;
        if(Math.min(a,b,c)<-1e-7)continue;
        const dist=Math.abs(a*A[1]+b*B[1]+c*D[1]-P[1]);
        if(dist<bestDistance){bestDistance=dist;best=i;bestWeights=[a,b,c];}
      }
      if(best<0)return refine('foot below lattice resolution');
      const v=vertices.length;vertices.push(P);normals.push(projected.n);
      const face=indices.slice(best,best+3),small=Math.min(...bestWeights);
      if(small>.002){indices.splice(best,3);tri(face[0],face[1],v);tri(face[1],face[2],v);tri(face[2],face[0],v);}
      else {
        const opposite=bestWeights.indexOf(small),ea=face[(opposite+1)%3],eb=face[(opposite+2)%3],incident=[];
        for(let i=0;i<indices.length;i+=3){const f=indices.slice(i,i+3);if(f.includes(ea)&&f.includes(eb))incident.push({i,f});}
        if(incident.length!==2)return refine('sole edge is not regular');
        for(const hit of incident.reverse()){
          indices.splice(hit.i,3);const other=hit.f.find(x=>x!==ea&&x!==eb);
          tri(ea,v,other);tri(v,eb,other);
        }
      }
    }
    if(!topologyValid(true))return refine('projection folded a coarse triangle');
    const positions=new Float32Array(indices.length*3),normalArray=new Float32Array(indices.length*3);
    for(let i=0;i<indices.length;i++){positions.set(vertices[indices[i]],i*3);normalArray.set(normals[indices[i]],i*3);}
    const result={positions,normals:normalArray,triangleCount:indices.length/3,
      indexedPositions:new Float32Array(vertices.flat()),indices:new Uint32Array(indices),
      stats:{step,vertices:vertices.length,triangles:indices.length/3,grid:dims,refinements:attempt,cacheKey:key}};
    torsoCache.set(key,result);while(torsoCache.size>CACHE_LIMIT)torsoCache.delete(torsoCache.keys().next().value);
    return result;
  }

 const norm=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);},mix=(a,b,t)=>a+(b-a)*t,clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
 const key=p=>p.map(x=>Math.round(Math.fround(x)*1e6)).join(',');
 const cache=new Map();
 function build(recipe){
  const C=root.DuderCore,r=C.sanitizeRecipe(recipe),id=shapeKeys.map(k=>r[k]).join('|');
  if(cache.has(id)){const hit=cache.get(id);cache.delete(id);cache.set(id,hit);return hit;}
  const original=buildTorso(r),parts=C.primitives(r),vertices=[];for(let i=0;i<original.indexedPositions.length;i+=3)vertices.push(Array.from(original.indexedPositions.slice(i,i+3)));
  let faces=[];const baseNormals=new Map();for(let i=0;i<original.indices.length;i+=3){faces.push({v:Array.from(original.indices.slice(i,i+3)),kind:7});for(let j=0;j<3;j++)baseNormals.set(original.indices[i+j],Array.from(original.normals.slice((i+j)*3,(i+j)*3+3)));}
  const weights=new Map(),patched=new Set(),stats=[];
  function torsoX(y,z){let lo=0,hi=2*r.width;for(let j=0;j<32;j++){const x=(lo+hi)/2;if(C.sdRC([x,y,z],parts[0])>0)hi=x;else lo=x;}return(lo+hi)/2;}
  function skin(upper,lower,total,fore=0){const w=Array(7).fill(0);w[0]=1-total;w[upper]=total*(1-fore);w[lower]=total*fore;const indices=w.map((_,i)=>i).sort((a,b)=>w[b]-w[a]).slice(0,4);return{indices,weights:indices.map(i=>w[i])};}
  for(const [upper,lower,sign]of [[1,2,-1],[3,4,1]]){
   const U=parts[upper],L=parts[lower],S=U.a,rad=U.ra,Ry=rad*2.25,Rz=rad*2.25;
   // Clip a shared boundary into the actual torso surface. Keeping its polar
   // angles avoids the folded strips produced by remapping a jagged cut.
   const kept=[],removed=[],intersections=new Map(),value=p=>((p[1]-S[1])/Ry)**2+(p[2]/Rz)**2-1;
   function crossing(a,b){const edge=a<b?a+','+b:b+','+a;if(intersections.has(edge))return intersections.get(edge);const A=vertices[a],B=vertices[b];let lo=0,hi=1,positive=value(A)>0;for(let j=0;j<32;j++){const mid=(lo+hi)/2,p=A.map((v,k)=>mix(v,B[k],mid));if((value(p)>0)===positive)lo=mid;else hi=mid;}const t=(lo+hi)/2,p=A.map((v,k)=>mix(v,B[k],t));p[0]=sign*torsoX(p[1],p[2]);const index=vertices.length;vertices.push(p);intersections.set(edge,index);return index;}
   for(const face of faces){const center=face.v.reduce((sum,i)=>sum+vertices[i][0],0)/3;
    if(center*sign<=0){kept.push(face);continue;}
    const ds=face.v.map(i=>value(vertices[i])),inside=ds.filter(d=>d<0).length;if(inside===0){kept.push(face);continue;}removed.push(face);if(inside===3)continue;
    const polygon=[];for(let j=0;j<3;j++){const a=face.v[j],b=face.v[(j+1)%3];if(ds[j]>=0)polygon.push(a);if((ds[j]>=0)!==(ds[(j+1)%3]>=0))polygon.push(crossing(a,b));}
    for(let j=1;j<polygon.length-1;j++)kept.push({v:[polygon[0],polygon[j],polygon[j+1]],kind:7});
   }
   const edges=new Map();for(const {v}of kept)for(let j=0;j<3;j++){const a=v[j],b=v[(j+1)%3],key=a<b?a+','+b:b+','+a;if(edges.has(key))edges.delete(key);else edges.set(key,[b,a]);}
   const next=new Map();for(const [a,b]of edges.values()){if(next.has(a))throw Error('Non-disk socket: multiple outgoing edges');next.set(a,b);}
   const first=next.keys().next().value,loop=[first];let cursor=next.get(first);while(cursor!==first&&loop.length<1000){if(cursor===undefined)throw Error('Open shoulder boundary');loop.push(cursor);cursor=next.get(cursor);}
   if(loop.length!==next.size)throw Error('Shoulder boundary has more than one loop '+loop.length+'/'+next.size);
   faces=kept;const retainedFaceCount=faces.length;
   const N=loop.length,outer=loop.map(i=>vertices[i]);
   const angles=outer.map(p=>Math.atan2(p[2]/Rz,(p[1]-S[1])/Ry));
   let prev=loop,ringCount=0;for(const index of loop){patched.add(index);weights.set(key(vertices[index]),skin(upper,lower,0));}
   function appendRing(points,totalWeight,forearm=0){ringCount++;const ring=[];for(const p of points){const i=vertices.length;vertices.push(p);patched.add(i);ring.push(i);weights.set(key(p.map(Math.fround)),skin(upper,lower,totalWeight,forearm));}
    for(let i=0;i<N;i++){const j=(i+1)%N;faces.push({v:[prev[i],prev[j],ring[j]],kind:8},{v:[prev[i],ring[j],ring[i]],kind:8});}prev=ring;
   }
   // The torso fillet stays pinned. It rounds into a compact high socket,
   // instead of anchoring the moving arm to vertices low on the rib cage.
   const rootRadius=.75,filletLength=.25;
   for(const t of [.2,.4,.6,.8,1])appendRing(angles.map(a=>{const radius=rad*(rootRadius+(2.25-rootRadius)*(1-Math.sin(t*Math.PI/2))),y=S[1]+Math.cos(a)*radius,z=Math.sin(a)*radius,x=mix(torsoX(y,z),torsoX(S[1],0),smooth(0,1,t))+rad*filletLength*(1-Math.cos(t*Math.PI/2));return[sign*x,y,z];}),0);
   // Bend over enough distance that neighboring tube rings cannot fold over
   // each other. Shoulder weights follow the sweep angle; the elbow blend
   // continues across this collar and every subsequent ring.
   const axis=norm(sub(U.b,S)),upperLength=Math.hypot(...sub(U.b,S)),foreLength=Math.hypot(...sub(L.b,L.a));
   let join=Math.min(upperLength*.88,rad*3.2);
   // Very thin, steep arms need more lateral room before the ring can lean.
   // Constrain the inner edge to stay outside the planar socket instead of
   // allowing a buried second layer in the first moving band.
   const rootOut=torsoX(S[1],0)+rad*filletLength,sideLean=Math.hypot(axis[1],axis[2]),bendRadius=3*(rad*.95)**2/(2*Math.max(1e-8,(join-rad*.80)*sideLean)),tightBend=bendRadius<rad*rootRadius;
   if(tightBend)join=Math.min(upperLength*.98,Math.max(join,(rootOut-S[0]*sign+rad*.99*sideLean+rad*.05)/Math.abs(axis[0])));
   const P0=[sign*(torsoX(S[1],0)+rad*filletLength),S[1],0],P3=S.map((v,k)=>v+axis[k]*join),P1=P0.map((v,k)=>v+(k===0?sign*rad*.95:0)),P2=P3.map((v,k)=>v-axis[k]*rad*.80);
   function ring(center,tangent,radius){let e1=norm([-tangent[1]*sign,tangent[0]*sign,0]),e2=norm(cross(tangent,e1)).map(v=>v*sign);return angles.map(a=>center.map((v,k)=>v+radius*(Math.cos(a)*e1[k]+Math.sin(a)*e2[k])));}
   for(const t of [.16,.32,.5,.72,1]){const q=1-t,center=[0,1,2].map(k=>P0[k]*q*q*q+3*P1[k]*q*q*t+3*P2[k]*q*t*t+P3[k]*t*t*t),tangent=norm([0,1,2].map(k=>3*(P1[k]-P0[k])*q*q+6*(P2[k]-P1[k])*q*t+3*(P3[k]-P2[k])*t*t));
    const radius=rad*mix(rootRadius,.99,t);let frame=tangent;
    if(tightBend){const lean=Math.min(Math.hypot(tangent[1],tangent[2]),clamp(((center[0]-P0[0])*sign-rad*.03*t)/radius,0,1)),yz=Math.max(1e-8,Math.hypot(tangent[1],tangent[2]));frame=[sign*Math.sqrt(1-lean*lean),tangent[1]*lean/yz,tangent[2]*lean/yz];}
    appendRing(ring(center,frame,radius),clamp(Math.atan2(center[1]-S[1],(center[0]-S[0])*sign)/Math.atan2(axis[1],axis[0]*sign),0,1),smooth(-L.ra*2.05,L.ra*2.05,dot(sub(center,S),axis)-upperLength));
   }
   const end=upperLength+foreLength,steps=Array.from({length:Math.ceil((end-join)/(rad*.55))},(_,i)=>mix(join,end,(i+1)/Math.ceil((end-join)/(rad*.55))));
   for(const s of steps){const radius=s<=upperLength?mix(U.ra,U.rb,s/upperLength):mix(L.ra,L.rb,(s-upperLength)/foreLength),center=S.map((v,k)=>v+axis[k]*s),f=smooth(-L.ra*2.05,L.ra*2.05,s-upperLength);appendRing(ring(center,axis,radius),1,f);}
   for(const angle of [Math.PI/8,Math.PI/4,Math.PI*3/8]){const center=L.b.map((v,k)=>v+axis[k]*L.rb*Math.sin(angle));appendRing(ring(center,axis,L.rb*Math.cos(angle)),1,1);}
   const tip=vertices.length,pole=L.b.map((v,k)=>v+axis[k]*L.rb);vertices.push(pole);patched.add(tip);weights.set(key(pole.map(Math.fround)),skin(upper,lower,1,1));
   for(let i=0;i<N;i++)faces.push({v:[prev[i],prev[(i+1)%N],tip],kind:8});
   stats.push({side:sign,tightBend,join:join/rad,removed:removed.length,boundaryVertices:N,rings:ringCount,addedFaces:faces.length-retainedFaceCount});
  }
  const normals=vertices.map(()=>[0,0,0]);
  for(const {v}of faces){const [a,b,c]=v.map(i=>vertices[i]),n=norm(cross(sub(b,a),sub(c,a)));for(let j=0;j<3;j++){const u=norm(sub(vertices[v[(j+1)%3]],vertices[v[j]])),w=norm(sub(vertices[v[(j+2)%3]],vertices[v[j]])),angle=Math.acos(clamp(dot(u,w),-1,1));for(let k=0;k<3;k++)normals[v[j]][k]+=n[k]*angle;}}
  for(let i=0;i<vertices.length;i++)normals[i]=patched.has(i)?norm(normals[i]):(baseNormals.get(i)||norm(normals[i]));
  const edgeCounts=new Map();for(const {v}of faces)for(let j=0;j<3;j++){const a=v[j],b=v[(j+1)%3],key=a<b?a+','+b:b+','+a,q=edgeCounts.get(key)||[0,0];q[0]++;q[1]+=a<b?1:-1;edgeCounts.set(key,q);}
  const badEdges=[...edgeCounts.values()].filter(q=>q[0]!==2||q[1]!==0);if(badEdges.length)throw Error('Ring mesh has '+badEdges.length+' invalid edges');
  // Removed socket interiors must not survive as unused indexed vertices.
  const used=[...new Set(faces.flatMap(f=>f.v))],remap=new Map(used.map((v,i)=>[v,i]));
  const positions=new Float32Array(faces.length*9),normalArray=new Float32Array(faces.length*9),indices=new Uint32Array(faces.length*3),faceKinds=[];
  faces.forEach((f,i)=>{faceKinds.push(f.kind);f.v.forEach((vi,j)=>{positions.set(vertices[vi],i*9+j*3);normalArray.set(normals[vi],i*9+j*3);indices[i*3+j]=remap.get(vi);});});
  const result={positions,normals:normalArray,indices,indexedPositions:new Float32Array(used.flatMap(i=>vertices[i])),faceKinds,skinByPosition:weights,triangleCount:faces.length,stats:{...original.stats,ringPatch:stats,closedManifold:true,vertices:used.length,triangles:faces.length}};cache.set(id,result);while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);return result;
 }
 root.DuderShell=Object.freeze({build,clearCache:()=>{cache.clear();torsoCache.clear();},version:'3.0'});
})(typeof window!=='undefined'?window:globalThis);
