/** Reproduce the merged-leg regression with actual application draw captures. */
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createCaptureSession} from './capture-frame.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(key,fallback=null)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const output=path.resolve(arg('--output',path.join(here,'../output/leg-study'))),baseline=arg('--baseline');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(here,'../src/core.js'),'utf8'),c);const C=c.DuderCore;
const recipes=[['default','DEFAULT',C.baseDefaults()],['narrow-large','NARROW / LARGE FEET',C.sanitizeRecipe({...C.baseDefaults(),width:.75,height:.75,belly:1.2,feet:1.3,blend:.22})],['short-wide','SHORT / WIDE',C.sanitizeRecipe({...C.baseDefaults(),width:1.3,height:.75,belly:1.2,feet:1.3,blend:.22})],['small-feet','SMALL FEET / HIGH BLEND',C.sanitizeRecipe({...C.baseDefaults(),width:.75,height:.75,belly:1.2,feet:.7,blend:.22})]];
const versions=[];if(baseline){const previous=await import(pathToFileURL(path.resolve(baseline,'qa/capture-frame.mjs')).href);versions.push(['before',previous.createCaptureSession]);}versions.push(['after',createCaptureSession]);
fs.mkdirSync(output,{recursive:true});const cases=[];
for(const [name,label,r]of recipes){
 const recipe={...r,hat:'none',glasses:'none',pattern:0},sessions=[];
 for(const [version,create]of versions)sessions.push([version,await create({recipe,mode:'focus',motionClip:'idle',onlyScene:true,animate:false,smooth:true,showRig:false,yaw:0,pitch:0,zoom:1.10,width:480,height:440})]);
 const radius=Math.max(...sessions.map(([,s])=>s.renderer.restRadius));
 const part=C.primitives(recipe)[0],targetY=(part.b[1]+part.rb)*.5;
 for(const [version,session]of sessions){
  session.renderer.restRadius=radius;session.renderer.target=[0,targetY,0];const trace=session.frame(0),tag=name+'-'+version;
  fs.writeFileSync(path.join(output,tag+'.trace.json'),JSON.stringify(trace));
  cases.push({name,tag,label,version,recipe,sourceHashes:trace.sourceHashes,stats:trace.stats});
 }
}
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({scope:'Actual application GLSL capture; equal before/after camera framing per recipe.',cases},null,2)+'\n');
console.log(JSON.stringify({output,captures:cases.length}));
