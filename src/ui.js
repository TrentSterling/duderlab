/* DUDER LAB — GPU glyph/quad UI. All visible controls are drawn in one WebGL2 pass. */
(() => {
  'use strict';
  const C = {
    panel: [0.075,0.084,0.095,1], panelAlt: [0.092,0.102,0.112,1],
    field: [0.119,0.132,0.145,1], hover: [0.157,0.173,0.184,1],
    border: [0.22,0.245,0.255,1], text: [0.94,0.94,0.895,1],
    muted: [0.54,0.59,0.60,1], faint: [0.34,0.39,0.40,1],
    lime: [0.80,0.94,0.31,1], dark: [0.10,0.14,0.10,1],
    stageText: [0.28,0.30,0.29,1], shadow: [0.035,0.045,0.05,0.6]
  };
  const PALETTE = ['#3269ee','#f47d68','#f5cf44','#6fcb9c','#af87e3','#eb8c39','#2bbdb5','#ef84b2','#eee1bc','#6eb5ec','#6f49a0','#bad547'];
  const ACCENTS = ['#11181c','#f2eadb','#e8c037','#5770c4','#80452f','#55b7ab','#f27666','#e1a1ca','#3c4a42','#6a4b81','#2c9ac2','#b7d772'];
  const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const sameColor = (a,b)=>a && a.reduce((s,c,i)=>s+Math.abs(c-b[i]),0)<0.05;
  const VS = `#version 300 es
    precision highp float;
    layout(location=0) in vec2 aPos;
    layout(location=1) in vec2 aUV;
    layout(location=2) in vec4 aColor;
    layout(location=3) in vec3 aRect;
    layout(location=4) in vec2 aLocal;
    layout(location=5) in float aKind;
    uniform vec2 uResolution;
    out vec2 vUV; out vec4 vColor; out vec3 vRect; out vec2 vLocal; flat out float vKind;
    void main(){ gl_Position=vec4(aPos.x/uResolution.x*2.-1.,1.-aPos.y/uResolution.y*2.,0.,1.);
      vUV=aUV;vColor=aColor;vRect=aRect;vLocal=aLocal;vKind=aKind; }
  `;
  const FS = `#version 300 es
    precision highp float;
    uniform sampler2D uFont;
    in vec2 vUV; in vec4 vColor; in vec3 vRect; in vec2 vLocal; flat in float vKind;
    out vec4 fragColor;
    void main(){
      float alpha=1.;
      if(vKind>.5) alpha=texture(uFont,vUV).a;
      else { float r=min(vRect.z,min(vRect.x,vRect.y)*.5);
        vec2 q=abs(vLocal-vRect.xy*.5)-(vRect.xy*.5-r);
        float d=min(max(q.x,q.y),0.)+length(max(q,0.))-r;
        float aa=max(fwidth(d),.65);alpha=1.-smoothstep(-aa,aa,d); }
      fragColor=vec4(vColor.rgb,vColor.a*alpha);
    }
  `;
  function shader(gl,kind,src){const s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}

  class DuderUI {
    constructor(gl,canvas,onAction){
      this.gl=gl;this.canvas=canvas;this.onAction=onAction;this.font=window.DuderUIFont;
      if(!this.font) throw Error('DuderUIFont must load before DuderUI');
      this.state={panelOpen:false};this.mouse={x:-1,y:-1};this.hits=[];this.scroll={shape:0,skin:0,gear:0,motion:0,physics:0};this.focusKey=null;
      this.verts=[];this.drag=null;this.clip=null;this.lastTab='shape';this.scrollMax=0;
      const p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,VS));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,FS));gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
      this.program=p;this.resolution=gl.getUniformLocation(p,'uResolution');this.sampler=gl.getUniformLocation(p,'uFont');
      this.buffer=gl.createBuffer();this.vao=gl.createVertexArray();gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      let offset=0;[2,2,4,3,2,1].forEach((n,i)=>{gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,n,gl.FLOAT,false,56,offset*4);offset+=n;});gl.bindVertexArray(null);
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,0]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      this.ready=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);resolve(this);};img.onerror=()=>reject(Error('Embedded glyph atlas failed to load'));img.src=this.font.png;});
    }
    _layout(w,h){
      const mobile=w<600,header=w<1100?112:78,footer=h<540?34:42;
      const left=mobile?(this.state.panelOpen?Math.min(292,w-24):0):(w<780?220:w<1000?244:264);
      return {mobile,header,footer,left,bottom:h-footer};
    }
    getViewport(w,h){const l=this._layout(w,h),x=l.mobile?0:l.left;return {x,y:l.header,w:Math.max(1,w-x),h:Math.max(1,h-l.header-l.footer)};}
    measure(s,size=12,bold=false){const f=this.font.glyphs[bold?'bold':'regular'];let width=0;for(const ch of String(s))width+=(f[ch]||f['?']).advance;return width*size/this.font.size;}
    _quad(x,y,w,h,color,uv=null,kind=0,radius=0){
      if(w<=0||h<=0)return;let x0=x,y0=y,x1=x+w,y1=y+h;
      if(this.clip){x0=Math.max(x0,this.clip.x);y0=Math.max(y0,this.clip.y);x1=Math.min(x1,this.clip.x+this.clip.w);y1=Math.min(y1,this.clip.y+this.clip.h);if(x0>=x1||y0>=y1)return;}
      const u=uv||[0,0,0,0],a=(x0-x)/w,b=(x1-x)/w,c=(y0-y)/h,d=(y1-y)/h;
      const pts=[[x0,y0,a,c],[x1,y0,b,c],[x1,y1,b,d],[x0,y0,a,c],[x1,y1,b,d],[x0,y1,a,d]];
      for(const q of pts)this.verts.push(q[0],q[1],u[0]+q[2]*u[2],u[1]+q[3]*u[3],color[0],color[1],color[2],color[3]??1,w,h,radius,q[0]-x,q[1]-y,kind);
    }
    rect(x,y,w,h,color,radius=0){this._quad(x,y,w,h,color,null,0,radius);}
    text(s,x,y,size=12,color=C.text,bold=false,align='left'){
      s=String(s);if(align==='center')x-=this.measure(s,size,bold)/2;else if(align==='right')x-=this.measure(s,size,bold);
      const f=this.font.glyphs[bold?'bold':'regular'],k=size/this.font.size,base=y+size*.84;
      for(const ch of s){const g=f[ch]||f['?'];this._quad(x+g.bx*k,base+g.by*k,g.w*k,g.h*k,color,[g.x/this.font.width,g.y/this.font.height,g.w/this.font.width,g.h/this.font.height],1,0);x+=g.advance*k;}
    }
    _hit(x,y,w,h,item){
      if(this.clip){const x1=Math.min(x+w,this.clip.x+this.clip.w),y1=Math.min(y+h,this.clip.y+this.clip.h);x=Math.max(x,this.clip.x);y=Math.max(y,this.clip.y);w=x1-x;h=y1-y;if(w<=0||h<=0)return;}
      this.hits.push({...item,x,y,w,h});
    }
    _hover(x,y,w,h){return this.mouse.x>=x&&this.mouse.x<=x+w&&this.mouse.y>=y&&this.mouse.y<=y+h;}
    button(label,x,y,w,h,action,value,selected=false,accent=false,key=null){
      key=key||action+':'+JSON.stringify(value??label);const hover=this._hover(x,y,w,h),focus=this.focusKey===key;
      const bg=accent?C.lime:selected?[.23,.28,.17,1]:hover?C.hover:C.field;
      this.rect(x,y,w,h,focus?C.lime:selected?[.47,.57,.25,1]:C.border,7);this.rect(x+1,y+1,w-2,h-2,bg,6);
      this.text(label,x+w/2,y+(h-12)/2,12,accent?C.dark:selected?C.lime:C.text,accent||selected,'center');
      this._hit(x,y,w,h,{type:'button',key,action,value});
    }
    _label(s,x,y){this.text(s.toUpperCase(),x,y,9,C.muted,true);}
    slider(label,key,min,max,x,y,w,value,step=.01,action='param'){
      value=Number.isFinite(value)?value:min;const ratio=clamp((value-min)/(max-min),0,1),hover=this._hover(x,y,w,39),focus=this.focusKey===key;
      this.text(label,x,y,12,C.text);this.text(value.toFixed(key==='blend'?2:2),x+w,y,11,C.muted,false,'right');
      this.rect(x,y+24,w,4,C.border,2);this.rect(x,y+24,Math.max(4,w*ratio),4,focus?C.text:C.lime,2);
      this.rect(x+ratio*w-6,y+20,12,12,C.panel,6);this.rect(x+ratio*w-4,y+22,8,8,hover?C.text:C.lime,4);
      this._hit(x-5,y-3,w+10,39,{type:'slider',key,min,max,step,trackX:x,trackWidth:w,value,action});
    }
    _choices(label,key,items,x,y,w,current,columns=2){
      this._label(label,x,y);y+=19;const gap=6,bw=(w-gap*(columns-1))/columns;
      items.forEach((item,i)=>{const [name,val]=Array.isArray(item)?item:[item,item];this.button(name,x+(i%columns)*(bw+gap),y+Math.floor(i/columns)*32,bw,27,'param',{key,value:val},val===current,false,key+':'+val);});
      return y+Math.ceil(items.length/columns)*32+7;
    }
    _swatches(label,key,x,y,w,current,palette=PALETTE,showCurrent=false){
      this._label(label,x,y);y+=19;const gap=7,sw=(w-gap*5)/6;
      if(showCurrent){
        const color=current||rgb('#18232d'),hex='#'+color.map(c=>Math.round(clamp(c,0,1)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
        this.rect(x,y,26,24,C.border,4);this.rect(x+2,y+2,22,20,[...color,1],2);
        this.text(hex,x+34,y+6,11,C.text);
        this.button('Reset',x+w-60,y,60,24,'resetGearColor',key,false,false,'gear:reset:'+key);y+=33;
      }
      palette.forEach((hex,i)=>{const color=rgb(hex),xx=x+i%6*(sw+gap),yy=y+Math.floor(i/6)*33,selected=sameColor(current,color),hover=this._hover(xx,yy,sw,26),keyId=key+':'+hex;
        this.rect(xx-1,yy-1,sw+2,28,selected?C.lime:hover?C.text:C.border,6);this.rect(xx+2,yy+2,sw-4,22,[...color,1],3);
        if(selected)this.rect(xx+sw/2-2,yy+10,4,4,color.reduce((a,b)=>a+b,0)>1.6?C.dark:C.text,2);
        this._hit(xx-1,yy-1,sw+2,28,{type:'button',key:keyId,action:'param',value:{key,value:color}});
      });return y+66+9;
    }
    _header(s,w,l){
      this.rect(0,0,w,l.header,C.panel);this.rect(0,l.header-1,w,1,C.border);
      this._hit(0,0,w,l.header,{type:'block',key:'header'});
      this.rect(18,20,4,25,C.lime,2);this.text('DUDER LAB',31,18,w<360?20:23,C.text,true);this.text('BEAN WORKBENCH / V3.4.4',32,48,9,C.muted);
      if(l.mobile){
        this.button(s.panelOpen?'Close':'Edit',w-121,20,65,30,'togglePanel',undefined,s.panelOpen,false,'togglePanel');
        this.button('?',w-48,20,30,30,'help',undefined,s.helpOpen,false,'help');
      }
      const compact=w<1100,y=compact?71:23,x=compact?14:l.left+20;
      const short=w<700,tiny=w<360,gap=tiny?5:7;let cursor=x;
      const buttons=short?[
        ['Grid',tiny?42:50,'mode','gallery',s.mode==='gallery'],['Motion',tiny?58:65,'motion',null,!!s.motionEnabled],['Ragdoll',tiny?64:73,'ragdoll',null,!!s.physicsEnabled&&s.physicsMode==='ragdoll'],['Pile',tiny?54:62,'pile',null,!!s.physicsEnabled&&s.physicsMode==='pile'],['GLB',tiny?40:48,'exportGLB',null,false]
      ]:[['Gallery',77,'mode','gallery',s.mode==='gallery'],['Focus',67,'mode','focus',s.mode==='focus'],['Motion',74,'motion',null,!!s.motionEnabled],['Ragdoll',84,'ragdoll',null,!!s.physicsEnabled&&s.physicsMode==='ragdoll'],['Sumo',62,'sumo',null,!!s.physicsEnabled&&s.physicsMode==='sumo'],['Pile of beans',112,'pile',null,!!s.physicsEnabled&&s.physicsMode==='pile'],['Export GLB',104,'exportGLB',null,false]];
      for(const b of buttons){this.button(b[0],cursor,y,b[1],30,b[2],b[3],b[4],b[2]==='exportGLB');cursor+=b[1]+gap;}
      const hx=compact?Math.min(w-48,cursor+1):w-48;
      if(!l.mobile&&hx>cursor-3)this.button('?',hx,y,30,30,'help',undefined,s.helpOpen,false,'help');
      if(!compact&&w-cursor>135)this.text(s.physicsEnabled?(s.physicsPaused?'PHYSICS PAUSED':s.physicsMode==='sumo'?'SUMO LIVE':s.physicsMode==='pile'?'BEAN PILE':'PHYSICS LIVE'):s.motionEnabled?'MOTION PREVIEW':'LOCAL / OFFLINE',w-66,y+10,9,s.physicsEnabled||s.motionEnabled?C.lime:C.muted,false,'right');
    }
    _inspector(s,w,h,l){
      if(!l.left)return;
      const L=l.left,x=18,iw=L-36,top=l.header;
      this.rect(0,top,L,h-top-l.footer,C.panel);this.rect(L-1,top,1,h-top-l.footer,C.border);
      this._hit(0,top,L,h-top-l.footer,{type:'block',key:'panel'});
      this._label('Duder '+String((s.selected||0)+1).padStart(2,'0')+' / '+String(s.stats?.totalCount||16).padStart(2,'0'),x,top+19);
      let name=(s.recipe?.name||'UNTITLED').toUpperCase();while(this.measure(name,17,true)>iw-58&&name.length>5)name=name.slice(0,-2)+'…';
      this.text(name,x,top+38,17,C.text,true);
      this.button('←',L-75,top+17,26,26,'select',((s.selected||0)+15)%16,false,false,'previous');
      this.button('→',L-44,top+17,26,26,'select',((s.selected||0)+1)%16,false,false,'next');
      const tab=s.tab||'shape',tw=(iw-8)/3;
      ['Shape','Skin','Gear'].forEach((name,i)=>this.button(name,x+i*(tw+4),top+76,tw,27,'tab',name.toLowerCase(),tab===name.toLowerCase(),false,'tab:'+name));
      ['Motion','Physics'].forEach((name,i)=>this.button(name,x+i*((iw-4)/2+4),top+108,(iw-4)/2,27,'tab',name.toLowerCase(),tab===name.toLowerCase(),false,'tab:'+name));
      const bottomHeight=170,contentTop=top+154,contentBottom=h-l.footer-bottomHeight;
      this.contentRect={x:0,y:contentTop-7,w:L,h:Math.max(28,contentBottom-contentTop+6)};
      let yy=contentTop-(this.scroll[tab]||0);const startY=yy,r=s.recipe||{};
      this.clip={x:9,y:contentTop-8,w:L-18,h:Math.max(1,contentBottom-contentTop+4)};
      if(tab==='shape'){
        const specs=[['Height','height',.75,1.3],['Width','width',.75,1.3],['Depth','depth',.62,1.24],['Belly','belly',.8,1.2],['Arm length','armLength',.7,1.4],['Arm spread','armSpread',-.15,.22],['Arm thickness','armThickness',.65,1.35],['Arm clearance','armGap',0,.24],['Feet','feet',.7,1.3],['Joint blend','blend',.03,.22],['Eye spacing','eyeSpace',.7,1.3]];
        for(const [label,key,min,max]of specs){this.slider(label,key,min,max,x,yy,iw,r[key],.01);yy+=42;}
        this.slider('Eye size','eyeSize',.75,1.45,x,yy,iw,r.eyeSize??1.18,.01);yy+=42;
        yy=this._choices('Facet detail','facets',[['Coarse',8],['Low',12],['Fine',16]],x,yy+2,iw,r.facets||12,3);
      }else if(tab==='skin'){
        yy=this._choices('Skin pattern','pattern',['Solid','Freckles','Clouds','Stars','Spots','Seeds','Patchwork','Cow'].map((a,i)=>[a,i]),x,yy,iw,r.pattern||0,2);
        this.slider('Pattern scale','patternScale',.6,2,x,yy,iw,r.patternScale||1);yy+=46;
        yy=this._swatches('Body color','color',x,yy,iw,r.color);yy=this._swatches('Pattern color','accent',x,yy,iw,r.accent,ACCENTS);
        this.slider('Roughness','roughness',.15,.95,x,yy,iw,r.roughness??.7);yy+=45;
        this.slider('Outline width','outlineWidth',.8,4,x,yy,iw,s.outlineWidth??2.2,.1,'viewParam');yy+=43;
      }else if(tab==='gear'){
        yy=this._choices('Hat','hat',[['None','none'],['Cap','cap'],['Bucket','bucket'],['Beanie','beanie'],['Bowler','bowler'],['Sunhat','sunhat'],['Cowboy','cowboy'],['Wizard','wizard'],['Chef','chef'],['Crown','crown'],['Beret','beret'],['Top hat','topHat']],x,yy,iw,r.hat||'none',2);
        yy=this._swatches('Hat color','hatColor',x,yy+4,iw,r.hatColor||r.accessoryColor,ACCENTS,true);
        yy=this._choices('Glasses','glasses',[['None','none'],['Square','square'],['Round','round'],['Aviator','aviator'],['Cat eye','catEye']],x,yy+4,iw,r.glasses||'none',2);
        yy=this._swatches('Frame color','glassesColor',x,yy+4,iw,r.glassesColor||r.accessoryColor,ACCENTS,true);
        this.button('Reset both colors',x,yy+4,iw,27,'resetGearColors',null,false,false,'gear:resetColors');yy+=42;
        yy=this._choices('Outfit','outfit',[['Bare bean','none'],['Overalls','overalls'],['Tee','tee']],x,yy+4,iw,r.outfit||'none',2);
        yy=this._swatches('Outfit color','outfitColor',x,yy+4,iw,r.outfitColor,ACCENTS);
        this.text('Fitted colors follow the soft shell.',x,yy+1,10,C.muted);yy+=25;
      }else if(tab==='motion'){
        this._label('Animation clips',x,yy);yy+=21;
        const clips=[['Idle','idle'],['Walk','walk'],['Wave','wave'],['Dance','dance']],pw=(iw-6)/2;
        clips.forEach(([label,id],i)=>this.button(label,x+i%2*(pw+6),yy+Math.floor(i/2)*34,pw,28,'motionClip',id,s.motionClip===id,false,'motion:clip:'+id));yy+=74;
        this.button(s.motionPlaying?'Pause':'Play',x,yy,pw,30,'motionPause',null,!s.motionPlaying,false,'motion:pause');
        this.button('Restart',x+pw+6,yy,pw,30,'motionReset',null,false,false,'motion:reset');yy+=43;
        this.slider('Pose / timeline','motionProgress',0,1,x,yy,iw,s.motionProgress||0,.005,'motionParam');yy+=43;
        this.slider('Playback speed','motionSpeed',.25,2,x,yy,iw,s.motionSpeed??1,.05,'motionParam');yy+=43;
        this.slider('Motion amount','motionAmplitude',.25,1.25,x,yy,iw,s.motionAmplitude??1,.05,'motionParam');yy+=45;
        this.button('Release to ragdoll',x,yy,iw,33,'ragdoll',null,false,true,'motion:release');yy+=45;
        this.button('Show bones',x,yy,iw,28,'toggle','showRig',!!s.showRig,false,'motion:rig');yy+=39;
        yy=this._wrap('Scrub to inspect a pose. Release keeps the pose and its momentum. Gallery previews the clip on all 16.',x,yy,iw,11,C.muted);yy+=13;
        this.slider('Shell correction','projectionStrength',0,1,x,yy,iw,s.projectionStrength??.55,.01,'viewParam');yy+=43;
      }else if(tab==='physics'){
        const active=!!s.physicsEnabled,sumo=s.physicsMode==='sumo',pile=s.physicsMode==='pile',ps=s.physicsSettings||{},st=s.physicsStats||{};
        this._label(active?(s.physicsPaused?'Simulation paused':sumo?'Sumo live':pile?'Pile of beans':'Ragdoll live'):'Selected duder',x,yy);yy+=22;
        if(!active){
          this.button('Start ragdoll',x,yy,iw,34,'ragdoll',null,false,true,'physics:start');yy+=41;
          this.button('Start sumo',x,yy,iw,31,'sumo',null,false,false,'physics:sumo');yy+=38;
          this.button('Pile of beans',x,yy,iw,33,'pile',null,false,false,'physics:pile');yy+=45;
          yy=this._wrap('Drop and throw one duder, put two in the ring, or rain a pile onto the floor.',x,yy,iw,12,C.text);yy+=18;
        }else{
          const pw=(iw-6)/2;
          this.button(s.physicsPaused?'Resume':'Pause',x,yy,pw,30,'physicsPause',null,!!s.physicsPaused,false,'physics:pause');
          this.button(sumo?'Reset round':pile?'Refill pile':'Reset pose',x+pw+6,yy,pw,30,'physicsReset',null,false,false,'physics:reset');yy+=37;
          this.button(sumo?'Ragdoll':pile?'Refill':'Drop',x,yy,pw,30,sumo?'ragdoll':'physicsDrop',null,false,!sumo,sumo?'physics:ragdoll':'physics:drop');
          this.button('Kick',x+pw+6,yy,pw,30,'physicsKick',null,false,false,'physics:kick');yy+=46;
          yy=this._wrap('Left-drag a body to grab it. Release to throw. Right-drag the stage to orbit.',x,yy,iw,11,C.muted);yy+=18;
        }
        if(pile||!active){
          this._label('Beans in pile',x,yy);yy+=21;const choices=[4,8,12,16],cw=(iw-15)/4;
          choices.forEach((count,i)=>this.button(String(count),x+i*(cw+5),yy,cw,27,'pileCount',count,(s.pileCount||8)===count,false,'pile:count:'+count));yy+=38;
          if(pile){this.text((st.rigCount||1)+' of '+(st.spawnCount||s.pileCount||8)+' beans dropped',x,yy,11,C.muted);yy+=26;}
        }
        this.slider('Gravity','gravity',0,15,x,yy,iw,ps.gravity??9.81,.05,'paramPhysics');yy+=45;
        this.slider('Damping','damping',0,.6,x,yy,iw,ps.damping??.18,.01,'paramPhysics');yy+=45;
        this.slider('Shell correction','projectionStrength',0,1,x,yy,iw,s.projectionStrength??.55,.01,'viewParam');yy+=45;
        this.button('Show physics rig',x,yy,iw,29,'toggle','showRig',!!s.showRig,false,'toggle:showRig');yy+=45;
        this._label('Rig',x,yy);yy+=21;
        this.text((st.bodies??(sumo?14:7))+' rigid bodies / '+(st.joints??(sumo?12:6))+' joints',x,yy,12,C.text);yy+=22;
        this.text('Fixed physics step: 120 Hz',x,yy,11,C.muted);yy+=21;
        if(active){
          const err=Number.isFinite(st.maxJointError)?Math.max(0,st.maxJointError)*1000:0;
          this.text('Joint error: '+err.toFixed(1)+' mm',x,yy,11,C.muted);yy+=21;
          this.text(s.physicsPaused?'Simulation paused':st.winner?(st.winner==='Draw'?'Draw':String(st.winner)+' wins'):st.sleeping?'Resting':sumo?'Round '+(st.round||1)+' in progress':'Simulating',x,yy,11,s.physicsPaused?C.muted:C.lime);yy+=31;
          this.button('Back to editor',x,yy,iw,30,'physicsExit',null,false,false,'physics:exit');yy+=39;
        }
      }
      this.clip=null;
      const contentHeight=yy-startY;this.scrollMax=Math.max(0,contentHeight-(contentBottom-contentTop));
      this.scroll[tab]=clamp(this.scroll[tab]||0,0,this.scrollMax);
      if(this.scrollMax>0){const trackH=Math.max(20,contentBottom-contentTop-10),thumbH=Math.max(24,trackH*trackH/contentHeight);this.rect(L-7,contentTop,2,trackH,C.field,1);this.rect(L-7,contentTop+(trackH-thumbH)*(this.scroll[tab]/this.scrollMax),2,thumbH,C.muted,1);}
      const by=h-l.footer-bottomHeight+14,bw=(iw-6)/2;
      this.rect(18,by-12,iw,1,C.border);this._label('Preview',18,by);
      [['Spin','autoSpin'],[s.physicsEnabled||s.motionEnabled?'Rig overlay':'Idle',s.physicsEnabled||s.motionEnabled?'showRig':'animate'],['Smooth shading','smooth'],['Wireframe','wireframe'],['Shell outline','outlines']].forEach(([name,key],i)=>this.button(name,x+(i%2)*(bw+6),by+20+Math.floor(i/2)*31,bw,26,'toggle',key,!!s[key],false,'toggle:'+key));
      this.button('Physics',x+bw+6,by+82,bw,26,'tab','physics',s.tab==='physics',false,'physics:tab-footer');
      if(s.physicsEnabled)this.button('Back to editor',x,by+115,iw,30,'physicsExit',null,false,false,'physics:exit-footer');
      else{this.button('Reroll duder',x,by+115,bw,30,'randomize',null,false,false,'randomize');this.button('Shuffle all',x+bw+6,by+115,bw,30,'randomizeAll',null,false,false,'randomizeAll:footer');}
    }
    _footer(s,w,h,l){
      const y=h-l.footer;this.rect(0,y,w,l.footer,C.panel);this.rect(0,y,w,1,C.border);
      this._hit(0,y,w,l.footer,{type:'block',key:'footer'});
      if(l.left&&!l.mobile)this.text('V3.4.4   /   WEBGL2',18,y+(l.footer-10)/2,10,C.muted);
      const x=(l.mobile?0:l.left)+18,st=s.stats||{},tris=st.triangles>=1000?(st.triangles/1000).toFixed(1)+'K':String(st.triangles||0);
      const text=(st.count||16)+((st.count||16)===1?' DUDER   ':' DUDERS   ')+(st.drawCalls??3)+' DRAWS   '+tris+' TRIS'+(w>650?(st.offlineCapture?'   OFFLINE REPLAY':'   '+Math.round(st.fps||0)+' FPS'):'');
      this.text(text,x,y+(l.footer-10)/2,10,C.lime);
      const hint=s.physicsEnabled?'Left drag: grab / Right drag: orbit / D drop / K kick':s.motionEnabled?'Space pause / P release / X bones / G gallery':'Drag orbit / Wheel zoom / M motion / B bean pile';
      if(w-x-this.measure(text,10)>this.measure(hint,10)+38)this.text(hint,w-18,y+(l.footer-10)/2,10,C.muted,false,'right');
    }
    _wrap(s,x,y,width,size,color=C.muted,bold=false,line=1.55){
      let row='';for(const word of s.split(' ')){const next=row?row+' '+word:word;if(this.measure(next,size,bold)>width&&row){this.text(row,x,y,size,color,bold);y+=size*line;row=word;}else row=next;}if(row){this.text(row,x,y,size,color,bold);y+=size*line;}return y;
    }
    _help(s,w,h){
      this.clip=null;this.rect(0,0,w,h,[.025,.035,.04,.68]);this.hits=[];this._hit(0,0,w,h,{type:'button',key:'help-backdrop',action:'help'});
      const bw=Math.min(530,w-28),bh=Math.min(510,h-28),x=(w-bw)/2,y=(h-bh)/2;
      this.rect(x,y,bw,bh,C.border,13);this.rect(x+1,y+1,bw-2,bh-2,C.panel,12);this._hit(x,y,bw,bh,{type:'block',key:'help-panel'});
      this.text('Your duder workbench',x+25,y+24,23,C.text,true);this.button('×',x+bw-49,y+20,28,28,'help',undefined,false,false,'help-close');
      const inner=bw-50;this.helpContent={x:x+18,y:y+65,w:bw-36,h:Math.max(50,bh-146)};
      this.clip=this.helpContent;let yy=y+72-(this.helpScroll||0),startY=yy;
      yy=this._wrap('Drag to orbit. Scroll to zoom. Click a duder to select it. G switches Gallery / Focus. F frames the view. R rerolls one; Shift + R restores the original 16.',x+25,yy,inner,12,C.text);yy+=14;
      this._label('Physics playground',x+25,yy);yy+=23;
      yy=this._wrap('Ragdoll starts the selected duder in Focus. Sumo puts two in the ring. B starts a pile of 4 to 16 beans. Left-drag a body to grab and throw; right-drag to orbit. P starts or pauses physics. Space pauses. D drops, K kicks, S starts sumo, X shows the rig, and O toggles outlines. Gallery returns to the editor.',x+25,yy,inner,12,C.text);yy+=14;
      this._label('Motion preview',x+25,yy);yy+=23;
      yy=this._wrap('M opens Idle, Walk, Wave, and Dance. Adjust speed and motion amount, or scrub the timeline to inspect a pose. Release to ragdoll keeps the current pose and momentum. Gallery plays the selected clip on all 16 duders. GLB exports the currently displayed animation or physics pose as a static mesh.',x+25,yy,inner,12,C.text);yy+=14;
      yy=this._wrap('Tab moves between controls; arrows adjust a focused slider. All visible labels and controls use GPU glyphs in one UI draw.',x+25,yy,inner,11,C.muted);yy+=18;
      this._label('How the shell works',x+25,yy);yy+=23;
      yy=this._wrap('The connected shell follows seven bones, then the vertex shader projects it onto the live SDF. Shoulder, elbow, and hip constraints move the physics bodies. Hats, glasses, and eyes follow the torso. Every duder shares one character draw. Vertices follow bones first; shell correction only repairs local joints. Set it to 0 to compare.',x+25,yy,inner,12,C.text);yy+=11;
      yy=this._wrap('Export GLB saves the selected duder as a static mesh, including its current pose during physics. Export recipe saves all 16 editable recipes; Import recipe restores the JSON file. Physics runs locally with the bundled cannon-es engine.',x+25,yy,inner,11,C.muted);yy+=15;
      yy=this._wrap('SDF blend shells adapted from Trent Sterling / Critters. GOOBERS technique inspiration; RujiK visual prior art.',x+25,yy,inner,10,C.muted);
      this.clip=null;this.helpScrollMax=Math.max(0,yy-startY-this.helpContent.h+9);this.helpScroll=clamp(this.helpScroll||0,0,this.helpScrollMax);
      if(this.helpScrollMax>0){const sh=this.helpContent.h,thumb=Math.max(20,sh*sh/(sh+this.helpScrollMax));this.rect(x+bw-11,this.helpContent.y,2,sh,C.field,1);this.rect(x+bw-11,this.helpContent.y+(sh-thumb)*this.helpScroll/this.helpScrollMax,2,thumb,C.muted,1);}
      const btnY=y+bh-58,gap=8,btnW=(inner-gap)/2;
      this.button('Export recipe',x+25,btnY,btnW,32,'exportRecipe',undefined,false,false,'exportRecipe');this.button('Import recipe',x+25+btnW+gap,btnY,btnW,32,'importRecipe',undefined,false,false,'importRecipe');
    }
    draw(state,width,height){
      this.state=state;this.width=width;this.height=height;this.verts=[];this.hits=[];this.clip=null;
      const l=this._layout(width,height),vp=this.getViewport(width,height);
      if(state.labels&&vp.w>600){this.clip=vp;for(const label of state.labels){const txt=label.text||'',ww=this.measure(txt,9.5,label.selected)+20;if(label.selected)this.rect(label.x-ww/2,label.y-5,ww,23,[.80,.94,.31,.88],6);this.text(txt,label.x,label.y,9.5,label.selected?C.dark:C.stageText,!!label.selected,'center');}this.clip=null;}
      if(state.physicsEnabled){
        const ps=state.physicsStats||{},isSumo=state.physicsMode==='sumo',isPile=state.physicsMode==='pile';
        const mode=isSumo?'SUMO / ROUND '+(ps.round||1):isPile?'PILE OF BEANS':'RAGDOLL';
        const status=state.physicsPaused?'PAUSED':ps.winner?(ps.winner==='Draw'?'Draw':String(ps.winner)+' wins'):isSumo?'IN THE RING':isPile?(ps.pending?'DROPPING '+(ps.rigCount||1)+' / '+(ps.spawnCount||8):'GRAB A BEAN'):'GRAB A BODY';
        const title=mode+' / '+status,ww=Math.min(vp.w-36,this.measure(title,10,true)+24);
        this.rect(vp.x+18,vp.y+15,ww,27,[.075,.084,.095,.92],6);
        this.clip={x:vp.x+26,y:vp.y+15,w:ww-16,h:27};this.text(title,vp.x+30,vp.y+24,10,C.lime,true);this.clip=null;
      }else if(state.motionEnabled){
        const title=(state.motionClip||'idle').toUpperCase()+' / '+(state.motionPlaying?'PLAYING':'POSE PAUSED'),ww=this.measure(title,10,true)+24;
        this.rect(vp.x+18,vp.y+15,ww,27,[.075,.084,.095,.92],6);this.text(title,vp.x+30,vp.y+24,10,C.lime,true);
      }
      this._header(state,width,l);this._inspector(state,width,height,l);this._footer(state,width,height,l);
      if(state.toast){const label=String(state.toast),tw=Math.min(vp.w-30,this.measure(label,12)+32),tx=vp.x+(vp.w-tw)/2,ty=height-l.footer-53;this.rect(tx,ty,tw,34,C.panel,8);this.text(label,tx+tw/2,ty+11,12,C.lime,false,'center');}
      if(state.helpOpen)this._help(state,width,height);
      const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.disable(gl.CULL_FACE);gl.disable(gl.SCISSOR_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.program);gl.uniform2f(this.resolution,width,height);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(this.sampler,0);gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(this.verts),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,this.verts.length/14);gl.bindVertexArray(null);gl.depthMask(true);gl.disable(gl.BLEND);gl.enable(gl.DEPTH_TEST);
      return 1;
    }
    hit(x,y){for(let i=this.hits.length-1;i>=0;i--){const r=this.hits[i];if(x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)return r;}return null;}
    _adjust(slider,x){const raw=slider.min+clamp((x-slider.trackX)/slider.trackWidth,0,1)*(slider.max-slider.min),step=slider.step||.01,value=clamp(Math.round(raw/step)*step,slider.min,slider.max);this.onAction(slider.action||'param',{key:slider.key,value:Number(value.toFixed(4))});}
    pointer(type,x,y,event={}){
      type=type.replace(/^pointer/,'');this.mouse={x,y};
      if(type==='wheel'){
        if(this.state.helpOpen){this.helpScroll=clamp((this.helpScroll||0)+(event.deltaY||0)*.6,0,this.helpScrollMax||0);return true;}const r=this.contentRect;
        if(r&&x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h){const tab=this.state.tab||'shape';this.scroll[tab]=clamp((this.scroll[tab]||0)+(event.deltaY||0)*.6,0,this.scrollMax);return true;}
        return !!this.hit(x,y);
      }
      if(type==='move'){if(this.drag){this._adjust(this.drag,x);return true;}return !!this.hit(x,y);}
      if(type==='up'||type==='cancel'||type==='leave'){if(this.drag){this.drag=null;return true;}return !!this.hit(x,y);}
      if(type==='down'){
        const target=this.hit(x,y);if(target){this.focusKey=target.key;if(target.type==='slider'){this.drag=target;this._adjust(target,x);}else if(target.type==='button')this.onAction(target.action,target.value);return true;}
        if(this.state.panelOpen&&this.width<600){this.onAction('togglePanel');return true;}
      }
      return false;
    }
    key(event){
      if(event.key==='Escape'&&this.state.helpOpen){this.onAction('help');return true;}
      const controls=this.hits.filter(h=>h.type!=='block');if(!controls.length)return false;
      let index=controls.findIndex(h=>h.key===this.focusKey),active=controls[index];
      if(event.key==='Tab'){index=(index+(event.shiftKey?-1:1)+controls.length)%controls.length;this.focusKey=controls[index].key;return true;}
      if(!active)return false;
      if((event.key==='Enter'||event.key===' ')&&active.type==='button'){this.onAction(active.action,active.value);return true;}
      if(active.type==='slider'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){
        const dir=(event.key==='ArrowRight'||event.key==='ArrowUp')?1:-1,step=active.step*(event.shiftKey?10:1);
        const value=event.key==='Home'?active.min:event.key==='End'?active.max:clamp(active.value+dir*step,active.min,active.max);
        this.onAction(active.action||'param',{key:active.key,value:Number(value.toFixed(4))});return true;
      }return false;
    }
    dispose(){const gl=this.gl;gl.deleteBuffer(this.buffer);gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);gl.deleteTexture(this.texture);}
  }
  window.DuderUI=DuderUI;
})();
