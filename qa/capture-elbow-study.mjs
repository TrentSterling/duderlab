/** Exact-recipe, fixed-camera close-ups for the raised-elbow regression.
 * Capture the real indexed shader path; render-elbow-study.py replays it.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createCaptureSession} from './capture-frame.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(name,fallback=null)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const output=path.resolve(arg('--output',path.join(here,'../output/elbow-study'))),baseline=arg('--baseline');
const held=Number(arg('--held-phase','.80')),quick=process.argv.includes('--quick');
const width=640,height=640,target=[-.66,1.29,.015],zoom=3.3;
fs.mkdirSync(output,{recursive:true});
const context={};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(here,'../src/core.js'),'utf8'),context);
const recipe=JSON.parse(JSON.stringify(context.DuderCore.randomRecipe(1702468274)));
Object.assign(recipe,{name:'Elbow Regression',pattern:0,hat:'beanie',glasses:'none'});
const versions=[];
if(baseline){const m=await import(pathToFileURL(path.resolve(baseline,'qa/capture-frame.mjs')).href);versions.push(['before',m.createCaptureSession]);}
versions.push(['after',createCaptureSession]);
const views=[['front','FRONT',0],['threequarter','THREE QUARTER',-.65],['side','SIDE',-Math.PI/2],['back','BACK',Math.PI]],cases=[];
for(const [version,create]of versions){
  const session=await create({mode:'focus',motionClip:'wave',selected:0,onlyScene:true,animate:false,smooth:true,showRig:false,yaw:0,pitch:.06,zoom,width,height,recipe});
  session.renderer.restRadius=1.2;session.renderer.target=target.slice();session.frame(0);
  const duration=session.state.motionDuration;
  function save(name,label,view,phase){
    const trace=session.frame(phase*duration),pose=session.state.poseById[0];
    const record={name,version,label,view,phase,time:phase*duration,duration,yaw:session.renderer.yaw,pitch:session.renderer.pitch,target,zoom,sourceHashes:trace.sourceHashes,stats:trace.stats,parts:pose.parts};
    fs.writeFileSync(path.join(output,name+'.trace.json'),JSON.stringify(trace));cases.push(record);
  }
  for(const [view,label,yaw]of views){session.renderer.yaw=yaw;save(`${version}-elbow-${view}`,label,view,held);}
  if(version==='after'&&!quick){
    session.renderer.yaw=0;
    for(const [index,phase]of [.29,.375,.485,.595,.705,.80].entries())save(`after-elbow-wave-${index+1}`,`${index+1} / ${phase.toFixed(3)}`,'front',phase);
  }
}
fs.writeFileSync(path.join(output,'elbow-manifest.json'),JSON.stringify({scope:'Actual application indexed draw capture, fixed camera and exact screenshot recipe. Visual inspection remains required.',seed:recipe.seed,recipe,width,height,heldPhase:held,cases},null,2)+'\n');
console.log(JSON.stringify({captures:cases.length,output}));
