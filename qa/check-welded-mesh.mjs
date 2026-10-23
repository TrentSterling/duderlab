import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..');
const context={console,TextEncoder};context.window=context;context.globalThis=context;vm.createContext(context);
for(const name of ['core.js','shell.js','geometry.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',name),'utf8'),context,{filename:name});
const C=context.DuderCore,G=context.DuderGeometry,base=C.baseDefaults();
const attributes=[['positions',3],['normals',3],['colors',3],['meta',4],['skinIndices',4],['skinWeights',4],['outline',4]];
let cases=0,expandedVertices=0,indexedVertices=0,sharedSmoothVertices=0,maxNormalDelta=0,closedGearChecks=0;
const examples=[];

function closedGear(g,label){
  // Geometric topology ignores material splits; coincident positions are one
  // vertex even where the GPU must retain different color/roughness records.
  const vertices=new Map(),edges=new Map();
  for(let i=0;i<g.positions.length/3;i+=3){
    if(g.meta[i*4+1]>=0)continue;
    const ids=[];
    for(let j=0;j<3;j++){
      const key=Array.from(g.positions.subarray((i+j)*3,(i+j)*3+3)).join(',');
      if(!vertices.has(key))vertices.set(key,vertices.size);ids.push(vertices.get(key));
    }
    assert.equal(new Set(ids).size,3,`${label}: no collapsed accessory triangle`);
    for(let j=0;j<3;j++){
      const a=ids[j],b=ids[(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`,edge=edges.get(key)||{count:0,winding:0};
      edge.count++;edge.winding+=a<b?1:-1;edges.set(key,edge);
    }
  }
  for(const edge of edges.values()){
    assert.equal(edge.count,2,`${label}: closed accessory boundary`);
    assert.equal(edge.winding,0,`${label}: consistent accessory winding`);
  }
  closedGearChecks++;
}

function check(recipe,label){
  const g=G.build(recipe,0),ix=g.indexed,seen=new Map(),records=new Set(),count=g.positions.length/3;
  assert(ix&&Object.prototype.toString.call(ix.indices)==='[object Uint32Array]');
  assert.equal(ix.indices.length,count);assert.equal(ix.indices.length,g.counts.triangles*3);
  assert.equal(ix.counts.vertices,ix.positions.length/3);assert.equal(ix.counts.indices,count);
  assert(ix.counts.vertices<count*.65,`${label}: substantial index reuse`);
  for(const [name,size]of attributes)assert.equal(ix[name].length,ix.counts.vertices*size);
  for(let i=0;i<count;i++){
    const index=ix.indices[i];assert(index>=0&&index<ix.counts.vertices);
    for(const [name,size]of attributes)for(let j=0;j<size;j++){
      const value=ix[name][index*size+j];assert(Number.isFinite(value),`${label}: finite ${name}`);
      assert.equal(value,g[name][i*size+j],`${label}: exact indexed ${name} reconstruction`);
    }
    const n=Array.from(g.normals.subarray(i*3,i*3+3)),o=Array.from(g.outline.subarray(i*4,i*4+3));
    assert(Math.abs(Math.hypot(...n)-1)<2e-6,`${label}: unit shading normal`);
    assert(Math.abs(Math.hypot(...o)-1)<2e-6,`${label}: unit outline normal`);
    assert.deepEqual(n,o,`${label}: same smooth shading and hull direction`);
    const kind=g.meta[i*4+2],key=kind+':'+Array.from(g.positions.subarray(i*3,i*3+3)).join(',');
    if(seen.has(key)){
      const delta=Math.hypot(...n.map((v,j)=>v-seen.get(key)[j]));
      maxNormalDelta=Math.max(maxNormalDelta,delta);assert.equal(delta,0,`${label}: smooth position seam`);sharedSmoothVertices++;
    }else seen.set(key,n);
    if(kind===2||kind===3)assert.equal(g.outline[i*4+3],0,`${label}: eyes/lenses retain suppressed hulls`);
    const weights=Array.from(g.skinWeights.subarray(i*4,i*4+4));
    assert(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<2e-6,`${label}: normalized skin weights`);
  }
  for(let i=0;i<ix.counts.vertices;i++){
    const key=attributes.map(([name,size])=>Array.from(ix[name].subarray(i*size,(i+1)*size)).join(',')).join(';');
    assert(!records.has(key),`${label}: no duplicate complete indexed record`);records.add(key);
  }
  closedGear(g,label);cases++;expandedVertices+=count;indexedVertices+=ix.counts.vertices;
  if(recipe.facets===12&&recipe.glasses==='square')examples.push({hat:recipe.hat,expandedVertices:count,indexedVertices:ix.counts.vertices,triangles:g.counts.triangles,uniquePositions:g.counts.uniquePositions});
  return g;
}

for(const facets of [8,12,16])for(const hat of G.hatNames)for(const glasses of G.glassesNames)
  check({...base,facets,hat,glasses},`${facets}/${hat}/${glasses}`);
for(const side of ['low','high'])for(const hat of G.hatNames){
  const r={...base,hat,glasses:'aviator'};
  for(const [key,range]of Object.entries(C.ranges))r[key]=range[side==='low'?0:1];
  check(C.sanitizeRecipe(r),`${side} dimensions/${hat}`);
}

const exports=[];
for(const [pattern,hat,glasses,depth,posed]of [[0,'cap','square',.88,false],[3,'bucket','round',1.24,false],[7,'beanie','catEye',.62,false],[6,'sunhat','aviator',.88,true]]){
  const r={...base,pattern,hat,glasses,depth},g=G.build(r),a=.27,c=Math.cos(a),s=Math.sin(a);
  const matrix=[c,0,-s,0,0,1,0,0,s,0,c,0,.4,.2,-.3,1];
  const pose=posed?{transforms:Array.from({length:7},()=>matrix.slice()),projectionStrength:.55}:null;
  const baked=C.bake(g,r,true,pose),buffer=C.glb(baked,r),view=new DataView(buffer);
  assert.equal(view.getUint32(0,true),0x46546c67);assert.equal(view.getUint32(4,true),2);assert.equal(view.getUint32(8,true),buffer.byteLength);
  const jsonLength=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,jsonLength))),binaryStart=20+jsonLength+8;
  assert.equal(json.meshes.length,1);assert.equal(json.materials.length,1);assert.equal(json.meshes[0].primitives.length,1);
  const primitive=json.meshes[0].primitives[0],accessor=json.accessors[primitive.indices];
  assert.equal(accessor.componentType,5125);assert.equal(accessor.count,baked.positions.length/3);
  assert.equal(json.bufferViews[accessor.bufferView].target,34963);
  const getData=(a,Type,size)=>{const b=json.bufferViews[a.bufferView];return new Type(buffer,binaryStart+(b.byteOffset||0)+(a.byteOffset||0),a.count*size);};
  const indices=getData(accessor,Uint32Array,1),p=getData(json.accessors[primitive.attributes.POSITION],Float32Array,3),n=getData(json.accessors[primitive.attributes.NORMAL],Float32Array,3),color=getData(json.accessors[primitive.attributes.COLOR_0],Float32Array,3);
  assert(p.length<baked.positions.length*.65);
  for(let i=0;i<indices.length;i++)for(let j=0;j<3;j++){
    const source=i*3+j,dest=indices[i]*3+j;
    assert.equal(p[dest],baked.positions[source]);assert.equal(n[dest],baked.normals[source]);
    const value=Math.max(0,Math.min(1,baked.colors[source])),linear=value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4);
    assert(Math.abs(color[dest]-linear)<5e-8,'GLB retains baked procedural color sampling');
  }
  assert.equal(JSON.stringify(json.extras.recipe),JSON.stringify(C.sanitizeRecipe(r)));
  exports.push({pattern,hat,glasses,posed,triangles:baked.triangles,expandedVertices:indices.length,indexedVertices:p.length/3,bytes:buffer.byteLength});
}

// Optional faceted viewing/export remains coherent: rigid gear gets face
// normals, while eyes and glass lenses retain their smooth optical surfaces.
const flatRecipe={...base,hat:'cap',glasses:'square',pattern:0},flatSource=G.build(flatRecipe);
const flat=C.bake(flatSource,flatRecipe,false),smooth=C.bake(flatSource,flatRecipe);
let flatGearTrianglesChecked=0,smoothEyeLensVerticesChecked=0,changedGearNormals=0;
for(let i=0;i<flatSource.positions.length/3;i+=3){
  const kind=flatSource.meta[i*4+2];
  if(kind===1){
    const points=[0,1,2].map(j=>Array.from(flat.positions.subarray((i+j)*3,(i+j)*3+3)));
    const a=points[1].map((v,j)=>v-points[0][j]),b=points[2].map((v,j)=>v-points[0][j]);
    const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...cross),normal=cross.map(v=>v/length);
    for(let j=0;j<3;j++)for(let k=0;k<3;k++){
      assert(Math.abs(flat.normals[(i+j)*3+k]-normal[k])<2e-6,'Faceted gear export uses triangle normals');
      if(Math.abs(flat.normals[(i+j)*3+k]-smooth.normals[(i+j)*3+k])>.01)changedGearNormals++;
    }
    flatGearTrianglesChecked++;
  }else if(kind===2||kind===3){
    for(let j=0;j<9;j++)assert.equal(flat.normals[i*3+j],smooth.normals[i*3+j]);
    smoothEyeLensVerticesChecked+=3;
  }
}
assert(changedGearNormals>0);assert(flatGearTrianglesChecked>0);assert(smoothEyeLensVerticesChecked>0);
const report={passed:true,cases,closedGearChecks,expandedVertices,indexedVertices,vertexReduction:1-indexedVertices/expandedVertices,sharedSmoothVertices,maxNormalDelta,examples,exports,flatGearTrianglesChecked,smoothEyeLensVerticesChecked};
fs.writeFileSync(path.join(here,'welded-mesh-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
