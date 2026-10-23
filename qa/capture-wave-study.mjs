/** Capture reproducible wave reference views from actual application draws.
 * Pass --baseline /path/to/prior/checkout for a frozen before/after comparison.
 * The generated images are GLSL replay evidence, not new concept art.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createCaptureSession} from './capture-frame.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(name,fallback=null)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const output=path.resolve(arg('--output',path.join(here,'../output/wave-study')));
const baseline=arg('--baseline'),baselineOnly=process.argv.includes('--baseline-only');
const heldOnly=process.argv.includes('--held-only'),projectionStrength=Number(arg('--projection-strength','.55'));
const held=Number(arg('--held-phase','.80'));
const phaseValues=arg('--phases','0,.08,.22,.375,.485,.595,.705,.94').split(',').map(Number);
if(phaseValues.length!==8||phaseValues.some(n=>!Number.isFinite(n)||n<0||n>=1))throw Error('--phases needs eight normalized phases');
fs.mkdirSync(output,{recursive:true});
const context={};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(here,'../src/core.js'),'utf8'),context);
const recipe=JSON.parse(JSON.stringify(context.DuderCore.randomRecipe(1702468274)));
Object.assign(recipe,{name:'Wave Study',pattern:0,hat:'beanie',glasses:'none'});
if(process.argv.includes('--stream')){
  const fps=Number(arg('--fps','24')),loops=Number(arg('--loops','2'));
  const session=await createCaptureSession({mode:'focus',motionClip:'wave',selected:0,onlyScene:true,animate:false,smooth:true,showRig:false,yaw:0,pitch:.06,zoom:1.18,width:480,height:440,recipe});
  session.renderer.restRadius=1.2;session.renderer.target=[0,1.02,0];session.frame(0);
  const duration=session.state.motionDuration,frames=Math.ceil(loops*duration*fps),views=[['FRONT',0],['3/4',-.65],['SIDE',-Math.PI/2]];
  let previous;
  for(let frame=0;frame<frames;frame++){
    const traces=views.map(([,yaw])=>{session.renderer.yaw=yaw;return session.frame(frame/fps);});
    const payload={frame,fps,frames,duration,labels:views.map(v=>v[0])};
    if(previous)payload.patches=traces.map((t,j)=>({draws:t.draws.map((d,i)=>{const diff={};for(const [key,value]of Object.entries(d))if(JSON.stringify(previous[j].draws[i][key])!==JSON.stringify(value))diff[key]=value;return diff;}),simulationTime:t.simulationTime,stats:t.stats}));
    else payload.traces=traces;
    await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(payload)+'\n',error=>error?reject(error):resolve()));previous=traces;
  }
  process.exit(0);
}
const versions=[];
if(baseline){const module=await import(pathToFileURL(path.resolve(baseline,'qa/capture-frame.mjs')).href);versions.push(['before',module.createCaptureSession]);}
if(!baselineOnly)versions.push(['after',createCaptureSession]);
if(!versions.length)throw Error('--baseline-only needs --baseline');
const views=[['front','FRONT',0,.06],['threequarter','3/4',-.65,.06],['side','SIDE',-Math.PI/2,.06],['back','BACK',Math.PI,.06]];
const frameLabels=['01 REST','02 READY','03 LIFT','04 WAVE OUT','05 WAVE IN','06 WAVE OUT','07 WAVE IN','08 SETTLE'];
const cases=[];
for(const [version,create]of versions){
  const session=await create({mode:'focus',motionClip:'wave',selected:0,onlyScene:true,animate:false,smooth:true,showRig:false,yaw:0,pitch:.06,zoom:1.18,width:480,height:440,recipe,projectionStrength});
  // Identical framing avoids attributing a camera fit change to the character.
  session.renderer.restRadius=1.2;session.renderer.target=[0,1.02,0];
  session.frame(0);const duration=session.state.motionDuration;
  function save(name,label,view,phase,rig=false){
    session.state.showRig=rig;
    const trace=session.frame(phase*duration),pose=session.state.poseById[0];
    const record={name,version,label,view,phase,time:phase*duration,duration,yaw:session.renderer.yaw,pitch:session.renderer.pitch,showRig:rig,projectionStrength,sourceHashes:trace.sourceHashes,stats:trace.stats,parts:pose.parts,joints:pose.joints};
    fs.writeFileSync(path.join(output,name+'.trace.json'),JSON.stringify(trace));cases.push(record);
  }
  for(const [view,label,yaw,pitch]of views){session.renderer.yaw=yaw;session.renderer.pitch=pitch;save(`${version}-held-${view}`,label,view,held);}
  if(version==='after'&&!heldOnly){
    session.renderer.yaw=0;session.renderer.pitch=.06;
    phaseValues.forEach((phase,i)=>save(`after-wave-${String(i+1).padStart(2,'0')}`,frameLabels[i],'front',phase));
    for(const [view,,yaw,pitch]of views.slice(0,3)){session.renderer.yaw=yaw;session.renderer.pitch=pitch;save(`after-rig-${view}`,'RIG '+view.toUpperCase(),view,held,true);}
  }
}
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({seed:recipe.seed,recipe,heldPhase:held,phases:phaseValues,scope:'Actual application shader and index-buffer capture; replay with render-wave-study.py.',cases},null,2)+'\n');
console.log(JSON.stringify({captures:cases.length,output}));
