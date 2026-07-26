/**
 * 司马八字 · 岛屿加载器 island-loader.js
 *
 * 职责：
 *   1. 初始化 Three.js 场景（含 CSS2DRenderer 标注层）
 *   2. 调用后端 /generate → 轮询 /status → 加载 GLB
 *   3. onProgress(stage, pct) 回调与 main-new.js STAGE_MAP 对齐
 */

const IslandLoader = (() => {

  const API_BASE     = window.ISLAND_API_BASE || 'https://simabazi-island.onrender.com';
  const POLL_MS      = 3000;
  const MAX_WAIT_MS  = 180000;

  let _scene        = null;
  let _camera       = null;
  let _renderer     = null;
  let _labelRenderer= null;   // CSS2DRenderer
  let _controls     = null;
  let _islandGroup  = null;
  let _container    = null;
  let _animId       = null;

  // ── 初始化场景 ───────────────────────────────────────────
  function initScene(container) {
    _container = container;
    const W = container.clientWidth  || window.innerWidth;
    const H = container.clientHeight || window.innerHeight;

    // Scene
    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x080810);
    _scene.fog = new THREE.FogExp2(0x080810, 0.012);

    // Camera
    _camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
    _camera.position.set(0, 12, 22);

    // WebGL Renderer
    _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    _renderer.setSize(W, H);
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.toneMapping = THREE.ACESFilmicToneMapping;
    _renderer.toneMappingExposure = 1.2;
    _renderer.shadowMap.enabled = true;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(_renderer.domElement);

    // CSS2DRenderer（标注标签层）
    if (typeof THREE.CSS2DRenderer !== 'undefined') {
      _labelRenderer = new THREE.CSS2DRenderer();
      _labelRenderer.setSize(W, H);
      _labelRenderer.domElement.style.position = 'absolute';
      _labelRenderer.domElement.style.top = '0';
      _labelRenderer.domElement.style.left = '0';
      _labelRenderer.domElement.style.pointerEvents = 'none';
      container.appendChild(_labelRenderer.domElement);
    }

    // Lights
    _scene.add(new THREE.AmbientLight(0x1e2040, 1.8));
    const sun = new THREE.DirectionalLight(0xffeedd, 3.5);
    sun.position.set(5, 15, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.width  = 2048;
    sun.shadow.mapSize.height = 2048;
    _scene.add(sun);
    const fill = new THREE.DirectionalLight(0x3366aa, 1.0);
    fill.position.set(-8, 4, -5);
    _scene.add(fill);
    const rim = new THREE.DirectionalLight(0xc9a96e, 0.5);
    rim.position.set(0, -5, -10);
    _scene.add(rim);

    // Stars
    _addStars();

    // OrbitControls
    if (typeof THREE.OrbitControls !== 'undefined') {
      _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
      _controls.enableDamping  = true;
      _controls.dampingFactor  = 0.05;
      _controls.minDistance    = 8;
      _controls.maxDistance    = 40;
      _controls.maxPolarAngle  = Math.PI * 0.75;
      _controls.autoRotate     = true;
      _controls.autoRotateSpeed= 0.5;
      _controls.target.set(0, 0, 0);
    }

    // Resize
    window.addEventListener('resize', _onResize);

    // Render loop
    _startLoop();
  }

  function _addStars() {
    const geo   = new THREE.BufferGeometry();
    const verts = [];
    for (let i = 0; i < 2500; i++) {
      verts.push(
        (Math.random() - 0.5) * 220,
        (Math.random() - 0.5) * 220,
        (Math.random() - 0.5) * 220
      );
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    _scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.18, transparent: true, opacity: 0.8
    })));
  }

  function _onResize() {
    if (!_container) return;
    const W = _container.clientWidth  || window.innerWidth;
    const H = _container.clientHeight || window.innerHeight;
    _camera.aspect = W / H;
    _camera.updateProjectionMatrix();
    _renderer.setSize(W, H);
    if (_labelRenderer) _labelRenderer.setSize(W, H);
  }

  function _startLoop() {
    if (_animId) cancelAnimationFrame(_animId);
    const tick = () => {
      _animId = requestAnimationFrame(tick);
      if (_controls) _controls.update();
      _renderer.render(_scene, _camera);
      if (_labelRenderer) _labelRenderer.render(_scene, _camera);
    };
    tick();
  }

  // ── 主入口：生成并展示岛屿 ────────────────────────────────
  async function generateIsland(baziData, { onProgress, onComplete, onError } = {}) {
    try {
      // 检查缓存
      const cached = UserState.getIslandUrl(baziData);
      if (cached) {
        onProgress?.('completed', 95);
        await _loadGLB(cached);
        onProgress?.('completed', 100);
        onComplete?.(cached);
        return;
      }

      // 提交任务
      onProgress?.('queued', 5);
      const genResp = await fetch(`${API_BASE}/generate`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ bazi_data: baziData }),
      });
      if (!genResp.ok) throw new Error(`服务器错误: ${genResp.status}`);
      const genData = await genResp.json();

      // 命中服务端缓存
      if (genData.status === 'completed' && genData.model_url) {
        onProgress?.('completed', 95);
        await _loadGLB(genData.model_url);
        UserState.saveIslandUrl(baziData, genData.model_url);
        onProgress?.('completed', 100);
        onComplete?.(genData.model_url);
        return;
      }

      // 轮询
      const jobId    = genData.job_id;
      const modelUrl = await _poll(jobId, onProgress);

      // 加载GLB
      onProgress?.('completed', 95);
      await _loadGLB(modelUrl);
      UserState.saveIslandUrl(baziData, modelUrl);
      onProgress?.('completed', 100);
      onComplete?.(modelUrl);

    } catch (err) {
      console.error('[IslandLoader]', err);
      onError?.(err.message || '未知错误');
    }
  }

  // ── 轮询 ─────────────────────────────────────────────────
  async function _poll(jobId, onProgress) {
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await _sleep(POLL_MS);
      let data;
      try {
        const r = await fetch(`${API_BASE}/status/${jobId}`);
        if (!r.ok) continue;
        data = await r.json();
      } catch { continue; }

      const stage = data.stage || 'queued';
      const pct   = data.progress || 0;
      onProgress?.(stage, pct);

      if (stage === 'completed' && data.model_url) return data.model_url;
      if (stage === 'error') throw new Error(data.error || '生成失败');
    }
    throw new Error('生成超时，请重试');
  }

  // ── 加载 GLB ─────────────────────────────────────────────
  async function _loadGLB(url) {
    return new Promise((resolve, reject) => {
      if (typeof THREE.GLTFLoader === 'undefined') {
        reject(new Error('GLTFLoader未加载'));
        return;
      }
      new THREE.GLTFLoader().load(url, (gltf) => {
        const model = gltf.scene;

        // 居中 + 缩放到 10 单位
        const box    = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const scale  = 10 / Math.max(size.x, size.y, size.z);
        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale));

        // 阴影
        model.traverse(c => {
          if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
        });

        if (_islandGroup) _scene.remove(_islandGroup);
        _islandGroup = new THREE.Group();
        _islandGroup.add(model);
        _scene.add(_islandGroup);

        resolve(gltf);
      }, undefined, reject);
    });
  }

  // ── 工具 ─────────────────────────────────────────────────
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── 公开接口 ─────────────────────────────────────────────
  function getScene()       { return _scene; }
  function getIslandGroup() { return _islandGroup; }
  function getCamera()      { return _camera; }
  function getRenderer()    { return _renderer; }
  function stopAutoRotate() { if (_controls) _controls.autoRotate = false; }
  function startAutoRotate(){ if (_controls) _controls.autoRotate = true; }

  return { initScene, generateIsland, getScene, getCamera, getRenderer, getIslandGroup, stopAutoRotate, startAutoRotate };
})();
