/**
 * 司马八字 · 岛屿装饰管理 island-decorations.js
 *
 * 任务/成就解锁后，在基础岛屿上叠加小型3D装饰物件（GLB）。
 * 装饰物件预生成后放在 /assets/decorations/ 目录下。
 *
 * 未来接入真实GLB之前，用Three.js几何体作为占位符（placeholder）。
 */

const IslandDecorations = (() => {

  // ── 装饰定义（id → 配置）─────────────────────────────────
  const DECOR_DEFS = {
    // 任务解锁
    welcome_glow    : { pos:[0,6,0],    type:'glow',    color:0xc9a96e, size:0.8, glb:null },
    sprout_plant    : { pos:[-2,1,-2],  type:'crystal', color:0x6FCF97, size:0.4, glb:'sprout.glb' },
    cherry_blossom  : { pos:[2,1.5,2],  type:'tree',    color:0xffb7c5, size:1.2, glb:'cherry.glb' },
    moon_shrine     : { pos:[0,1.5,-4], type:'crystal', color:0xaad4ff, size:1.5, glb:'moon_shrine.glb' },
    share_flower    : { pos:[3,0.5,-1], type:'crystal', color:0xff9cdf, size:0.5, glb:'flower.glb' },
    shensha_glow    : { pos:[0,4,0],    type:'ring',    color:0xc9a96e, size:5.0, glb:null },
    island_expand   : { pos:[0,-0.5,0], type:'ring',    color:0x6EB5FF, size:6.0, glb:null },

    // 水晶商品购买后（预留）
    crystal_water   : { pos:[-3,0.5,1], type:'crystal', color:0x6EB5FF, size:0.8, glb:'basin_clear.glb' },
    crystal_amethyst: { pos:[0,0.5,-3], type:'crystal', color:0x9b59b6, size:0.8, glb:'pillar_amethyst.glb' },
    crystal_rose    : { pos:[3,0.5,-1], type:'crystal', color:0xffb7c5, size:0.6, glb:'bracelet_rose.glb' },
    crystal_obsidian: { pos:[-3,0.5,-2],type:'crystal', color:0x1a1a2e, size:0.7, glb:'bracelet_obsidian.glb' },
  };

  const GLB_BASE  = '/assets/decorations/';
  let _scene      = null;
  let _placed     = {};   // decorId → THREE.Object3D

  // ── 初始化（传入scene引用）───────────────────────────────
  function init(scene) { _scene = scene; }

  // ── 恢复已解锁装饰（每次进岛屿后调用）──────────────────
  function restoreAll(baziData) {
    const decorations = UserState.getDecorations();
    decorations.forEach(d => add(d.id, baziData));
  }

  // ── 添加单个装饰 ─────────────────────────────────────────
  function add(decorId, baziData) {
    if (!_scene) return;
    if (_placed[decorId]) return;   // 已存在

    const def = DECOR_DEFS[decorId];
    if (!def) return;

    // 有GLB文件优先加载，否则用几何占位
    if (def.glb && typeof THREE.GLTFLoader !== 'undefined') {
      _loadGLB(decorId, def);
    } else {
      _addPlaceholder(decorId, def);
    }
  }

  // ── 移除装饰 ─────────────────────────────────────────────
  function remove(decorId) {
    if (_placed[decorId]) {
      _scene.remove(_placed[decorId]);
      delete _placed[decorId];
    }
  }

  // ── 加载真实 GLB ─────────────────────────────────────────
  function _loadGLB(decorId, def) {
    new THREE.GLTFLoader().load(
      GLB_BASE + def.glb,
      (gltf) => {
        const model = gltf.scene;
        model.position.set(...def.pos);
        model.scale.setScalar(def.size);
        model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        _scene.add(model);
        _placed[decorId] = model;
        _addEntryAnimation(model);
      },
      undefined,
      () => _addPlaceholder(decorId, def)   // 加载失败回退占位
    );
  }

  // ── 几何占位符（GLB未就绪时）────────────────────────────
  function _addPlaceholder(decorId, def) {
    let mesh;
    const mat = new THREE.MeshStandardMaterial({
      color      : def.color,
      emissive   : def.color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity    : 0.85,
    });

    switch (def.type) {
      case 'glow': {
        // 发光球
        const geo = new THREE.SphereGeometry(def.size, 16, 16);
        mesh = new THREE.Mesh(geo, mat);
        // 添加点光源
        const light = new THREE.PointLight(def.color, 1.5, 6);
        light.position.set(...def.pos);
        _scene.add(light);
        break;
      }
      case 'ring': {
        // 光环
        const geo = new THREE.TorusGeometry(def.size, 0.05, 8, 64);
        mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = Math.PI / 2;
        break;
      }
      case 'tree': {
        // 锥形树
        const group = new THREE.Group();
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.1, def.size * 0.6, 6),
          new THREE.MeshStandardMaterial({ color: 0x8B6914 })
        );
        const crown = new THREE.Mesh(
          new THREE.ConeGeometry(def.size * 0.5, def.size, 8),
          mat
        );
        crown.position.y = def.size * 0.8;
        group.add(trunk, crown);
        mesh = group;
        break;
      }
      default: {
        // 水晶柱
        const geo = new THREE.ConeGeometry(def.size * 0.3, def.size, 6);
        mesh = new THREE.Mesh(geo, mat);
      }
    }

    mesh.position.set(...def.pos);
    _scene.add(mesh);
    _placed[decorId] = mesh;
    _addEntryAnimation(mesh);
  }

  // ── 入场动画（从下方浮现）───────────────────────────────
  function _addEntryAnimation(obj) {
    const startY = obj.position.y - 3;
    const endY   = obj.position.y;
    obj.position.y = startY;

    let elapsed = 0;
    const duration = 1200;
    const startTime = Date.now();

    const tick = () => {
      elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);   // cubic ease-out
      obj.position.y = startY + (endY - startY) * ease;
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
  }

  // ── 流年/大运触发的氛围变化 ──────────────────────────────
  function applyLiunianEffect(liuNianElement) {
    const colorMap = {
      '木': 0x6FCF97, '火': 0xEB5757,
      '土': 0xF2C94C, '金': 0xC8C8D8, '水': 0x6EB5FF,
    };
    const color = colorMap[liuNianElement] || 0xc9a96e;

    // 修改环境光色调
    if (_scene) {
      _scene.traverse(obj => {
        if (obj.isAmbientLight) obj.color.setHex(color);
      });
    }
  }

  return { init, restoreAll, add, remove, applyLiunianEffect };
})();
