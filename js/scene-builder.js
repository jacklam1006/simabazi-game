/**
 * scene-builder.js · Three.js 3D 命盘浮空岛
 *
 * 当前阶段：程序化几何体（无需 GLB 模型文件）
 * 下一阶段：将各区域几何体替换为真实 GLB 3D 模型
 *
 * 场景布局（俯视）：
 *        [木 · 北 · 竹林]
 *  [水·西北]  [中央四柱祭坛]  [金·东]
 *        [火 · 南 · 熔岩]
 *           [土·西南]
 */

class SceneBuilder {
  constructor(container) {
    this.container = container;
    this.scene     = null;
    this.camera    = null;
    this.renderer  = null;
    this.clock     = new THREE.Clock();
    this.animated  = [];
    this._orbit    = { dragging:false, lastX:0, lastY:0,
                       theta:Math.PI*.28, phi:1.05, radius:22 };
    this._lookAt   = new THREE.Vector3(0, 1.5, 0);
  }

  /* ─── 初始化 ─────────────────────────────────────── */
  init() {
    const W = window.innerWidth, H = window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060810);
    this.scene.fog = new THREE.FogExp2(0x060810, 0.018);

    this.camera = new THREE.PerspectiveCamera(52, W/H, 0.1, 200);
    this._syncCamera();

