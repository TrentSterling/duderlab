/** Regression checks for the detached beanie-hem stroke.
 * Geometry checks complement GLES image review: one beanie component,
 * anchored contact loops, fractional cuff creases, expanding exteriors,
 * and continuous corner data across material seams.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..');
const context={console};context.window=context;context.globalThis=context;vm.createContext(context);
const sourceHashes={};
for(const name of ['core.js','shell.js','geometry.js']){
  const source=fs.readFileSync(path.join(root,'src',name),'utf8');
  sourceHashes[name]=crypto.createHash('sha256').update(source).digest('hex');
  vm.runInContext(source,context,{filename:name});
}
const C=context.DuderCore,G=context.DuderGeometry,base=C.baseDefaults(),results=[];
const specs={
  cap:{rough:.74,innerRings:4,outerRings:4,anchors:[
    [Math.sqrt(.405*.405-.23*.23),0,0],[0,.175,0],
    [Math.sqrt(.435*.435-.23*.23),0,1],[0,.205,1]]},
  bucket:{rough:.82,innerRings:3,outerRings:4,anchors:[
    [.340,0,0],[.365,.025,0],[0,.267,0],[.605,-.045,1],[0,.300,1]]},
  beanie:{rough:.94,innerRings:5,outerRings:7,creaseRings:1,creaseWeight:.75,anchors:[
    [.377,0,0],[.377,.109,0],[0,.400,0],[.424,0,.75],[.443,.078,1],[0,.439,1]]},
  bowler:{rough:.64,innerRings:5,outerRings:7,anchors:[
    [.340,0,0],[.375,.023,0],[0,.314,0],[.577,.021,1],[0,.346,1]]},
  sunhat:{rough:.88,innerRings:4,outerRings:6,anchors:[
    [.340,0,0],[.377,.025,0],[0,.244,0],[.777,-.033,1],[0,.278,1]]}
};

function hatConnectivity(g,hat){
  const positions=new Map(),faces=[],edges=new Map();
  for(let i=0;i<g.positions.length/3;i+=3){
    if(g.meta[i*4+2]!==1)continue;
    const face=[];
    for(let j=0;j<3;j++){
      const key=Array.from(g.positions.subarray((i+j)*3,(i+j)*3+3)).join(',');
      if(!positions.has(key))positions.set(key,positions.size);face.push(positions.get(key));
    }
    assert.equal(new Set(face).size,3,hat+': no collapsed triangle');
    const id=faces.length;faces.push(face);
    for(let j=0;j<3;j++){
      const a=face[j],b=face[(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;
      if(!edges.has(key))edges.set(key,{faces:[],winding:0});
      const edge=edges.get(key);edge.faces.push(id);edge.winding+=a<b?1:-1;
    }
  }
  const neighbors=faces.map(()=>[]);
  for(const edge of edges.values()){
    assert.equal(edge.faces.length,2,hat+': surface is closed across tint/material boundaries');
    assert.equal(edge.winding,0,hat+': edge winding is consistent');
    const [a,b]=edge.faces;neighbors[a].push(b);neighbors[b].push(a);
  }
  let components=0;const remaining=new Set(faces.map((_,i)=>i));
  while(remaining.size){
    components++;const seed=remaining.values().next().value,stack=[seed];remaining.delete(seed);
    while(stack.length)for(const next of neighbors[stack.pop()])if(remaining.delete(next))stack.push(next);
  }
  if(hat==='beanie')assert.equal(components,1,'Beanie crown and rolled cuff must be one connected surface');
  return {components,triangles:faces.length,uniquePositions:positions.size};
}

function check(input,label){
  const recipe=C.sanitizeRecipe({...input,glasses:'none'}),spec=specs[recipe.hat],g=G.build(recipe),ix=g.indexed;
  const metric=G.metrics(recipe),origin=metric.top-(recipe.hat==='beanie'?.245:.17)*recipe.width;
  const positions=new Map(),main=new Map(),visor=new Map();let materialSeams=0,creaseMaterialSeams=0,auxiliaryVertices=0;
  for(let i=0;i<ix.positions.length/3;i++){
    if(ix.meta[i*4+2]!==1)continue;
    const p=Array.from(ix.positions.subarray(i*3,i*3+3)),key=p.join(',');
    const n=Array.from(ix.normals.subarray(i*3,i*3+3)),o=Array.from(ix.outline.subarray(i*4,i*4+4));
    assert(n.every(Number.isFinite)&&o.every(Number.isFinite),label+': finite smooth data');
    assert(Math.abs(Math.hypot(...n)-1)<2e-6,label+': unit lighting normal');
    assert(Math.abs(Math.hypot(...o.slice(0,3))-1)<2e-6,label+': unit outline normal');
    assert.equal(JSON.stringify(n),JSON.stringify(o.slice(0,3)),label+': smooth lighting/hull directions agree');
    assert(o[3]===0||o[3]===1||o[3]===spec.creaseWeight,label+': authored contact/crease/exterior weights');
    const previous=positions.get(key);
    if(previous){
      assert.equal(JSON.stringify(previous.n),JSON.stringify(n),label+': exact normal continuity at material seam');
      assert.equal(JSON.stringify(previous.o),JSON.stringify(o),label+': exact extrusion continuity at material seam');
      materialSeams++;
      if(o[3]===spec.creaseWeight)creaseMaterialSeams++;
    }else positions.set(key,{p,n,o});
    if(ix.meta[i*4+3]===Math.fround(spec.rough))main.set(key,{p,n,o});
    else{
      auxiliaryVertices++;
      if(recipe.hat==='cap'&&(p[1]-origin)/recipe.width<.01){
        const contact=Math.abs(Math.hypot(p[0],p[2]/recipe.depth)/recipe.width-.350)<2e-6;
        assert.equal(o[3],contact?0:1,label+': visor contact arc/endpoints stay fixed; outer edge expands');
        visor.set(key,{p,n,o});
      }else assert.equal(o[3],recipe.hat==='cap'?1:0,label+': cap button expands; decorative trim stays suppressed');
    }
  }
  const anchored=[...main.values()].filter(v=>v.o[3]===0).length,exterior=[...main.values()].filter(v=>v.o[3]===1).length,crease=[...main.values()].filter(v=>v.o[3]===spec.creaseWeight).length;
  assert.equal(anchored,spec.innerRings*recipe.facets+1,label+': complete interior/contact rings are fixed');
  assert.equal(exterior,spec.outerRings*recipe.facets+1,label+': exterior rings and crown expand');
  assert.equal(crease,(spec.creaseRings||0)*recipe.facets,label+': one complete fractional cuff crease ring');
  assert.equal(creaseMaterialSeams,crease,label+': fractional crease stays continuous across the cuff tint boundary');
  for(const [radius,height,weight]of spec.anchors){
    const matches=[...main.values()].filter(({p})=>Math.abs(Math.hypot(p[0],p[2]/recipe.depth)/recipe.width-radius)<2e-6&&Math.abs((p[1]-origin)/recipe.width-height)<2e-6);
    assert.equal(matches.length,radius===0?1:recipe.facets,label+': circular feature landmark exists');
    for(const v of matches)assert.equal(v.o[3],weight,label+': correct contact/exterior landmark weight');
  }
  let transitionFaces=0,oneMovingCorner=0,twoMovingCorners=0,creaseTransitionFaces=0,oneFullCorner=0,twoFullCorners=0,visorTransitionFaces=0;
  for(let i=0;i<ix.indices.length;i+=3){
    const indices=Array.from(ix.indices.subarray(i,i+3));
    if(ix.meta[indices[0]*4+2]!==1)continue;
    const weights=indices.map(v=>ix.outline[v*4+3]),low=Math.min(...weights),high=Math.max(...weights);
    if(ix.meta[indices[0]*4+3]!==Math.fround(spec.rough)){
      if(recipe.hat==='cap'&&low===0&&high===1)visorTransitionFaces++;
      continue;
    }
    if(low===0&&high>0){
      assert.equal(high,spec.creaseWeight||1,label+': underside expands to the authored outer-crease weight');
      transitionFaces++;const moving=weights.filter(w=>w>0).length;
      if(moving===1)oneMovingCorner++;else if(moving===2)twoMovingCorners++;
    }else if(low>0&&low<high){
      assert.equal(low,spec.creaseWeight,label+': outer cuff transition begins at the fractional crease');
      assert.equal(high,1,label+': outer cuff transition reaches full shell width');
      creaseTransitionFaces++;const full=weights.filter(w=>w===1).length;
      if(full===1)oneFullCorner++;else if(full===2)twoFullCorners++;
    }
  }
  assert.equal(oneMovingCorner,recipe.facets,label+': each underside sector has an anchored-to-moving triangle');
  assert.equal(twoMovingCorners,recipe.facets,label+': quad split retains the other moving-edge triangle');
  assert.equal(oneFullCorner,(spec.creaseRings||0)*recipe.facets,label+': cuff sectors interpolate fractional to full width');
  assert.equal(twoFullCorners,(spec.creaseRings||0)*recipe.facets,label+': cuff quad split retains both width transitions');
  if(recipe.hat==='cap'){
    assert.equal([...visor.values()].filter(v=>v.o[3]===0).length,22,label+': both complete visor contact arcs are anchored');
    assert.equal([...visor.values()].filter(v=>v.o[3]===1).length,18,label+': visor exterior excludes the two shared endpoints');
    assert.equal(visorTransitionFaces,40,label+': top/underside and end sectors bridge contact to exterior');
  }
  const topology=recipe.hat==='beanie'||recipe.hat==='cap'?hatConnectivity(g,recipe.hat):null;
  if(recipe.hat==='beanie'){assert.equal(auxiliaryVertices,0,'Beanie has no detached decorative cuff');assert(materialSeams>0,'Beanie cuff tint remains across welded seams');}
  results.push({label,hat:recipe.hat,facets:recipe.facets,depth:recipe.depth,anchoredVertices:anchored,exteriorVertices:exterior,creaseVertices:crease,transitionFaces,creaseTransitionFaces,visorTransitionFaces,materialSeamRecords:materialSeams,creaseMaterialSeams,auxiliaryVertices,...(topology?{topology}:{})});
}

for(const hat of Object.keys(specs))for(const facets of [8,12,16])for(const depth of [.62,1,1.24])check({...base,hat,facets,depth},`${hat}/${facets}/${depth}`);
check(C.randomRecipe(1702468274),'User screenshot seed1702468274');
const report={passed:true,cases:results.length,beanieConnectedCases:results.filter(r=>r.hat==='beanie').length,capClosedCases:results.filter(r=>r.hat==='cap').length,transitionFaces:results.reduce((s,r)=>s+r.transitionFaces,0),creaseTransitionFaces:results.reduce((s,r)=>s+r.creaseTransitionFaces,0),visorTransitionFaces:results.reduce((s,r)=>s+r.visorTransitionFaces,0),sourceHashes,results};
fs.writeFileSync(path.join(here,'hat-contact-outline-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,cases:report.cases,beanieConnectedCases:report.beanieConnectedCases,capClosedCases:report.capClosedCases,transitionFaces:report.transitionFaces,creaseTransitionFaces:report.creaseTransitionFaces,visorTransitionFaces:report.visorTransitionFaces,report:path.join(here,'hat-contact-outline-report.json')}));
