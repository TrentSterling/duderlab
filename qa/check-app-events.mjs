/** Functional integration checks against the real app.js event handlers.
 * DOM/canvas and WebGL transports are minimal mocks. This verifies wiring and
 * exported bytes; it makes no browser-compatibility or performance claim.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mockGL} from './capture-frame.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),src=path.resolve(here,'../src');
const width=1440,height=1000,{gl}=mockGL(width,height);gl.captureDraws=false;
let now=0,timerSerial=0,urlSerial=0;
const timers=new Map(),raf=[],downloads=[],inputs=[],urls=new Map(),storage=new Map(),logs=[],checks=[];
function emitter(obj={}){
  const listeners=new Map();obj.addEventListener=(type,fn)=>{const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);};
  obj.dispatch=(type,e={})=>{e.type=type;e.preventDefault??=()=>{};e.target??=obj;for(const fn of listeners.get(type)||[])fn(e);};return obj;
}
const canvas=emitter({tagName:'CANVAS',clientWidth:width,clientHeight:height,width,height,dataset:{},getContext:n=>n==='webgl2'?gl:null,getBoundingClientRect:()=>({left:0,top:0,width,height}),focus(){},setPointerCapture(){},toBlob(){throw Error('Screenshot export is outside this event test');}});
const fallback={hidden:false,textContent:''};
const document={
  getElementById(id){return id==='duder'?canvas:id==='fallback'?fallback:null;},
  body:{appendChild(){}},
  createElement(tag){
    if(tag==='a')return {href:'',download:'',click(){const blob=urls.get(this.href);if(!blob)throw Error('Missing download Blob');downloads.push({name:this.download,blob});},remove(){}};
    if(tag==='input'){const input={tagName:'INPUT',files:[],click(){inputs.push(this);},remove(){}};return input;}
    throw Error('Unexpected DOM element '+tag);
  }
};
class FakeImage{
  set src(value){this._src=value;const bytes=Buffer.from(value.split(',')[1],'base64');this.width=bytes.readUInt32BE(16);this.height=bytes.readUInt32BE(20);queueMicrotask(()=>this.onload?.());}get src(){return this._src;}
}
const context=emitter({console:{log(){},warn(...a){logs.push({level:'warn',text:a.join(' ')});},error(...a){logs.push({level:'error',text:a.join(' ')});}},document,Image:FakeImage,devicePixelRatio:1,Float32Array,Uint8Array,Uint16Array,Uint32Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,Blob,URLSearchParams,location:{search:'?qa=1'},performance:{now:()=>now},queueMicrotask,
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
  URL:{createObjectURL(blob){const url='blob:test/'+(++urlSerial);urls.set(url,blob);return url;},revokeObjectURL(url){urls.delete(url);}},
  setTimeout(fn,delay=0){const id=++timerSerial;timers.set(id,{fn,due:now+delay});return id;},clearTimeout(id){timers.delete(id);},
  requestAnimationFrame(fn){raf.push(fn);return raf.length;},cancelAnimationFrame(){}
});context.window=context;context.globalThis=context;vm.createContext(context);
const sourceHashes={};
for(const file of ['font-data.js','vendor-cannon.js','core.js','shell.js','geometry.js','collision-shapes.js','physics.js','animation.js','renderer.js','ui.js']){
  const code=fs.readFileSync(path.join(src,file),'utf8');sourceHashes[file]=crypto.createHash('sha256').update(code).digest('hex');vm.runInContext(code,context,{filename:file});
}
const RealUI=context.DuderUI,RealRenderer=context.DuderRenderer;
context.DuderUI=class extends RealUI{constructor(...args){super(...args);context.testUI=this;}};
context.DuderRenderer=class extends RealRenderer{constructor(...args){super(...args);context.testRenderer=this;}};
const app=fs.readFileSync(path.join(src,'app.js'),'utf8');sourceHashes['app.js']=crypto.createHash('sha256').update(app).digest('hex');await vm.runInContext(app,context,{filename:'app.js'});
const ui=context.testUI,renderer=context.testRenderer;
assert(ui&&renderer,'App did not construct renderer and UI');assert.equal(fallback.hidden,true,'App initialization fallback remained visible');
function frame(){assert(raf.length>0,'No animation frame queued');now+=1000/60;const fn=raf.shift();fn(now);for(const [id,t]of [...timers])if(t.due<=now){timers.delete(id);t.fn();}assert(!canvas.dataset.error,canvas.dataset.error||'App error');}
function pointer(type,x,y,extra={}){canvas.dispatch(type,{clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,...extra});}
function click(x,y){pointer('pointerdown',x,y);pointer('pointerup',x,y);frame();}
function clickControl(predicate,label){const hit=ui.hits.find(predicate);assert(hit,'Missing control: '+label);click(hit.x+hit.w/2,hit.y+hit.h/2);return hit;}
function press(key,shiftKey=false){context.dispatch('keydown',{key,shiftKey,target:canvas});frame();}
function pass(name,details={}){checks.push({name,passed:true,...details});}

frame();assert.equal(ui.state.mode,'gallery');assert.equal(ui.state.stats.drawCalls,4);assert.equal(ui.state.stats.totalCount,16);assert.equal(ui.state.smooth,true);assert(renderer.vertexCount<renderer.expandedVertexCount);pass('Initial smooth gallery with indexed geometry and four-pass accounting',{triangles:renderer.triangles,vertices:renderer.vertexCount,expandedVertices:renderer.expandedVertexCount,geometryBytes:renderer.gpuGeometryBytes});
let vp=renderer.viewport;click(vp.x+2.5*vp.w/4,vp.y+1.5*vp.h/4);assert.equal(ui.state.selected,6);pass('Gallery canvas click selects duder 7');
clickControl(h=>h.action==='mode'&&h.value==='focus','Focus');assert.equal(ui.state.mode,'focus');assert.equal(ui.state.selected,6);assert.equal(ui.state.stats.count,1);assert.equal(ui.state.stats.totalCount,16);pass('Focus button retains selection and collection total');
let slider=ui.hits.find(h=>h.type==='slider'&&h.key==='height');assert(slider);pointer('pointerdown',slider.trackX+slider.trackWidth*.8,slider.y+20);pointer('pointermove',slider.trackX+slider.trackWidth*.8,slider.y+20);pointer('pointerup',slider.trackX+slider.trackWidth*.8,slider.y+20);frame();assert.equal(ui.state.recipe.height,1.19);pass('Shape slider changes actual recipe and rebuilds geometry',{height:ui.state.recipe.height});
slider=ui.hits.find(h=>h.type==='slider'&&h.key==='depth');assert(slider,'Depth slider');pointer('pointerdown',slider.trackX+slider.trackWidth*.5,slider.y+20);pointer('pointerup',slider.trackX+slider.trackWidth*.5,slider.y+20);frame();assert.equal(ui.state.recipe.depth,.93);pass('Depth slider updates body proportion',{depth:ui.state.recipe.depth});
clickControl(h=>h.action==='tab'&&h.value==='skin','Skin tab');assert.equal(ui.state.tab,'skin');clickControl(h=>h.action==='param'&&h.value?.key==='pattern'&&h.value.value===3,'Stars pattern');assert.equal(ui.state.recipe.pattern,3);pass('Skin tab and procedural pattern selection');
clickControl(h=>h.action==='param'&&h.value?.key==='color'&&h.key.includes('#f47d68'),'Body color');assert(ui.state.recipe.color[0]>.9);pass('Skin color swatch edits shader data');
clickControl(h=>h.action==='tab'&&h.value==='gear','Gear tab');clickControl(h=>h.action==='param'&&h.value?.key==='hat'&&h.value.value==='bucket','Bucket hat');clickControl(h=>h.action==='param'&&h.value?.key==='glasses'&&h.value.value==='round','Round glasses');assert.equal(ui.state.recipe.hat,'bucket');assert.equal(ui.state.recipe.glasses,'round');pass('Gear tab fits selected hat and glasses');
clickControl(h=>h.action==='toggle'&&h.value==='animate','Idle');assert.equal(ui.state.animate,false);clickControl(h=>h.action==='toggle'&&h.value==='smooth','Smooth shading');assert.equal(ui.state.smooth,false);clickControl(h=>h.action==='toggle'&&h.value==='smooth','Smooth shading');assert.equal(ui.state.smooth,true);clickControl(h=>h.action==='toggle'&&h.value==='wireframe','Wireframe');assert.equal(ui.state.wireframe,true);pass('Animation, smooth shading round-trip, and wireframe controls');
vp=renderer.viewport;let x=vp.x+vp.w*.5,y=vp.y+vp.h*.5;pointer('pointerdown',x,y);pointer('pointermove',x+60,y+20);pointer('pointerup',x+60,y+20);frame();assert.notEqual(renderer.yaw,.25);assert.notEqual(renderer.pitch,.12);canvas.dispatch('wheel',{clientX:x,clientY:y,deltaY:-200});frame();assert(renderer.zoom>1);pass('Canvas drag orbits and wheel zooms');
press('f');assert.equal(renderer.yaw,.25);assert.equal(renderer.pitch,.12);assert.equal(renderer.zoom,1);pass('F frames selected view');
press('g');assert.equal(ui.state.mode,'gallery');pass('G toggles gallery/focus');
const oldSeed=ui.state.recipe.seed;press('r');assert.notEqual(ui.state.recipe.seed,oldSeed);pass('R rerolls selected duder');press('R',true);assert.equal(ui.state.selected,0);assert.equal(ui.state.recipe.name,context.DuderCore.presets()[0].name);pass('Shift+R restores original collection');
clickControl(h=>h.action==='help'&&h.key==='help','Help');assert.equal(ui.state.helpOpen,true);clickControl(h=>h.action==='exportRecipe','Export recipe');assert(downloads.length>0);let item=downloads.at(-1);assert.equal(item.name,'duder-recipes-v3.json');let saved=JSON.parse(await item.blob.text());assert.equal(saved.recipes.length,16);pass('Recipe download contains all 16 entries',{name:item.name,bytes:item.blob.size});
clickControl(h=>h.action==='importRecipe','Import recipe');assert(inputs.length>0);saved.selected=2;saved.recipes[2].height=1.23;saved.recipes[2].name='Imported duder';const text=JSON.stringify(saved),input=inputs.at(-1);input.files=[{size:Buffer.byteLength(text),text:async()=>text}];await input.onchange();frame();assert.equal(ui.state.selected,2);assert.equal(ui.state.recipe.height,1.23);assert.equal(ui.state.recipe.name,'Imported duder');pass('Recipe file import restores selection and edited parameters');
clickControl(h=>h.key==='help-close','Close help');assert.equal(ui.state.helpOpen,false);clickControl(h=>h.action==='exportGLB','Export GLB');item=downloads.at(-1);assert(item.name.endsWith('.glb'));const bytes=await item.blob.arrayBuffer(),dv=new DataView(bytes);assert.equal(dv.getUint32(0,true),0x46546c67);assert.equal(dv.getUint32(4,true),2);assert.equal(dv.getUint32(8,true),bytes.byteLength);const jsonLength=dv.getUint32(12,true),gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonLength)));assert.equal(gltf.meshes.length,1);assert.equal(gltf.materials.length,1);assert(gltf.accessors[0].count>0);pass('GLB button downloads valid single-mesh GLB 2.0',{name:item.name,bytes:bytes.byteLength,vertices:gltf.accessors[0].count,materials:gltf.materials.length});

clickControl(h=>h.action==='ragdoll','Ragdoll');assert.equal(ui.state.physicsEnabled,true);assert.equal(ui.state.physicsMode,'ragdoll');assert.equal(ui.state.mode,'focus');assert.equal(ui.state.physicsStats.bodies,7);assert.equal(ui.state.physicsStats.joints,6);assert.equal(ui.state.stats.drawCalls,5);pass('Ragdoll button creates seven rigid bodies, six joints, and one batched rig overlay');
for(let i=0;i<30;i++)frame();assert(ui.state.poseById[ui.state.selected].transforms.flatMap(m=>Array.from(m)).every(Number.isFinite));pass('Physics steps feed finite matrices into the actual render data path');
press(' ');assert.equal(ui.state.physicsPaused,true);const stopped=JSON.stringify(ui.state.poseById[ui.state.selected].transforms.map(m=>Array.from(m)));for(let i=0;i<12;i++)frame();assert.equal(JSON.stringify(ui.state.poseById[ui.state.selected].transforms.map(m=>Array.from(m))),stopped);pass('Space pauses physical motion');
press(' ');assert.equal(ui.state.physicsPaused,false);press('x');assert.equal(ui.state.showRig,false);assert.equal(ui.state.stats.drawCalls,4);press('o');assert.equal(ui.state.outlines,false);assert.equal(ui.state.stats.drawCalls,3);press('o');press('x');pass('Rig and shell outline toggles account for exactly one draw each');
slider=ui.hits.find(h=>h.type==='slider'&&h.key==='projectionStrength');assert(slider);pointer('pointerdown',slider.trackX,slider.y+20);pointer('pointerup',slider.trackX,slider.y+20);frame();assert.equal(ui.state.projectionStrength,0);pass('Shell correction slider reaches pure bone skinning');
press('d');assert.equal(ui.state.physicsPaused,false);let pose=ui.state.poseById[ui.state.selected];assert(pose.center[1]>1);pass('D triggers a raised physical drop');
// Pick the torso through the real screen ray path, then drag and release.
const center=pose.center,clip=context.DuderMath.point(renderer.vpMatrix,center);vp=renderer.viewport;x=vp.x+(clip[0]/clip[3]+1)*.5*vp.w;y=vp.y+(1-clip[1]/clip[3])*.5*vp.h;
pointer('pointerdown',x,y);assert(context.DuderLab.physics.grab,'Pointer did not acquire a body');pointer('pointermove',x+40,y-30);for(let i=0;i<15;i++)frame();pointer('pointerup',x+40,y-30);assert.equal(context.DuderLab.physics.grab,null);pass('Canvas grab ray attaches, moves, and releases a physical body');
press('s');assert.equal(ui.state.physicsMode,'sumo');assert.equal(ui.state.physicsStats.bodies,14);assert.equal(ui.state.physicsStats.joints,12);assert.equal(ui.state.stats.count,2);assert.equal(renderer.last.length,2);for(let i=0;i<30;i++)frame();pass('S starts two generated rigs in one collision world and character batch');
press('k');frame();assert(ui.state.physicsStats.maxJointError>=0);pass('Kick action reaches running physics');
press(' ');assert.equal(ui.state.physicsPaused,true);clickControl(h=>h.action==='exportGLB','Export posed GLB');item=downloads.at(-1);assert(item.name.endsWith('-pose.glb'));const posedBytes=await item.blob.arrayBuffer(),posedDV=new DataView(posedBytes);assert.equal(posedDV.getUint32(0,true),0x46546c67);assert.equal(posedDV.getUint32(8,true),posedBytes.byteLength);pass('Paused physics exports the current pose as valid GLB',{bytes:posedBytes.byteLength});
press('g');assert.equal(ui.state.physicsEnabled,false);assert.equal(ui.state.mode,'gallery');assert.equal(ui.state.stats.count,16);assert.equal(ui.state.stats.drawCalls,4);pass('Gallery exits physics and restores the editable sixteen-duder batch');
// New V3 user paths: motion controls, exact handoff, and a growing shared pile.
clickControl(h=>h.action==='motion','Motion');assert.equal(ui.state.motionEnabled,true);assert.equal(ui.state.tab,'motion');assert.equal(ui.state.mode,'focus');assert.equal(ui.state.showRig,false);pass('Motion button opens a clean animation preview');
clickControl(h=>h.action==='motionClip'&&h.value==='wave','Wave');for(let i=0;i<30;i++)frame();assert.equal(ui.state.motionClip,'wave');assert(ui.state.motionTime>.4);assert(ui.state.poseById[ui.state.selected].transforms.flatMap(m=>Array.from(m)).every(Number.isFinite));pass('Wave clip feeds finite animation matrices to the renderer');
press(' ');assert.equal(ui.state.motionPlaying,false);const motionStopped=ui.state.motionTime;for(let i=0;i<5;i++)frame();assert.equal(ui.state.motionTime,motionStopped);pass('Space pauses animation even when a UI button is focused');
slider=ui.hits.find(h=>h.key==='motionProgress');assert(slider);pointer('pointerdown',slider.trackX+slider.trackWidth*.45,slider.y+20);pointer('pointerup',slider.trackX+slider.trackWidth*.45,slider.y+20);frame();assert(Math.abs(ui.state.motionProgress-.45)<1e-5);assert.equal(ui.state.motionPlaying,false);pass('Timeline scrub selects an exact held pose');
slider=ui.hits.find(h=>h.key==='motionSpeed');assert(slider);pointer('pointerdown',slider.trackX+slider.trackWidth*5/7,slider.y+20);pointer('pointerup',slider.trackX+slider.trackWidth*5/7,slider.y+20);frame();assert.equal(ui.state.motionSpeed,1.5);pass('Motion speed slider reaches 1.5x');
press('x');assert.equal(ui.state.stats.drawCalls,5);press('x');assert.equal(ui.state.stats.drawCalls,4);pass('Motion rig overlay adds exactly one draw');
clickControl(h=>h.action==='exportGLB','Export animated GLB');assert(downloads.at(-1).name.endsWith('-pose.glb'));pass('Animation export captures the currently held pose');
const heldPose=ui.state.poseById[ui.state.selected].transforms.map(m=>Array.from(m));context.DuderLab.action('ragdoll');const released=context.DuderLab.physics.poseTransforms().transforms;let handoffError=0;for(let i=0;i<7;i++)for(let k=0;k<16;k++)handoffError=Math.max(handoffError,Math.abs(heldPose[i][k]-released[i][k]));assert(handoffError<1e-5);assert.equal(ui.state.motionEnabled,false);frame();pass('Release to ragdoll preserves all seven current bone transforms',{maxTransformError:handoffError});
press('m');clickControl(h=>h.action==='motionClip'&&h.value==='dance','Dance');for(let i=0;i<12;i++)frame();context.DuderLab.action('ragdoll');assert(context.DuderLab.physics.rigs[0].bodies.some(b=>b.velocity.length()>.01||b.angularVelocity.length()>.01));frame();pass('Playing animation releases physical linear or angular momentum');
press('m');clickControl(h=>h.action==='motionClip'&&h.value==='walk','Walk');press('g');assert.equal(ui.state.motionEnabled,true);assert.equal(ui.state.stats.count,16);assert.equal(renderer.last.length,16);assert.equal(Object.keys(ui.state.poseById).length,16);assert.equal(ui.state.stats.drawCalls,4);pass('Gallery previews all 16 animated duders in the same fill and outline batches');
press('b');assert.equal(ui.state.physicsMode,'pile');assert.equal(ui.state.motionEnabled,false);assert.equal(ui.state.showRig,false);assert.equal(ui.state.physicsStats.spawnCount,8);assert.equal(ui.state.stats.count,1);assert.equal(renderer.last.length,1);pass('B starts an eight-bean pile with one visible initial rig and seven pending');
for(let i=0;i<330;i++)frame();assert.equal(ui.state.physicsStats.rigCount,8);assert.equal(ui.state.physicsStats.bodies,56);assert.equal(ui.state.physicsStats.joints,48);assert.equal(ui.state.stats.count,8);assert.equal(renderer.last.length,8);assert.equal(ui.state.stats.drawCalls,4);assert(ui.state.physicsStats.maxJointError<.05);pass('Staggered spawn grows to eight colliding ragdolls while retaining four total draws',{jointGap:ui.state.physicsStats.maxJointError});
press(' ');const pileTime=context.DuderLab.physics.elapsed;for(let i=0;i<8;i++)frame();assert.equal(context.DuderLab.physics.elapsed,pileTime);press('x');assert.equal(ui.state.stats.drawCalls,5);pass('Pile pause and batched collider overlay work');
clickControl(h=>h.action==='pileCount'&&h.value===4,'Four beans');assert.equal(ui.state.pileCount,4);assert.equal(ui.state.physicsStats.spawnCount,4);assert.equal(ui.state.physicsStats.rigCount,1);press('d');assert.equal(ui.state.physicsStats.spawnCount,4);assert.equal(ui.state.physicsPaused,false);pass('Pile size control and refill preserve the requested count');
press('g');assert.equal(ui.state.physicsEnabled,false);assert.equal(ui.state.motionEnabled,false);assert.equal(ui.state.stats.count,16);pass('Leaving the pile restores the editable gallery');
assert.equal(logs.filter(x=>x.level==='error').length,0,JSON.stringify(logs));
const summary={purpose:'Pure JavaScript functional integration against actual app event handlers. WebGL is mocked; rendering and browser behavior are validated separately. No performance inference from synthetic frames.',passed:checks.length,checks,downloads:downloads.map(d=>({name:d.name,bytes:d.blob.size,mime:d.blob.type})),sourceHashes,errors:logs.filter(x=>x.level==='error')};
fs.writeFileSync(path.join(here,'app-events.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({passed:checks.length,downloads:summary.downloads,report:path.join(here,'app-events.json')}));
