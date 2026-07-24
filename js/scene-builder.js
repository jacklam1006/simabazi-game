/**
 * scene-builder.js · Three.js 3D 命盘浮空岛
 * v0.2.0 - 阴阳分流 + 大运环境 + 流年天空 + 四柱祭坛精准映射
 *
 * 阳干（甲丙戊庚壬）→ 高大、棱角、气势磅礴
 * 阴干（乙丁己辛癸）→ 圆润、有机、精致细腻
 *
 * 背景层级：
 *   最外层 = 大运旋转光环（元运气场）
 *   中间层 = 流年粒子天气（今年气场）
 *   核心层 = 本命五行浮空岛
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

  /* ─── 工具：天干五行/阴阳速查 ───────────────────────── */
  static STEM_WX  = { 甲:'木',乙:'木',丙:'火',丁:'火',戊:'土',己:'土',庚:'金',辛:'金',壬:'水',癸:'水' };
  static STEM_YANG = { 甲:1,乙:0,丙:1,丁:0,戊:1,己:0,庚:1,辛:0,壬:1,癸:0 };
  static WX_HEX   = { 木:0x3a7a3a, 火:0xcc3300, 土:0xb07840, 金:0x9ab0c8, 水:0x2277cc };
  static WX_EMI   = { 木:0x0a1f0a, 火:0x550800, 土:0x3d2010, 金:0x1a2840, 水:0x062050 };

  /* ─── 初始化 ─────────────────────────────────────────── */
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
    // 环境光：更亮，冷调
    this.scene.add(new THREE.AmbientLight(0x1e2040, 2.2));

    // 主光（暖白，高位）
    const sun = new THREE.DirectionalLight(0xffeedd, 2.8);
    sun.position.set(12, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left:-24, right:24, top:24, bottom:-24, near:1, far:100 });
    this.scene.add(sun);

    // 侧光（冷蓝，补足暗面）
    const fill = new THREE.DirectionalLight(0x3366aa, 1.0);
    fill.position.set(-14, 8, -10);
    this.scene.add(fill);

    // 底光（深紫，浮岛底部光晕）
    const bot = new THREE.PointLight(0x220044, 2.0, 20);
    bot.position.set(0, -5, 0);
    this.scene.add(bot);
  }

  /* ─── 场景构建入口 ──────────────────────────────────── */
  buildFromBazi(baziData) {
    this._clearDynamic();

    const wx = baziData.wuxing || { 木:20, 火:20, 土:20, 金:20, 水:20 };
    const total = Object.values(wx).reduce((a,b) => a+b, 0);
    const s = {};
    for (const k in wx) s[k] = wx[k] / total;

    // yangRatio: 各五行中阳性成分比例（0=全阴, 1=全阳）
    const yr = baziData.yangRatio || { 木:.5, 火:.5, 土:.5, 金:.5, 水:.5 };

    // 更新背景色调（与日主五行呼应）
    const dmWx = SceneBuilder.STEM_WX[baziData.dayMaster] || '木';
    this._setDayunAtmosphere(baziData.dayun?.wx || dmWx);

    this._addStarfield();
    this._addIsland();
    this._addMuZone( s['木']||.2, yr['木']||.5 );
    this._addHuoZone(s['火']||.2, yr['火']||.5 );
    this._addTuZone( s['土']||.2, yr['土']||.5 );
    this._addJinZone(s['金']||.2, yr['金']||.5 );
    this._addShuiZone(s['水']||.2, yr['水']||.5 );
    this._addAltar(baziData);
    this._addZoneLights(s, yr);

    // 大运外环 + 流年天气
    if (baziData.dayun)   this._addDayunRing(baziData.dayun);
    if (baziData.liunian) this._addLiunianSky(baziData.liunian);

    return this;
  }

  /* ─── 背景气氛（大运调色） ──────────────────────────── */
  _setDayunAtmosphere(wx) {
    const fogColors = { 木:0x060d08, 火:0x0d0604, 土:0x0a0906, 金:0x08080d, 水:0x040810 };
    const c = fogColors[wx] || 0x060810;
    this.scene.background = new THREE.Color(c);
    this.scene.fog.color.set(c);
  }

  /* ─── 星空 ───────────────────────────────────────────── */
  _addStarfield() {
    const n = 900;
    const pos = new Float32Array(n*3);
    for (let i=0; i<n; i++) {
      const t=Math.random()*Math.PI*2, p=Math.acos(2*Math.random()-1), r=85+Math.random()*15;
      pos[i*3]=r*Math.sin(p)*Math.cos(t); pos[i*3+1]=r*Math.sin(p)*Math.sin(t); pos[i*3+2]=r*Math.cos(p);
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const pts=new THREE.Points(geo, new THREE.PointsMaterial({ color:0xffffff, size:.22, transparent:true, opacity:.55 }));
    pts.userData.dyn=true;
    this.scene.add(pts);
  }

  /* ─── 浮空岛基底 ─────────────────────────────────────── */
  _addIsland() {
    // 主岛体（深石青色）
    const island=this._mesh(new THREE.CylinderGeometry(8.2,6.8,1.6,48),
      { color:0x1a1a28, roughness:.88, metalness:.18 });
    island.position.y=-0.8; island.receiveShadow=island.castShadow=true;
    island.userData.dyn=true; this.scene.add(island);

    // 岛顶面（深蓝灰，让区域颜色更突出）
    const top=this._mesh(new THREE.CylinderGeometry(8.2,8.2,.08,48),
      { color:0x22222e, roughness:1, metalness:0 });
    top.position.y=0; top.receiveShadow=true;
    top.userData.dyn=true; this.scene.add(top);

    // 底部发光环（更亮的蓝紫）
    const glow=this._mesh(new THREE.CylinderGeometry(8.0,6.6,.12,48),
      { color:0x4455ff, emissive:0x3344ee, emissiveIntensity:3.5, transparent:true, opacity:.55 });
    glow.position.y=-1.62; glow.userData.dyn=true;
    this.animated.push({ mesh:glow, type:'pulse', base:3.5, amp:1.2, speed:.7 });
    this.scene.add(glow);

    // 悬浮碎石（环绕）
    for (let i=0; i<10; i++) {
      const angle=(i/10)*Math.PI*2+Math.random()*.4, r=5.5+Math.random()*2.8;
      const rock=this._mesh(new THREE.IcosahedronGeometry(.18+Math.random()*.28,0),
        { color:0x14141e, roughness:1, metalness:.1 });
      rock.position.set(Math.cos(angle)*r, -1.6-Math.random()*.8, Math.sin(angle)*r);
      rock.userData.dyn=true;
      this.animated.push({ mesh:rock, type:'float', phase:Math.random()*6 });
      this.scene.add(rock);
    }
  }

  /* ═══════════════════════════════════════════════════════
   * 木区 · 北
   * yr > 0.6 → 甲木：参天大树，高耸挺拔，几何感强
   * yr < 0.4 → 乙木：柔藤花草，圆润展开，花瓣粒子
   * ══════════════════════════════════════════════════════ */
  _addMuZone(strength, yr) {
    const sc = .55 + strength*1.6;
    const isYang = yr > .55;
    const g = new THREE.Group();
    g.position.set(.5, 0, -5);
    g.add(this._groundPatch(2.8*sc, isYang ? 0x142014 : 0x1e3018));

    if (isYang) {
      // 甲木：中央"王树"（粗壮高大）
      const kh = (2.0 + .4)*sc;
      const kt = this._mesh(new THREE.CylinderGeometry(.13,.2,kh,7),{ color:0x221508, roughness:1 });
      kt.position.set(0, kh/2, 0); kt.castShadow=true; g.add(kt);
      for (let l=0; l<4; l++) {
        const cone=this._mesh(new THREE.ConeGeometry(.6-l*.1,.9-l*.12,8),
          { color:l<2?0x1a5520:0x2d7a3a, emissive:0x0a1f0a, emissiveIntensity:.5+l*.1, roughness:.8 });
        cone.position.set(0, kh*.52+l*.58, 0); cone.castShadow=true; g.add(cone);
      }
      // 普通高松树
      const tN = Math.floor(3+strength*6);
      for (let i=0; i<tN; i++) {
        const x=(Math.random()-.5)*5.5, z=(Math.random()-.5)*3.5;
        if (Math.abs(x)<.8 && Math.abs(z)<.8) continue;
        const h=(.9+Math.random()*1.1)*sc;
        const trunk=this._mesh(new THREE.CylinderGeometry(.06,.1,h,6),{ color:0x2a1808, roughness:1 });
        trunk.position.set(x,h/2,z); trunk.castShadow=true; g.add(trunk);
        for (let l=0; l<3; l++) {
          const c=this._mesh(new THREE.ConeGeometry(.35-l*.08,.7-l*.1,7),
            { color:l===0?0x1e5a1e:0x327832, emissive:0x081508, emissiveIntensity:.4, roughness:.9 });
          c.position.set(x, h*.62+l*.42, z); c.castShadow=true; g.add(c);
        }
      }
      // 高竹（甲木特征：挺直）
      for (let i=0; i<Math.floor(5+strength*5); i++) {
        const bx=(Math.random()-.5)*5.5, bz=(Math.random()-.5)*3;
        const bh=(1.5+Math.random()*1.2)*sc;
        const bam=this._mesh(new THREE.CylinderGeometry(.03,.045,bh,5),
          { color:0x6FCF97, roughness:.6, emissive:0x1a4a20, emissiveIntensity:.6 });
        bam.position.set(bx,bh/2,bz); bam.rotation.z=(Math.random()-.5)*.06; bam.castShadow=true; g.add(bam);
      }
      this._addParticles(g, 0x6FCF97, 35+Math.floor(strength*55));
    } else {
      // 乙木：矮树展开冠 + 花朵粒子
      const tN = Math.floor(4+strength*6);
      for (let i=0; i<tN; i++) {
        const x=(Math.random()-.5)*5, z=(Math.random()-.5)*3.5;
        const h=(.4+Math.random()*.55)*sc;
        const trunk=this._mesh(new THREE.CylinderGeometry(.06,.09,h,6),{ color:0x3a2810, roughness:1 });
        trunk.position.set(x,h/2,z); trunk.castShadow=true;
        trunk.rotation.z=(Math.random()-.5)*.22; g.add(trunk);
        const canopy=this._mesh(new THREE.SphereGeometry(.45+Math.random()*.28,8,6),
          { color:0x4a9a3a, emissive:0x1a3a0a, emissiveIntensity:.4, roughness:.9 });
        canopy.scale.y=.7; canopy.position.set(x, h+.28, z); g.add(canopy);
      }
      // 花朵
      for (let i=0; i<Math.floor(10+strength*14); i++) {
        const fx=(Math.random()-.5)*5.5, fz=(Math.random()-.5)*3.5;
        const fl=this._mesh(new THREE.ConeGeometry(.09,.14,6),
          { color:Math.random()>.5?0xff88bb:0xffddaa, emissive:0xaa2244, emissiveIntensity:.9 });
        fl.position.set(fx, .12+Math.random()*.7, fz); fl.rotation.x=Math.PI;
        g.add(fl); this.animated.push({ mesh:fl, type:'float', phase:Math.random()*6 });
      }
      this._addParticles(g, 0xaaeebb, 25+Math.floor(strength*40));
      this._addParticles(g, 0xffaacc, 12+Math.floor(strength*18));
    }
    this._addGroup(g);
  }

  /* ═══════════════════════════════════════════════════════
   * 火区 · 南
   * yr > 0.55 → 丙火：火山 + 熔岩池 + 热焰
   * yr < 0.45 → 丁火：灯笼群 + 烛台
   * ══════════════════════════════════════════════════════ */
  _addHuoZone(strength, yr) {
    const sc = .55 + strength*1.6;
    const isYang = yr > .55;
    const g = new THREE.Group();
    g.position.set(1, 0, 5.5);

    if (isYang) {
      // 丙火：火山地面（玄武岩黑）
      const ground = this._mesh(new THREE.CircleGeometry(3.2*sc, 24),
        { color:0x0e0600, roughness:1 });
      ground.rotation.x=-Math.PI/2; ground.position.y=.01; g.add(ground);

      // 熔岩池（地面中心，鲜亮橙红）
      const lavaPool = this._mesh(new THREE.CircleGeometry(1.1*sc, 24),
        { color:0xff4400, emissive:0xff3300, emissiveIntensity:4.0, transparent:true, opacity:.9 });
      lavaPool.rotation.x=-Math.PI/2; lavaPool.position.y=.02;
      this.animated.push({ mesh:lavaPool, type:'pulse', base:4.0, amp:1.5, speed:1.2 });
      g.add(lavaPool);

      // 熔岩池外环（深橙）
      const lavaRing = this._mesh(new THREE.RingGeometry(1.1*sc, 1.4*sc, 24),
        { color:0xdd2200, emissive:0xcc1100, emissiveIntensity:2.5, transparent:true, opacity:.7, side:THREE.DoubleSide });
      lavaRing.rotation.x=-Math.PI/2; lavaRing.position.y=.02;
      this.animated.push({ mesh:lavaRing, type:'ripple', phase:0 });
      g.add(lavaRing);

      // 火山锥（高、宽底、多段）
      const vBase = this._mesh(new THREE.CylinderGeometry(.6*sc, 1.5*sc, .5*sc, 8),
        { color:0x1a0500, roughness:1 });
      vBase.position.set(0,.25*sc,0); vBase.castShadow=true; g.add(vBase);

      const vMid = this._mesh(new THREE.CylinderGeometry(.25*sc, .6*sc, .7*sc, 7),
        { color:0x220800, roughness:1 });
      vMid.position.set(0,.75*sc,0); vMid.castShadow=true; g.add(vMid);

      const vTop = this._mesh(new THREE.ConeGeometry(.25*sc, .55*sc, 7),
        { color:0xff2200, emissive:0xff1100, emissiveIntensity:2.5, roughness:.5 });
      vTop.position.set(0,1.28*sc,0); vTop.castShadow=true;
      this.animated.push({ mesh:vTop, type:'pulse', base:2.5, amp:.8, speed:1.5 });
      g.add(vTop);

      // 岩浆裂缝线（辐射状扁平长条）
      for (let i=0; i<6; i++) {
        const a=(i/6)*Math.PI*2;
        const crack = this._mesh(new THREE.BoxGeometry(.06, .02, (1.0+Math.random()*.6)*sc),
          { color:0xff4400, emissive:0xff3000, emissiveIntensity:3.0, roughness:.2 });
        crack.rotation.y=a; crack.position.set(Math.cos(a)*.9*sc,.02,Math.sin(a)*.9*sc);
        this.animated.push({ mesh:crack, type:'pulse', base:3.0, amp:1.5, speed:.8+i*.15 });
        g.add(crack);
      }

      // 上升火焰粒子
      this._addParticles(g, 0xff4400, 60+Math.floor(strength*80), true);
      this._addParticles(g, 0xff8800, 30+Math.floor(strength*40), true);

    } else {
      // 丁火：暗红地面 + 灯笼阵
      const ground = this._mesh(new THREE.CircleGeometry(2.8*sc, 24),
        { color:0x1a0d00, roughness:1 });
      ground.rotation.x=-Math.PI/2; ground.position.y=.01; g.add(ground);

      const lN=Math.floor(6+strength*8);
      for (let i=0; i<lN; i++) {
        const x=(Math.random()-.5)*5, z=(Math.random()-.5)*3.5;
        const h=(.6+Math.random()*.8)*sc;
        // 灯杆（暗棕木）
        const pole=this._mesh(new THREE.CylinderGeometry(.022,.038,h,5),{ color:0x3a2010, roughness:1 });
        pole.position.set(x,h/2,z); g.add(pole);
        // 灯笼上横架
        const top=this._mesh(new THREE.CylinderGeometry(.055,.055,.06,5),{ color:0x3a2010, roughness:1 });
        top.position.set(x,h+.06,z); g.add(top);
        // 灯笼主体（扁球，强发光）
        const c=Math.random()>.4?0xff6600:0xff2200;
        const lantern=this._mesh(new THREE.SphereGeometry(.16+Math.random()*.08,10,8),
          { color:c, emissive:c, emissiveIntensity:2.5, transparent:true, opacity:.88 });
        lantern.scale.y=.75; lantern.position.set(x,h-.05,z); g.add(lantern);
        this.animated.push({ mesh:lantern, type:'orbPulse', phase:Math.random()*Math.PI*2 });
        // 灯笼底穗（细锥）
        const tassel=this._mesh(new THREE.ConeGeometry(.04,.14,4),
          { color:0xffaa00, emissive:0xff8800, emissiveIntensity:2.0, transparent:true, opacity:.8 });
        tassel.position.set(x,h-.22,z); tassel.rotation.z=Math.PI; g.add(tassel);
      }
      this._addParticles(g, 0xff8833, 35+Math.floor(strength*50), true);
    }
    this._addGroup(g);
  }

  /* ═══════════════════════════════════════════════════════
   * 土区 · 西南
   * yr > 0.55 → 戊土：巍峨山岳，岩石层叠
   * yr < 0.45 → 己土：肥沃田园，丘陵梯田
   * ══════════════════════════════════════════════════════ */
  _addTuZone(strength, yr) {
    const sc = .55 + strength*1.5;
    const isYang = yr > .55;
    const g = new THREE.Group();
    g.position.set(-5.5, 0, 2);

    // 地面（统一：深暖棕）
    const ground = this._mesh(new THREE.CircleGeometry(3.0*sc, 24),
      { color:0x2a1a08, roughness:1 });
    ground.rotation.x=-Math.PI/2; ground.position.y=.01; g.add(ground);

    if (isYang) {
      // 戊土：山岳——多层递进石台
      const stoneColors=[0x5a3a18,0x6a4828,0x7a5838,0x8a6848];
      const layers=4;
      for (let t=0; t<layers; t++) {
        const r=(1.4-t*.28)*sc;
        const h=.28;
        const terrace=this._mesh(new THREE.CylinderGeometry(r, r*1.1, h, 6+t*2),
          { color:stoneColors[t], roughness:.92, metalness:.05 });
        terrace.position.y=t*h; terrace.castShadow=terrace.receiveShadow=true; g.add(terrace);
      }
      // 山顶巨石
      const peak=this._mesh(new THREE.IcosahedronGeometry(.3*sc,1),
        { color:0x9a7848, roughness:.85 });
      peak.position.y=layers*.28+.18; peak.castShadow=true; g.add(peak);

      // 侧面石柱（戊土特征）
      for (let i=0; i<Math.floor(5+strength*4); i++) {
        const a=Math.random()*Math.PI*2, r=(.8+Math.random()*.9)*sc;
        const h=(.25+Math.random()*.55)*sc;
        const pillar=this._mesh(new THREE.CylinderGeometry(.07+Math.random()*.04, .1+Math.random()*.05, h, 5),
          { color:0x6a4828, roughness:.95 });
        pillar.position.set(Math.cos(a)*r, h/2, Math.sin(a)*r);
        pillar.rotation.z=(Math.random()-.5)*.08; g.add(pillar);
      }
      // 碎石散落
      for (let i=0; i<10; i++) {
        const a=Math.random()*Math.PI*2, r=(.6+Math.random()*1.4)*sc;
        const p=this._mesh(new THREE.IcosahedronGeometry(.07+Math.random()*.1,0),
          { color:0x7a5838, roughness:1 });
        p.position.set(Math.cos(a)*r, .04, Math.sin(a)*r); g.add(p);
      }

    } else {
      // 己土：丘陵梯田——用 CylinderGeometry 做真正的梯级山丘
      const hillCount = Math.floor(3+strength*3);
      for (let m=0; m<hillCount; m++) {
        const mx=(Math.random()-.5)*3.6, mz=(Math.random()-.5)*2.8;
        const baseR=(.5+Math.random()*.45)*sc;
        const hillH=(.22+Math.random()*.18)*sc;
        // 丘陵底座
        const base=this._mesh(new THREE.CylinderGeometry(baseR, baseR*1.2, hillH*.4, 10),
          { color:0x7a5820, roughness:.95 });
        base.position.set(mx, hillH*.2, mz); g.add(base);
        // 丘顶（半球形）
        const top=this._mesh(new THREE.SphereGeometry(baseR*.85, 10, 8, 0, Math.PI*2, 0, Math.PI/2),
          { color:0x8a6828, roughness:.9 });
        top.position.set(mx, hillH*.4, mz); g.add(top);
      }

      // 金黄稻田纹路（细长矩形，平铺）
      for (let i=0; i<Math.floor(10+strength*12); i++) {
        const px=(Math.random()-.5)*5.5, pz=(Math.random()-.5)*3.8;
        const ph=(.08+Math.random()*.16)*sc;
        const stalk=this._mesh(new THREE.CylinderGeometry(.012,.018,ph,3),
          { color:Math.random()>.5?0xc8a020:0xd4a830, emissive:0x403000, emissiveIntensity:.4, roughness:1 });
        stalk.position.set(px,ph/2,pz); stalk.rotation.z=(Math.random()-.5)*.3; g.add(stalk);
      }

      // 小岩块点缀
      for (let i=0; i<6; i++) {
        const a=Math.random()*Math.PI*2, r=(.8+Math.random()*1.2)*sc;
        const p=this._mesh(new THREE.IcosahedronGeometry(.06+Math.random()*.08,0),
          { color:0x6a4818, roughness:1 });
        p.position.set(Math.cos(a)*r, .04, Math.sin(a)*r); g.add(p);
      }
    }

    this._addParticles(g, 0xc8a040, 18+Math.floor(strength*28));
    this._addGroup(g);
  }

  /* ═══════════════════════════════════════════════════════
   * 金区 · 东
   * yr > 0.65 → 庚金：剑锋利刃，尖锐金属晶柱
   * yr < 0.35 → 辛金：珠宝首饰，圆润珍珠簇
   * ══════════════════════════════════════════════════════ */
  _addJinZone(strength, yr) {
    const sc = .55 + strength*1.5;
    const isYang = yr > .55;
    const g = new THREE.Group();
    g.position.set(5.5, 0, -1);

    if (isYang) {
      // 庚金：金属地面 + 刀锋晶柱
      const floor=this._mesh(new THREE.CircleGeometry(2.3*sc,16),
        { color:0x1a1a22, roughness:.15, metalness:.9 });
      floor.rotation.x=-Math.PI/2; floor.position.y=.01; g.add(floor);
      const blN=Math.floor(5+strength*8);
      for (let i=0; i<blN; i++) {
        const x=(Math.random()-.5)*4, z=(Math.random()-.5)*3.5;
        const h=(.4+Math.random()*.7)*sc;
        const blade=this._mesh(new THREE.BoxGeometry(.05+Math.random()*.04, h, .15+Math.random()*.1),
          { color:0xa8a8c0, emissive:0x1a1a2a, emissiveIntensity:.6, roughness:.05, metalness:.95 });
        blade.position.set(x, h/2, z);
        blade.rotation.y=Math.random()*Math.PI;
        blade.rotation.z=(Math.random()-.5)*.2;
        blade.castShadow=true; g.add(blade);
        this.animated.push({ mesh:blade, type:'rotate', speed:.002+Math.random()*.002 });
      }
      // 八面体小晶体点缀
      for (let i=0; i<Math.floor(3+strength*4); i++) {
        const x=(Math.random()-.5)*4.5, z=(Math.random()-.5)*3.5;
        const sz=(.12+Math.random()*.1)*sc;
        const cr=this._mesh(new THREE.OctahedronGeometry(sz,0),
          { color:0xd8d8e8, emissive:0x3a3a4a, emissiveIntensity:.5, roughness:.05, metalness:.9 });
        cr.position.set(x,sz,z); cr.scale.y=1.8;
        cr.rotation.set(Math.random(),Math.random(),Math.random()); cr.castShadow=true; g.add(cr);
      }
    } else {
      // 辛金：珍珠/宝石簇
      const floor=this._mesh(new THREE.CircleGeometry(2.0*sc,16),
        { color:0x22181e, roughness:.3, metalness:.6 });
      floor.rotation.x=-Math.PI/2; floor.position.y=.01; g.add(floor);
      const pN=Math.floor(6+strength*9);
      for (let i=0; i<pN; i++) {
        const x=(Math.random()-.5)*4, z=(Math.random()-.5)*3.5;
        const r=(.14+Math.random()*.12)*sc;
        const pearl=this._mesh(new THREE.SphereGeometry(r,10,10),
          { color:Math.random()>.5?0xf0d0e8:0xe8e0f8, emissive:0x441133, emissiveIntensity:.5, roughness:.1, metalness:.7 });
        pearl.position.set(x,r,z); pearl.castShadow=true; g.add(pearl);
        this.animated.push({ mesh:pearl, type:'orbPulse', phase:Math.random()*Math.PI*2 });
      }
    }
    this._addParticles(g, isYang ? 0xb0b0c8 : 0xf0c0e0, 18+Math.floor(strength*28));
    this._addGroup(g);
  }

  /* ═══════════════════════════════════════════════════════
   * 水区 · 西北
   * yr > 0.55 → 壬水：宽广莲花池，波涛汹涌
   * yr < 0.45 → 癸水：薄雾细雨，露滴晶莹
   * ══════════════════════════════════════════════════════ */
  _addShuiZone(strength, yr) {
    const sc = .55 + strength*1.6;
    const isYang = yr > .55;
    const g = new THREE.Group();
    g.position.set(-3.5, 0, -4.5);
    const R = (isYang ? 2.2 : 1.6) * sc;

    if (isYang) {
      // 壬水：宽广水池（高亮蓝，确保可见）
      const water=this._mesh(new THREE.CircleGeometry(R,32),
        { color:0x0a4080, emissive:0x1166cc, emissiveIntensity:3.5,
          roughness:0, metalness:.7, transparent:true, opacity:.95 });
      water.rotation.x=-Math.PI/2; water.position.y=.02; g.add(water);
      this.animated.push({ mesh:water, type:'pulse', base:3.5, amp:1.2, speed:.85 });

      // 水面波纹（亮蓝环）
      for (let i=0; i<3; i++) {
        const ring=this._mesh(new THREE.RingGeometry(R*(.22+i*.26), R*(.26+i*.26), 32),
          { color:0x44aaff, emissive:0x2288ff, emissiveIntensity:2.5,
            transparent:true, opacity:.5-i*.12, side:THREE.DoubleSide });
        ring.rotation.x=-Math.PI/2; ring.position.y=.03+i*.01; g.add(ring);
        this.animated.push({ mesh:ring, type:'ripple', phase:i*1.2 });
      }

      // 莲花（放大，明显）
      for (let i=0; i<6; i++) {
        const a=(i/6)*Math.PI*2;
        // 花瓣（4片扁锥组成一朵）
        for (let p=0; p<4; p++) {
          const pa=a+(p/4)*Math.PI*2;
          const petal=this._mesh(new THREE.ConeGeometry(.09,.22,5),
            { color:0xff99cc, emissive:0xcc3366, emissiveIntensity:1.5 });
          petal.position.set(
            Math.cos(a)*R*.58+Math.cos(pa)*.1,
            .18,
            Math.sin(a)*R*.58+Math.sin(pa)*.1);
          petal.rotation.z=Math.PI+Math.sin(pa)*.4;
          petal.rotation.x=-Math.cos(pa)*.4;
          g.add(petal);
        }
        // 花蕊
        const pistil=this._mesh(new THREE.SphereGeometry(.06,6,6),
          { color:0xffee44, emissive:0xddaa00, emissiveIntensity:2.0 });
        pistil.position.set(Math.cos(a)*R*.58, .3, Math.sin(a)*R*.58);
        this.animated.push({ mesh:pistil, type:'float', phase:i*1.4 });
        g.add(pistil);
      }

      // 水面反光闪点
      this._addParticles(g, 0x88ddff, 35+Math.floor(strength*50));
      this._addParticles(g, 0xffffff, 12+Math.floor(strength*18));

    } else {
      // 癸水：雾气水池（亮蓝+银白）
      const mist=this._mesh(new THREE.CircleGeometry(R,24),
        { color:0x083860, emissive:0x1155bb, emissiveIntensity:3.0,
          roughness:.05, metalness:.6, transparent:true, opacity:.9 });
      mist.rotation.x=-Math.PI/2; mist.position.y=.02; g.add(mist);
      this.animated.push({ mesh:mist, type:'pulse', base:3.0, amp:1.0, speed:.7 });

      // 外发光环
      const outerGlow=this._mesh(new THREE.RingGeometry(R, R*1.2, 32),
        { color:0x4499ee, emissive:0x3388dd, emissiveIntensity:2.0,
          transparent:true, opacity:.4, side:THREE.DoubleSide });
      outerGlow.rotation.x=-Math.PI/2; outerGlow.position.y=.03;
      this.animated.push({ mesh:outerGlow, type:'ripple', phase:0 });
      g.add(outerGlow);

      // 露珠（更大更亮）
      for (let i=0; i<Math.floor(10+strength*12); i++) {
        const a=Math.random()*Math.PI*2, r=Math.random()*R*.88;
        const dew=this._mesh(new THREE.SphereGeometry(.08+Math.random()*.08,8,8),
          { color:0xaaddff, emissive:0x2266cc, emissiveIntensity:2.5,
            transparent:true, opacity:.85, metalness:.6, roughness:0 });
        dew.position.set(Math.cos(a)*r, .1+Math.random()*.35, Math.sin(a)*r); g.add(dew);
        this.animated.push({ mesh:dew, type:'float', phase:Math.random()*6 });
      }
      this._addParticles(g, 0x88ccff, 28+Math.floor(strength*40));
      this._addParticles(g, 0xddeeff, 15+Math.floor(strength*22));
    }
    this._addGroup(g);
  }

  /* ─── 中央四柱祭坛 · 精准映射四柱天干 ─────────────── */
  _addAltar(baziData) {
    const g = new THREE.Group();

    // 祭坛底座
    g.add(Object.assign(
      this._mesh(new THREE.CylinderGeometry(2.0,2.2,.22,8),
        { color:0x14122a, emissive:0x0a0818, emissiveIntensity:.5, roughness:.35, metalness:.65 }),
      { position:new THREE.Vector3(0,.11,0) }));

    // 四柱对应：年[左后]月[右后]时[右前]日[左前/日主最大]
    const pillars = baziData.pillars || {};
    const pCfg = [
      { pos:[-1.1,0,-1.1], key:'year',  label:'年' },
      { pos:[ 1.1,0,-1.1], key:'month', label:'月' },
      { pos:[ 1.1,0, 1.1], key:'hour',  label:'时' },
      { pos:[-1.1,0, 1.1], key:'day',   label:'日' },
    ];

    pCfg.forEach(({ pos, key, label }, idx) => {
      const stem  = pillars[key]?.stem || '甲';
      const wx    = SceneBuilder.STEM_WX[stem] || '木';
      const isDay = key === 'day';
      const yang  = SceneBuilder.STEM_YANG[stem] ?? 1;
      const col   = SceneBuilder.WX_HEX[wx];
      const emi   = SceneBuilder.WX_EMI[wx];

      // 柱体：日主最高，阳干高，阴干低
      const h = isDay ? 2.6 : (yang ? 2.1 : 1.7);
      const pillar=this._mesh(
        new THREE.CylinderGeometry(isDay?.13:.1, isDay?.17:.13, h, yang?6:10),
        { color:col, emissive:emi, emissiveIntensity:.4, roughness:.3, metalness:.55 });
      pillar.position.set(pos[0], h/2+.22, pos[2]); pillar.castShadow=true; g.add(pillar);

      // 宝珠：阳=八面体尖锐, 阴=球形圆润
      const orbR = isDay?.28:(yang?.19:.22);
      const orbGeo = yang
        ? new THREE.OctahedronGeometry(orbR,0)
        : new THREE.SphereGeometry(orbR,10,10);
      const orb=this._mesh(orbGeo,
        { color:col, emissive:col, emissiveIntensity:isDay?2.0:1.4, roughness:0, metalness:.8 });
      orb.position.set(pos[0], h+orbR+.22, pos[2]);
      this.animated.push({ mesh:orb, type:'orbPulse', phase:idx*Math.PI*.5 });
      if (yang) this.animated.push({ mesh:orb, type:'rotate', speed:.006+idx*.001 });
      g.add(orb);

      // 日主光柱（仅日柱）
      if (isDay) {
        const beam=this._mesh(new THREE.CylinderGeometry(.04,.14,3.0,8),
          { color:col, emissive:col, emissiveIntensity:1.8, transparent:true, opacity:.2 });
        beam.position.set(pos[0], h*.6+.22, pos[2]);
        this.animated.push({ mesh:beam, type:'pulse', base:.2, amp:.12, speed:1.4, isOpacity:true });
        g.add(beam);
      }
    });

    // 双环（旋转对称）
    const ring1=this._mesh(new THREE.TorusGeometry(1.2,.05,8,48),
      { color:0xc9a96e, emissive:0xc9a96e, emissiveIntensity:1.6, roughness:0, metalness:1 });
    ring1.position.y=1.8;
    this.animated.push({ mesh:ring1, type:'rotate', speed:.009 }); g.add(ring1);

    const ring2=this._mesh(new THREE.TorusGeometry(.7,.035,6,32),
      { color:0x6eb5ff, emissive:0x6eb5ff, emissiveIntensity:1.4, roughness:0, metalness:1 });
    ring2.position.y=1.8; ring2.rotation.x=Math.PI*.3;
    this.animated.push({ mesh:ring2, type:'rotate', speed:-.012 }); g.add(ring2);

    g.userData.dyn=true; this.scene.add(g);
  }

  /* ─── 大运外环（元运气场）───────────────────────────── */
  _addDayunRing(dayun) {
    const wx = dayun.wx || '金';
    const favorable = dayun.favorable ?? true;
    const col = SceneBuilder.WX_HEX[wx];
    const emi = SceneBuilder.WX_EMI[wx];

    // 主环
    const ring=this._mesh(new THREE.TorusGeometry(11.5,.4,10,96),
      { color:col, emissive:col,
        emissiveIntensity: favorable ? 1.8 : 0.25,
        metalness:.7, roughness:.2, transparent:true,
        opacity: favorable ? .7 : .3 });
    ring.position.y=-0.6; ring.rotation.x=Math.PI*.5; ring.userData.dyn=true;
    this.animated.push({ mesh:ring, type:'rotate', speed: favorable ? .003 : -.003 });
    this.scene.add(ring);

    // 副环（倾斜）
    const ring2=this._mesh(new THREE.TorusGeometry(11.9,.15,6,64),
      { color:col, emissive:col, emissiveIntensity: favorable ? .9 : .1, transparent:true, opacity:.28 });
    ring2.position.y=-0.6; ring2.rotation.x=Math.PI*.42; ring2.userData.dyn=true;
    this.animated.push({ mesh:ring2, type:'rotate', speed: favorable ? -.005 : .005 });
    this.scene.add(ring2);

    // 指引灯标（边缘竖柱）
    const beacon=this._mesh(new THREE.CylinderGeometry(.04,.18,4,6),
      { color:col, emissive:col, emissiveIntensity:2.2, transparent:true, opacity:.6 });
    beacon.position.set(11.5, 1, 0); beacon.userData.dyn=true;
    this.animated.push({ mesh:beacon, type:'pulse', base:.6, amp:.3, speed:1.5, isOpacity:true });
    this.scene.add(beacon);

    // 对侧灯标
    const beacon2=this._mesh(new THREE.CylinderGeometry(.04,.18,4,6),
      { color:col, emissive:col, emissiveIntensity:2.2, transparent:true, opacity:.6 });
    beacon2.position.set(-11.5, 1, 0); beacon2.userData.dyn=true;
    this.animated.push({ mesh:beacon2, type:'pulse', base:.4, amp:.35, speed:1.8, isOpacity:true });
    this.scene.add(beacon2);
  }

  /* ─── 流年天空粒子（年运气场）──────────────────────── */
  _addLiunianSky(liunian) {
    const wx = liunian.wx || '火';
    const col = SceneBuilder.WX_HEX[wx];

    const n = 220;
    const pos=new Float32Array(n*3), vel=new Float32Array(n*3);
    for (let i=0; i<n; i++) {
      const a=Math.random()*Math.PI*2, r=5+Math.random()*7;
      pos[i*3]  =Math.cos(a)*r;
      pos[i*3+1]=Math.random()*14-2;
      pos[i*3+2]=Math.sin(a)*r;
      vel[i*3]  =(Math.random()-.5)*.003;
      vel[i*3+1]=-(0.013+Math.random()*.018); // 自上而下落
      vel[i*3+2]=(Math.random()-.5)*.003;
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const pts=new THREE.Points(geo, new THREE.PointsMaterial({
      color:col, size:.11, transparent:true, opacity:.5,
      blending:THREE.AdditiveBlending, depthWrite:false,
    }));
    pts.userData.dyn=true;
    pts.userData.vel=vel;
    pts.userData.maxY=12;
    pts.userData.minY=-2;
    this.scene.add(pts);
    this.animated.push({ mesh:pts, type:'liunianSky' });
  }

  /* ─── 五行区域点光源 ─────────────────────────────────── */
  _addZoneLights(s, yr) {
    [
      { pos:[ .5,4,-5],    wx:'木' },
      { pos:[ 1, 4, 5.5],  wx:'火' },
      { pos:[-5.5,4,2],    wx:'土' },
      { pos:[ 5.5,4,-1],   wx:'金' },
      { pos:[-3.5,4,-4.5], wx:'水' },
    ].forEach(({ pos, wx }) => {
      const col = SceneBuilder.WX_HEX[wx];
      const light=new THREE.PointLight(col, (s[wx]||.2)*3.5, 10, 2);
      light.position.set(...pos); light.userData.dyn=true; this.scene.add(light);
    });
  }

  /* ─── 粒子系统 ───────────────────────────────────────── */
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
    const pts=new THREE.Points(geo, new THREE.PointsMaterial({
      color, size:.07, transparent:true, opacity:.72,
      blending:THREE.AdditiveBlending, depthWrite:false,
    }));
    pts.userData.vel=vel; pts.userData.maxY=rising?3.5:2.2;
    group.add(pts); this.animated.push({ mesh:pts, type:'particles' });
  }

  /* ─── 动画循环 ───────────────────────────────────────── */
  startRenderLoop() {
    const loop=()=>{
      requestAnimationFrame(loop);
      this._tick(this.clock.getElapsedTime());
      this.renderer.render(this.scene, this.camera);
    };
    loop(); return this;
  }

  _tick(t) {
    for (const obj of this.animated) {
      const m=obj.mesh; if (!m) continue;
      switch(obj.type) {
        case 'float':
          m.position.y+=Math.sin(t*.9+(obj.phase||0))*.0004; break;
        case 'rotate':
          m.rotation.y+=obj.speed||.005; break;
        case 'orbPulse': {
          const sc=1+.14*Math.sin(t*2+(obj.phase||0)); m.scale.setScalar(sc); break;
        }
        case 'ripple':
          if (m.material) m.material.opacity=.12+.16*Math.abs(Math.sin(t*.55+(obj.phase||0))); break;
        case 'pulse':
          if (obj.isOpacity) { if (m.material) m.material.opacity=obj.base+obj.amp*Math.sin(t*obj.speed); }
          else               { if (m.material) m.material.emissiveIntensity=obj.base+obj.amp*Math.sin(t*obj.speed); }
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
          m.geometry.attributes.position.needsUpdate=true; break;
        }
        case 'liunianSky': {
          const pa=m.geometry.attributes.position.array;
          const v=m.userData.vel;
          for (let i=0; i<pa.length/3; i++) {
            pa[i*3]+=v[i*3]; pa[i*3+1]+=v[i*3+1]; pa[i*3+2]+=v[i*3+2];
            if (pa[i*3+1] < m.userData.minY) {
              const a=Math.random()*Math.PI*2, r=5+Math.random()*7;
              pa[i*3]=Math.cos(a)*r; pa[i*3+1]=m.userData.maxY; pa[i*3+2]=Math.sin(a)*r;
            }
          }
          m.geometry.attributes.position.needsUpdate=true; break;
        }
      }
    }
  }

  /* ─── 轨道控制 ───────────────────────────────────────── */
  _bindControls() {
    const el=this.renderer.domElement;
    el.addEventListener('mousedown', e=>{
      this._orbit.dragging=true; this._orbit.lastX=e.clientX; this._orbit.lastY=e.clientY; });
    window.addEventListener('mouseup', ()=>{ this._orbit.dragging=false; });
    window.addEventListener('mousemove', e=>{
      if (!this._orbit.dragging) return;
      this._orbit.theta-=(e.clientX-this._orbit.lastX)*.005;
      this._orbit.phi=Math.max(.3,Math.min(1.45, this._orbit.phi+(e.clientY-this._orbit.lastY)*.004));
      this._orbit.lastX=e.clientX; this._orbit.lastY=e.clientY; this._syncCamera();
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
      this._orbit.phi=Math.max(.3,Math.min(1.45, this._orbit.phi+(t.clientY-lt.clientY)*.005));
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

  /* ─── 工具 ───────────────────────────────────────────── */
  _mesh(geo, matProps) {
    const mat=new THREE.MeshStandardMaterial(matProps);
    const m=new THREE.Mesh(geo,mat);
    m.castShadow=m.receiveShadow=true;
    return m;
  }

  _groundPatch(radius, color) {
    const m=this._mesh(new THREE.CircleGeometry(radius,16),{ color,roughness:1 });
    m.rotation.x=-Math.PI/2; m.position.y=.01; return m;
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
