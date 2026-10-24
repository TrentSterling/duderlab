/* Duder Lab application — local recipes, direct manipulation, and portable exports. */
(async()=>{
  'use strict';
  const canvas=document.getElementById('duder'),fallback=document.getElementById('fallback');
  const errors=[];window.addEventListener('error',e=>{errors.push(e.message);canvas.dataset.error=e.message;});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const STORAGE='tront-duder-lab-v03';
  let recipes=DuderCore.presets();
  let state={tab:'shape',mode:'gallery',selected:0,panelOpen:false,helpOpen:false,autoSpin:false,animate:true,smooth:true,wireframe:false,outlines:true,outlineWidth:2.2,projectionStrength:.55,physicsEnabled:false,physicsMode:'ragdoll',physicsPaused:false,physicsSettings:{gravity:9.81,damping:.18},physicsStats:{bodies:7,joints:6,maxJointError:0,sleeping:false},pileCount:8,motionEnabled:false,motionClip:'idle',motionTime:0,motionSpeed:1,motionAmplitude:1,motionPlaying:true,showRig:true,poseById:{},toast:'',dt:0,stats:{count:16,drawCalls:3,triangles:0,fps:0}};
  const search=new URLSearchParams(location.search),isQA=search.has('qa');
  try{if(!isQA){const old=JSON.parse(localStorage.getItem(STORAGE)||localStorage.getItem('tront-duder-lab-v02')||localStorage.getItem('tront-duder-lab-v01')||'null');if(old&&[1,2,3].includes(old.version)&&Array.isArray(old.recipes)&&old.recipes.length===16){recipes=old.recipes.map(DuderCore.sanitizeRecipe);state.selected=clamp(old.selected|0,0,15);}}}catch(e){/* Local storage can be unavailable for file://. Explicit recipe export remains usable. */}
  if(search.get('focus')){state.mode='focus';state.selected=clamp(parseInt(search.get('focus'))||0,0,15);}
  let renderer,ui,physics=null,physicsIds=[],activePhysicsCount=0,dirty=true,storageTimer,toastUntil=0,frames=0,lastTime=performance.now(),fpsAccum=0,fpsCount=0,fpsTime=0,clock=0;
  const toast=(s)=>{state.toast=s;toastUntil=performance.now()+3500;};
  const persist=()=>{clearTimeout(storageTimer);storageTimer=setTimeout(()=>{try{localStorage.setItem(STORAGE,JSON.stringify({version:3,selected:state.selected,recipes}));}catch(e){}},250);};
  function download(bytes,mime,name){const url=URL.createObjectURL(new Blob([bytes],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);}
  function safeName(s){return String(s||'duder').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-|-$/g,'');}
  async function exportGLB(){
    try{
      const r=recipes[state.selected],g=DuderGeometry.build(r,state.selected),pose=(state.physicsEnabled||state.motionEnabled)?state.poseById[state.selected]:null,baked=DuderCore.bake(g,r,state.smooth,pose?{...pose,projectionStrength:state.projectionStrength}:null),bytes=DuderCore.glb(baked,r);
      download(bytes,'model/gltf-binary',safeName(r.name)+(pose?'-pose':'')+'.glb');toast((pose?'Posed GLB exported: ':'Rest GLB exported: ')+baked.triangles.toLocaleString()+' triangles');
      canvas.dataset.lastExport=JSON.stringify({type:'glb',bytes:bytes.byteLength,triangles:baked.triangles,name:r.name});
    }catch(e){console.error(e);toast('Export failed: '+e.message);}
  }
  function exportRecipe(){const text=JSON.stringify({format:'duder-lab',version:3,selected:state.selected,recipes},null,2);download(text,'application/json','duder-recipes-v3.json');toast('Saved all 16 recipes');}
  function importRecipe(){
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
    input.onchange=async()=>{
      try{const f=input.files[0];if(!f)return;if(f.size>1000000)throw Error('Recipe file is too large');const data=JSON.parse(await f.text());
        if(Array.isArray(data.recipes)){if(!data.recipes.length||data.recipes.length>16)throw Error('Expected 1 to 16 recipes');data.recipes.forEach((r,i)=>recipes[i]=DuderCore.sanitizeRecipe(r));state.selected=clamp(data.selected|0,0,15);}
        else if(data.recipe){recipes[state.selected]=DuderCore.sanitizeRecipe(data.recipe);}
        else if(data&&typeof data==='object'&&('height'in data||'color'in data)){recipes[state.selected]=DuderCore.sanitizeRecipe(data);}
        else throw Error('This is not a duder recipe');dirty=true;if(state.physicsEnabled)startPhysics(state.physicsMode,false);persist();toast('Recipes restored');
      }catch(e){toast('Could not import: '+e.message);}finally{input.remove();}
    };input.click();
  }
  function updatePhysicsState(){
    if(!state.physicsEnabled||!physics)return;
    if(activePhysicsCount!==physics.rigs.length){activePhysicsCount=physics.rigs.length;dirty=true;}
    state.poseById={};physicsIds.slice(0,activePhysicsCount).forEach((id,i)=>state.poseById[id]=physics.poseTransforms(i,state.showRig));
    const raw=physics.stats;state.physicsStats={...raw,sleeping:raw.sleeping===raw.bodies,
      winner:raw.winner===-2?'Draw':Number.isInteger(raw.winner)&&raw.winner>=0?recipes[physicsIds[raw.winner]]?.name:null};
  }
  function updateMotionState(){
    if(!state.motionEnabled)return;
    const ids=state.mode==='focus'?[state.selected]:recipes.map((_,i)=>i);
    state.poseById={};for(const id of ids)state.poseById[id]=DuderAnimation.sample(recipes[id],state.motionClip,state.motionTime,{amplitude:state.motionAmplitude});
    const clip=DuderAnimation.clips.find(c=>c.id===state.motionClip)||DuderAnimation.clips[0];state.motionDuration=clip.duration;state.motionProgress=((state.motionTime%clip.duration)+clip.duration)%clip.duration/clip.duration;
  }
  function startMotion(clip=state.motionClip,frame=true){
    if(!state.motionEnabled)state.showRig=false;if(state.physicsEnabled)stopPhysics();state.motionEnabled=true;state.motionClip=clip;state.motionTime=0;state.motionPlaying=true;state.mode='focus';state.tab='motion';state.autoSpin=false;
    updateMotionState();dirty=true;if(frame)renderer.frame(state);
  }
  function startPhysics(mode,frame=true,fromMotion=false){
    const pose=fromMotion&&state.motionEnabled?DuderAnimation.sample(recipes[state.selected],state.motionClip,state.motionTime,{amplitude:state.motionAmplitude}):null;
    const previousPose=pose?DuderAnimation.sample(recipes[state.selected],state.motionClip,state.motionTime-(state.motionPlaying?state.motionSpeed/120:0),{amplitude:state.motionAmplitude}):null;
    physics??=new DuderPhysics();physics.endGrab();state.physicsMode=mode;state.physicsEnabled=true;state.physicsPaused=false;
    state.motionEnabled=false;state.mode='focus';state.tab='physics';state.autoSpin=false;
    if(mode==='pile')state.showRig=false;
    physicsIds=mode==='sumo'?[state.selected,(state.selected+1)%recipes.length]:mode==='pile'?Array.from({length:state.pileCount},(_,i)=>(state.selected+i)%recipes.length):[state.selected];
    if(mode==='sumo')physics.startSumo(recipes[physicsIds[0]],recipes[physicsIds[1]]);
    else if(mode==='pile')physics.startPile(physicsIds.map(id=>recipes[id]),{count:state.pileCount});
    else physics.reset(recipes[state.selected],pose?{pose,previousPose,poseDt:1/120}:{height:.8,tumble:true});
    physics.setGravity(state.physicsSettings.gravity);physics.setDamping(state.physicsSettings.damping);physics.setPaused(false);
    updatePhysicsState();dirty=true;if(frame)renderer.frame(state);
  }
  function stopPhysics(){if(physics)physics.endGrab();state.physicsEnabled=false;state.physicsPaused=false;state.poseById={};physicsIds=[];activePhysicsCount=0;dirty=true;}
  function frameView(){
    renderer.frame(state);
    if(state.physicsEnabled&&state.physicsMode==='pile'){
      const bounds=physics.stats.bounds;if(bounds){const c=bounds.center||bounds.min.map((v,i)=>(v+bounds.max[i])/2);renderer.target=[c[0],Math.max(.8,c[1]),c[2]];renderer.zoom=Math.min(1,4/Math.max(4,bounds.max[0]-bounds.min[0],bounds.max[2]-bounds.min[2],bounds.max[1]-bounds.min[1]));}
    }else if(state.physicsEnabled&&state.physicsMode!=='sumo'){
      const p=state.poseById[state.selected]?.center;if(p){renderer.target=[p[0],clamp(p[1],.7,1.4),p[2]];if(p[1]>2)renderer.zoom=.8;}
    }
  }
  function action(name,value){
    if(name==='param'){
      const r={...recipes[state.selected],[value.key]:value.value};recipes[state.selected]=DuderCore.sanitizeRecipe(r);
      if(!['color','accent','roughness','pattern','patternScale','seed'].includes(value.key))dirty=true;
      if(state.physicsEnabled&&['height','width','depth','belly','armLength','armSpread','armThickness','armGap','feet','blend'].includes(value.key))startPhysics(state.physicsMode,false);
      persist();
    }else if(name==='tab'){if(value==='motion'&&!state.motionEnabled)startMotion();else state.tab=value;}
    else if(name==='mode'){if(state.physicsEnabled)stopPhysics();state.mode=value;dirty=true;renderer.frame(state);}
    else if(name==='select'){state.selected=((value|0)+16)%16;if(state.physicsEnabled)startPhysics(state.physicsMode);else if(state.mode==='focus')dirty=true;persist();}
    else if(name==='randomizeAll'){let seed=(Date.now()^Math.floor(performance.now()*1000))>>>0;recipes=Array.from({length:16},(_,i)=>DuderCore.randomRecipe(seed+i*104729));dirty=true;if(state.physicsEnabled)startPhysics(state.physicsMode);persist();toast('New batch. Every duder stays editable.');}
    else if(name==='randomize'){recipes[state.selected]=DuderCore.randomRecipe((Date.now()+Math.floor(performance.now()*1000))>>>0);dirty=true;if(state.physicsEnabled)startPhysics(state.physicsMode);persist();toast('Duder rerolled');}
    else if(name==='toggle')state[value]=!state[value];
    else if(name==='viewParam'){if(value.key==='outlineWidth')state.outlineWidth=clamp(value.value,.8,4);if(value.key==='projectionStrength')state.projectionStrength=clamp(value.value,0,1);}
    else if(name==='motion'){startMotion();toast('Choose a clip, scrub the pose, or release it to physics.');}
    else if(name==='motionClip'){startMotion(value,false);}
    else if(name==='motionPause'){state.motionPlaying=!state.motionPlaying;}
    else if(name==='motionReset'){state.motionTime=0;updateMotionState();}
    else if(name==='motionParam'){
      if(value.key==='motionSpeed')state.motionSpeed=clamp(value.value,.25,2);
      else if(value.key==='motionAmplitude')state.motionAmplitude=clamp(value.value,.25,1.25);
      else if(value.key==='motionProgress'){state.motionPlaying=false;state.motionTime=clamp(value.value,0,1)*(state.motionDuration||1);}
      updateMotionState();
    }
    else if(name==='ragdoll'){const handingOff=state.motionEnabled;startPhysics('ragdoll',!handingOff,handingOff);toast(handingOff?'Released the current pose and momentum to physics.':'Left-drag a body to grab. Right-drag to orbit.');}
    else if(name==='sumo'){startPhysics('sumo');toast('Two active ragdolls. X shows the rig; Space pauses.');}
    else if(name==='pile'){startPhysics('pile');toast('Beans incoming. Grab one from the pile; B refills it.');}
    else if(name==='pileCount'){state.pileCount=clamp(Math.round(Number(value)||8),4,16);if(state.physicsEnabled&&state.physicsMode==='pile')startPhysics('pile');}
    else if(name==='physicsPause'){if(state.physicsEnabled){state.physicsPaused=!state.physicsPaused;physics.setPaused(state.physicsPaused);}}
    else if(name==='physicsReset'){if(state.physicsEnabled){startPhysics(state.physicsMode);if(state.physicsMode==='ragdoll'){physics.reset(recipes[state.selected],{height:.03,tumble:false});physics.setGravity(state.physicsSettings.gravity);physics.setDamping(state.physicsSettings.damping);updatePhysicsState();}}}
    else if(name==='physicsDrop'){if(state.physicsEnabled){physics.drop();state.physicsPaused=false;physics.setPaused(false);updatePhysicsState();frameView();}}
    else if(name==='physicsKick'){if(state.physicsEnabled){physics.kick();state.physicsPaused=false;physics.setPaused(false);}}
    else if(name==='physicsExit'){stopPhysics();state.tab='shape';renderer.frame(state);}
    else if(name==='paramPhysics'){
      if(value.key==='gravity'){state.physicsSettings.gravity=clamp(value.value,0,15);physics?.setGravity(state.physicsSettings.gravity);}
      else if(value.key==='damping'){state.physicsSettings.damping=clamp(value.value,0,.6);physics?.setDamping(state.physicsSettings.damping);}
    }
    else if(name==='help')state.helpOpen=!state.helpOpen;
    else if(name==='togglePanel')state.panelOpen=!state.panelOpen;
    else if(name==='frame')frameView();
    else if(name==='exportGLB')exportGLB();
    else if(name==='exportRecipe')exportRecipe();
    else if(name==='importRecipe')importRecipe();
    else if(name==='reset'){stopPhysics();state.motionEnabled=false;recipes=DuderCore.presets();state.selected=0;dirty=true;renderer.frame(state);persist();toast('Original 16 restored');}
    else if(name==='screenshot'){canvas.toBlob(b=>{if(b)download(b,'image/png','duder-lab-v3-2-1.png');});}
    state.recipe=recipes[state.selected];
  }
  try{
    renderer=new DuderRenderer(canvas);ui=new DuderUI(renderer.gl,canvas,action);await ui.ready;state.recipe=recipes[state.selected];ui.state=state;fallback.hidden=true;
  }catch(e){console.error(e);fallback.textContent=e.message;fallback.hidden=false;canvas.dataset.error=e.message;return;}
  if(search.has('pile'))startPhysics('pile');else if(search.has('sumo'))startPhysics('sumo');else if(search.has('ragdoll'))startPhysics('ragdoll');else if(search.has('motion'))startMotion(DuderAnimation.clips.some(c=>c.id===search.get('motion'))?search.get('motion'):'wave');
  let pointer=null,pinch=null;const touchPoints=new Map();
  function xy(e){const r=canvas.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top];}
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{
    canvas.focus();const[x,y]=xy(e);canvas.setPointerCapture(e.pointerId);
    if(e.pointerType==='touch'){touchPoints.set(e.pointerId,[x,y]);if(touchPoints.size===2){const p=[...touchPoints.values()];pinch={d:Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]),zoom:renderer.zoom};if(pointer?.kind==='grab')physics?.endGrab();pointer=null;return;}}
    if(ui.pointer('down',x,y,e)){pointer=null;return;}
    if(state.physicsEnabled&&e.button===0){const ray=renderer.screenRay(x,y);if(ray&&physics.beginGrab(ray.origin,ray.direction)){pointer={id:e.pointerId,kind:'grab',x,y,startX:x,startY:y,dragged:true};return;}}
    pointer={id:e.pointerId,x,y,startX:x,startY:y,button:e.button,dragged:false};
  });
  canvas.addEventListener('pointermove',e=>{
    const[x,y]=xy(e);if(e.pointerType==='touch'&&touchPoints.has(e.pointerId))touchPoints.set(e.pointerId,[x,y]);
    if(pinch&&touchPoints.size===2){const p=[...touchPoints.values()],d=Math.hypot(p[0][0]-p[1][0],p[0][1]-p[1][1]);renderer.zoom=clamp(pinch.zoom*d/Math.max(1,pinch.d),.65,2.8);return;}
    if(ui.pointer('move',x,y,e)&&!pointer)return;
    if(pointer&&pointer.id===e.pointerId&&pointer.kind==='grab'){const ray=renderer.screenRay(x,y);if(ray)physics.moveGrab(ray.origin,ray.direction);return;}
    if(pointer&&pointer.id===e.pointerId){const dx=x-pointer.x,dy=y-pointer.y;pointer.dragged=pointer.dragged||Math.hypot(x-pointer.startX,y-pointer.startY)>4;
      if(pointer.dragged){renderer.yaw-=dx*.009;renderer.pitch=clamp(renderer.pitch+dy*.007,state.physicsEnabled?.08:-.40,1.25);state.autoSpin=false;}
      pointer.x=x;pointer.y=y;
    }
  });
  function pointerUp(e){const[x,y]=xy(e);ui.pointer('up',x,y,e);touchPoints.delete(e.pointerId);pinch=null;if(pointer?.kind==='grab')physics?.endGrab();
    if(pointer&&pointer.id===e.pointerId&&!pointer.dragged){let pick=renderer.pick(x,y,state.mode);if(pick>=0&&!state.physicsEnabled)action('select',pick);}pointer=null;
  }
  canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
  canvas.addEventListener('dblclick',e=>{const[x,y]=xy(e),pick=renderer.pick(x,y,state.mode);if(pick>=0){action('select',pick);action('mode','focus');}});
  canvas.addEventListener('wheel',e=>{e.preventDefault();const[x,y]=xy(e);if(ui.pointer('wheel',x,y,e))return;renderer.zoom=clamp(renderer.zoom*Math.exp(-e.deltaY*.001),.65,2.8);},{passive:false});
  window.addEventListener('keydown',e=>{
    if(e.target?.tagName==='INPUT')return;
    if(e.key===' '&&(state.physicsEnabled||state.motionEnabled)&&!state.helpOpen){action(state.physicsEnabled?'physicsPause':'motionPause');e.preventDefault();return;}
    if(ui.key(e)){e.preventDefault();return;}
    const k=e.key.toLowerCase();
    if(k==='f'){action('frame');e.preventDefault();}
    else if(k==='g'){action('mode',state.mode==='gallery'?'focus':'gallery');e.preventDefault();}
    else if(k==='r'){action(e.shiftKey?'reset':'randomize');e.preventDefault();}
    else if(k===' '){state.physicsEnabled?action('physicsPause'):action('toggle','animate');e.preventDefault();}
    else if(k==='p'){state.physicsEnabled?action('physicsPause'):action('ragdoll');e.preventDefault();}
    else if(k==='s'){action('sumo');e.preventDefault();}
    else if(k==='b'){action('pile');e.preventDefault();}
    else if(k==='m'){action('motion');e.preventDefault();}
    else if(k==='d'&&state.physicsEnabled){action('physicsDrop');e.preventDefault();}
    else if(k==='k'&&state.physicsEnabled){action('physicsKick');e.preventDefault();}
    else if(k==='x'){action('toggle','showRig');e.preventDefault();}
    else if(k==='o'){action('toggle','outlines');e.preventDefault();}
    else if(k==='escape'){state.helpOpen=false;state.panelOpen=false;if(state.mode==='focus')action('mode','gallery');}
    else if(k==='arrowleft'){action('select',state.selected-1);e.preventDefault();}
    else if(k==='arrowright'){action('select',state.selected+1);e.preventDefault();}
    else if(k==='?'||k==='h'){action('help');e.preventDefault();}
  });
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fallback.hidden=false;fallback.textContent='Graphics context lost. Reload this page; your saved recipes will be restored.';});
  function tick(now){
    try{
      const elapsed=Math.max(0,(now-lastTime)/1000),dt=Math.min(.1,elapsed);lastTime=now;state.dt=dt;if(state.animate&&!state.physicsEnabled)clock+=dt;
      if(state.physicsEnabled){physics.step(dt);updatePhysicsState();}
      else if(state.motionEnabled){if(state.motionPlaying)state.motionTime+=dt*state.motionSpeed;updateMotionState();}
      state.recipe=recipes[state.selected];ui.state=state;const vp=ui.getViewport(canvas.clientWidth,canvas.clientHeight);
      if(dirty){renderer.rebuild(recipes,state.mode,state.selected,state.physicsEnabled?physicsIds.slice(0,activePhysicsCount):undefined);dirty=false;}
      renderer.draw(state,recipes,clock,vp);fpsAccum+=elapsed;fpsCount++;fpsTime+=elapsed;
      if(fpsTime>.5){state.stats.fps=fpsCount/Math.max(.001,fpsAccum);fpsCount=0;fpsAccum=0;fpsTime=0;}
      state.stats.count=state.physicsEnabled?activePhysicsCount:state.mode==='focus'?1:16;state.stats.totalCount=16;state.stats.triangles=renderer.triangles;state.stats.drawCalls=renderer.drawCalls+1;
      state.labels=renderer.labels(recipes,state.mode,state.selected);if(now>toastUntil)state.toast='';
      const uiCalls=ui.draw(state,canvas.clientWidth,canvas.clientHeight);state.stats.drawCalls=renderer.drawCalls+uiCalls;
      frames++;
      if(frames%30===0){
        const err=renderer.gl.getError();if(err!==0){errors.push('WebGL error '+err);console.error('WebGL error',err);}
        canvas.dataset.diagnostics=JSON.stringify({version:'3.2.1',frames,mode:state.mode,selected:state.selected,tab:state.tab,drawCalls:state.stats.drawCalls,triangles:renderer.triangles,vertices:renderer.vertexCount,expandedVertices:renderer.expandedVertexCount,indices:renderer.indexCount,geometryBytes:renderer.gpuGeometryBytes,fps:Math.round(state.stats.fps),errors,viewport:vp,recipe:{name:state.recipe.name,height:state.recipe.height,width:state.recipe.width,blend:state.recipe.blend,pattern:state.recipe.pattern,hat:state.recipe.hat,glasses:state.recipe.glasses},smooth:state.smooth,wireframe:state.wireframe,outlines:state.outlines,physics:state.physicsEnabled?state.physicsStats:null,physicsMode:state.physicsMode,motion:state.motionEnabled?{clip:state.motionClip,time:state.motionTime,playing:state.motionPlaying}:null,projectionStrength:state.projectionStrength});
      }
      requestAnimationFrame(tick);
    }catch(e){errors.push(e.message);console.error(e);canvas.dataset.error=e.message;fallback.hidden=false;fallback.textContent=e.message;}
  }
  window.DuderLab={get state(){return state;},get recipes(){return recipes;},get physics(){return physics;},get renderer(){return renderer;},action};
  requestAnimationFrame(tick);
})();