    this.renderer = new THREE.WebGLRenderer({ antialias:true });
    this.renderer.setSize(W, H);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this._setupLights();
    this._bindControls();
    window.addEventListener('resize', () => this._onResize());
    return this;
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0x1a1a2e, 1.4));

    const sun = new THREE.DirectionalLight(0xfff0d0, 2.0);
    sun.position.set(14, 28, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera,
      { left:-22, right:22, top:22, bottom:-22, near:1, far:80 });
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x3355cc, 0.5);
    fill.position.set(-12, 6, -12);
    this.scene.add(fill);
  }

  /* ─── 场景构建入口 ───────────────────────────────── */
  buildFromBazi(baziData) {
    this._clearDynamic();

    const wx = baziData.wuxing || { 木:20, 火:30, 土:15, 金:20, 水:15 };
    const total = Object.values(wx).reduce((a,b) => a+b, 0);
    const s = {};
    for (const k in wx) s[k] = wx[k] / total;

    this._addStarfield();
    this._addIsland();
    this._addMuZone(s['木']  || 0.2);
    this._addHuoZone(s['火'] || 0.2);
    this._addTuZone(s['土']  || 0.2);
    this._addJinZone(s['金'] || 0.2);
    this._addShuiZone(s['水']|| 0.2);
    this._addAltar(baziData);
    this._addZoneLights(s);
    return this;
  }

  /* ─── 星空 ───────────────────────────────────────── */
  _addStarfield() {
    const n = 900;
    const pos = new Float32Array(n*3);
    for (let i = 0; i < n; i++) {
      const t = Math.random()*Math.PI*2;
      const p = Math.acos(2*Math.random()-1);
      const r = 85 + Math.random()*15;
      pos[i*3]   = r*Math.sin(p)*Math.cos(t);
      pos[i*3+1] = r*Math.sin(p)*Math.sin(t);
      pos[i*3+2] = r*Math.cos(p);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const pts = new THREE.Points(geo,
      new THREE.PointsMaterial({ color:0xffffff, size:0.22,
        transparent:true, opacity:0.55 }));
    pts.userData.dyn = true;
    this.scene.add(pts);
  }

  /* ─── 浮空岛基底 ─────────────────────────────────── */
  _addIsland() {
    const island = this._mesh(
      new THREE.CylinderGeometry(8, 6.8, 1.4, 32),
      { color:0x14141e, roughness:0.95, metalness:0.1 });
    island.position.y = -0.7;
    island.receiveShadow = island.castShadow = true;
    island.userData.dyn = true;
    this.scene.add(island);

    // 底部辉光
    const glow = this._mesh(
      new THREE.CylinderGeometry(7.8, 6.5, 0.18, 32),
      { color:0x2233cc, emissive:0x1122aa, emissiveIntensity:2,
        transparent:true, opacity:0.45 });
    glow.position.y = -1.45;
    glow.userData.dyn = true;
    this.animated.push({ mesh:glow, type:'pulse', base:2, amp:0.6, speed:0.8 });
    this.scene.add(glow);

    // 悬浮小石块
    for (let i = 0; i < 7; i++) {
      const angle = (i/7)*Math.PI*2 + Math.random();
      const r = 4 + Math.random()*2.5;
      const rock = this._mesh(
        new THREE.IcosahedronGeometry(0.25+Math.random()*0.35, 0),
        { color:0x101018, roughness:1 });
      rock.position.set(Math.cos(angle)*r, -1.9-Math.random(), Math.sin(angle)*r);
      rock.userData.dyn = true;
      this.animated.push({ mesh:rock, type:'float', phase:Math.random()*6 });
      this.scene.add(rock);
    }
  }

  /* ─── 木区 · 北 · 竹林 ───────────────────────────── */
  _addMuZone(strength) {
    const sc = 0.55 + strength*1.6;
    const g = new THREE.Group();
    g.position.set(0.5, 0, -5);
    g.add(this._groundPatch(2.8*sc, 0x183818));

    const treeN = Math.floor(3 + strength*7);
    for (let i = 0; i < treeN; i++) {
      const x = (Math.random()-.5)*5, z = (Math.random()-.5)*3.5;
      const h = (0.7+Math.random()*0.9)*sc;
      const trunk = this._mesh(new THREE.CylinderGeometry(.065,.1,h,6),
        { color:0x3a2810, roughness:1 });
      trunk.position.set(x, h/2, z);
      trunk.castShadow = true;
      g.add(trunk);
      for (let l = 0; l < 2+Math.floor(Math.random()*2); l++) {
        const cone = this._mesh(
          new THREE.ConeGeometry(.38-l*.07, .75-l*.12, 7),
          { color:l===0?0x246624:0x3a8840,
            emissive:0x0a1f0a, emissiveIntensity:.4, roughness:.9 });
        cone.position.set(x, h*.68+l*.45, z);
        cone.castShadow = true;
        g.add(cone);
      }
    }

    for (let i = 0; i < 5; i++) {
      const bx=(Math.random()-.5)*5.5, bz=(Math.random()-.5)*3;
      const bh=(1.1+Math.random()*.9)*sc;
      const bamboo = this._mesh(
        new THREE.CylinderGeometry(.035,.045,bh,5),
        { color:0x6FCF97, roughness:.6, emissive:0x1a4a20, emissiveIntensity:.5 });
      bamboo.position.set(bx, bh/2, bz);
      bamboo.rotation.z=(Math.random()-.5)*.15;
      bamboo.castShadow=true;
      g.add(bamboo);
    }

    this._addParticles(g, 0x6FCF97, 30+Math.floor(strength*50));
    this._addGroup(g);
  }

  /* ─── 火区 · 南 · 熔岩晶柱 ──────────────────────── */
  _addHuoZone(strength) {
    const sc = 0.55 + strength*1.6;
    const g = new THREE.Group();
    g.position.set(1, 0, 5.5);

    const gMesh = this._groundPatch(2.8*sc, 0x2a0800);
    gMesh.material = new THREE.MeshStandardMaterial(
      { color:0x2a0800, emissive:0x180300, emissiveIntensity:.8, roughness:1 });
    g.add(gMesh);

    const spikeN = Math.floor(4+strength*8);
    for (let i = 0; i < spikeN; i++) {
      const x=(Math.random()-.5)*5, z=(Math.random()-.5)*3.5;
      const h=(.5+Math.random()*1.1)*sc;
      const spike = this._mesh(
        new THREE.ConeGeometry(.13+Math.random()*.08, h, 3+Math.floor(Math.random()*3)),
        { color:Math.random()>.5?0xcc2200:0xff5500,
          emissive:0x661100, emissiveIntensity:.9, roughness:.25, metalness:.2 });
      spike.position.set(x, h/2, z);
      spike.rotation.y=Math.random()*Math.PI;
      spike.castShadow=true;
      g.add(spike);
    }

    this._addParticles(g, 0xff3300, 45+Math.floor(strength*70), true);
    this._addParticles(g, 0xff8800, 20+Math.floor(strength*30), true);
    this._addGroup(g);
  }

  /* ─── 土区 · 西南 · 黄土梯台 ────────────────────── */
  _addTuZone(strength) {
    const sc = 0.55 + strength*1.5;
    const g = new THREE.Group();
    g.position.set(-5.5, 0, 2);

    for (let t = 0; t < 3; t++) {
      const s=(1-t*.28)*sc;
      const terrace = this._mesh(
        new THREE.CylinderGeometry(s, s*1.1, .28, 8),
        { color:[0xc8924a,0xd4a056,0xddb060][t], roughness:.95 });
      terrace.position.y=t*.25;
      terrace.castShadow=terrace.receiveShadow=true;
      g.add(terrace);
    }

    for (let i = 0; i < 7; i++) {
      const a=Math.random()*Math.PI*2, r=(.7+Math.random()*.9)*sc;
      const p=this._mesh(new THREE.IcosahedronGeometry(.1+Math.random()*.1,0),
        { color:0xb07840, roughness:1 });
      p.position.set(Math.cos(a)*r, 3*.25+.1, Math.sin(a)*r);
      g.add(p);
    }

    this._addParticles(g, 0xF2C94C, 18+Math.floor(strength*28));
    this._addGroup(g);
  }

  /* ─── 金区 · 东 · 水晶簇 ─────────────────────────── */
  _addJinZone(strength) {
    const sc = 0.55 + strength*1.5;
    const g = new THREE.Group();
    g.position.set(5.5, 0, -1);

    const floor = this._mesh(new THREE.CircleGeometry(2.3*sc,16),
      { color:0x1e1e26, roughness:.25, metalness:.75 });
    floor.rotation.x=-Math.PI/2; floor.position.y=.01;
    g.add(floor);

    const crN = Math.floor(4+strength*7);
    for (let i = 0; i < crN; i++) {
      const x=(Math.random()-.5)*4, z=(Math.random()-.5)*3.5;
      const sz=(.18+Math.random()*.18)*sc;
      const cr = this._mesh(new THREE.OctahedronGeometry(sz,0),
        { color:Math.random()>.5?0xd4c090:0xeeddaa,
          emissive:0x4a3800, emissiveIntensity:.6, roughness:.08, metalness:.85 });
      cr.position.set(x, sz*.8, z);
      cr.scale.y=2.2+Math.random()*.8;
      cr.rotation.set(Math.random(),Math.random(),Math.random());
      cr.castShadow=true;
      g.add(cr);
      this.animated.push({ mesh:cr, type:'rotate', speed:.003+Math.random()*.003 });
    }

    this._addParticles(g, 0xe8d8b0, 18+Math.floor(strength*28));
    this._addGroup(g);
  }

  /* ─── 水区 · 西北 · 莲花池 ──────────────────────── */
  _addShuiZone(strength) {
    const sc = 0.55 + strength*1.6;
    const g = new THREE.Group();
    g.position.set(-3.5, 0, -4.5);
    const R = 2.0*sc;

    const water = this._mesh(new THREE.CircleGeometry(R,32),
      { color:0x091e36, emissive:0x06182a, emissiveIntensity:1,
        roughness:0, metalness:.55, transparent:true, opacity:.92 });
    water.rotation.x=-Math.PI/2; water.position.y=.02;
    g.add(water);
    this.animated.push({ mesh:water, type:'pulse', base:1, amp:.35, speed:.9 });

    for (let r = 0; r < 3; r++) {
      const ring = this._mesh(
        new THREE.RingGeometry(R*(.28+r*.26), R*(.31+r*.26), 32),
        { color:0x6EB5FF, emissive:0x2244aa, emissiveIntensity:1.2,
          transparent:true, opacity:.28-r*.07, side:THREE.DoubleSide });
      ring.rotation.x=-Math.PI/2; ring.position.y=.03;
      g.add(ring);
      this.animated.push({ mesh:ring, type:'ripple', phase:r*1.3 });
    }

    for (let i = 0; i < 4; i++) {
      const a=(i/4)*Math.PI*2;
      const lotus = this._mesh(new THREE.ConeGeometry(.11,.16,6),
        { color:0xff88aa, emissive:0x881133, emissiveIntensity:.8 });
      lotus.position.set(Math.cos(a)*R*.58, .14, Math.sin(a)*R*.58);
      g.add(lotus);
      this.animated.push({ mesh:lotus, type:'float', phase:i*1.5 });
    }

    this._addParticles(g, 0x6EB5FF, 28+Math.floor(strength*40));
    this._addGroup(g);
  }

  /* ─── 中央四柱祭坛 ───────────────────────────────── */
  _addAltar(baziData) {
    const g = new THREE.Group();

    g.add(Object.assign(
      this._mesh(new THREE.CylinderGeometry(2.0,2.2,.22,8),
        { color:0x14122a, emissive:0x0a0818, emissiveIntensity:.5,
          roughness:.35, metalness:.65 }),
      { position:new THREE.Vector3(0,.11,0) }));

    const pCfg = [
      { pos:[-1,0,-1], color:0xC9A96E },
      { pos:[ 1,0,-1], color:0xEB5757 },
      { pos:[ 1,0, 1], color:0x6FCF97 },
      { pos:[-1,0, 1], color:0x6EB5FF },
    ];

    pCfg.forEach(({ pos, color }, i) => {
      const pillar = this._mesh(new THREE.CylinderGeometry(.11,.14,2.0,6),
        { color, emissive:color, emissiveIntensity:.35, roughness:.3, metalness:.5 });
      pillar.position.set(pos[0],1.22,pos[2]);
      pillar.castShadow=true;
      g.add(pillar);

      const orb = this._mesh(new THREE.SphereGeometry(.19,12,12),
        { color, emissive:color, emissiveIntensity:1.4, roughness:0, metalness:.8 });
      orb.position.set(pos[0],2.32,pos[2]);
      this.animated.push({ mesh:orb, type:'orbPulse', phase:i*Math.PI*.5 });
      g.add(orb);
    });

    // 外环
    const ring1 = this._mesh(new THREE.TorusGeometry(1.15,.045,8,48),
      { color:0xc9a96e, emissive:0xc9a96e, emissiveIntensity:1.6, roughness:0, metalness:1 });
    ring1.position.y=1.75;
    this.animated.push({ mesh:ring1, type:'rotate', speed:.009 });
    g.add(ring1);

    // 内环（反向）
    const ring2 = this._mesh(new THREE.TorusGeometry(.65,.03,6,32),
      { color:0x6eb5ff, emissive:0x6eb5ff, emissiveIntensity:1.4, roughness:0, metalness:1 });
    ring2.position.y=1.75;
    ring2.rotation.x=Math.PI*.3;
    this.animated.push({ mesh:ring2, type:'rotate', speed:-.012 });
    g.add(ring2);

    // 光柱
    const beam = this._mesh(new THREE.CylinderGeometry(.03,.12,2.5,8),
      { color:0xffffff, emissive:0xffffff, emissiveIntensity:1.5,
        transparent:true, opacity:.18 });
    beam.position.y=1.25;
    this.animated.push({ mesh:beam, type:'pulse', base:.18, amp:.10, speed:1.2, isOpacity:true });
    g.add(beam);

    g.userData.dyn=true;
    this.scene.add(g);
  }

  /* ─── 五行区域点光源 ─────────────────────────────── */
  _addZoneLights(s) {
    [
      { pos:[ .5,4,-5],    color:0x44ff44, wx:'木' },
      { pos:[ 1, 4, 5.5],  color:0xff4400, wx:'火' },
      { pos:[-5.5,4,2],    color:0xffcc44, wx:'土' },
      { pos:[ 5.5,4,-1],   color:0xddcc88, wx:'金' },
      { pos:[-3.5,4,-4.5], color:0x44aaff, wx:'水' },
    ].forEach(({ pos, color, wx }) => {
      const light = new THREE.PointLight(color, (s[wx]||.2)*3.5, 10, 2);
      light.position.set(...pos);
      light.userData.dyn=true;
      this.scene.add(light);
    });
  }

  /* ─── 粒子系统 ───────────────────────────────────── */
  _addParticles(group, color, count, rising=false) {
    const pos=new Float32Array(count*3), vel=new Float32Array(count*3);
    for (let i=0; i<count; i++) {
      const a=Math.random()*Math.PI*2, r=Math.random()*2.5;
      pos[i*3]=Math.cos(a)*r; pos[i*3+1]=Math.random()*1.8; pos[i*3+2]=Math.sin(a)*r;
      vel[i*3]=(Math.random()-.5)*.005;
      vel[i*3+1]=.004+Math.random()*.009;
      vel[i*3+2]=(Math.random()-.5)*.005;
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const pts=new THREE.Points(geo,
      new THREE.PointsMaterial({ color, size:.07, transparent:true, opacity:.72,
        blending:THREE.AdditiveBlending, depthWrite:false }));
    pts.userData.vel=vel;
    pts.userData.maxY=rising?3.5:2.2;
    group.add(pts);
    this.animated.push({ mesh:pts, type:'particles' });
  }

  /* ─── 动画循环 ───────────────────────────────────── */
  startRenderLoop() {
    const loop=()=>{
      requestAnimationFrame(loop);
      const t=this.clock.getElapsedTime();
      this._tick(t);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
    return this;
  }

  _tick(t) {
    for (const obj of this.animated) {
      const m=obj.mesh;
      if (!m) continue;
      switch(obj.type) {
        case 'float':
          m.position.y+=Math.sin(t*.9+(obj.phase||0))*.0004;
          break;
        case 'rotate':
          m.rotation.y+=obj.speed||.005;
          break;
        case 'orbPulse': {
          const sc=1+.14*Math.sin(t*2+(obj.phase||0));
          m.scale.setScalar(sc);
          break;
        }
        case 'ripple':
          if (m.material) m.material.opacity=.12+.16*Math.abs(Math.sin(t*.55+(obj.phase||0)));
          break;
        case 'pulse':
          if (obj.isOpacity) {
            if (m.material) m.material.opacity=obj.base+obj.amp*Math.sin(t*obj.speed);
          } else {
            if (m.material) m.material.emissiveIntensity=obj.base+obj.amp*Math.sin(t*obj.speed);
          }
          break;
        case 'particles': {
          const pa=m.geometry.attributes.position.array;
          const v=m.userData.vel, maxY=m.userData.maxY;
          for (let i=0; i<pa.length/3; i++) {
            pa[i*3]+=v[i*3]; pa[i*3+1]+=v[i*3+1]; pa[i*3+2]+=v[i*3+2];
            if (pa[i*3+1]>maxY) {
              const a=Math.random()*Math.PI*2, r=Math.random()*2.5;
              pa[i*3]=Math.cos(a)*r; pa[i*3+1]=-0.1; pa[i*3+2]=Math.sin(a)*r;
            }
          }
          m.geometry.attributes.position.needsUpdate=true;
          break;
        }
      }
    }
  }

  /* ─── 轨道控制（鼠标/触屏） ─────────────────────── */
  _bindControls() {
    const el=this.renderer.domElement;
    el.addEventListener('mousedown', e=>{
      this._orbit.dragging=true;
      this._orbit.lastX=e.clientX; this._orbit.lastY=e.clientY;
    });
    window.addEventListener('mouseup', ()=>{ this._orbit.dragging=false; });
    window.addEventListener('mousemove', e=>{
      if (!this._orbit.dragging) return;
      this._orbit.theta-=(e.clientX-this._orbit.lastX)*.005;
      this._orbit.phi=Math.max(.3,Math.min(1.45,
        this._orbit.phi+(e.clientY-this._orbit.lastY)*.004));
      this._orbit.lastX=e.clientX; this._orbit.lastY=e.clientY;
      this._syncCamera();
    });
    el.addEventListener('wheel', e=>{
      this._orbit.radius=Math.max(8,Math.min(38,this._orbit.radius+e.deltaY*.022));
      this._syncCamera();
    },{ passive:true });
    let lt=null;
    el.addEventListener('touchstart', e=>{ lt=e.touches[0]; });
    el.addEventListener('touchmove', e=>{
      if (!lt) return;
      const t=e.touches[0];
      this._orbit.theta-=(t.clientX-lt.clientX)*.006;
      this._orbit.phi=Math.max(.3,Math.min(1.45,
        this._orbit.phi+(t.clientY-lt.clientY)*.005));
      lt=t; this._syncCamera(); e.preventDefault();
    },{ passive:false });
    el.addEventListener('touchend', ()=>{ lt=null; });
  }

  _syncCamera() {
    const {theta,phi,radius}=this._orbit;
    this.camera.position.set(
      radius*Math.sin(phi)*Math.sin(theta),
      radius*Math.cos(phi),
      radius*Math.sin(phi)*Math.cos(theta));
    this.camera.lookAt(this._lookAt);
  }

  /* ─── 工具 ───────────────────────────────────────── */
  _mesh(geo, matProps) {
    const mat=new THREE.MeshStandardMaterial(matProps);
    const m=new THREE.Mesh(geo,mat);
    m.castShadow=m.receiveShadow=true;
    return m;
  }

  _groundPatch(radius, color) {
    const m=this._mesh(new THREE.CircleGeometry(radius,16),{ color,roughness:1 });
    m.rotation.x=-Math.PI/2; m.position.y=.01;
    return m;
  }

  _addGroup(g) { g.userData.dyn=true; this.scene.add(g); }

  _clearDynamic() {
    const rm=[];
    this.scene.traverse(o=>{ if(o.userData.dyn) rm.push(o); });
    rm.forEach(o=>this.scene.remove(o));
    this.animated=[];
  }

  _onResize() {
    const W=window.innerWidth, H=window.innerHeight;
    this.camera.aspect=W/H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W,H);
  }
}
