// Verify rigid-motion correctness, representation invariance, elbow volume, and
// the production CPU bake against actual GLES vertex-shader transform feedback.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createCaptureSession} from './capture-frame.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),sourceHashes={};
for(const name of ['core','shell','geometry','animation']){
  const source=fs.readFileSync(path.join(root,'src',name+'.js'),'utf8');
  sourceHashes[name+'.js']=crypto.createHash('sha256').update(source).digest('hex');
  vm.runInThisContext(source,{filename:name+'.js'});
}
sourceHashes['renderer.js']=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src/renderer.js'))).digest('hex');
const C=DuderCore,A=DuderAnimation,failures=[];
const check=(ok,message)=>{if(!ok&&!failures.includes(message))failures.push(message);};
const distance=(a,b)=>Math.hypot(...a.map((x,k)=>x-b[k]));
const normalized=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
const metrics={singleBoneCases:0,maxSingleBonePositionError:0,maxSingleBoneNormalError:0,hemisphereCases:0,maxHemispherePositionError:0,maxHemisphereNormalError:0,maxQuaternionNormError:0,maxDualOrthogonalityError:0,volumeSamples:0,maxRadiusError:0,maxLbsRadiusError:0,posedBakes:0,bakedVertices:0,maxWeldedBakeDifference:0,maxAccessoryPositionError:0};
// Construct a known rigid matrix independently from an axis-angle quaternion.
function rigid(axis,angle,translation=[0,0,0],pivot=[0,0,0]){
  const [ax,ay,az]=normalized(axis),s=Math.sin(angle/2),x=ax*s,y=ay*s,z=az*s,w=Math.cos(angle/2);
  const m=new Float32Array([1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y),0,2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x),0,2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y),0,0,0,0,1]);
  const rotated=C.transformVector(m,pivot);for(let k=0;k<3;k++)m[12+k]=pivot[k]-rotated[k]+translation[k];return m;
}
const points=[[0,0,0],[1,2,-3],[-.12,5,.27]],normal=normalized([.2,.7,-.4]);
const axes=[[1,0,0],[0,1,0],[0,0,1],[1,1,1],[-.2,.9,.3]],angles=[0,1e-9,-1e-9,Math.PI/2,-Math.PI/2,1.9,2.12,Math.PI-1e-7,Math.PI,Math.PI+1e-7,Math.PI*2-1e-7,-Math.PI*2+1e-7];
for(const axis of axes)for(const angle of angles)for(const point of points){
  const m=rigid(axis,angle,[.43,-1.12,.7],[.1,.9,-.2]),q=C.dualQuaternion(m),got=C.skinDualQuaternion(point,normal,{indices:[0,0,0,0],weights:[1,0,0,0]},[q]);
  const pe=distance(got.p,C.transformPoint(m,point)),ne=distance(got.n,C.transformVector(m,normal));metrics.singleBoneCases++;metrics.maxSingleBonePositionError=Math.max(metrics.maxSingleBonePositionError,pe);metrics.maxSingleBoneNormalError=Math.max(metrics.maxSingleBoneNormalError,ne);
  metrics.maxQuaternionNormError=Math.max(metrics.maxQuaternionNormError,Math.abs(Math.hypot(...q.slice(0,4))-1));metrics.maxDualOrthogonalityError=Math.max(metrics.maxDualOrthogonalityError,Math.abs(q.slice(0,4).reduce((s,v,k)=>s+v*q[k+4],0)));
  check(pe<2e-6&&ne<2e-6,'Single-bone dual quaternion differs from its rigid matrix');
}
const palettes=[
  [0,.7,1.9,2.12].map((a,i)=>C.dualQuaternion(rigid([1,.2,.3],a,[i*.1,-i*.05,.12],[.2,.8,-.1]))),
  [Math.PI-.1,Math.PI-1e-7,Math.PI+1e-7,Math.PI+.1].map((a,i)=>C.dualQuaternion(rigid([.2,-.8,.3],a,[i*.07,.1,i*.03],[.1,.6,.2])))
];
for(const palette of palettes)for(const weights of [[.5,.3,.15,.05],[.5,.5,0,0],[.7,0,.2,.1]])for(const point of points){
  const skin={indices:[0,1,2,3],weights},expected=C.skinDualQuaternion(point,normal,skin,palette);
  for(let mask=0;mask<16;mask++){
    const changed=palette.map((q,i)=>q.map(v=>v*((mask>>i)&1?-1:1))),got=C.skinDualQuaternion(point,normal,skin,changed),pe=distance(got.p,expected.p),ne=distance(got.n,expected.n);
    metrics.hemisphereCases++;metrics.maxHemispherePositionError=Math.max(metrics.maxHemispherePositionError,pe);metrics.maxHemisphereNormalError=Math.max(metrics.maxHemisphereNormalError,ne);
    check(pe<1e-10&&ne<1e-10,'Paired real/dual sign changes alter the blend');
  }
}
const pivot=[.12,.8,-.2],radius=.12,volumeCases=[];
for(const angle of [Math.PI/3,109*Math.PI/180,2.12,160*Math.PI/180]){
  const matrices=[rigid([0,0,1],0,[0,0,0],pivot),rigid([0,0,1],angle,[0,0,0],pivot)],palette=matrices.map(C.dualQuaternion),expectedLbsRadius=radius*Math.cos(angle/2);let minDq=Infinity,maxDq=0,minLbs=Infinity,maxLbs=0;
  for(let i=0;i<32;i++){
    const theta=i*Math.PI*2/32,p=[pivot[0]+radius*Math.cos(theta),pivot[1]+radius*Math.sin(theta),pivot[2]],got=C.skinDualQuaternion(p,[0,0,1],{indices:[0,1,0,0],weights:[.5,.5,0,0]},palette),a=C.transformPoint(matrices[0],p),b=C.transformPoint(matrices[1],p),lbs=a.map((v,k)=>(v+b[k])*.5),dr=distance(got.p,pivot),lr=distance(lbs,pivot);
    metrics.volumeSamples++;metrics.maxRadiusError=Math.max(metrics.maxRadiusError,Math.abs(dr-radius));metrics.maxLbsRadiusError=Math.max(metrics.maxLbsRadiusError,Math.abs(lr-expectedLbsRadius));minDq=Math.min(minDq,dr);maxDq=Math.max(maxDq,dr);minLbs=Math.min(minLbs,lr);maxLbs=Math.max(maxLbs,lr);
    check(Math.abs(dr-radius)<1e-6,'Equal-weight elbow ring loses radius with dual quaternions');check(Math.abs(lr-expectedLbsRadius)<1e-6,'Linear-blend control disagrees with analytic contraction');
  }
  volumeCases.push({angleDegrees:angle*180/Math.PI,radius,dualQuaternionRadius:[minDq,maxDq],linearBlendRadius:[minLbs,maxLbs],expectedLinearRadius:expectedLbsRadius});
}
const variants=[
  ['default',{hat:'beanie',glasses:'none'}],
  ['short-thick',{height:.75,width:1.3,belly:1.2,depth:.62,armLength:.7,armThickness:1.35,armGap:0,armSpread:-.15,hat:'cap',glasses:'square'}],
  ['tall-thin',{height:1.3,width:.75,belly:.8,depth:1.24,armLength:1.4,armThickness:.65,armGap:.24,hat:'bucket',glasses:'round'}]
];
const gpuCases=[];
for(const [name,overrides]of variants){
  const recipe=C.sanitizeRecipe({...C.baseDefaults(),...overrides,pattern:0}),session=await createCaptureSession({motionClip:'wave',onlyScene:true,outlines:false,smooth:true,recipe,width:64,height:64});
  for(const phase of [.20,.38,.49,.70]){
    const trace=session.frame(phase*4),g=session.renderer.batchGeometry[0],pose=A.sample(recipe,'wave',phase*4),baked=C.bake(g,recipe,true,pose),indices=g.indexed.indices,count=g.indexed.positions.length/3,expected=new Float32Array(count*6),seen=new Uint8Array(count);
    metrics.posedBakes++;metrics.bakedVertices+=baked.positions.length/3;
    check(trace.sourceHashes['core.js']===sourceHashes['core.js'],'Core changed while the dual-quaternion verification was running');
    check(trace.sourceHashes['renderer.js']===sourceHashes['renderer.js'],'Renderer changed while the dual-quaternion verification was running');
    check(baked.positions.length===g.positions.length,'Solid posed bake changes the triangle count');
    check([...baked.positions,...baked.normals].every(Number.isFinite),'Posed CPU bake contains nonfinite arms or normals');
    for(let i=0;i<indices.length;i++){
      const weights=Array.from(g.skinWeights.slice(i*4,i*4+4));check(weights[0]>0&&weights[0]>=Math.max(...weights)-1e-7,'First hemisphere reference is not the dominant skin influence');
      const ix=indices[i],p=Array.from(baked.positions.slice(i*3,i*3+3)),n=Array.from(baked.normals.slice(i*3,i*3+3));
      check(Math.abs(Math.hypot(...n)-1)<.001,'Posed CPU normal is not unit length');
      if(seen[ix])metrics.maxWeldedBakeDifference=Math.max(metrics.maxWeldedBakeDifference,distance(p,Array.from(expected.slice(ix*6,ix*6+3))));
      expected.set(p,ix*6);expected.set(n,ix*6+3);seen[ix]=1;
      if(g.meta[i*4+1]<0){const rigidPosition=C.transformPoint(pose.transforms[0],Array.from(g.positions.slice(i*3,i*3+3)));metrics.maxAccessoryPositionError=Math.max(metrics.maxAccessoryPositionError,distance(p,rigidPosition));}
    }
    check(seen.every(Boolean),'Indexed bake comparison missed vertices');
    check(metrics.maxWeldedBakeDifference<1e-6,'Coincident indexed vertices split during the posed bake');
    check(metrics.maxAccessoryPositionError<1e-6,'Rigid accessory changed position under body skinning');
    const draw=trace.draws.find(d=>d.method==='drawElements'&&d.uniforms.uOutline?.value[0]===0);
    check(!!draw,'No production indexed fill draw was captured');
    gpuCases.push({name:name+'-'+phase,sourceHashes:trace.sourceHashes,draw,expected:Array.from(expected),vertexCount:count});
  }
}
let gpu=null;
if(!process.argv.includes('--cpu-only')){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'duder-dq-'));
  try{
    const input=path.join(temp,'input.json'),output=path.join(temp,'output.json');fs.writeFileSync(input,JSON.stringify({cases:gpuCases}));
    const result=spawnSync('python3',[path.join(root,'qa/check-dual-quaternion-gpu.py'),input,output],{encoding:'utf8',maxBuffer:8*1024*1024});
    if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
    check(result.status===0,'Actual GLES vertex-shader comparison failed');
    if(fs.existsSync(output))gpu=JSON.parse(fs.readFileSync(output,'utf8'));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
const report={passed:failures.length===0,scope:'Rigid dual-quaternion correctness, fixed-weight elbow cross-section preservation, posed CPU bake, and actual shipped GLSL transform feedback on software GLES.',sourceHashes,failures,metrics,volumeCases,gpu};
fs.writeFileSync(path.join(root,'qa/dual-quaternion-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failures,metrics,gpu:gpu?{passed:gpu.passed,vertices:gpu.vertices,maxPositionError:gpu.maxPositionError,maxNormalError:gpu.maxNormalError}:null},null,2));
if(failures.length)process.exitCode=1;
