import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';import {mockGL} from './capture-frame.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),src=path.resolve(dir,'../src'),checks=[],calls=[];
const overlaps=(a,b)=>Math.max(a.x,b.x)<Math.min(a.x+a.w,b.x+b.w)-.001&&Math.max(a.y,b.y)<Math.min(a.y+a.h,b.y+b.h)-.001;
async function check(width,height,tab,panelOpen=true){
 const {gl,draws}=mockGL(width,height),canvas={clientWidth:width,clientHeight:height,width,height};
 class Image{set src(v){this._src=v;const b=Buffer.from(v.split(',')[1],'base64');this.width=b.readUInt32BE(16);this.height=b.readUInt32BE(20);queueMicrotask(()=>this.onload?.());}get src(){return this._src;}}
 const c={Image,Float32Array,Uint8Array,queueMicrotask};c.window=c;vm.createContext(c);for(const name of ['font-data.js','ui.js'])vm.runInContext(fs.readFileSync(path.join(src,name),'utf8'),c,{filename:name});
 const ui=new c.DuderUI(gl,canvas,(a,v)=>calls.push({a,v}));await ui.ready;
 const state={tab,mode:'focus',selected:0,recipe:{name:'Blue Shift'},stats:{count:tab==='physics'?8:1,totalCount:16,drawCalls:4,triangles:1680,fps:0},physicsEnabled:tab==='physics',physicsMode:'pile',physicsPaused:false,physicsSettings:{gravity:9.81,damping:.18},physicsStats:{bodies:56,joints:48,maxJointError:.0012,rigCount:8,spawnCount:8,pending:0},pileCount:8,motionEnabled:tab==='motion',motionClip:'wave',motionPlaying:true,motionTime:.8,motionDuration:2.6,motionProgress:.8/2.6,motionSpeed:1,motionAmplitude:1,showRig:false,outlines:true,projectionStrength:.55,outlineWidth:2.2,panelOpen};
 const draw=()=>{draws.length=0;ui.draw(state,width,height);assert.equal(draws.length,1,'UI must remain one GPU draw');const controls=ui.hits.filter(h=>h.type!=='block');for(const h of controls){assert(h.x>=-.001&&h.x+h.w<=width+.001&&h.y>=0&&h.y+h.h<=height+.001,`${width} ${tab}: ${h.key} outside canvas`);for(const q of controls)if(h!==q)assert(!overlaps(h,q),`${width} ${tab}: ${h.key} overlaps ${q.key}`);}};
 draw();const headerHeight=width<1100?112:78,top=ui.hits.filter(h=>h.type==='button'&&h.y<headerHeight);
 for(const action of ['motion','ragdoll','pile','exportGLB',...(width>=700?['sumo']:[])]){const h=top.find(h=>h.action===action);assert(h,`${action} header missing at ${width}px`);ui.pointer('down',h.x+h.w/2,h.y+h.h/2);ui.pointer('up',h.x+h.w/2,h.y+h.h/2);assert.equal(calls.at(-1).a,action);}
 assert.equal(ui.getViewport(width,height).y,headerHeight,'Wrong header offset');
 if(width>=600||panelOpen){
  for(const name of ['Shape','Skin','Gear','Motion','Physics'])assert(ui.hits.some(h=>h.key==='tab:'+name),`Missing ${name} tab`);
  const wanted=tab==='motion'?['motion:clip:idle','motion:clip:walk','motion:clip:wave','motion:clip:dance','motion:pause','motion:reset','motionProgress','motionSpeed','motionAmplitude','motion:release','motion:rig','projectionStrength']:['physics:pause','physics:reset','physics:drop','physics:kick','pile:count:4','pile:count:8','pile:count:12','pile:count:16','gravity','damping','projectionStrength','toggle:showRig'];
  const seen=new Set(),scrollMax=ui.scrollMax,positions=[0];for(let y=64;y<scrollMax;y+=64)positions.push(y);positions.push(scrollMax);
  for(const scroll of positions){ui.scroll[tab]=scroll;draw();for(const h of ui.hits){if(!wanted.includes(h.key)||seen.has(h.key)||h.h<16)continue;seen.add(h.key);const before=calls.length;ui.pointer('down',h.type==='slider'?h.trackX+h.trackWidth*.67:h.x+h.w/2,h.y+h.h/2);ui.pointer('up',h.x+h.w/2,h.y+h.h/2);assert.equal(calls.length,before+1,`${h.key} did not route`);assert.equal(calls.at(-1).a,h.action);if(h.type==='slider')assert.equal(calls.at(-1).v.key,h.key);else if(h.action==='pileCount')assert.equal(calls.at(-1).v,h.value);}}
  for(const key of wanted)assert(seen.has(key),`${width} ${tab}: ${key} unreachable by scrolling`);
  ui.scroll[tab]=0;draw();const outline=ui.hits.find(h=>h.key==='toggle:outlines');assert(outline,'Missing persistent outline toggle');
 }
 checks.push({width,height,tab,panelOpen,headerButtons:top.length,drawCalls:1,passed:true});
}
for(const width of [320,390,600,700,850,960,1100,1440]){await check(width,width<600?844:800,'motion');await check(width,width<600?844:800,'physics');}
await check(390,844,'motion',false);await check(320,844,'physics',false);
const report={passed:checks.length,routedActions:calls.length,checks};fs.writeFileSync(path.join(dir,'ui-v3-checks.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
