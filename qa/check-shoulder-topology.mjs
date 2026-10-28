/** Measure the actual shoulder mesh, rather than inferring quality from weights.
 * Diagnostic only: long edges, area growth, union-surface error, and the extent
 * of the underarm blend patch must be interpreted with matched wireframe views.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--source',path.join(here,'..'))),time=Number(arg('--time','1.88'));
const output=path.resolve(arg('--report',path.join(here,'shoulder-topology-report.json')));
const context={Float32Array,Uint32Array},sourceHashes={};vm.createContext(context);
for(const name of ['core','shell','geometry','animation']){
  const source=fs.readFileSync(path.join(root,'src',name+'.js'),'utf8');sourceHashes[name+'.js']=crypto.createHash('sha256').update(source).digest('hex');vm.runInContext(source,context,{filename:name+'.js'});
}
const C=context.DuderCore,G=context.DuderGeometry,A=context.DuderAnimation;
const recipe=C.sanitizeRecipe({...C.randomRecipe(1702468274),name:'Shoulder Topology Study',facets:Number(arg('--facets','12')),pattern:0,outfit:'none',hat:'beanie',glasses:'none'});
const g=G.build(recipe),parts=C.primitives(recipe),pose=A.sample(recipe,'wave',time);
const baked=C.bake(g,recipe,true,{...pose,projectionStrength:.55}),unprojected=C.bake(g,recipe,true,{...pose,projectionStrength:0});
const sub=(a,b)=>a.map((v,k)=>v-b[k]),length=a=>Math.hypot(...a),distance=(a,b)=>length(sub(a,b));
const dot=(a,b)=>a.reduce((sum,v,k)=>sum+v*b[k],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const average=points=>[0,1,2].map(k=>points.reduce((sum,p)=>sum+p[k],0)/points.length);
const bounds=points=>({min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))});
const inverse=pose.transforms.map(C.rigidInverse),distanceScale=Math.min(1,recipe.depth);
function posedField(p){
  let d=1e9;
  for(let i=0;i<parts.length;i++){
    const q=C.transformPoint(inverse[i],p);q[2]/=recipe.depth;
    let value=C.sdRC(q,parts[i]);if(i>=5)value=Math.max(value,-q[1]);value*=distanceScale;
    const k=Math.max(1e-4,recipe.blend*C.blendScales[i]*distanceScale),h=Math.max(0,Math.min(1,.5+.5*(value-d)/k));d=value+(d-value)*h-k*h*(1-h);
  }
  return d;
}
const nodes=[],byPosition=new Map(),ids=new Int32Array(g.positions.length/3);ids.fill(-1);
for(let i=0;i<ids.length;i++){
  if(g.meta[i*4+1]<0)continue;
  const p=Array.from(g.positions.slice(i*3,i*3+3)),key=p.join(',');
  if(!byPosition.has(key)){
    const weights=Array(7).fill(0);for(let k=0;k<4;k++)weights[g.skinIndices[i*4+k]]+=g.skinWeights[i*4+k];
    const rest=[p[0],p[1],p[2]*recipe.depth],posed=Array.from(baked.positions.slice(i*3,i*3+3)),pureSkin=Array.from(unprojected.positions.slice(i*3,i*3+3));
    const node={id:nodes.length,sourceVertex:i,raw:p,rest,posed,pureSkin,weights,armWeight:weights[1]+weights[2],projectionDisplacement:distance(posed,pureSkin),posedField:posedField(posed)};
    byPosition.set(key,node.id);nodes.push(node);
  }
  ids[i]=byPosition.get(key);
}
const shoulder=parts[1].a,radius=parts[1].ra,elbow=parts[1].b;
// Includes the shoulder collar and below-shoulder bridge into the rib cage.
// The elbow itself is outside the measured window unless a cell crosses it.
const inShoulder=p=>p[0]<0&&distance(p,shoulder)<=radius*4.25&&p[0]>elbow[0]+radius*.15;
const inUnderarm=p=>inShoulder(p)&&p[1]<shoulder[1]-radius*.15;
const edges=new Map(),triangles=[];
for(let i=0;i<ids.length;i+=3){
  const v=Array.from(ids.slice(i,i+3));if(v.some(id=>id<0))continue;
  const vertices=v.map(id=>nodes[id]),center=average(vertices.map(n=>n.raw));
  if(!inShoulder(center))continue;
  const rest=vertices.map(n=>n.rest),posed=vertices.map(n=>n.posed),pureSkin=vertices.map(n=>n.pureSkin);
  const restArea=length(cross(sub(rest[1],rest[0]),sub(rest[2],rest[0])))/2,posedArea=length(cross(sub(posed[1],posed[0]),sub(posed[2],posed[0])))/2;
  const triangleEdges=[];
  for(let k=0;k<3;k++){
    const a=v[k],b=v[(k+1)%3],key=a<b?a+':'+b:b+':'+a;
    if(!edges.has(key)){
      const A=nodes[a],B=nodes[b],bindLength=distance(A.rest,B.rest),posedLength=distance(A.posed,B.posed);
      edges.set(key,{ids:[a,b],bindLength,posedLength,stretch:posedLength/Math.max(1e-12,bindLength),armWeightDifference:Math.abs(A.armWeight-B.armWeight),restMidpointField:C.field(average([A.raw,B.raw]),parts,recipe.blend),posedMidpointField:posedField(average([A.posed,B.posed])),underarm:inUnderarm(average([A.raw,B.raw])),triangles:[]});
    }
    edges.get(key).triangles.push(i/3);triangleEdges.push(edges.get(key));
  }
  const triangle={id:i/3,vertices:v,underarm:inUnderarm(center),restCenter:average(rest),posedCenter:average(posed),restArea,posedArea,areaRatio:posedArea/Math.max(1e-12,restArea),maxEdgeLength:Math.max(...triangleEdges.map(e=>e.posedLength)),maxEdgeStretch:Math.max(...triangleEdges.map(e=>e.stretch)),armWeightRange:[Math.min(...vertices.map(n=>n.armWeight)),Math.max(...vertices.map(n=>n.armWeight))],restCentroidField:C.field(center,parts,recipe.blend),posedCentroidField:posedField(average(posed)),pureSkinCentroidField:posedField(average(pureSkin))};
  triangles.push(triangle);
}
const shoulderEdges=[...edges.values()],underarmEdges=shoulderEdges.filter(e=>e.underarm),underarm=triangles.filter(t=>t.underarm);
const detailEdge=edge=>({...edge,vertices:edge.ids.map(id=>nodes[id])});
const detailTriangle=triangle=>({...triangle,vertexDetails:triangle.vertices.map(id=>nodes[id])});
const bridge=underarm.filter(t=>t.armWeightRange[1]>.05&&t.armWeightRange[0]<.95);
const bridgeNodes=[...new Set(bridge.flatMap(t=>t.vertices))].map(id=>nodes[id]);
const offSurface=underarm.filter(t=>t.posedCentroidField>radius*.25),offSurfaceNodes=[...new Set(offSurface.flatMap(t=>t.vertices))].map(id=>nodes[id]);
const stretched=underarm.filter(t=>t.maxEdgeStretch>1.5),expanded=underarm.filter(t=>t.areaRatio>1.5);
const stats=list=>({count:list.length,maxPosedEdge:Math.max(...list.map(e=>e.posedLength)),maxEdgeStretch:Math.max(...list.map(e=>e.stretch)),edgesAbove1p5Stretch:list.filter(e=>e.stretch>1.5).length,edgesAbove2Stretch:list.filter(e=>e.stretch>2).length});
const report={
  diagnostic:true,scope:'Actual connected body triangles and canonical edges near the left shoulder at bind and held wave. Edge/area expansion and triangle-centroid distance to the posed SDF distinguish coarse interpolation from a broad implicit-surface web. This is not a pass/fail beauty metric.',
  sourceRoot:root,sourceHashes,recipe,time,phase:time/4,shoulder,elbow,upperArmRadius:radius,geometry:g.counts,
  region:{rule:'Left-side triangle centroid within 4.25 arm radii of shoulder and medial to elbow minus 0.15 radius; underarm lies more than 0.15 radius below shoulder.',shoulderTriangles:triangles.length,underarmTriangles:underarm.length,shoulderEdges:stats(shoulderEdges),underarmEdges:stats(underarmEdges)},
  bridge:{triangles:bridge.length,uniqueVertices:bridgeNodes.length,bindBounds:bounds(bridgeNodes.map(n=>n.rest)),posedBounds:bounds(bridgeNodes.map(n=>n.posed)),trianglesWithEdgeStretchAbove1p5:stretched.length,trianglesWithAreaGrowthAbove1p5:expanded.length,maximumAreaRatio:Math.max(...underarm.map(t=>t.areaRatio)),maxPositiveCentroidField:Math.max(...underarm.map(t=>t.posedCentroidField)),minimumCentroidField:Math.min(...underarm.map(t=>t.posedCentroidField))},
  offSurfacePatch:{centroidErrorThreshold:radius*.25,triangles:offSurface.length,uniqueVertices:offSurfaceNodes.length,triangleIds:offSurface.map(t=>t.id),bindBounds:offSurfaceNodes.length?bounds(offSurfaceNodes.map(n=>n.rest)):null,posedBounds:offSurfaceNodes.length?bounds(offSurfaceNodes.map(n=>n.posed)):null},
  longestUnderarmEdges:underarmEdges.sort((a,b)=>b.posedLength-a.posedLength).slice(0,12).map(detailEdge),
  mostStretchedUnderarmEdges:underarmEdges.slice().sort((a,b)=>b.stretch-a.stretch).slice(0,12).map(detailEdge),
  mostExpandedUnderarmTriangles:underarm.slice().sort((a,b)=>b.areaRatio-a.areaRatio).slice(0,12).map(detailTriangle),
  mostOffSurfaceUnderarmTriangles:underarm.slice().sort((a,b)=>b.posedCentroidField-a.posedCentroidField).slice(0,12).map(detailTriangle)
};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:output,time,recipeSeed:recipe.seed,region:report.region,bridge:report.bridge},null,2));
