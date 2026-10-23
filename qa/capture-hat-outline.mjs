/** Capture the exact reported beanie and related hollow-hat outline cases.
 * Run through check-hat-outline-render.py for actual GLES replay and pixel checks.
 * --baseline accepts another Duder Lab source checkout for before/after evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createCaptureSession} from './capture-frame.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const arg=name=>{
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
};
const output=path.resolve(arg('--output')||path.join(here,'../output/hat-outline'));
const baseline=arg('--baseline');
fs.mkdirSync(output,{recursive:true});

// This seed is visible in the user's screenshot and reproduces its green
// beanie, pink star pattern, and proportions without approximating the recipe.
const context={};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(here,'../src/core.js'),'utf8'),context);
const recipe=JSON.parse(JSON.stringify(context.DuderCore.randomRecipe(1702468274)));
const versions=[];
if(baseline){
  const module=await import(pathToFileURL(path.resolve(baseline,'qa/capture-frame.mjs')).href);
  versions.push(['before',module.createCaptureSession]);
}
versions.push(['after',createCaptureSession]);
const views=[['front',.25,.12],['level',.25,0],['below',.25,-.12],['under',.25,-.35],['side',1.82,.12],['back',3.39,.12]];
const manifest=[];
for(const [version,create]of versions){
  for(const hat of ['beanie','cap','bucket','bowler','sunhat']){
    if(version==='before'&&hat!=='beanie')continue;
    const session=await create({mode:'focus',selected:0,onlyScene:true,animate:false,smooth:true,yaw:.25,pitch:.12,zoom:1.1,width:500,height:424,recipe:{...recipe,hat}});
    const chosenViews=hat==='beanie'?views:views.filter(v=>['front','below','side'].includes(v[0]));
    for(const [view,yaw,pitch]of chosenViews){
      // 4 px is the UI maximum; 6 px is an additional frontal stress case.
      const widths=view==='front'&&hat==='beanie'?[1,2.2,4,6]:[2.2,4];
      for(const width of widths){
        session.renderer.yaw=yaw;session.renderer.pitch=pitch;session.state.outlineWidth=width;
        const name=`${version}-${hat}-${view}-${width}`,trace=session.frame(0);
        fs.writeFileSync(path.join(output,name+'.trace.json'),JSON.stringify(trace));
        manifest.push({name,version,hat,view,yaw,pitch,width,sourceHashes:trace.sourceHashes,stats:trace.stats});
      }
    }
  }
}
const gallery=await createCaptureSession({mode:'gallery',width:1440,height:1000});
const trace=gallery.frame(0);
fs.writeFileSync(path.join(output,'final-gallery.trace.json'),JSON.stringify(trace));
manifest.push({name:'final-gallery',version:'after',sourceHashes:trace.sourceHashes,stats:trace.stats});
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({seed:1702468274,recipe,cases:manifest},null,2));
console.log(JSON.stringify({captures:manifest.length,output}));
