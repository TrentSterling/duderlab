/** Matched arm-weight and wave captures from the application's real draw path.
 * Surface frames use the production shaders unchanged. Weight frames replace
 * only the replay fragment shader and add a diagnostic varying to its vertex
 * shader; positions, indices, skin attributes, palette and camera stay intact.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createCaptureSession} from './capture-frame.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(name,fallback=null)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const output=path.resolve(arg('--output',path.join(here,'../output/arm-study')));
const baseline=arg('--baseline');
const phase=Number(arg('--phase','.485')),width=512,height=512;
const context={};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(here,'../src/core.js'),'utf8'),context);
const recipe=context.DuderCore.sanitizeRecipe({...context.DuderCore.randomRecipe(1702468274),name:'Arm Study',pattern:0,hat:'beanie',glasses:'none'});
const views=[['front','FRONT',0],['threequarter','THREE QUARTER',-.65],['back','BACK',Math.PI]];
const versions=[];
if(baseline){const module=await import(pathToFileURL(path.resolve(baseline,'qa/capture-frame.mjs')).href);versions.push(['before',module.createCaptureSession]);}
versions.push(['after',createCaptureSession]);
const sessions=[];
for(const [version,create]of versions){
  const session=await create({mode:'focus',motionClip:'wave',selected:0,onlyScene:true,animate:false,smooth:true,showRig:false,yaw:0,pitch:.06,zoom:1.72,width,height,recipe});
  session.renderer.restRadius=1.2;session.renderer.target=[-.30,1.05,0];session.frame(0);
  sessions.push({version,session});
}

function weightsTrace(source){
  const trace=structuredClone(source);
  trace.purpose='Diagnostic rest-space waving-arm influence; real geometry, weights and camera; replay color shader only.';
  for(const draw of trace.draws){
    if(!draw.vs.includes('aSkinWeights'))continue;
    draw.vs=draw.vs.replace('  void main(){','  out float vArmStudy;\n  void main(){');
    draw.vs=draw.vs.replace('    vLocal=rest;',`    vArmStudy=0.;
    for(int study=0;study<4;study++){
      int bone=int(aSkinIndices[study]+.5);
      if(bone==1||bone==2)vArmStudy+=aSkinWeights[study];
    }
    vLocal=rest;`);
    if(!draw.vs.includes('vArmStudy=0.'))throw Error('Diagnostic vertex injection no longer matches production shader.');
    draw.fs=`#version 300 es
precision highp float;precision highp int;
uniform bool uOutline;
in float vArmStudy;in vec3 vNormal;
out vec4 outColor;
void main(){
  if(uOutline){outColor=vec4(.055,.075,.09,1.);return;}
  float w=clamp(vArmStudy,0.,1.);
  vec3 gray=vec3(.66,.72,.77),cyan=vec3(.15,.72,.90),yellow=vec3(1.,.83,.27),red=vec3(.95,.25,.16);
  vec3 color=w<.25?mix(gray,cyan,w*4.):w<.5?mix(cyan,yellow,(w-.25)*4.):mix(yellow,red,(w-.5)*2.);
  float light=.88+.12*abs(normalize(vNormal).z);
  outColor=vec4(color*light,1.);
}`;
  }
  return trace;
}

if(process.argv.includes('--stream')){
  if(!baseline)throw Error('--stream requires --baseline for A/B video');
  const fps=Number(arg('--fps','16')),frames=Math.round(4*fps),yaw=-.50;
  let previous;
  for(let frame=0;frame<frames;frame++){
    const traces=sessions.map(({session})=>{session.renderer.yaw=yaw;return session.frame(frame/fps);});
    const packet={frame,frames,fps,width,height,labels:sessions.map(x=>x.version==='before'?'BEFORE':'AFTER'),recipe};
    if(previous)packet.patches=traces.map((trace,j)=>({draws:trace.draws.map((draw,i)=>{const delta={};for(const [key,value]of Object.entries(draw))if(JSON.stringify(previous[j].draws[i][key])!==JSON.stringify(value))delta[key]=value;return delta;}),simulationTime:trace.simulationTime,stats:trace.stats}));
    else packet.traces=traces;
    await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(packet)+'\n',error=>error?reject(error):resolve()));
    previous=traces;
  }
  process.exit(0);
}

fs.mkdirSync(output,{recursive:true});
const cases=[];
function save(version,session,name,kind,view,label,at){
  const original=session.frame(at*4),trace=kind==='weights'?weightsTrace(original):original;
  fs.writeFileSync(path.join(output,name+'.trace.json'),JSON.stringify(trace));
  cases.push({name,version,kind,view,label,phase:at,time:at*4,yaw:session.renderer.yaw,pitch:session.renderer.pitch,zoom:session.renderer.zoom,target:session.renderer.target.slice(),sourceHashes:original.sourceHashes,stats:original.stats,diagnosticShader:kind==='weights'});
}
for(const {version,session}of sessions){
  for(const [view,label,yaw]of views){
    session.renderer.yaw=yaw;
    save(version,session,`${version}-surface-${view}`,'surface',view,label,phase);
    save(version,session,`${version}-weights-${view}`,'weights',view,label,0);
  }
  session.renderer.yaw=-.50;
  for(const [label,at]of [['LIFT',.22],['WAVE IN',.485],['WAVE OUT',.595],['SETTLE',.94]]){
    save(version,session,`${version}-motion-${label.toLowerCase().replaceAll(' ','-')}`,'motion','threequarter',label,at);
  }
}
const manifest={seed:recipe.seed,recipe,phase,width,height,baseline:baseline?path.resolve(baseline):null,scope:'Matched application shader replay, with separately identified diagnostic influence colors. Identical recipe, framing and sampled pose time for each A/B pair.',cases};
fs.writeFileSync(path.join(output,'arm-study-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({captures:cases.length,output}));
