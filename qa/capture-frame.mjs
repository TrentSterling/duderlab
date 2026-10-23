/** Capture the application's actual WebGL2 draw commands for offline EGL replay.
 * This is a code integration harness, not a browser or a substitute UI runtime.
 * Shader sources and buffers are taken directly from the shipped modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const sourceDir=path.resolve(here,'../src');
const DEFAULT_WIDTH=1440,DEFAULT_HEIGHT=1000;

const constants={
  VERTEX_SHADER:0x8B31,FRAGMENT_SHADER:0x8B30,COMPILE_STATUS:0x8B81,LINK_STATUS:0x8B82,
  ARRAY_BUFFER:0x8892,ELEMENT_ARRAY_BUFFER:0x8893,STATIC_DRAW:0x88E4,DYNAMIC_DRAW:0x88E8,
  FLOAT:0x1406,UNSIGNED_BYTE:0x1401,UNSIGNED_SHORT:0x1403,UNSIGNED_INT:0x1405,
  TEXTURE_2D:0x0DE1,TEXTURE0:0x84C0,RGBA:0x1908,RGBA8:0x8058,RGBA32F:0x8814,
  TEXTURE_MIN_FILTER:0x2801,TEXTURE_MAG_FILTER:0x2800,TEXTURE_WRAP_S:0x2802,TEXTURE_WRAP_T:0x2803,
  NEAREST:0x2600,LINEAR:0x2601,CLAMP_TO_EDGE:0x812F,REPEAT:0x2901,
  DEPTH_TEST:0x0B71,CULL_FACE:0x0B44,SCISSOR_TEST:0x0C11,BLEND:0x0BE2,
  BACK:0x0405,FRONT:0x0404,FRONT_AND_BACK:0x0408,LEQUAL:0x0203,LESS:0x0201,CCW:0x0901,
  TRIANGLES:0x0004,LINES:0x0001,LINE_STRIP:0x0003,
  SRC_ALPHA:0x0302,ONE_MINUS_SRC_ALPHA:0x0303,ONE:1,ZERO:0,
  COLOR_BUFFER_BIT:0x4000,DEPTH_BUFFER_BIT:0x0100,
  UNPACK_FLIP_Y_WEBGL:0x9240,UNPACK_PREMULTIPLY_ALPHA_WEBGL:0x9241,UNPACK_ALIGNMENT:0x0CF5,
  MAX_TEXTURE_SIZE:0x0D33,MAX_VERTEX_TEXTURE_IMAGE_UNITS:0x8B4C,MAX_TEXTURE_IMAGE_UNITS:0x8872,
  CURRENT_PROGRAM:0x8B8D,VERTEX_ARRAY_BINDING:0x85B5,VIEWPORT:0x0BA2,
  ACTIVE_TEXTURE:0x84E0,TEXTURE_BINDING_2D:0x8069,ARRAY_BUFFER_BINDING:0x8894,ELEMENT_ARRAY_BUFFER_BINDING:0x8895,
  NO_ERROR:0
};
const clone=v=>JSON.parse(JSON.stringify(v));
function rawBytes(view){
  if(view==null)return Buffer.alloc(0);
  if(typeof view==='number')return Buffer.alloc(view);
  if(ArrayBuffer.isView(view))return Buffer.from(new Uint8Array(view.buffer,view.byteOffset,view.byteLength));
  if(Object.prototype.toString.call(view)==='[object ArrayBuffer]')return Buffer.from(new Uint8Array(view));
  throw new Error('Unsupported buffer data type: '+Object.prototype.toString.call(view));
}

export function mockGL(width,height){
  let serial=0,program=null,arrayBuffer=null,defaultElements=null,vao=null,activeUnit=0;
  const boundTextures=new Map(),draws=[],pixelStore={};
  const state={viewport:[0,0,width,height],depthTest:false,depthMask:true,depthFunc:constants.LESS,cullFaceEnabled:false,cullFace:constants.BACK,blend:false,blendFunc:[constants.ONE,constants.ZERO],scissorTest:false};
  const clear={color:[0,0,0,0],depth:1};
  const create=kind=>({id:++serial,kind});
  const gl={...constants,draws,state,clear,captureDraws:true,drawCount:0,
    createShader(type){return {...create('shader'),type,source:''};},shaderSource(s,source){s.source=source;},compileShader(){},getShaderParameter(){return true;},getShaderInfoLog(){return '';},deleteShader(){},
    createProgram(){return {...create('program'),shaders:[],uniforms:{}};},attachShader(p,s){p.shaders.push(s);},linkProgram(){},getProgramParameter(){return true;},getProgramInfoLog(){return '';},deleteProgram(){},useProgram(p){program=p;},
    getUniformLocation(p,name){return {program:p,name};},
    createVertexArray(){return {...create('vao'),attributes:{},elementBuffer:null};},bindVertexArray(v){vao=v;},deleteVertexArray(){},
    createBuffer(){return {...create('buffer'),data:Buffer.alloc(0)};},
    bindBuffer(target,b){if(target===constants.ARRAY_BUFFER)arrayBuffer=b;else if(target===constants.ELEMENT_ARRAY_BUFFER){if(vao)vao.elementBuffer=b;else defaultElements=b;}else throw Error('Unexpected buffer target '+target);},deleteBuffer(){},
    bufferData(target,data,usage){const buffer=target===constants.ARRAY_BUFFER?arrayBuffer:target===constants.ELEMENT_ARRAY_BUFFER?(vao?vao.elementBuffer:defaultElements):null;if(!buffer)throw Error('No bound buffer for target '+target);buffer.data=rawBytes(data);buffer.usage=usage;},
    enableVertexAttribArray(loc){if(!vao)throw Error('Attribute without VAO');vao.attributes[loc]??={};vao.attributes[loc].enabled=true;},
    disableVertexAttribArray(loc){if(vao?.attributes[loc])vao.attributes[loc].enabled=false;},
    vertexAttribPointer(loc,size,type,normalized,stride,offset){if(!vao||!arrayBuffer)throw Error('Attribute pointer missing VAO or buffer');vao.attributes[loc]={...vao.attributes[loc],buffer:arrayBuffer,size,type,normalized,stride,offset};},
    createTexture(){return {...create('texture'),parameters:{}};},bindTexture(target,t){if(target!==constants.TEXTURE_2D)throw Error('Unexpected texture target');boundTextures.set(activeUnit,t);},deleteTexture(){},
    activeTexture(unit){activeUnit=unit-constants.TEXTURE0;},
    texParameteri(target,pname,value){const t=boundTextures.get(activeUnit);if(t)t.parameters[pname]=value;},
    pixelStorei(pname,value){pixelStore[pname]=value;},
    texImage2D(...args){
      const t=boundTextures.get(activeUnit);if(!t)throw Error('No bound texture');
      if(args.length===9){const [target,level,internalFormat,w,h,border,format,type,data]=args;Object.assign(t,{target,level,internalFormat,width:w,height:h,format,type,encoding:type===constants.FLOAT?'float32':'uint8',data:rawBytes(data).toString('base64')});}
      else if(args.length===6){const [target,level,internalFormat,format,type,img]=args;if(!img.src?.startsWith('data:image/png;base64,'))throw Error('Expected embedded PNG');Object.assign(t,{target,level,internalFormat,width:img.width,height:img.height,format,type,encoding:'png',data:img.src.split(',')[1]});}
      else throw Error('Unexpected texImage2D arity '+args.length);
      t.flipY=!!pixelStore[constants.UNPACK_FLIP_Y_WEBGL];t.premultiplyAlpha=!!pixelStore[constants.UNPACK_PREMULTIPLY_ALPHA_WEBGL];
    },
    texSubImage2D(target,level,x,y,w,h,format,type,data){
      const t=boundTextures.get(activeUnit);if(x!==0||y!==0||t.width!==w||t.height!==h)throw Error('Partial texture updates not supported by this capture');
      Object.assign(t,{target,level,width:w,height:h,format,type,encoding:type===constants.FLOAT?'float32':'uint8',data:rawBytes(data).toString('base64')});
    },
    clearColor(...c){clear.color=c;},clearDepth(d){clear.depth=d;},clear(mask){clear.mask=mask;},
    viewport(...v){state.viewport=v;},depthMask(v){state.depthMask=!!v;},depthFunc(v){state.depthFunc=v;},cullFace(v){state.cullFace=v;},blendFunc(...v){state.blendFunc=v;},frontFace(v){state.frontFace=v;},
    enable(cap){switch(cap){case constants.DEPTH_TEST:state.depthTest=true;break;case constants.CULL_FACE:state.cullFaceEnabled=true;break;case constants.BLEND:state.blend=true;break;case constants.SCISSOR_TEST:state.scissorTest=true;break;default:throw Error('Unknown enable '+cap);}},
    disable(cap){switch(cap){case constants.DEPTH_TEST:state.depthTest=false;break;case constants.CULL_FACE:state.cullFaceEnabled=false;break;case constants.BLEND:state.blend=false;break;case constants.SCISSOR_TEST:state.scissorTest=false;break;default:throw Error('Unknown disable '+cap);}},
    isEnabled(cap){return cap===constants.DEPTH_TEST?state.depthTest:cap===constants.CULL_FACE?state.cullFaceEnabled:cap===constants.BLEND?state.blend:state.scissorTest;},
    getError(){return 0;},
    getParameter(p){switch(p){case constants.MAX_TEXTURE_SIZE:return 16384;case constants.MAX_VERTEX_TEXTURE_IMAGE_UNITS:case constants.MAX_TEXTURE_IMAGE_UNITS:return 32;case constants.CURRENT_PROGRAM:return program;case constants.VERTEX_ARRAY_BINDING:return vao;case constants.VIEWPORT:return state.viewport;case constants.ACTIVE_TEXTURE:return constants.TEXTURE0+activeUnit;case constants.TEXTURE_BINDING_2D:return boundTextures.get(activeUnit);case constants.ARRAY_BUFFER_BINDING:return arrayBuffer;case constants.ELEMENT_ARRAY_BUFFER_BINDING:return vao?vao.elementBuffer:defaultElements;default:throw Error('Unhandled getParameter '+p);}},
    drawArrays(mode,first,count){
      if(!program)throw Error('drawArrays without program');
      gl.drawCount++;if(!gl.captureDraws)return;
      recordDraw({method:'drawArrays',mode,first,count,vertexCount:count,uniqueVertices:count});
    },
    drawElements(mode,count,type,offset){
      if(!program)throw Error('drawElements without program');
      const buffer=vao?vao.elementBuffer:defaultElements;if(!buffer)throw Error('drawElements without ELEMENT_ARRAY_BUFFER');
      gl.drawCount++;if(!gl.captureDraws)return;
      const bytes=type===constants.UNSIGNED_INT?4:type===constants.UNSIGNED_SHORT?2:type===constants.UNSIGNED_BYTE?1:0;
      if(!bytes||offset%bytes!==0||offset<0||count<0||offset+count*bytes>buffer.data.length)throw Error('Invalid element type, offset or count');
      const packed=buffer.data.subarray(offset,offset+count*bytes),used=new Set();let vertexCount=0;
      for(let i=0;i<count;i++){const index=packed.readUIntLE(i*bytes,bytes);used.add(index);vertexCount=Math.max(vertexCount,index+1);}
      recordDraw({method:'drawElements',mode,first:0,count,vertexCount,uniqueVertices:used.size,indices:{type,encoding:'uint'+bytes*8,offset:0,data:packed.toString('base64')}});
    }
  };
  function recordDraw(spec){
    const attributes=[];
    for(const [location,a] of Object.entries(vao?.attributes||{})){
      if(!a.enabled)continue;if(a.type!==constants.FLOAT)throw Error('Nonfloat attribute not supported');
      const stride=a.stride||a.size*4,packed=Buffer.alloc(spec.vertexCount*a.size*4),src=a.buffer.data;
      for(let i=0;i<spec.vertexCount;i++){
        const off=a.offset+(spec.first+i)*stride;if(off+a.size*4>src.length)throw Error('Attribute buffer overrun');src.copy(packed,i*a.size*4,off,off+a.size*4);
      }
      attributes.push({loc:Number(location),size:a.size,type:a.type,normalized:a.normalized,encoding:'float32',data:packed.toString('base64')});
    }
    const textures=[];for(const [unit,t]of boundTextures)if(t?.width)textures.push({unit,target:t.target,internalFormat:t.internalFormat,format:t.format,type:t.type,width:t.width,height:t.height,encoding:t.encoding,data:t.data,parameters:{...t.parameters},flipY:!!t.flipY,premultiplyAlpha:!!t.premultiplyAlpha});
    draws.push({vs:program.shaders.find(s=>s.type===constants.VERTEX_SHADER)?.source,fs:program.shaders.find(s=>s.type===constants.FRAGMENT_SHADER)?.source,uniforms:clone(program.uniforms),attributes,textures,state:clone(state),...spec,first:0});
  }
  for(const type of ['1i','1f','2f','3f','4f','1iv','2iv','3iv','4iv','1fv','2fv','3fv','4fv'])gl['uniform'+type]=(loc,...value)=>{if(!loc)return;loc.program.uniforms[loc.name]={type,value:type.endsWith('v')?Array.from(value[0]):value};};
  gl.uniformMatrix4fv=(loc,transpose,value)=>{loc.program.uniforms[loc.name]={type:'Matrix4fv',transpose:!!transpose,value:Array.from(value)};};
  return {gl,draws,clear};
}

export async function createCaptureSession(options={}){
  const width=options.width||DEFAULT_WIDTH,height=options.height||DEFAULT_HEIGHT;
  const {gl,draws,clear}=mockGL(width,height),canvas={clientWidth:width,clientHeight:height,width,height,getContext(name){if(name!=='webgl2')throw Error(name);return gl;}};
  class FakeImage {
    set src(value){this._src=value;const bytes=Buffer.from(value.split(',')[1],'base64');this.width=bytes.readUInt32BE(16);this.height=bytes.readUInt32BE(20);queueMicrotask(()=>this.onload?.());}
    get src(){return this._src;}
  }
  const context={console,Float32Array,Float64Array,Int32Array,Uint8Array,Uint16Array,Uint32Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,Image:FakeImage,devicePixelRatio:1,performance,queueMicrotask,setTimeout,clearTimeout,document:{createElement(){throw Error('Unexpected DOM creation');}}};
  context.window=context;context.globalThis=context;vm.createContext(context);
  const sourceHashes={},modules=['font-data.js','core.js','shell.js','geometry.js','animation.js'];
  if(options.physicsMode){modules.push('vendor-cannon.js');if(fs.existsSync(path.join(sourceDir,'collision-shapes.js')))modules.push('collision-shapes.js');modules.push('physics.js');}
  modules.push('renderer.js','ui.js');
  for(const name of modules){
    const text=fs.readFileSync(path.join(sourceDir,name),'utf8');sourceHashes[name]=crypto.createHash('sha256').update(text).digest('hex');vm.runInContext(text,context,{filename:name});
  }
  const recipes=context.DuderCore.presets(),selected=options.selected??0,mode=options.physicsMode||options.motionClip?'focus':options.mode||'gallery';
  if(options.recipe)recipes[selected]=context.DuderCore.sanitizeRecipe({...recipes[selected],...options.recipe});
  const ids=options.physicsMode==='sumo'?[selected,(selected+1)%16]:options.physicsMode==='pile'?Array.from({length:options.pileCount||8},(_,i)=>(selected+i)%16):mode==='focus'?[selected]:recipes.map((_,i)=>i);
  const state={tab:options.tab||(options.physicsMode?'physics':options.motionClip?'motion':'shape'),mode,selected,panelOpen:!!options.panelOpen,helpOpen:false,autoSpin:false,animate:options.animate!==false,smooth:options.smooth!==false,wireframe:!!options.wireframe,outlines:options.outlines!==false,outlineWidth:options.outlineWidth??2.2,projectionStrength:options.projectionStrength??.55,showRig:options.showRig??(!!options.physicsMode&&options.physicsMode!=='pile'),physicsEnabled:!!options.physicsMode,physicsMode:options.physicsMode||'ragdoll',physicsPaused:false,pileCount:options.pileCount||8,motionEnabled:!!options.motionClip,motionClip:options.motionClip||'idle',motionTime:0,motionSpeed:options.motionSpeed??1,motionAmplitude:options.motionAmplitude??1,motionPlaying:true,poseById:{},toast:'',dt:0,stats:{count:ids.length,totalCount:16,drawCalls:4,triangles:0,fps:0,offlineCapture:true}};
  const renderer=new context.DuderRenderer(canvas),ui=new context.DuderUI(gl,canvas,()=>{});await ui.ready;
  let physics=null,simulationTime=0;
  if(options.physicsMode){
    physics=new context.DuderPhysics();
    if(options.physicsMode==='sumo')physics.startSumo(recipes[ids[0]],recipes[ids[1]]);
    else if(options.physicsMode==='pile')physics.startPile(ids.map(id=>recipes[id]),{count:ids.length});
    else physics.reset(recipes[selected],{height:options.dropHeight??.8,tumble:options.tumble??true});
    physics.setGravity(options.gravity??9.81);physics.setDamping(options.damping??.18);
  }
  state.recipe=recipes[selected];ui.state=state;renderer.frame(state);
  if(options.yaw!==undefined)renderer.yaw=options.yaw;if(options.pitch!==undefined)renderer.pitch=options.pitch;if(options.zoom!==undefined)renderer.zoom=options.zoom;
  let activeCount=physics?physics.rigs.length:ids.length;
  renderer.rebuild(recipes,mode,selected,ids.slice(0,activeCount));
  const viewport=options.onlyScene?{x:0,y:0,w:width,h:height}:ui.getViewport(width,height);
  function frame(time=0){
    if(time<simulationTime-1e-7)throw Error('Capture time must increase within a session');
    if(physics){
      const goal=Math.round(time*120);while(Math.round(simulationTime*120)<goal){physics.step(1/120);simulationTime+=1/120;}
      if(activeCount!==physics.rigs.length){activeCount=physics.rigs.length;renderer.rebuild(recipes,mode,selected,ids.slice(0,activeCount));}
      state.poseById={};ids.slice(0,activeCount).forEach((id,i)=>state.poseById[id]=physics.poseTransforms(i,state.showRig));
      const st=physics.stats;state.physicsStats={...st,sleeping:st.sleeping===st.bodies,winner:st.winner===-2?'Draw':st.winner>=0?recipes[ids[st.winner]].name:null};
      state.physicsSettings={gravity:physics.gravity,damping:physics.damping};
    }else if(state.motionEnabled){
      state.motionTime=time*state.motionSpeed;state.poseById={};
      for(const id of ids)state.poseById[id]=context.DuderAnimation.sample(recipes[id],state.motionClip,state.motionTime,{amplitude:state.motionAmplitude});
      state.motionDuration=context.DuderAnimation.clips.find(c=>c.id===state.motionClip).duration;state.motionProgress=(state.motionTime%state.motionDuration)/state.motionDuration;
    }
    draws.length=0;gl.drawCount=0;renderer.draw(state,recipes,time,viewport);
    state.stats.count=activeCount;state.stats.triangles=renderer.triangles;state.stats.drawCalls=renderer.drawCalls+(options.onlyScene?0:1);state.stats.vertices=renderer.vertexCount;state.stats.expandedVertices=renderer.expandedVertexCount;state.stats.indices=renderer.indexCount;state.stats.geometryBytes=renderer.gpuGeometryBytes;state.labels=renderer.labels(recipes,mode,selected);
    if(!options.onlyScene)ui.draw(state,width,height);
    const expected=2+(state.outlines?1:0)+((state.physicsEnabled||state.motionEnabled)&&state.showRig?1:0)+(options.onlyScene?0:1);
    if(draws.length!==expected)throw Error('Expected '+expected+' draw calls, received '+draws.length);
    return {version:3,purpose:'Actual application draw commands for offline EGL shader replay; not browser execution',width,height,mode,selected,physicsMode:options.physicsMode||null,motionClip:options.motionClip||null,simulationTime:physics?Number(simulationTime.toFixed(6)):time,viewport,sourceHashes,recipe:state.recipe,stats:clone(state.stats),physicsStats:state.physicsStats?clone(state.physicsStats):null,clear:clone(clear),draws:draws.slice()};
  }
  return {frame,renderer,physics,ui,state,recipes,sourceHashes};
}

export async function capture(options={}){
  const session=await createCaptureSession(options),data=session.frame(options.time||0);
  const defaultName=options.physicsMode?options.physicsMode+'-'+String(options.time||0).replace('.','_'):options.mode||'gallery';
  const out=options.output||path.join(here,`capture-${options.name||defaultName}.json`);
  if(options.write!==false){fs.writeFileSync(out,JSON.stringify(data));console.log(JSON.stringify({path:out,mode:data.mode,physicsMode:data.physicsMode,selected:data.selected,time:data.simulationTime,width:data.width,height:data.height,draws:data.draws.length,triangles:data.stats.triangles,bytes:fs.statSync(out).size}));}
  return data;
}

function deltaDraws(previous,current){return current.map((d,i)=>{const p=previous[i],diff={};for(const [key,value]of Object.entries(d)){if(!p||JSON.stringify(p[key])!==JSON.stringify(value))diff[key]=value;}return diff;});}
async function streamMovie(){
  const mode=process.argv[process.argv.indexOf('--stream')+1]||'sumo';
  const frames=Number(process.env.DUDER_CAPTURE_FRAMES||96),fps=Number(process.env.DUDER_CAPTURE_FPS||12);
  const motion=['idle','walk','wave','dance'].includes(mode);
  const session=await createCaptureSession({physicsMode:motion?null:mode,motionClip:motion?mode:null,selected:Number(process.env.DUDER_CAPTURE_SELECTED||0),width:Number(process.env.DUDER_CAPTURE_WIDTH||800),height:Number(process.env.DUDER_CAPTURE_HEIGHT||600),onlyScene:process.env.DUDER_CAPTURE_SCENE_ONLY==='1',tab:motion?'motion':'physics'});
  let previous;
  for(let i=0;i<frames;i++){
    const data=session.frame(i/fps);
    if(!previous)await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify({frame:i,fps,trace:data})+'\n',error=>error?reject(error):resolve()));
    else await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify({frame:i,fps,patch:{draws:deltaDraws(previous.draws,data.draws),stats:data.stats,physicsStats:data.physicsStats,simulationTime:data.simulationTime}})+'\n',error=>error?reject(error):resolve()));
    previous=data;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--stream'))await streamMovie();
  else if(process.argv.includes('--physics')){
    for(const physicsMode of ['ragdoll','sumo']){
      const session=await createCaptureSession({physicsMode});
      for(const time of [0,1.5,4]){
        const data=session.frame(time),out=path.join(here,`capture-${physicsMode}-${String(time).replace('.','_')}.json`);fs.writeFileSync(out,JSON.stringify(data));
        console.log(JSON.stringify({path:out,mode:physicsMode,time,draws:data.draws.length,triangles:data.stats.triangles,physicsStats:data.physicsStats}));
      }
    }
  }else{
    await capture({mode:'gallery',selected:0});
    await capture({mode:'focus',selected:0,name:'focus-00'});
    await capture({mode:'focus',selected:15,name:'focus'});
    await capture({mode:'focus',selected:0,width:390,height:844,name:'mobile'});
  }
}
