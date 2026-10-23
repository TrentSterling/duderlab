/* Duder Lab V3 — batched WebGL2 skinning, bounded SDF correction, and welded-normal hull outlines.
 * SDF blend-shell projection adapted from Trent Sterling's Critters.
 * Technique provenance: GOOBERS / u/AntiqueFeedback7447; visual prior art RujiK.
 * The projected shells visually fuse; they do not form a welded CAD solid.
 */
(() => {
  'use strict';
  const M={
    sub:(a,b)=>a.map((v,i)=>v-b[i]),
    dot:(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),
    cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
    norm:a=>{let d=Math.hypot(...a)||1;return a.map(v=>v/d)},
    mul:(a,b)=>{let c=new Float32Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++)for(let k=0;k<4;k++)c[i*4+j]+=a[k*4+j]*b[i*4+k];return c},
    point:(m,p)=>[0,1,2,3].map(i=>m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]),
    ortho:(l,r,b,t,n,f)=>new Float32Array([2/(r-l),0,0,0,0,2/(t-b),0,0,0,0,-2/(f-n),0,-(r+l)/(r-l),-(t+b)/(t-b),-(f+n)/(f-n),1]),
    view:(eye,at)=>{let z=M.norm(M.sub(eye,at)),x=M.norm(M.cross([0,1,0],z)),y=M.cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-M.dot(x,eye),-M.dot(y,eye),-M.dot(z,eye),1])}
  };
  function program(gl,vs,fs){
    const compile=(type,code)=>{let s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const msg=gl.getShaderInfoLog(s);console.error(code.split('\n').map((x,i)=>`${i+1}: ${x}`).join('\n'));throw Error(msg)}return s};
    let p=gl.createProgram(),v=compile(gl.VERTEX_SHADER,vs),f=compile(gl.FRAGMENT_SHADER,fs);gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;
  }
  M.identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  M.rigidInverse=m=>{const o=M.identity();for(let c=0;c<3;c++)for(let r=0;r<3;r++)o[c*4+r]=m[r*4+c];for(let r=0;r<3;r++)o[12+r]=-(o[r]*m[12]+o[4+r]*m[13]+o[8+r]*m[14]);return o;};
  M.around=(p,axis,a)=>{const [x,y,z]=M.norm(axis),c=Math.cos(a),s=Math.sin(a),t=1-c,m=M.identity();m.set([t*x*x+c,t*x*y+s*z,t*x*z-s*y,0,t*x*y-s*z,t*y*y+c,t*y*z+s*x,0,t*x*z+s*y,t*y*z-s*x,t*z*z+c,0,0,0,0,1]);for(let i=0;i<3;i++)m[12+i]=p[i]-(m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]);return m;};
  const vs=`#version 300 es
  precision highp float;precision highp int;
  layout(location=0) in vec3 aPosition;layout(location=1) in vec3 aNormal;
  layout(location=2) in vec3 aColor;layout(location=3) in vec4 aMeta;
  layout(location=4) in vec3 aBary;layout(location=5) in vec4 aSkinIndices;layout(location=6) in vec4 aSkinWeights;layout(location=7) in vec4 aOutline;
  uniform sampler2D uData;uniform mat4 uVP;uniform vec2 uGrid;uniform int uFocus;
  uniform bool uOutline;uniform float uOutlineWidth;uniform vec2 uViewport;uniform vec3 uViewDir;
  uniform float uProjection;
  out vec3 vWorld;out vec3 vNormal;out vec3 vLocal;out vec3 vColor;out vec3 vBary;
  out float vJoint;flat out int vId;flat out float vKind;flat out float vRough;flat out float vOutlineScale;
  vec4 A[7];vec4 B[7];mat4 T[7];mat4 IT[7];float K;float Depth;bool Physics;
  float sdRC(vec3 p,vec4 a,vec4 b){
    vec3 ba=b.xyz-a.xyz;float l2=dot(ba,ba),rr=a.w-b.w;
    if(l2<1e-8||rr*rr>=l2)return min(length(p-a.xyz)-a.w,length(p-b.xyz)-b.w);
    float a2=l2-rr*rr,il2=1./l2;vec3 pa=p-a.xyz;
    float y=dot(pa,ba),z=y-l2;vec3 xv=pa*l2-ba*y;
    float x2=dot(xv,xv),y2=y*y*l2,z2=z*z*l2,k=sign(rr)*rr*rr*x2;
    if(sign(z)*a2*z2>k)return sqrt(x2+z2)*il2-b.w;
    if(sign(y)*a2*y2<k)return sqrt(x2+y2)*il2-a.w;
    return (sqrt(max(0.,x2*a2*il2))+y*rr)*il2-a.w;
  }
  float field(vec3 p){
    float d=1e5;const float blends[7]=float[7](1.,.60,.42,.60,.42,.85,.85);
    for(int i=0;i<7;i++){
      vec3 q=(IT[i]*vec4(p,1.)).xyz;q.z/=Depth;
      float e=sdRC(q,A[i],B[i]);if(i>=5)e=max(e,-q.y);
      e*=min(1.,Depth);float k=K*blends[i];
      float h=clamp(.5+.5*(e-d)/k,0.,1.);d=mix(e,d,h)-k*h*(1.-h);
    }
    return Physics?d:max(d,-p.y);
  }
  vec3 grad(vec3 p){vec2 e=vec2(.006,-.006);vec3 g=e.xyy*field(p+e.xyy)+e.yyx*field(p+e.yyx)+e.yxy*field(p+e.yxy)+e.xxx*field(p+e.xxx);return g/max(length(g),1e-8);}
  mat4 matrixAt(int x,int id){return mat4(texelFetch(uData,ivec2(x,id),0),texelFetch(uData,ivec2(x+1,id),0),texelFetch(uData,ivec2(x+2,id),0),texelFetch(uData,ivec2(x+3,id),0));}
  void main(){
    int id=int(aMeta.x+.5);vec4 parms=texelFetch(uData,ivec2(0,id),0);Depth=parms.x;K=max(.001,parms.y)*min(1.,Depth);Physics=texelFetch(uData,ivec2(3,id),0).x>.5;
    for(int i=0;i<7;i++){T[i]=matrixAt(20+i*4,id);IT[i]=matrixAt(48+i*4,id);A[i]=texelFetch(uData,ivec2(4+i*2,id),0);B[i]=texelFetch(uData,ivec2(5+i*2,id),0);}
    bool body=aMeta.y>-.5;vec3 rest=body?aPosition*vec3(1,1,Depth):aPosition;
    vec3 sourceN=uOutline?aOutline.xyz:aNormal;
    vec3 restN=body?normalize(sourceN/vec3(1,1,Depth)):sourceN;
    vec3 p=vec3(0),n=vec3(0);float maxWeight=0.;
    for(int i=0;i<4;i++){float w=aSkinWeights[i];int j=int(aSkinIndices[i]+.5);p+=(T[j]*vec4(rest,1.)).xyz*w;n+=mat3(T[j])*restN*w;maxWeight=max(maxWeight,w);}
    n=normalize(n);vJoint=body?clamp((1.-maxWeight)*4.,0.,1.):0.;
    // Bone-driven positions never accumulate projection: each frame starts from
    // rest coordinates. Rigid regions stay exactly attached; only joint vertices
    // receive two bounded corrections, each no larger than .035 world units.
    if(body&&vJoint>.0001){
      float cap=.035*uProjection*vJoint;
      for(int i=0;i<2;i++){vec3 g=grad(p);p-=g*clamp(field(p),-cap,cap);}
      n=normalize(mix(n,grad(p),vJoint*.8));
    }
    vLocal=rest;vWorld=p;vNormal=n;vColor=aColor;vBary=aBary;vId=id;vKind=aMeta.z;vRough=aMeta.w;vOutlineScale=aOutline.w;
    vec4 clip=uVP*vec4(p,1.);int cell=uFocus>=0?0:id;
    vec2 center=vec2(-1.+(float(cell%int(uGrid.x))+.5)*2./uGrid.x,1.-(float(cell/int(uGrid.x))+.5)*2./uGrid.y);
    clip.xy=clip.xy/uGrid+center*clip.w;
    if(uOutline){
      vec2 direction=(uVP*vec4(n,0.)).xy/uGrid;direction*=uViewport;
      // A normal nearly aligned to the camera has no stable screen direction.
      // Fade its expansion instead of normalizing numerical noise to full width.
      float silhouette=smoothstep(.08,.35,length(cross(n,uViewDir)));
      if(length(direction)>.00001)clip.xy+=normalize(direction)*(2.*uOutlineWidth*aOutline.w*silhouette/uViewport)*clip.w;
      clip.z+=.00015*clip.w;
    }
    gl_Position=clip;
  }`;
  function fragment(){return `#version 300 es
  precision highp float;precision highp int;
  uniform sampler2D uData;uniform vec3 uCamera;uniform bool uSmooth;uniform bool uWire;uniform bool uOutline;
  in vec3 vWorld;in vec3 vNormal;in vec3 vLocal;in vec3 vColor;in vec3 vBary;in float vJoint;
  flat in int vId;flat in float vKind;flat in float vRough;flat in float vOutlineScale;
  out vec4 outColor;
  ${DuderCore.skinGLSL}
  vec3 linearRGB(vec3 c){return pow(max(c,vec3(0)),vec3(2.2));}
  vec3 srgb(vec3 c){return pow(max(c,vec3(0)),vec3(1./2.2));}
  void main(){
    if(uOutline){if(vOutlineScale<.001)discard;outColor=vec4(.055,.075,.09,1.);return;}
    vec4 base=texelFetch(uData,ivec2(1,vId),0),acc=texelFetch(uData,ivec2(2,vId),0),par=texelFetch(uData,ivec2(0,vId),0);
    vec3 albedo=vColor;float rough=vRough;
    if(vKind<.5){albedo=skinColor(vLocal,base.rgb,acc.rgb,acc.a,par.z,par.w);rough=base.a;}
    vec3 ns=normalize(vNormal),nf=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
    if(dot(nf,ns)<0.)nf=-nf;
    vec3 N=(uSmooth||vKind>1.5)?ns:(vKind<.5?normalize(mix(nf,ns,vJoint*.97)):nf);
    vec3 V=normalize(uCamera-vWorld),L=normalize(vec3(-.55,.85,1.15)),H=normalize(V+L);
    float nl=max(dot(N,L),0.),nv=max(dot(N,V),.001),nh=max(dot(N,H),0.),vh=max(dot(V,H),0.);
    float a=max(.06,rough*rough),a2=a*a,den=nh*nh*(a2-1.)+1.;
    float D=a2/(3.14159265*den*den),k=(rough+1.)*(rough+1.)/8.;
    float G=nl/(nl*(1.-k)+k)*nv/(nv*(1.-k)+k);
    vec3 F=vec3(.04)+(1.-.04)*pow(1.-vh,5.);
    vec3 A=linearRGB(albedo);
    float hemi=.56+.20*N.y;vec3 ambient=mix(vec3(.72,.73,.82),vec3(1.10,1.07,1.01),N.y*.5+.5);
    vec3 col=A*(hemi*ambient+.62*nl);
    col+=D*G*F/(4.*max(.001,nv*nl))*.80*nl;
    float rim=pow(1.-nv,4.);col+=vec3(.12,.16,.19)*rim*(1.-rough)*.65;
    if(vKind>2.5){vec3 refl=reflect(-V,N);float strip=pow(max(0.,1.-abs(refl.y-.45)*3.),6.);col+=vec3(.20,.27,.34)*strip;}
    float groundAO=smoothstep(0.,.35,vWorld.y);col*=mix(.72,1.,groundAO);
    col=srgb(col/(1.+col*.10));
    if(uWire){vec3 edge=smoothstep(vec3(0),fwidth(vBary)*1.15,vBary);float line=1.-min(edge.x,min(edge.y,edge.z));col=mix(col,vec3(.08,.12,.16),line*.85);}
    outColor=vec4(clamp(col,0.,1.),1.);
  }`;}
  const bgVS=`#version 300 es
  precision highp float;out vec2 vUV;
  void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUV=p;gl_Position=vec4(p*2.-1.,.999,1.);}`;
  const bgFS=`#version 300 es
  precision highp float;in vec2 vUV;out vec4 outColor;
  uniform vec2 uGrid;uniform vec2 uGround;uniform int uSelected;uniform bool uFocus;uniform vec2 uSize;
  uniform int uScene;uniform vec3 uEye;uniform vec3 uRight;uniform vec3 uUp;uniform vec3 uForward;uniform vec2 uExtent;
  uniform vec4 uShadows[16];uniform int uShadowCount;
  void main(){
    vec2 scaled=vec2(vUV.x,1.-vUV.y)*uGrid,cell=floor(scaled),uv=fract(scaled);
    int id=int(cell.y)*int(uGrid.x)+int(cell.x);vec2 q=vec2(uv.x*2.-1.,1.-uv.y*2.);
    float vign=length((vUV-.5)*vec2(.75,1.));
    vec3 bg=mix(vec3(.959,.949,.926),vec3(.906,.910,.894),vign*.32);
    if(uScene>0){
      vec2 ndc=vUV*2.-1.;vec3 ro=uEye+uRight*ndc.x*uExtent.x+uUp*ndc.y*uExtent.y;
      float dy=min(-.0001,uForward.y),t=-ro.y/dy;vec3 p=ro+uForward*t;float surface=0.;
      if(uScene==2){
        float topT=t,topRadius=length(p.xz);t=(-.25-ro.y)/dy;surface=2.;
        if(topT>0.&&topRadius<=2.20){t=topT;surface=0.;}
        float a=dot(uForward.xz,uForward.xz),b=dot(ro.xz,uForward.xz),c=dot(ro.xz,ro.xz)-2.20*2.20,disc=b*b-a*c;
        if(a>.0001&&disc>=0.){float sideT=(-b-sqrt(disc))/a;float sideY=ro.y+uForward.y*sideT;if(sideT>0.&&sideT<t&&sideY<=0.&&sideY>=-.16){t=sideT;surface=1.;}}
        p=ro+uForward*t;
      }
      if(t>0.){
        float radial=length(p.xz),ring=surface<.5?1.:0.;
        if(uScene==2){bg=surface<.5?vec3(.91,.86,.73):surface<1.5?vec3(.66,.62,.51):vec3(.83,.85,.83);float border=1.-smoothstep(.025,.042,abs(radial-2.16));bg=mix(bg,vec3(.33,.36,.29),border*.85*ring);float marks=1.-smoothstep(.018,.027,abs(abs(p.x)-.58));marks*=1.-smoothstep(.22,.26,abs(p.z));bg=mix(bg,vec3(.98,.97,.91),marks*.9*ring);}
        else {vec2 g=abs(fract(p.xz*.5+.5)-.5);float grid=1.-smoothstep(.005,.015,min(g.x,g.y));bg-=grid*.018;}
        float shadow=0.;
        for(int i=0;i<16;i++){if(i>=uShadowCount)break;vec2 d=(p.xz-uShadows[i].xy)/vec2(.65,.48);shadow+=exp(-dot(d,d)*1.4)*uShadows[i].w;}
        bg*=1.-min(.33,shadow*.24);bg=mix(bg,vec3(.94,.94,.91),smoothstep(4.,14.,length(p.xz))*.6);
      }
    }else{
      float isSel=(id==uSelected&&!uFocus)?1.:0.;
      float border=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)),pad=.022;
      float card=smoothstep(pad,pad+.012,border);bg=mix(bg,bg+vec3(.012,.018,.004),card*isSel);
      vec2 d=q-uGround;float shadow=exp(-dot(d/vec2(.47,.095),d/vec2(.47,.095))*1.7);
      float ambient=exp(-dot(d/vec2(.65,.15),d/vec2(.65,.15))*1.5);bg*=1.-shadow*.24-ambient*.065;
      float selectedLine=(1.-smoothstep(.005,.010,abs(border-pad)))*isSel;bg=mix(bg,vec3(.55,.64,.30),selectedLine*.45);
    }
    outColor=vec4(bg,1.);
  }`;
  const rigVS=`#version 300 es
  precision highp float;layout(location=0) in vec3 aPosition;layout(location=1) in vec3 aColor;uniform mat4 uVP;out vec3 color;
  void main(){color=aColor;gl_Position=uVP*vec4(aPosition,1.);}`;
  const rigFS=`#version 300 es
  precision highp float;in vec3 color;out vec4 outColor;void main(){outColor=vec4(color,1.);}`;

  class DuderRenderer{
    constructor(canvas){
      this.canvas=canvas;this.gl=canvas.getContext('webgl2',{alpha:false,antialias:true,depth:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
      if(!this.gl)throw Error('WebGL 2 is required. Try current Chrome, Edge, or Firefox with graphics acceleration enabled.');
      const gl=this.gl;this.program=program(gl,vs,fragment());this.bg=program(gl,bgVS,bgFS);this.rigProgram=program(gl,rigVS,rigFS);
      this.uniforms={};for(const name of ['uData','uVP','uGrid','uFocus','uCamera','uSmooth','uWire','uOutline','uOutlineWidth','uViewport','uProjection','uViewDir'])this.uniforms[name]=gl.getUniformLocation(this.program,name);
      this.bgUniforms={};for(const name of ['uGrid','uGround','uSelected','uFocus','uSize','uScene','uEye','uRight','uUp','uForward','uExtent','uShadows[0]','uShadowCount'])this.bgUniforms[name]=gl.getUniformLocation(this.bg,name);
      this.rigUniform=gl.getUniformLocation(this.rigProgram,'uVP');
      this.vao=gl.createVertexArray();this.emptyVAO=gl.createVertexArray();this.rigVAO=gl.createVertexArray();this.rigBuffer=gl.createBuffer();
      this.buffers=[];this.count=0;this.triangles=0;this.texWidth=128;
      this.data=new Float32Array(this.texWidth*16*4);this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,this.texWidth,16,0,gl.RGBA,gl.FLOAT,this.data);
      this.frame();this.last=[];this.drawCalls=0;this.geometryById=new Map();this.geometryKeys=new Map();this.poses={};
      gl.clearColor(.95,.95,.92,1);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
    }
    rebuild(recipes,mode,selected,idsOverride){
      const gl=this.gl,ids=idsOverride||(mode==='focus'?[selected]:recipes.map((_,i)=>i)),all=ids.map(i=>{const key=JSON.stringify(recipes[i]);if(this.geometryKeys.get(i)===key)return this.geometryById.get(i);const g=DuderGeometry.build(recipes[i],i);this.geometryById.set(i,g);this.geometryKeys.set(i,key);return g;});
      gl.bindVertexArray(this.vao);this.buffers.forEach(b=>gl.deleteBuffer(b));this.buffers=[];
      [['positions',3],['normals',3],['colors',3],['meta',4],['bary',3],['skinIndices',4],['skinWeights',4],['outline',4]].forEach(([key,size],loc)=>{
        const n=all.reduce((sum,g)=>sum+g[key].length,0),data=new Float32Array(n);let off=0;for(const g of all){data.set(g[key],off);off+=g[key].length;}
        const buffer=gl.createBuffer();this.buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);
      });gl.bindVertexArray(null);this.count=all.reduce((sum,g)=>sum+g.positions.length/3,0);this.triangles=this.count/3;this.last=ids;
      this.restRadius=.8;for(const g of all)for(let i=0;i<g.positions.length;i+=3)this.restRadius=Math.max(this.restRadius,Math.hypot(g.positions[i],g.positions[i+2])*1.10);
    }
    idleTransforms(recipe,time,animate){
      const out=Array.from({length:7},M.identity);if(!animate)return out;
      const joints=DuderCore.rigDefinition(recipe).joints;
      for(const j of joints){let a=0,axis=[0,0,1];
        if(j.child===1||j.child===3){const sign=j.child===1?-1:1;a=sign*(.10*Math.sin(time*1.6+sign*.7));axis=[0,0,1];}
        else if(j.child===2||j.child===4){const sign=j.child===2?-1:1;a=.16+.10*Math.sin(time*1.6+sign*.7);axis=j.axis||[1,0,0];}
        out[j.child]=M.mul(out[j.parent],M.around(j.point,axis,a));
      }return out;
    }
    updateData(recipes,time,animate,state={}){
      const tex=this.data;this.poses={};
      for(const id of this.last){
        const r=recipes[id],o=id*this.texWidth*4,pose=state.poseById?.[id],transforms=pose?.transforms||this.idleTransforms(r,time,animate);
        tex.set([r.depth,r.blend,r.patternScale,r.seed%997],o);tex.set([...r.color,r.roughness],o+4);tex.set([...r.accent,r.pattern],o+8);tex.set([pose?1:0,0,0,0],o+12);
        const prim=DuderCore.primitives(r,0,false);for(let i=0;i<7;i++){
          tex.set([...prim[i].a,prim[i].ra],o+(4+i*2)*4);tex.set([...prim[i].b,prim[i].rb],o+(5+i*2)*4);
          tex.set(transforms[i],o+(20+i*4)*4);tex.set(M.rigidInverse(transforms[i]),o+(48+i*4)*4);
        }
        this.poses[id]=pose||{transforms,parts:DuderCore.rigDefinition(r).parts.map((p,i)=>({...p,a:M.point(transforms[i],p.a).slice(0,3),b:M.point(transforms[i],p.b).slice(0,3)}))};
      }
      const gl=this.gl;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,this.texWidth,16,gl.RGBA,gl.FLOAT,tex);
    }
    frame(state){const active=!!state?.physicsEnabled,pile=active&&state.physicsMode==='pile';this.yaw=pile?.45:active?.20:.25;this.pitch=pile?.55:active?.37:.12;this.zoom=1;this.target=[0,pile?1.65:active?.85:1.02,0];}
    camera(vp,mode,state={}){
      const single=mode==='focus'||state.physicsEnabled,cols=single?1:4,rows=single?1:4,aspect=(vp.w/cols)/(vp.h/rows);
      const at=this.target,dist=9,yaw=this.yaw,pitch=this.pitch;
      this.eye=[at[0]+Math.sin(yaw)*Math.cos(pitch)*dist,at[1]+Math.sin(pitch)*dist,at[2]+Math.cos(yaw)*Math.cos(pitch)*dist];
      this.forward=M.norm(M.sub(at,this.eye));this.right=M.norm(M.cross(this.forward,[0,1,0]));this.up=M.cross(this.right,this.forward);
      const pile=state.physicsEnabled&&state.physicsMode==='pile';
      const base=pile?3.1:state.physicsEnabled?(state.physicsMode==='sumo'?2.20:1.90):(single?1.42:1.37);
      const horizontal=pile?3.8:state.physicsEnabled?(state.physicsMode==='sumo'?2.45:1.65):(this.restRadius||1.18),half=Math.max(base,horizontal/aspect)/this.zoom;
      this.extent=[half*aspect,half];const view=M.view(this.eye,at);this.vpMatrix=M.mul(M.ortho(-half*aspect,half*aspect,-half,half,.1,45),view);
      this.grid=[cols,rows];this.viewport=vp;const p=M.point(this.vpMatrix,[0,.025,0]);this.ground=[p[0]/p[3],p[1]/p[3]];
    }
    screenRay(x,y){const v=this.viewport;if(!v||x<v.x||y<v.y||x>v.x+v.w||y>v.y+v.h)return null;const nx=(x-v.x)/v.w*2-1,ny=1-(y-v.y)/v.h*2;return{origin:this.eye.map((c,i)=>c+this.right[i]*nx*this.extent[0]+this.up[i]*ny*this.extent[1]),direction:this.forward.slice()};}
    drawRig(){
      const data=[],palette=[[.94,.35,.16],[.15,.70,.90]],push=(a,b,c)=>data.push(...a,...c,...b,...c);
      for(let k=0;k<this.last.length;k++){
        const pose=this.poses[this.last[k]],col=palette[k%palette.length];if(!pose?.parts)continue;
        if(pose.colliderLines){const lines=pose.colliderLines;for(let i=0;i<lines.length;i+=6)push(Array.from(lines.slice(i,i+3)),Array.from(lines.slice(i+3,i+6)),col);}
        for(const p of pose.parts){
          push(p.a,p.b,[.98,.92,.31]);
          const radius=.027;for(const axis of [[1,0,0],[0,1,0],[0,0,1]])push(p.a.map((x,i)=>x-axis[i]*radius),p.a.map((x,i)=>x+axis[i]*radius),[1,1,.96]);
        }
      }
      if(!data.length)return;const gl=this.gl;gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.useProgram(this.rigProgram);gl.uniformMatrix4fv(this.rigUniform,false,this.vpMatrix);gl.bindVertexArray(this.rigVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.rigBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);gl.drawArrays(gl.LINES,0,data.length/6);this.drawCalls++;
    }
    draw(state,recipes,time,vp){
      const gl=this.gl,dpr=Math.min(2,window.devicePixelRatio||1),width=this.canvas.clientWidth,height=this.canvas.clientHeight;
      if(this.canvas.width!==Math.round(width*dpr)||this.canvas.height!==Math.round(height*dpr)){this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);}
      if(state.autoSpin)this.yaw+=Math.min(.04,state.dt||.016)*.22;
      this.camera(vp,state.mode,state);this.updateData(recipes,time,state.animate&&!state.physicsEnabled,state);this.drawCalls=0;
      gl.disable(gl.SCISSOR_TEST);gl.disable(gl.BLEND);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.viewport(Math.round(vp.x*dpr),Math.round((height-vp.y-vp.h)*dpr),Math.round(vp.w*dpr),Math.round(vp.h*dpr));
      gl.disable(gl.CULL_FACE);gl.disable(gl.DEPTH_TEST);gl.useProgram(this.bg);gl.bindVertexArray(this.emptyVAO);
      gl.uniform2fv(this.bgUniforms.uGrid,this.grid);gl.uniform2fv(this.bgUniforms.uGround,this.ground);gl.uniform1i(this.bgUniforms.uSelected,state.selected);gl.uniform1i(this.bgUniforms.uFocus,state.mode==='focus'?1:0);gl.uniform2f(this.bgUniforms.uSize,vp.w,vp.h);
      gl.uniform1i(this.bgUniforms.uScene,state.physicsEnabled?(state.physicsMode==='sumo'?2:1):0);gl.uniform3fv(this.bgUniforms.uEye,this.eye);gl.uniform3fv(this.bgUniforms.uRight,this.right);gl.uniform3fv(this.bgUniforms.uUp,this.up);gl.uniform3fv(this.bgUniforms.uForward,this.forward);gl.uniform2fv(this.bgUniforms.uExtent,this.extent);
      const shadows=new Float32Array(16*4);for(let i=0;i<this.last.length;i++){const p=this.poses[this.last[i]]?.parts?.[0],a=p?.a||[0,1,0],b=p?.b||a;shadows.set([(a[0]+b[0])*.5,(a[2]+b[2])*.5,0,Math.max(.07,1-Math.max(0,(a[1]+b[1])*.5-1)*.25)],i*4);}
      gl.uniform4fv(this.bgUniforms['uShadows[0]'],shadows);gl.uniform1i(this.bgUniforms.uShadowCount,this.last.length);
      gl.drawArrays(gl.TRIANGLES,0,3);this.drawCalls++;
      gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.uniform1i(this.uniforms.uData,0);gl.uniformMatrix4fv(this.uniforms.uVP,false,this.vpMatrix);gl.uniform2fv(this.uniforms.uGrid,this.grid);gl.uniform1i(this.uniforms.uFocus,state.mode==='focus'?state.selected:-1);gl.uniform3fv(this.uniforms.uCamera,this.eye);gl.uniform1i(this.uniforms.uSmooth,state.smooth?1:0);gl.uniform1i(this.uniforms.uWire,state.wireframe?1:0);gl.uniform2f(this.uniforms.uViewport,vp.w,vp.h);gl.uniform1f(this.uniforms.uOutlineWidth,state.outlineWidth??2.2);gl.uniform1f(this.uniforms.uProjection,state.projectionStrength??.55);gl.uniform3fv(this.uniforms.uViewDir,this.forward);
      if(state.outlines!==false){gl.uniform1i(this.uniforms.uOutline,1);gl.cullFace(gl.FRONT);gl.drawArrays(gl.TRIANGLES,0,this.count);this.drawCalls++;}
      gl.uniform1i(this.uniforms.uOutline,0);gl.cullFace(gl.BACK);gl.drawArrays(gl.TRIANGLES,0,this.count);this.drawCalls++;
      if(state.showRig&&(state.physicsEnabled||(state.motionEnabled&&state.mode==='focus')))this.drawRig();gl.bindVertexArray(null);gl.viewport(0,0,this.canvas.width,this.canvas.height);return this.drawCalls;
    }
    labels(recipes,mode,selected){const v=this.viewport;if(!v||mode==='focus')return[];return recipes.map((r,i)=>({x:v.x+(i%4+.5)*v.w/4,y:v.y+(Math.floor(i/4)+1)*v.h/4-17,text:String(i+1).padStart(2,'0')+'  '+r.name,selected:i===selected}));}
    pick(x,y,mode){const v=this.viewport;if(!v||x<v.x||y<v.y||x>v.x+v.w||y>v.y+v.h)return-1;return mode==='focus'?-1:Math.min(15,Math.floor((x-v.x)/v.w*4)+4*Math.floor((y-v.y)/v.h*4));}
  }
  window.DuderRenderer=DuderRenderer;window.DuderMath=M;
})();
