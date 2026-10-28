/** Structural acceptance for the connected shoulder-ring surface.
 * Uses mesh incidence, provided normals, and transported bind-face normals.
 * The old implicit arm union is deliberately not a shape-quality oracle.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--source',path.join(path.dirname(fileURLToPath(import.meta.url)),'..')));
const reportPath=path.resolve(arg('--report','/tmp/duder-shoulder-manifold-report.json'));
const bindOnly=process.argv.includes('--bind-only');
const checkFacing=process.argv.includes('--check-facing');
const probeTriangles=arg('--probe-triangles','').split(',').filter(Boolean).map(Number);
const context={Float32Array,Uint32Array},sourceHashes={};vm.createContext(context);
for(const name of ['core','shell','geometry','animation']){
  const source=fs.readFileSync(path.join(root,'src',name+'.js'),'utf8');
  sourceHashes[name+'.js']=crypto.createHash('sha256').update(source).digest('hex');
  vm.runInContext(source,context,{filename:name+'.js'});
}
const C=context.DuderCore,S=context.DuderShell,G=context.DuderGeometry,A=context.DuderAnimation;
const sub=(a,b)=>a.map((v,k)=>v-b[k]),dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(...a),distance=(a,b)=>length(sub(a,b));
const unit=a=>{const n=length(a);return a.map(v=>v/Math.max(1e-30,n));};
const point=(array,i)=>Array.from(array.slice(i*3,i*3+3));
const canonical=p=>p.map(x=>Math.round(Math.fround(x)*1e6)).join(',');
const exact=p=>p.join(',');
const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const sevenWeights=skin=>{const w=Array(7).fill(0);for(let k=0;k<4;k++)w[skin.indices[k]]+=skin.weights[k];return w;};
const skinAt=(g,i)=>({indices:Array.from(g.skinIndices.slice(i*4,i*4+4)),weights:Array.from(g.skinWeights.slice(i*4,i*4+4))});
const failures=[],cases=[];
const check=(condition,caseName,message,detail)=>{if(!condition)failures.push({case:caseName,message,...(detail?{detail}: {})});};

function topology(positions,triangles){
  const edges=new Map(),neighbors=new Map(),used=new Set();let zeroArea=0,minDoubleArea=Infinity,volume=0;
  for(const tri of triangles){
    const [a,b,c]=tri.map(i=>point(positions,i)),face=cross(sub(b,a),sub(c,a)),area=length(face);
    minDoubleArea=Math.min(minDoubleArea,area);if(!(area>1e-12))zeroArea++;
    volume+=dot(a,cross(b,c))/6;
    for(let k=0;k<3;k++){
      const a=tri[k],b=tri[(k+1)%3],id=a<b?a+','+b:b+','+a;
      const value=edges.get(id)||{count:0,direction:0};value.count++;value.direction+=a<b?1:-1;edges.set(id,value);
      used.add(a);used.add(b);if(!neighbors.has(a))neighbors.set(a,new Set());if(!neighbors.has(b))neighbors.set(b,new Set());neighbors.get(a).add(b);neighbors.get(b).add(a);
    }
  }
  let components=0;const seen=new Set();for(const seed of used)if(!seen.has(seed)){
    components++;const stack=[seed];seen.add(seed);while(stack.length){const i=stack.pop();for(const j of neighbors.get(i))if(!seen.has(j)){seen.add(j);stack.push(j);}}
  }
  return{vertices:used.size,edges:edges.size,triangles:triangles.length,components,euler:used.size-edges.size+triangles.length,
    invalidIncidence:[...edges.values()].filter(e=>e.count!==2).length,inconsistentWinding:[...edges.values()].filter(e=>e.direction!==0).length,zeroArea,minDoubleArea,signedVolume:volume};
}
function requireTopology(name,label,t){
  check(t.components===1,name,label+' is not one connected body',t);
  check(t.invalidIncidence===0&&t.inconsistentWinding===0,name,label+' has an open/nonmanifold edge or inconsistent winding',t);
  check(t.euler===2,name,label+' does not have sphere topology',t);
  check(t.zeroArea===0&&t.signedVolume>0,name,label+' has collapsed triangles or reversed global orientation',t);
}
function faceAlignment(positions,normals,triangles){
  let minimum=1,reversed=0,worst=null;const negativeTriangles=[];
  for(let i=0;i<triangles.length;i++){
    const tri=triangles[i],p=tri.map(j=>point(positions,j)),n=tri.map(j=>point(normals,j));
    const face=unit(cross(sub(p[1],p[0]),sub(p[2],p[0]))),average=unit([0,1,2].map(k=>n[0][k]+n[1][k]+n[2][k]));
    const cosine=dot(face,average);if(cosine<minimum){minimum=cosine;worst={triangle:i,cosine,positions:p};}if(cosine< -1e-6){reversed++;negativeTriangles.push(i);}
  }
  return{minimum,reversed,worst,negativeTriangles};
}
function actualFacing(positions,triangles,nodeIds,flagged,width){
  const selected=[...new Set(flagged)];if(!selected.length)return{tested:0,failures:[]};
  const data=triangles.map((indices,id)=>{const p=indices.map(i=>point(positions,i));return{id,p,keys:indices.map(i=>nodeIds[i]),min:[0,1,2].map(k=>Math.min(...p.map(v=>v[k]))),max:[0,1,2].map(k=>Math.max(...p.map(v=>v[k])))};});
  function edgeTriangle(a,b,tri){
    const direction=sub(b,a),e1=sub(tri[1],tri[0]),e2=sub(tri[2],tri[0]),h=cross(direction,e2),det=dot(e1,h);if(Math.abs(det)<1e-12)return false;
    const inverse=1/det,s=sub(a,tri[0]),u=inverse*dot(s,h);if(u<1e-7||u>1-1e-7)return false;
    const q=cross(s,e1),v=inverse*dot(direction,q);if(v<1e-7||u+v>1-1e-7)return false;
    const t=inverse*dot(e2,q);return t>1e-7&&t<1-1e-7;
  }
  function winding(p){
    let sum=0;for(const tri of data){const [a,b,c]=tri.p.map(q=>sub(q,p)),la=length(a),lb=length(b),lc=length(c);sum+=2*Math.atan2(dot(a,cross(b,c)),la*lb*lc+dot(a,b)*lc+dot(b,c)*la+dot(c,a)*lb);}return sum/(4*Math.PI);
  }
  const failures=[];let maxWindingError=0;
  for(const id of selected){
    const tri=data[id],face=cross(sub(tri.p[1],tri.p[0]),sub(tri.p[2],tri.p[0])),normal=unit(face),center=[0,1,2].map(k=>(tri.p[0][k]+tri.p[1][k]+tri.p[2][k])/3);
    const maxEdge=Math.max(...[0,1,2].map(i=>distance(tri.p[i],tri.p[(i+1)%3]))),epsilon=Math.max(1e-9,Math.min(1e-5*width,length(face)/maxEdge*.05));
    const outside=winding(center.map((v,k)=>v+normal[k]*epsilon)),inside=winding(center.map((v,k)=>v-normal[k]*epsilon)),intersections=[];
    for(const other of data){
      if(tri.keys.some(key=>other.keys.includes(key))||[0,1,2].some(k=>tri.max[k]<other.min[k]-1e-9||other.max[k]<tri.min[k]-1e-9))continue;
      if([0,1,2].some(k=>edgeTriangle(tri.p[k],tri.p[(k+1)%3],other.p)||edgeTriangle(other.p[k],other.p[(k+1)%3],tri.p)))intersections.push(other.id);
    }
    const error=Math.max(Math.abs(outside),Math.abs(inside-1));maxWindingError=Math.max(maxWindingError,error);
    if(error>1e-4||intersections.length)failures.push({triangle:id,windingOutside:outside,windingInside:inside,intersections});
  }
  return{tested:selected.length,maxWindingError,failures};
}
function bodyGeometry(g){
  const sizes={positions:3,normals:3,colors:3,meta:4,skinIndices:4,skinWeights:4},arrays=Object.fromEntries(Object.keys(sizes).map(name=>[name,[]]));
  for(let i=0;i<g.positions.length/3;i++)if(g.meta[i*4+1]>=0)for(const [name,size]of Object.entries(sizes))for(let k=0;k<size;k++)arrays[name].push(g[name][i*size+k]);
  return Object.fromEntries(Object.keys(sizes).map(name=>[name,new Float32Array(arrays[name])]));
}
const specs=C.presets().map((r,i)=>({name:'preset-'+String(i+1).padStart(2,'0')+'-'+r.name,recipe:r}));
specs.push({name:'reported-wave',recipe:C.sanitizeRecipe({...C.randomRecipe(1702468274),facets:12})});
for(const [name,changes]of [
  ['thin-short-low-resolution',{facets:8,height:1.3,width:.75,armLength:.7,armThickness:.65,armGap:0,blend:.22}],
  ['wide-short-thick',{facets:8,height:.75,width:1.3,belly:1.2,armLength:.7,armThickness:1.35,armGap:0,armSpread:-.15,blend:.22}],
  ['thin-long-minimum-blend',{facets:16,height:1.3,width:.75,armLength:1.4,armThickness:.65,armSpread:.22,armGap:.24,blend:.03}],
  ['deep-thick',{facets:12,depth:1.24,armThickness:1.35,armLength:.7,armGap:0,blend:.22}],
  ['flat-short',{facets:8,depth:.62,armThickness:.65,armLength:.7,armGap:0,blend:.03}]
])specs.push({name,recipe:C.sanitizeRecipe({...C.baseDefaults(),...changes})});

const selected=arg('--case',null);
for(const {name,recipe:r}of specs.filter(s=>!selected||s.name.includes(selected))){
  const start=performance.now(),failureStart=failures.length;
  try{
    const s=S.build(r),g=bodyGeometry(G.build(r)),count=g.positions.length/3;
    check(C.boneNames.length===7,name,'The ring metadata became an eighth bone');
    const shellTriangles=[];for(let i=0;i<s.indices.length;i+=3)shellTriangles.push(Array.from(s.indices.slice(i,i+3)));
    const shellTopology=topology(s.indexedPositions,shellTriangles);requireTopology(name,'Indexed shell',shellTopology);
    check(shellTopology.vertices===s.indexedPositions.length/3,name,'Unused indexed vertices remain in the shell',{used:shellTopology.vertices,allocated:s.indexedPositions.length/3});
    const expandedTriangles=Array.from({length:count/3},(_,i)=>[i*3,i*3+1,i*3+2]);
    const shellExpanded=Array.from({length:s.positions.length/9},(_,i)=>[i*3,i*3+1,i*3+2]);
    const shellOrientation=faceAlignment(s.positions,s.normals,shellExpanded);
    // Smooth source normals and DQ-transported normals are approximations at
    // a sharply bent collar. Report disagreement; incidence/winding is the
    // structural gate, with flagged faces independently inspected geometrically.
    const bindOrientation=faceAlignment(g.positions,g.normals,expandedTriangles);
    check(count===s.positions.length/3,name,'Geometry builder dropped shell triangles',{shell:s.positions.length/9,body:count/3});
    let reordered=0,flipped=0;
    for(let i=0;i<Math.min(count,s.positions.length/3);i+=3){
      const a=[0,1,2].map(k=>canonical(point(s.positions,i+k))),b=[0,1,2].map(k=>canonical(point(g.positions,i+k)));
      const sameSet=a.every(key=>b.includes(key));if(!sameSet)reordered++;else if(![0,1,2].some(shift=>a.every((key,k)=>key===b[(k+shift)%3])))flipped++;
    }
    check(reordered===0&&flipped===0,name,'Final builder changed shell triangle identity or winding',{reordered,flipped});

    const unique=new Map(),nodes=[],ids=[];let missingPatchWeights=0,maxWeightError=0,maxSeamWeightError=0,maxSeamNormalError=0,invalidSkin=0,maxStoredSkinError=0;
    for(let i=0;i<count;i++){
      const p=point(g.positions,i),key=exact(p),skin=skinAt(g,i),weights=sevenWeights(skin),n=point(g.normals,i),kind=g.meta[i*4+1];
      if(!p.every(Number.isFinite)||!n.every(Number.isFinite)||!skin.indices.every(x=>Number.isInteger(x)&&x>=0&&x<7)||!skin.weights.every(x=>Number.isFinite(x)&&x>=0)||skin.weights[0]<Math.max(...skin.weights)-1e-7)invalidSkin++;
      maxWeightError=Math.max(maxWeightError,Math.abs(skin.weights.reduce((a,b)=>a+b,0)-1));
      const stored=s.skinByPosition?.get(canonical(p));
      if(kind===8&&!stored)missingPatchWeights++;
      if(stored){const expected=sevenWeights(stored);maxStoredSkinError=Math.max(maxStoredSkinError,...weights.map((w,k)=>Math.abs(w-expected[k])));}
      if(!unique.has(key)){unique.set(key,nodes.length);nodes.push({position:p,normal:n,weights,members:[]});}
      const id=unique.get(key),node=nodes[id];ids.push(id);node.members.push(i);
      maxSeamWeightError=Math.max(maxSeamWeightError,...weights.map((w,k)=>Math.abs(w-node.weights[k])));
      maxSeamNormalError=Math.max(maxSeamNormalError,distance(n,node.normal));
    }
    const bindPositions=new Float32Array(nodes.flatMap(n=>n.position)),weldedTriangles=expandedTriangles.map(tri=>tri.map(i=>ids[i]));
    const finalTopology=topology(bindPositions,weldedTriangles);requireTopology(name,'Final welded body',finalTopology);
    const bindFacing=checkFacing?actualFacing(g.positions,expandedTriangles,ids,[...bindOrientation.negativeTriangles,...probeTriangles],r.width):null;
    if(bindFacing)check(bindFacing.failures.length===0,name,'Flagged bind faces are buried, reversed, or intersect nonadjacent faces',bindFacing);
    check(invalidSkin===0&&maxWeightError<2e-6,name,'Invalid or unnormalized skin records',{invalidSkin,maxWeightError});
    check(missingPatchWeights===0&&maxStoredSkinError<2e-6,name,'Structured patch silently fell back to analytic weights',{missingPatchWeights,maxStoredSkinError});
    check(maxSeamWeightError<1e-7&&maxSeamNormalError<2e-6,name,'Coincident body vertices disagree on skin weights or normals',{maxSeamWeightError,maxSeamNormalError});
    // Color subdivision is irrelevant to mesh deformation. Use the exact body
    // and dimensions, with a solid bare recipe so input/output vertices map 1:1.
    const bakeRecipe={...r,pattern:0,outfit:'none'},neutral=C.bake(g,bakeRecipe,true),poseResults=[];
    const physical=new Float32Array(g.positions);for(let i=2;i<physical.length;i+=3)physical[i]*=r.depth;
    let neutralRestError=0;for(let i=0;i<count;i++)neutralRestError=Math.max(neutralRestError,distance(point(neutral.positions,i),point(physical,i)));
    check(neutralRestError<2e-6,name,'Neutral export changes the authored body/shoulder surface',{neutralRestError});
    const poses=bindOnly?[]:[['identity',{transforms:Array.from({length:7},identity)}],...([0,.8,1.16,1.88,2.38,2.82,3.2,3.76].map(t=>['wave-'+t,A.sample(r,'wave',t)]))];
    for(const [poseName,pose]of poses){
      const baked=C.bake(g,bakeRecipe,true,pose),palette=pose.transforms.map(C.dualQuaternion),nodePositions=new Float32Array(nodes.length*3);
      let seamError=0,invalid=0,minAreaRatio=Infinity,minTransportAlignment=1,transportReversals=0,worstTransport=null;const transportFlags=[];
      for(let id=0;id<nodes.length;id++){
        const members=nodes[id].members,reference=point(baked.positions,members[0]);nodePositions.set(reference,id*3);
        for(const member of members){const p=point(baked.positions,member);if(!p.every(Number.isFinite))invalid++;seamError=Math.max(seamError,distance(p,reference));}
      }
      for(let i=0;i<count;i+=3){
        const p=[0,1,2].map(k=>point(physical,i+k)),q=[0,1,2].map(k=>point(baked.positions,i+k));
        const bindFace=cross(sub(p[1],p[0]),sub(p[2],p[0])),posedFace=cross(sub(q[1],q[0]),sub(q[2],q[0]));
        const transported=[0,1,2].map(k=>C.skinDualQuaternion([0,0,0],unit(bindFace),skinAt(g,i+k),palette).n);
        const normal=unit([0,1,2].map(k=>transported[0][k]+transported[1][k]+transported[2][k]));
        const cosine=dot(unit(posedFace),normal);minAreaRatio=Math.min(minAreaRatio,length(posedFace)/Math.max(1e-30,length(bindFace)));
        if(cosine<minTransportAlignment){minTransportAlignment=cosine;worstTransport={triangle:i/3,kind:g.meta[i*4+1],cosine,bind:p,posed:q};}if(cosine< -1e-6){transportReversals++;transportFlags.push(i/3);}
      }
      const posedTopology=topology(nodePositions,weldedTriangles),orientation=faceAlignment(baked.positions,baked.normals,expandedTriangles);
      const facing=checkFacing?actualFacing(baked.positions,expandedTriangles,ids,[...orientation.negativeTriangles,...transportFlags,...probeTriangles],r.width):null;
      if(facing)check(facing.failures.length===0,name,poseName+' has flagged faces buried, reversed, or intersecting nonadjacent faces',facing);
      requireTopology(name,poseName+' welded body',posedTopology);
      check(invalid===0&&seamError<2e-6,name,poseName+' separates coincident shoulder vertices or produces nonfinite positions',{invalid,seamError});
      // A rigidly transported bind normal omits the skin-weight gradient.
      // Sharp but outward collar bends can rotate past90 degrees relative to
      // this approximation. Keep it diagnostic, not a false inversion gate.
      poseResults.push({pose:poseName,seamError,minAreaRatio,minTransportAlignment,transportReversals,normalReversals:orientation.reversed,minNormalAlignment:orientation.minimum,minDoubleArea:posedTopology.minDoubleArea,signedVolume:posedTopology.signedVolume,...(facing?{facing}: {})});
    }
    cases.push({name,recipe:r,ms:Math.round(performance.now()-start),shellTopology,finalTopology,shellOrientation,bindOrientation,bindFacing,flipped,reordered,missingPatchWeights,maxStoredSkinError,maxWeightError,maxSeamWeightError,maxSeamNormalError,neutralRestError,poseResults,failures:failures.length-failureStart});
  }catch(error){failures.push({case:name,message:error.stack||String(error)});cases.push({name,recipe:r,ms:Math.round(performance.now()-start),exception:String(error)});}
  console.log(JSON.stringify({case:name,failures:failures.length-failureStart,ms:Math.round(performance.now()-start)}));
  fs.writeFileSync(reportPath+'.progress.json',JSON.stringify({cases:cases.length,failures},null,2)+'\n');
}
const report={scope:'The actual shell and rendered body: all 16 presets, the reported seed, and five dimensional extremes unless --case selects a subset. Identity plus eight wave samples, or bind only with --bind-only. Structural gates: welded closure, directed winding, connectedness, positive volume, nonzero area, stored skin assignments, neutral export identity, and seam continuity. Supplied/transported-normal disagreement is diagnostic: both omit deformation-gradient effects. With --check-facing, each flagged face is tested for exterior/interior generalized winding0/1 and proper nonadjacent triangle intersections. Shared-vertex contacts and coplanar overlaps are excluded; this is not a proof of absence of all self intersections. Color subdivision is suppressed only during deformation checks.',bindOnly,checkFacing,sourceRoot:root,sourceHashes,cases:cases.length,poseCases:cases.reduce((n,c)=>n+(c.poseResults?.length||0),0),passed:failures.length===0,checks:cases,failures};
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:reportPath,cases:report.cases,poseCases:report.poseCases,passed:report.passed,failures:failures.length}));
if(failures.length)process.exitCode=1;
