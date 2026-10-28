/** Exercise the real arm-study boot, keyboard and GPU UI paths.
 * The WebGL transport is mocked to inspect actual draw submissions/resources.
 * Shader compilation and visual quality remain the separate GLES render test.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {mockGL} from './capture-frame.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(here,'../src');
const checks=[],sourceHashes={};
const pass=(name,details={})=>checks.push({name,passed:true,...details});
function emitter(object={}){
  const listeners=new Map();
  object.addEventListener=(type,fn)=>{const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);};
  object.dispatch=(type,event={})=>{event.type=type;event.preventDefault??=()=>{};event.target??=object;for(const fn of listeners.get(type)||[])fn(event);};
  return object;
}
async function boot({query='?qa=1',studyFlag=false,seedStorage=false}={}){
  const width=1440,height=1000,{gl}=mockGL(width,height),raf=[],errors=[];
  let now=0,timerSerial=0;
  const timers=new Map(),storage=new Map(),storageReads=[],storageWrites=[];
  const resources={buffers:0,textures:0,programs:0,geometryBuilds:0,rebuilds:0};
  for(const [method,key]of [['createBuffer','buffers'],['createTexture','textures'],['createProgram','programs']]){
    const real=gl[method];gl[method]=(...args)=>{resources[key]++;return real(...args);};
  }
  const canvas=emitter({tagName:'CANVAS',clientWidth:width,clientHeight:height,width,height,dataset:{},getContext:()=>gl,getBoundingClientRect:()=>({left:0,top:0,width,height}),focus(){},setPointerCapture(){}});
  const fallback={hidden:false,textContent:''};
  class FakeImage{
    set src(value){this._src=value;const bytes=Buffer.from(value.split(',')[1],'base64');this.width=bytes.readUInt32BE(16);this.height=bytes.readUInt32BE(20);queueMicrotask(()=>this.onload?.());}
    get src(){return this._src;}
  }
  const context=emitter({console:{log(){},warn(){},error(...args){errors.push(args.map(String).join(' '));}},
    document:{getElementById:id=>id==='duder'?canvas:fallback,createElement(){throw Error('Unexpected DOM creation during arm study');}},
    Image:FakeImage,devicePixelRatio:1,Float32Array,Uint8Array,Uint16Array,Uint32Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,URLSearchParams,
    location:{search:query},performance:{now:()=>now},queueMicrotask,
    localStorage:{getItem(key){storageReads.push(key);return storage.get(key)??null;},setItem(key,value){storageWrites.push(key);storage.set(key,String(value));}},
    setTimeout(fn,delay=0){const id=++timerSerial;timers.set(id,{fn,due:now+delay});return id;},clearTimeout(id){timers.delete(id);},requestAnimationFrame:fn=>raf.push(fn),cancelAnimationFrame(){},DuderArmStudyStart:studyFlag
  });
  context.window=context;context.globalThis=context;vm.createContext(context);
  for(const file of ['font-data.js','vendor-cannon.js','core.js','shell.js','geometry.js','collision-shapes.js','physics.js','animation.js','renderer.js','ui.js']){
    const code=fs.readFileSync(path.join(source,file),'utf8');sourceHashes[file]=crypto.createHash('sha256').update(code).digest('hex');vm.runInContext(code,context,{filename:file});
  }
  const RealRenderer=context.DuderRenderer,RealUI=context.DuderUI,realBuild=context.DuderGeometry.build;
  context.DuderGeometry.build=(...args)=>{resources.geometryBuilds++;return realBuild(...args);};
  context.DuderRenderer=class extends RealRenderer{
    constructor(...args){super(...args);context.testRenderer=this;}
    rebuild(...args){resources.rebuilds++;return super.rebuild(...args);}
  };
  context.DuderUI=class extends RealUI{constructor(...args){super(...args);context.testUI=this;}};
  let savedCollection=null;
  if(seedStorage){
    const recipes=context.DuderCore.presets();
    recipes[5]=context.DuderCore.sanitizeRecipe({...recipes[5],name:'Saved personal duder',height:1.17,hat:'chef',hatColor:[.8,.2,.4],glasses:'catEye',glassesColor:[.1,.5,.8],outfit:'overalls'});
    savedCollection=JSON.stringify({version:3,selected:5,recipes});storage.set('tront-duder-lab-v03',savedCollection);
  }
  const app=fs.readFileSync(path.join(source,'app.js'),'utf8');sourceHashes['app.js']=crypto.createHash('sha256').update(app).digest('hex');await vm.runInContext(app,context,{filename:'app.js'});
  const renderer=context.testRenderer,ui=context.testUI;
  assert(renderer&&ui&&fallback.hidden,'App initialization failed');
  function frame(capture=true){
    assert(raf.length,'App stopped scheduling frames');gl.captureDraws=capture;gl.draws.length=0;gl.drawCount=0;
    now+=1000/60;raf.shift()(now);
    for(const [id,timer]of [...timers])if(timer.due<=now){timers.delete(id);timer.fn();}
    assert(!canvas.dataset.error,canvas.dataset.error);assert.equal(errors.length,0,errors.join('\n'));
    return gl.draws.slice();
  }
  function key(value,target=canvas){context.dispatch('keydown',{key:value,shiftKey:false,target});return frame();}
  function click(hit){
    assert(hit,'Missing arm weight control');const e={clientX:hit.x+hit.w/2,clientY:hit.y+hit.h/2,pointerId:1,pointerType:'mouse',button:0};
    canvas.dispatch('pointerdown',{...e});canvas.dispatch('pointerup',{...e});return frame();
  }
  frame();
  return{context,renderer,ui,canvas,gl,resources,frame,key,click,storage,storageReads,storageWrites,savedCollection};
}

const normal=await boot();
assert.equal(normal.ui.state.mode,'gallery');assert.equal(normal.ui.state.motionEnabled,false);assert.equal(normal.ui.state.showArmWeights,false);
assert.equal(normal.context.DuderLab.recipes.length,16);assert.equal(normal.context.DuderCore.version,'3.4.6');
assert.equal(normal.renderer.program.uniforms.uArmWeights.value[0],0);
assert.deepEqual(JSON.parse(JSON.stringify(normal.context.DuderLab.recipes)),JSON.parse(JSON.stringify(normal.context.DuderCore.presets())));
pass('Normal startup retains the complete 16-duder collection and regular materials');
const saved=await boot({query:'',seedStorage:true});
assert.equal(saved.ui.state.mode,'gallery');assert.equal(saved.ui.state.selected,5);assert.equal(saved.ui.state.recipe.name,'Saved personal duder');
assert.equal(saved.ui.state.recipe.hat,'chef');assert.equal(saved.ui.state.recipe.outfit,'overalls');
assert.deepEqual(JSON.parse(JSON.stringify(saved.context.DuderLab.recipes)),JSON.parse(saved.savedCollection).recipes);
assert.equal(saved.storage.get('tront-duder-lab-v03'),saved.savedCollection);
pass('Regular startup restores saved selection, wardrobe, colors, outfits and body edits');

const sessions=[];
for(const spec of [{name:'query',query:'?armstudy',seedStorage:true},{name:'standalone-flag',query:'',studyFlag:true,seedStorage:true}]){
  const session=await boot(spec),{ui,renderer,context}=session,state=ui.state;
  assert.equal(state.mode,'focus');assert.equal(state.tab,'motion');assert.equal(state.panelOpen,true);assert.equal(state.selected,0);
  assert.equal(state.motionEnabled,true);assert.equal(state.motionClip,'wave');assert.equal(state.motionDuration,4);assert.equal(state.motionPlaying,true);
  assert.equal(state.physicsEnabled,false);assert.equal(state.showRig,false);assert.equal(state.showArmWeights,false);
  assert.equal(state.recipe.seed,1702468274);assert.equal(state.recipe.name,'Arm Study');assert.equal(state.recipe.hat,'beanie');assert.equal(state.recipe.pattern,0);assert.equal(state.recipe.outfit,'none');assert.equal(state.recipe.glasses,'none');
  const expected=context.DuderCore.sanitizeRecipe({...context.DuderCore.randomRecipe(1702468274),name:'Arm Study',pattern:0,outfit:'none',hat:'beanie',glasses:'none'});
  assert.deepEqual(JSON.parse(JSON.stringify(state.recipe)),JSON.parse(JSON.stringify(expected)));
  assert.equal(renderer.yaw,-.5);assert.equal(renderer.pitch,.06);assert.equal(renderer.zoom,1.25);
  assert.equal(state.stats.count,1);assert.equal(state.stats.drawCalls,4);assert(ui.hits.some(hit=>hit.key==='motion:weights'));
  pass(spec.name+' starts the exact wave study with its Motion controls and established camera',{seed:state.recipe.seed,triangles:renderer.triangles,drawCalls:state.stats.drawCalls});
  assert.equal(session.storageReads.length,0,'Arm study unexpectedly loaded the main saved collection');
  context.DuderLab.action('param',{key:'color',value:[.8,.3,.4]});
  for(let i=0;i<17;i++)session.frame(false);
  assert.deepEqual(session.storageWrites,['tront-duder-arm-study-v3-4-6']);
  assert.equal(session.storage.get('tront-duder-lab-v03'),session.savedCollection);
  assert.equal(JSON.parse(session.storage.get('tront-duder-arm-study-v3-4-6')).recipes[0].name,'Arm Study');
  pass(spec.name+' study edits persist separately and preserve the saved regular collection');
  sessions.push(session);
}

const session=sessions[0],{context,ui,renderer,resources}=session;
context.DuderLab.action('motionPause');ui.state.animate=false;
const plain=session.frame(),beforeResources={...resources},beforeGeometry=renderer.batchGeometry[0],beforeBuffers=renderer.buffers.slice();
const plainCharacter=plain.filter(draw=>draw.method==='drawElements');assert.equal(plainCharacter.length,2);
const recipeBefore=JSON.stringify(ui.state.recipe),poseBefore=JSON.stringify(ui.state.poseById[0].transforms.map(m=>Array.from(m)));
const weights=session.key('v');
assert.equal(ui.state.showArmWeights,true);assert.equal(renderer.program.uniforms.uArmWeights.value[0],1);
assert.equal(weights.length,plain.length);assert.equal(ui.state.stats.drawCalls,4);
assert.equal(renderer.batchGeometry[0],beforeGeometry);assert.deepEqual(renderer.buffers,beforeBuffers);assert.deepEqual(resources,beforeResources);
assert.equal(JSON.stringify(ui.state.recipe),recipeBefore);assert.equal(JSON.stringify(ui.state.poseById[0].transforms.map(m=>Array.from(m))),poseBefore);
const weightedCharacter=weights.filter(draw=>draw.method==='drawElements');assert.equal(weightedCharacter.length,2);
for(let i=0;i<2;i++){
  assert.equal(weightedCharacter[i].vs,plainCharacter[i].vs);assert.equal(weightedCharacter[i].fs,plainCharacter[i].fs);
  assert.deepEqual(weightedCharacter[i].attributes,plainCharacter[i].attributes);assert.deepEqual(weightedCharacter[i].indices,plainCharacter[i].indices);
  assert.deepEqual(weightedCharacter[i].uniforms.uVP,plainCharacter[i].uniforms.uVP);
  assert.equal(weightedCharacter[i].uniforms.uArmWeights.value[0],1);
}
pass('V enables the real weight-color uniform without rebuilding geometry, reallocating resources, changing pose, or adding a draw',{drawCalls:weights.length,indexedDrawCalls:weightedCharacter.length,geometryBytes:renderer.gpuGeometryBytes});
session.key('V');assert.equal(ui.state.showArmWeights,false);assert.equal(renderer.program.uniforms.uArmWeights.value[0],0);
session.click(ui.hits.find(hit=>hit.key==='motion:weights'));assert.equal(ui.state.showArmWeights,true);assert.equal(renderer.program.uniforms.uArmWeights.value[0],1);
session.key('v',{tagName:'INPUT'});assert.equal(ui.state.showArmWeights,true);
session.click(ui.hits.find(hit=>hit.key==='motion:weights'));assert.equal(ui.state.showArmWeights,false);
assert.deepEqual(resources,beforeResources);assert.equal(renderer.batchGeometry[0],beforeGeometry);assert.equal(ui.state.stats.drawCalls,4);
pass('Uppercase V and the Motion button toggle both ways; text input leaves the view alone');

const report={passed:true,version:'3.4.6',scope:'Real application boot, GPU UI and keyboard event wiring with captured WebGL draw submissions. Verifies no geometry rebuild, buffer/texture/program allocation or added draw for the weight view; actual GLSL execution is verified separately.',checks,sourceHashes};
const output=path.join(here,'arm-study-view-report.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,checks:checks.length,report:output}));
