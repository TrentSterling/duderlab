/** Focused regression for arms borrowing the belly during a wave.
 * Regions come from the bind geometry, not the production weight envelope.
 * Compare against the same pose with arm bones locked to the torso, so authored
 * torso lean, grounding, and leg animation cannot masquerade as arm drag.
 * This numeric study complements fixed-camera surface and weight renders.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--source',path.join(here,'..')));
const baseline=arg('--baseline',null),baselineReport=arg('--baseline-report',null),output=path.resolve(arg('--report',path.join(here,'arm-influence-report.json')));
const recordOnly=process.argv.includes('--record-only');
const distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);

// Independent Rodrigues construction, rather than reusing clip helpers.
function rotation(axis,angle,pivot){
  const length=Math.hypot(...axis),[x,y,z]=axis.map(v=>v/length),c=Math.cos(angle),s=Math.sin(angle),t=1-c;
  const m=new Float32Array([t*x*x+c,t*x*y+s*z,t*x*z-s*y,0,t*x*y-s*z,t*y*y+c,t*y*z+s*x,0,t*x*z+s*y,t*y*z-s*x,t*z*z+c,0,0,0,0,1]);
  for(let k=0;k<3;k++)m[12+k]=pivot[k]-m[k]*pivot[0]-m[4+k]*pivot[1]-m[8+k]*pivot[2];
  return m;
}
function load(sourceRoot){
  const sourceHashes={},context={Float32Array,Uint32Array};vm.createContext(context);
  for(const name of ['core','shell','geometry','animation']){
    const source=fs.readFileSync(path.join(sourceRoot,'src',name+'.js'),'utf8');
    sourceHashes[name+'.js']=crypto.createHash('sha256').update(source).digest('hex');vm.runInContext(source,context,{filename:name+'.js'});
  }
  return{C:context.DuderCore,G:context.DuderGeometry,A:context.DuderAnimation,sourceHashes};
}
function boneWeights(skin){
  const values=Array(7).fill(0);for(let k=0;k<4;k++)values[skin.indices[k]]+=skin.weights[k];return values;
}
function metric(){return{samples:0,max:0,sumSquares:0,worst:null};}
function observe(m,value,detail){m.samples++;m.sumSquares+=value*value;if(value>m.max){m.max=value;m.worst=detail;}}
function finish(m){return{samples:m.samples,max:m.max,rms:m.samples?Math.sqrt(m.sumSquares/m.samples):0,worst:m.worst};}

const recipeSpecs=[
  ['default',{}],
  ['reported-wave',{seed:1702468274}],
  ['thin-short-high-blend',{height:1.3,width:.75,armLength:.7,armThickness:.65,armGap:0,blend:.22}],
  ['thin-long-high-blend',{height:1.3,width:.75,armLength:1.4,armThickness:.65,blend:.22}],
  ['wide-short-thick',{height:.75,width:1.3,belly:1.2,armLength:.7,armThickness:1.35,armGap:0,armSpread:-.15,blend:.22}],
  ['deep-body',{depth:1.24,armLength:.7,armGap:0,blend:.22}],
  ['flat-body',{depth:.62,armThickness:1.35,armGap:0,blend:.22}],
  ['minimum-blend',{width:.75,armThickness:.65,armLength:.7,armSpread:-.15,armGap:0,blend:.03}]
];
const phases=[0,.20,.29,.375,.485,.595,.705,.80,.94];

function study(sourceRoot){
  const{C,G,A,sourceHashes}=load(sourceRoot),cases=[],failures=[];
  const check=(condition,message)=>{if(!condition&&!failures.includes(message))failures.push(message);};
  for(const [name,overrides]of recipeSpecs){
    const raw=overrides.seed?C.randomRecipe(overrides.seed):C.baseDefaults();
    const recipe=C.sanitizeRecipe({...raw,...overrides,pattern:0,outfit:'none',hat:'none',glasses:'none'});
    const g=G.build(recipe),parts=C.primitives(recipe),rig=C.rigDefinition(recipe);
    const unique=new Map(),probes=[],protectedTorso=[],nearUnderarm=[];
    let maxNormalizationError=0,maxSeamWeightDifference=0,maxProtectedArmWeight=0,maxProtectedForearmWeight=0;
    for(let i=0;i<g.positions.length/3;i++){
      if(g.meta[i*4+1]<0)continue;
      const p=Array.from(g.positions.slice(i*3,i*3+3));
      const skin={indices:Array.from(g.skinIndices.slice(i*4,i*4+4)),weights:Array.from(g.skinWeights.slice(i*4,i*4+4))},w=boneWeights(skin);
      maxNormalizationError=Math.max(maxNormalizationError,Math.abs(skin.weights.reduce((a,b)=>a+b,0)-1));
      check(skin.indices.every(id=>Number.isInteger(id)&&id>=0&&id<7)&&skin.weights.every(weight=>Number.isFinite(weight)&&weight>=0),name+': invalid skin weights');
      check(skin.weights[0]>=Math.max(...skin.weights)-1e-7,name+': dual-quaternion reference is not the dominant bone');
      const key=p.join(',');
      if(unique.has(key)){
        const previous=unique.get(key);for(let k=0;k<7;k++)maxSeamWeightDifference=Math.max(maxSeamWeightDifference,Math.abs(w[k]-previous[k]));
        continue;
      }
      unique.set(key,w);
      const distances=parts.map(part=>C.sdRC(p,part));
      const shoulderRadii=Math.min(distance(p,parts[1].a)/parts[1].ra,distance(p,parts[3].a)/parts[3].ra);
      const nearest=distances.indexOf(Math.min(...distances));
      const probe={index:i,p,physical:[p[0],p[1],p[2]*recipe.depth],skin,w,shoulderRadii,torsoDistance:distances[0]};
      probes.push(probe);
      // The protected area lies on the torso capsule, outside the shoulder
      // patch. A wider near-underarm band is diagnostic: that tissue may move.
      if(nearest===0&&Math.abs(distances[0])<=.008*recipe.width&&shoulderRadii>=2.75){
        protectedTorso.push(probe);maxProtectedArmWeight=Math.max(maxProtectedArmWeight,w[1]+w[2]+w[3]+w[4]);maxProtectedForearmWeight=Math.max(maxProtectedForearmWeight,w[2]+w[4]);
      }
      if(nearest===0&&distances[0]<=.02*recipe.width&&shoulderRadii>=1.5&&shoulderRadii<2.75)nearUnderarm.push(probe);
    }
    check(protectedTorso.length>=20,name+': empty protected torso fixture');
    check(maxNormalizationError<2e-6,name+': weights do not sum to one');
    check(maxSeamWeightDifference<1e-7,name+': coincident mesh vertices disagree on weights');
    check(maxProtectedArmWeight<=.05,name+': protected torso has more than 5% arm influence');
    check(maxProtectedForearmWeight<=.01,name+': protected torso has more than 1% forearm influence');

    let maxInfinitesimalWeightStep=0,continuitySamples=0,worstContinuity=null;
    const epsilon=1e-5*recipe.width;
    for(const probe of probes){
      if(probe.shoulderRadii>4||probe.p[1]<parts[0].a[1])continue;
      for(let axis=0;axis<3;axis++){
        const p=probe.p.slice(),q=probe.p.slice();p[axis]-=epsilon;q[axis]+=epsilon;
        const a=boneWeights(C.skinWeightsForPoint(p,parts,recipe.blend)),b=boneWeights(C.skinWeightsForPoint(q,parts,recipe.blend));
        const step=Math.max(...a.map((v,k)=>Math.abs(v-b[k])));continuitySamples++;
        if(step>maxInfinitesimalWeightStep){maxInfinitesimalWeightStep=step;worstContinuity={point:probe.p,axis,before:a,after:b};}
      }
    }
    check(maxInfinitesimalWeightStep<.002,name+': arm envelope has a discontinuity at a small bind-space perturbation');
    const poses=[];
    for(const [side,upper,lower,sign]of [['left',1,2,-1],['right',3,4,1]]){
      for(const [label,axis,angle]of [['raise',[0,0,1],sign*.99],['reach',[1,0,0],-.8]]){
        const transforms=Array.from({length:7},identity);transforms[upper]=rotation(axis,angle,rig.parts[upper].a);transforms[lower]=transforms[upper];poses.push({name:side+'-'+label,transforms,forearmOnly:false});
      }
      const hinge=rig.joints.find(j=>j.child===lower);
      for(const angle of [1.36,2.05]){
        const transforms=Array.from({length:7},identity);transforms[lower]=rotation(hinge.axis,angle,hinge.point);poses.push({name:side+'-elbow-'+angle,transforms,forearmOnly:true});
      }
    }
    for(const phase of phases)poses.push({name:'wave-'+phase,transforms:A.sample(recipe,'wave',phase*4).transforms,forearmOnly:false});
    const pure=metric(),elbow=metric(),underarm=metric(),poseMetrics=[];
    for(const pose of poses){
      const palette=pose.transforms.map(C.dualQuaternion),locked=pose.transforms.map((m,i)=>i>=1&&i<=4?pose.transforms[0]:m).map(C.dualQuaternion);
      const current=metric();
      for(const probe of protectedTorso){
        const p=C.skinDualQuaternion(probe.physical,[0,1,0],probe.skin,palette).p;
        const q=C.skinDualQuaternion(probe.physical,[0,1,0],probe.skin,locked).p;
        const drift=distance(p,q),detail={pose:pose.name,point:probe.p,weights:probe.w,shoulderRadii:probe.shoulderRadii};
        observe(pure,drift,detail);observe(current,drift,detail);if(pose.forearmOnly)observe(elbow,drift,detail);
      }
      for(const probe of nearUnderarm){
        const p=C.skinDualQuaternion(probe.physical,[0,1,0],probe.skin,palette).p,q=C.skinDualQuaternion(probe.physical,[0,1,0],probe.skin,locked).p;
        observe(underarm,distance(p,q),{pose:pose.name,point:probe.p,weights:probe.w,shoulderRadii:probe.shoulderRadii});
      }
      poseMetrics.push({pose:pose.name,...finish(current)});
    }
    check(pure.max<=.02*recipe.width,name+': arm motion displaces protected torso by more than 2% of body width');
    check(elbow.max<=.005*recipe.width,name+': isolated elbow pulls protected torso by more than 0.5% of body width');

    // Run the actual CPU export path with projection on/off. A matching control
    // locks just the arm transforms; body lean and all other bone poses remain.
    const projected=metric(),projectionContribution=metric();
    const held=A.sample(recipe,'wave',.8*4),lockedTransforms=held.transforms.map((m,i)=>i>=1&&i<=4?held.transforms[0]:m);
    const bakes=[0,.55].map(projectionStrength=>({
      projectionStrength,
      current:C.bake(g,recipe,true,{...held,projectionStrength}),
      locked:C.bake(g,recipe,true,{...held,transforms:lockedTransforms,projectionStrength})
    }));
    for(const probe of protectedTorso){
      const differences=bakes.map(bake=>{
        const p=Array.from(bake.current.positions.slice(probe.index*3,probe.index*3+3)),q=Array.from(bake.locked.positions.slice(probe.index*3,probe.index*3+3));return sub(p,q);
      });
      observe(projected,Math.hypot(...differences[1]),{point:probe.p,weights:probe.w});
      observe(projectionContribution,distance(differences[0],differences[1]),{point:probe.p,weights:probe.w});
    }
    check(projected.max<=.025*recipe.width,name+': default surface correction pulls protected torso by more than 2.5% of body width');
    const entry={name,recipe,uniqueBodyVertices:probes.length,protectedTorsoVertices:protectedTorso.length,nearUnderarmVertices:nearUnderarm.length,maxNormalizationError,maxSeamWeightDifference,maxProtectedArmWeight,maxProtectedForearmWeight,continuitySamples,maxInfinitesimalWeightStep,worstContinuity,pureSkinning:finish(pure),forearmOnly:finish(elbow),nearUnderarmDiagnostic:finish(underarm),defaultProjection:finish(projected),projectionContribution:finish(projectionContribution),poses:poseMetrics};
    cases.push(entry);
    console.log(JSON.stringify({source:sourceRoot,name,protected:protectedTorso.length,armWeight:maxProtectedArmWeight,forearmWeight:maxProtectedForearmWeight,pureDrift:pure.max,projectedDrift:projected.max,smallStep:maxInfinitesimalWeightStep}));
  }
  // The published elbow case spans all detail settings. Expand its spatial
  // selection to the entire left arm and shoulder, retaining the same normal
  // alignment diagnostic used by the elbow-specific regression.
  const triangleCases=[];
  for(const facets of [8,12,16]){
    const recipe=C.sanitizeRecipe({...C.randomRecipe(1702468274),facets,pattern:0,outfit:'none',hat:'none',glasses:'none'}),g=G.build(recipe),parts=C.primitives(recipe);
    for(const phase of phases){
      const pose=A.sample(recipe,'wave',phase*4),baked=C.bake(g,recipe,true,pose);
      let triangles=0,reversals=0,minimumAlignment=1,minimumAreaRatio=Infinity;const worst=[];
      for(let i=0;i<g.positions.length;i+=9){
        if(g.meta[i/3*4+1]<0)continue;
        const rest=[0,1,2].map(k=>Array.from(g.positions.slice(i+k*3,i+k*3+3)));
        const center=[0,1,2].map(k=>(rest[0][k]+rest[1][k]+rest[2][k])/3);
        if(center[0]>=0||Math.min(C.sdRC(center,parts[1]),C.sdRC(center,parts[2]))>recipe.blend)continue;
        const points=[0,1,2].map(k=>Array.from(baked.positions.slice(i+k*3,i+k*3+3))),face=cross(sub(points[1],points[0]),sub(points[2],points[0]));
        const normal=[0,1,2].map(k=>baked.normals[i+k]+baked.normals[i+3+k]+baked.normals[i+6+k]),area=Math.hypot(...face),alignment=dot(face,normal)/Math.max(1e-15,area*Math.hypot(...normal));
        const physical=rest.map(p=>[p[0],p[1],p[2]*recipe.depth]),restArea=Math.hypot(...cross(sub(physical[1],physical[0]),sub(physical[2],physical[0]))),areaRatio=area/restArea;
        triangles++;if(alignment<-.1)reversals++;minimumAlignment=Math.min(minimumAlignment,alignment);minimumAreaRatio=Math.min(minimumAreaRatio,areaRatio);
        if(alignment<.1)worst.push({triangle:i/9,alignment,areaRatio,center});
      }
      check(triangles>20,'facets '+facets+': arm triangle fixture is empty');
      triangleCases.push({facets,phase,triangles,reversals,minimumAlignment,minimumAreaRatio,worst:worst.sort((a,b)=>a.alignment-b.alignment).slice(0,3)});
    }
  }
  return{sourceRoot,sourceHashes,failures,cases,triangleCases};
}

if(baseline&&baselineReport)throw Error('Choose --baseline or --baseline-report, not both');
const current=study(root),before=baselineReport?JSON.parse(fs.readFileSync(path.resolve(baselineReport),'utf8')).current:baseline?study(path.resolve(baseline)):null;
const comparisons=[];
if(before){
  for(const entry of current.cases){
    const old=before.cases.find(c=>c.name===entry.name);
    comparisons.push({name:entry.name,pureSkinningBefore:old.pureSkinning.max,pureSkinningAfter:entry.pureSkinning.max,defaultProjectionBefore:old.defaultProjection.max,defaultProjectionAfter:entry.defaultProjection.max,forearmWeightBefore:old.maxProtectedForearmWeight,forearmWeightAfter:entry.maxProtectedForearmWeight});
  }
  for(const entry of current.triangleCases){
    const old=before.triangleCases.find(c=>c.facets===entry.facets&&c.phase===entry.phase);
    if(entry.reversals>old.reversals)current.failures.push(`facets=${entry.facets} phase=${entry.phase}: new arm triangle reversals (${old.reversals} → ${entry.reversals})`);
  }
}else for(const entry of current.triangleCases)if(entry.reversals)current.failures.push(`facets=${entry.facets} phase=${entry.phase}: ${entry.reversals} arm triangle reversal(s)`);

const report={
  passed:current.failures.length===0,
  scope:'Bind-space body ownership, isolated left/right shoulders and elbows, full-wave arm-induced displacement with torso lean canceled, default projection contribution, and arm triangle orientation. Numeric checks do not replace visual silhouette review.',
  protectedRegion:'Nearest torso capsule; |torso SDF| <= 0.008 * recipe width; at least 2.75 upper-arm radii from both shoulder pivots. Near-underarm band is reported separately and may deform.',
  thresholds:{maxProtectedArmWeight:.05,maxProtectedForearmWeight:.01,maxPureDriftByRecipeWidth:.02,maxElbowDriftByRecipeWidth:.005,maxDefaultProjectionDriftByRecipeWidth:.025,maxWeightStepAcross2eMinus5Width:.002},
  failures:current.failures,current,before,comparisons
};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,recipes:current.cases.length,triangleCases:current.triangleCases.length,failures:report.failures,report:output}));
if(!report.passed&&!recordOnly)process.exitCode=1;
