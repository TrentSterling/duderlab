// Geometric and cache regression checks for the straight A bind pose. A recipe
// slider edit must give the same rig as loading that recipe into a fresh app.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceHashes={},sources={};
for(const name of ['core.js','animation.js']){
  sources[name]=fs.readFileSync(path.join(root,'src',name),'utf8');
  sourceHashes[name]=crypto.createHash('sha256').update(sources[name]).digest('hex');
}
function fresh(){const c=vm.createContext({});for(const [name,source]of Object.entries(sources))vm.runInContext(source,c,{filename:name});return c;}
const context=fresh(),C=context.DuderCore,A=context.DuderAnimation,failures=[];
const check=(ok,message)=>{if(!ok&&!failures.includes(message))failures.push(message);};
const sub=(a,b)=>a.map((v,k)=>v-b[k]),dot=(a,b)=>a.reduce((sum,v,k)=>sum+v*b[k],0);
const norm=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
const metrics={shapeCorners:0,elbows:0,maxRestElbowAngle:0,maxHingeAxisLengthError:0,maxHingePerpendicularError:0,minFootMidlineField:Infinity,cacheComparisons:0,maxWarmColdPoseDifference:0,maxWarmColdPartsDifference:0,maxBlendHipMotion:0,maxWeightCacheDifference:0};
// Cover the complete paired extremes of body, arm, and foot dimensions without
// tying the assertions to the formula used to construct those dimensions.
const keys=['height','width','depth','belly','armLength','armSpread','armThickness','armGap','feet','blend'];
for(let mask=0;mask<1<<keys.length;mask++){
  const recipe=C.sanitizeRecipe({...C.baseDefaults(),...Object.fromEntries(keys.map((key,i)=>[key,C.ranges[key][(mask>>i)&1]]))});
  const raw=C.primitives(recipe),rig=C.rigDefinition(recipe);metrics.shapeCorners++;
  for(const [upper,lower]of [[1,2],[3,4]]){
    const a=norm(sub(rig.parts[upper].b,rig.parts[upper].a)),b=norm(sub(rig.parts[lower].b,rig.parts[lower].a)),j=rig.joints.find(j=>j.child===lower);
    const angle=Math.acos(Math.max(-1,Math.min(1,dot(a,b))));
    const lengthError=Math.abs(Math.hypot(...j.axis)-1),perpendicular=Math.max(Math.abs(dot(j.axis,a)),Math.abs(dot(j.axis,b)));
    metrics.elbows++;metrics.maxRestElbowAngle=Math.max(metrics.maxRestElbowAngle,angle);metrics.maxHingeAxisLengthError=Math.max(metrics.maxHingeAxisLengthError,lengthError);metrics.maxHingePerpendicularError=Math.max(metrics.maxHingePerpendicularError,perpendicular);
    check(angle<1e-6,'A bind pose contains a pre-bent elbow');
    check(lengthError<1e-10&&perpendicular<1e-10,'Straight elbow has an invalid hinge frame');
    check(Math.hypot(...sub(rig.parts[upper].b,rig.parts[lower].a))<1e-10,'A bind elbow endpoints do not meet');
  }
  const mid=[0,raw[5].b[1],raw[5].b[2]],gap=C.field(mid,raw,recipe.blend);
  metrics.minFootMidlineField=Math.min(metrics.minFootMidlineField,gap);
  check(gap>0,'Lower feet merge across the center line');
  // Reusing the immutable primitive set may cache data, but must not change
  // results versus rebuilding the same recipe's primitive set.
  const point=raw[2].a.map((v,k)=>v+(.04*(k-1))),first=C.skinWeightsForPoint(point,raw,recipe.blend),cached=C.skinWeightsForPoint(point,raw,recipe.blend),uncached=C.skinWeightsForPoint(point,C.primitives(recipe),recipe.blend);
  for(const result of [cached,uncached])for(let i=0;i<4;i++){
    const difference=Math.abs(first.weights[i]-result.weights[i]);metrics.maxWeightCacheDifference=Math.max(metrics.maxWeightCacheDifference,difference);
    check(first.indices[i]===result.indices[i]&&difference<1e-12,'Cached elbow weights differ from fresh primitive weights');
  }
}
// Blend participates in the foot clearance and therefore the rig itself. Test
// both slider directions with an already populated animation cache.
for(const width of [.75,1.3])for(const feet of [.7,1.3])for(const blends of [[.03,.22],[.22,.03]]){
  const recipes=blends.map(blend=>C.sanitizeRecipe({...C.baseDefaults(),width,feet,blend}));
  for(const clip of A.clips)A.sample(recipes[0],clip.id,clip.duration*.37);
  const cold=fresh(),expectedRig=C.rigDefinition(recipes[1]),oldRig=C.rigDefinition(recipes[0]);
  metrics.maxBlendHipMotion=Math.max(metrics.maxBlendHipMotion,Math.abs(expectedRig.parts[5].a[0]-oldRig.parts[5].a[0]));
  for(const clip of A.clips)for(const phase of [0,.37,.8]){
    const warm=A.sample(recipes[1],clip.id,clip.duration*phase),expected=cold.DuderAnimation.sample(recipes[1],clip.id,clip.duration*phase);
    metrics.cacheComparisons++;
    for(let i=0;i<7;i++){
      for(let k=0;k<16;k++)metrics.maxWarmColdPoseDifference=Math.max(metrics.maxWarmColdPoseDifference,Math.abs(warm.transforms[i][k]-expected.transforms[i][k]));
      for(const end of ['a','b'])for(let k=0;k<3;k++)metrics.maxWarmColdPartsDifference=Math.max(metrics.maxWarmColdPartsDifference,Math.abs(warm.parts[i][end][k]-expected.parts[i][end][k]));
    }
  }
}
check(metrics.maxWarmColdPoseDifference<1e-7&&metrics.maxWarmColdPartsDifference<1e-7,'Changing blend reuses a stale animation rig');
// At least one recipe actually moves its hips, otherwise the cache exercise
// could pass without traversing the geometric dependency it must protect.
const narrowA=C.rigDefinition(C.sanitizeRecipe({...C.baseDefaults(),width:.75,feet:1.3,blend:.03}));
const narrowB=C.rigDefinition(C.sanitizeRecipe({...C.baseDefaults(),width:.75,feet:1.3,blend:.22}));
check(Math.abs(narrowA.parts[5].a[0]-narrowB.parts[5].a[0])>.01,'Blend cache fixture does not change the hip position');
const report={passed:failures.length===0,scope:'Straight bind elbow geometry, physical hinge frames, foot field separation, immutable weight caching, and cold-versus-warm animation rig parity after blend edits.',sourceHashes,failures,metrics};
fs.writeFileSync(path.join(root,'qa/bind-pose-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(failures.length)process.exitCode=1;
