/* Duder Lab — coherent Surface Nets skin for the seven-part SDF union.
 * This supplies one closed tessellation instead of overlapping primitive skins.
 * One local shoulder loop distributes the arm bend; the rest of the original
 * low-poly body and arms keep their existing mesh and bounded SDF correction.
 */
(function(root){
  'use strict';
  const cache=new Map(),CACHE_LIMIT=64;
  const shapeKeys=['height','width','belly','armLength','armSpread','armThickness','armGap','feet','blend','facets'];
  const corners=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  const edges=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const faces=[[[0,1,3,2],[0,5,1,4]],[[4,5,7,6],[2,7,3,6]],[[0,1,5,4],[0,9,2,8]],[[2,3,7,6],[1,11,3,10]],[[0,2,6,4],[4,10,6,8]],[[1,3,7,5],[5,11,7,9]]];
  const sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

  function build(recipe,attempt=0){
    const C=root.DuderCore;if(!C)throw Error('DuderCore must load before DuderShell.');
    const r=C.sanitizeRecipe(recipe),key=shapeKeys.map(k=>r[k]).join('|');
    if(cache.has(key)){const hit=cache.get(key);cache.delete(key);cache.set(key,hit);return hit;}
    // A few more samples keep posed underarm triangles from spanning an entire
    // occlusion fold. This improves the smooth shell without another draw pass.
    const parts=C.primitives(r),step=(r.facets<=8?.105:r.facets>=16?.065:.085)*Math.min(1,Math.max(.62,r.width*r.armThickness/.88))*Math.pow(.82,attempt),margin=r.blend+.11;
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
      return build(recipe,attempt+1);
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
    const original={positions,normals:normalArray,triangleCount:indices.length/3,
      indexedPositions:new Float32Array(vertices.flat()),indices:new Uint32Array(indices),
      stats:{step,vertices:vertices.length,triangles:indices.length/3,grid:dims,refinements:attempt,cacheKey:key}};
    const result=shoulderLoop(original,r,parts);
    cache.set(key,result);while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
    return result;
  }
 function shoulderLoop(source,r,parts){
  const C=root.DuderCore,points=[],normals=[],len2=(a,b)=>dot(sub(a,b),sub(a,b));
  for(let i=0;i<source.indexedPositions.length;i+=3)points.push(Array.from(source.indexedPositions.slice(i,i+3)));
  let faces=[];for(let i=0;i<source.indices.length;i+=3){faces.push(Array.from(source.indices.slice(i,i+3)));for(let j=0;j<3;j++)normals[source.indices[i+j]]=Array.from(source.normals.slice((i+j)*3,(i+j)*3+3));}
  const stats=[],skinByPosition=new Map();const skinKey=p=>p.map(v=>Math.round(Math.fround(v)*1e6)).join(',');
  // Split just one influence contour at each shoulder. Every original vertex
  // stays at its existing position; only triangles crossed by the loop change.
  for(const upper of [1,3]){const lower=upper+1,total=p=>{const s=C.skinWeightsForPoint(p,parts,r.blend);return s.indices.reduce((sum,b,k)=>sum+([upper,lower].includes(b)?s.weights[k]:0),0);},values=points.map(p=>total(p)-.5),cuts=new Map(),out=[];let changed=0;
   function cut(a,b){const k=a<b?a+','+b:b+','+a;if(cuts.has(k))return cuts.get(k);const A=points[a],B=points[b],t=-values[a]/(values[b]-values[a]);const hit=C.projectSurfaceVertex(A.map((v,k)=>v+(B[k]-v)*t),parts,r.blend);
    // Slide the lower part of the new loop toward the shoulder. This changes
    // the long flat underarm chord into a bend, without narrowing the arm root.
    const S=parts[upper].a,rad=parts[upper].ra,below=Math.max(0,Math.min(1,(S[1]-hit.p[1]-rad*.25)/(rad*1.55))),lift=1.2*rad*below*below*(3-2*below),delta=S.map((v,k)=>v-hit.p[k]),length=Math.hypot(...delta);if((t<.08||t>.92)&&lift<=rad*.25){const original=t<.08?a:b;cuts.set(k,original);return original;}hit.p=hit.p.map((v,k)=>v+delta[k]*lift/Math.max(1e-8,length));
    // Interpolate the original endpoint influences. Re-evaluating the distance
    // envelope at the inserted point would repaint this carefully placed loop.
    const w=Array(7).fill(0);for(const [p,f]of [[A,1-t],[B,t]]){const skin=C.skinWeightsForPoint(p,parts,r.blend);for(let j=0;j<4;j++)w[skin.indices[j]]+=skin.weights[j]*f;}w[upper]+=w[lower];w[lower]=0;const ids=w.map((_,i)=>i).sort((a,b)=>w[b]-w[a]).slice(0,4),sum=ids.reduce((s,i)=>s+w[i],0);skinByPosition.set(skinKey(hit.p),{indices:ids,weights:ids.map(i=>w[i]/sum)});
    const index=points.length;points.push(hit.p);normals.push(hit.n);values.push(0);cuts.set(k,index);return index;}
   function polygon(ids){ids=ids.filter((v,i)=>i===0||v!==ids[i-1]);if(ids.length>1&&ids[0]===ids[ids.length-1])ids.pop();if(ids.length<3)return;if(ids.length===3)out.push(ids);else if(len2(points[ids[0]],points[ids[2]])<=len2(points[ids[1]],points[ids[3]]))out.push([ids[0],ids[1],ids[2]],[ids[0],ids[2],ids[3]]);else out.push([ids[0],ids[1],ids[3]],[ids[1],ids[2],ids[3]]);}
   for(const face of faces){const signs=face.map(i=>values[i]>=0);if(signs.every(Boolean)||signs.every(x=>!x)){out.push(face);continue;}changed++;
    for(const side of [true,false]){const poly=[];for(let j=0;j<3;j++){const a=face[j],b=face[(j+1)%3];if(signs[j]===side)poly.push(a);if(signs[j]!==signs[(j+1)%3])poly.push(cut(a,b));}polygon(poly);}
   }faces=out;stats.push({upper,cutEdges:cuts.size,changedFaces:changed});
  }
  // Recompute normals only on the inserted band and its shared boundary.
  const touched=new Set();for(const face of faces)if(face.some(i=>i>=source.indexedPositions.length/3))for(const i of face)touched.add(i);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);},sums=points.map(()=>[0,0,0]);
  for(const face of faces){const n=unit(cross(sub(points[face[1]],points[face[0]]),sub(points[face[2]],points[face[0]])));for(let j=0;j<3;j++){const i=face[j];if(!touched.has(i))continue;const a=unit(sub(points[face[(j+1)%3]],points[i])),b=unit(sub(points[face[(j+2)%3]],points[i])),angle=Math.acos(Math.max(-1,Math.min(1,dot(a,b))));for(let k=0;k<3;k++)sums[i][k]+=n[k]*angle;}}
  for(const i of touched)normals[i]=unit(sums[i]);
  const positions=new Float32Array(faces.length*9),ns=new Float32Array(faces.length*9),indices=new Uint32Array(faces.length*3);faces.forEach((f,i)=>f.forEach((v,j)=>{positions.set(points[v],i*9+j*3);ns.set(normals[v],i*9+j*3);indices[i*3+j]=v;}));
  const result={positions,skinByPosition,normals:ns,indices,indexedPositions:new Float32Array(points.flat()),triangleCount:faces.length,stats:{...source.stats,baseTriangles:source.triangleCount,triangles:faces.length,vertices:points.length,shoulderLoop:stats}};return result;
 }
  root.DuderShell=Object.freeze({build,clearCache:()=>cache.clear(),version:'3.1'});
})(typeof window!=='undefined'?window:globalThis);
