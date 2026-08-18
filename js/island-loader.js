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
  const POLL_MS      = 4000;
  const MAX_WAIT_MS  = 600000;  // 10分钟，3D生成本身就慢

  let _scene        = null;
  let _camera       = null;
  let _renderer     = null;
  let _labelRenderer= null;   // CSS2DRenderer
  let _controls     = null;
  let _islandGroup  = null;
  let _container    = null;
  let _animId       = null;
  let _flyTween     = null;   // 相机动画 tween 状态
  let _revealTween  = null;   // 岛屿入场（缩放+淡入）tween 状态，与 _flyTween 并行独立运行

  // ── 初始化场景 ───────────────────────────────────────────
  function initScene(container) {
    if (_scene) return;  // 已初始化，防止重复创建 canvas
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
    // CSS2DRenderer.js 是独立CDN脚本，网络较差时可能加载较慢/失败，
    // 不能"检查一次没有就永久放弃"（会导致标注标签之后走固定位置兜底、
    // 完全不跟随3D物体），改为限时轮询等待其就绪。
    _setupLabelRenderer(container, Date.now());

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

  // ── CSS2DRenderer 限时轮询等待（CDN加载时序不确定）──────
  const LABEL_RENDERER_MAX_WAIT_MS = 5000;
  const LABEL_RENDERER_POLL_MS     = 100;

  function _setupLabelRenderer(container, startedAt) {
    if (typeof THREE.CSS2DRenderer !== 'undefined') {
      const W = container.clientWidth  || window.innerWidth;
      const H = container.clientHeight || window.innerHeight;
      _labelRenderer = new THREE.CSS2DRenderer();
      _labelRenderer.setSize(W, H);
      _labelRenderer.domElement.style.position = 'absolute';
      _labelRenderer.domElement.style.top = '0';
      _labelRenderer.domElement.style.left = '0';
      _labelRenderer.domElement.style.pointerEvents = 'none';
      container.appendChild(_labelRenderer.domElement);
      return;
    }
    if (Date.now() - startedAt >= LABEL_RENDERER_MAX_WAIT_MS) {
      console.warn(`[IslandLoader] CSS2DRenderer 在 ${LABEL_RENDERER_MAX_WAIT_MS}ms 内仍未就绪（CDN加载失败？），3D标注标签将不可用`);
      return;
    }
    setTimeout(() => _setupLabelRenderer(container, startedAt), LABEL_RENDERER_POLL_MS);
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
      if (_flyTween) {
        // 相机飞行期间：手动更新 tween，跳过 controls.update()
        // 避免 OrbitControls 内部球坐标覆盖 tween 设置的位置
        _flyTween.update(performance.now());
        if (_controls) {
          _camera.lookAt(_controls.target);
        }
      } else {
        if (_controls) _controls.update();
      }
      // 岛屿入场（缩放+淡入）tween：与 _flyTween 完全独立的动画通道，
      // playRevealFlight() 期间两者同时驱动；_flyTween 单独播放时
      // （如 Tutorial 的 flyTo）_revealTween 恒为 null，不影响现状。
      if (_revealTween) {
        _revealTween.update(performance.now());
      }
      _renderer.render(_scene, _camera);
      if (_labelRenderer) _labelRenderer.render(_scene, _camera);
    };
    tick();
  }

  // ── 主入口：生成并展示岛屿 ────────────────────────────────
  // forceRegen: true 时跳过 UserState.getIslandUrl() 本地缓存读取，直接进入正常的
  // /generate 请求流程（请求体带 force_regen:true，后端 GenerateRequest.force_regen
  // 字段已存在，main.py 不需要改动）。用于"设置面板→完全重新生成"场景，绕开前端本地
  // 缓存 + 后端文件缓存两层，真实重新走图像+3D生成流程。不传时（默认 false）行为与
  // 改动前完全一致——向后兼容现有调用点（main-new.js::_startGenerate() 默认调用）。
  async function generateIsland(baziData, { onProgress, onComplete, onError, forceRegen = false } = {}) {
    try {
      // 检查缓存（forceRegen 时跳过，不读取也不短路返回）
      if (!forceRegen) {
        const cached = UserState.getIslandUrl(baziData);
        if (cached) {
          onProgress?.('completed', 95);
          await _loadGLB(cached);
          onProgress?.('completed', 100);
          onComplete?.(cached);
          return;
        }
      }

      // 提交任务
      onProgress?.('queued', 5);
      const genResp = await fetch(`${API_BASE}/generate`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ bazi_data: baziData, force_regen: forceRegen }),
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
      const msg = err?.message || err?.toString?.() || JSON.stringify(err) || '未知错误';
      console.error('[IslandLoader] 详细错误:', err);
      onError?.(msg);
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
      }, undefined, (e) => {
        reject(new Error('GLB加载失败: ' + (e?.message || e?.type || String(e))));
      });
    });
  }

  // ── 工具 ─────────────────────────────────────────────────
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── 直接加载已有 GLB（不走生成流程）────────────────────
  async function loadFromUrl(url) {
    await _loadGLB(url);
  }

  // ── 相机平滑飞行（Tutorial 专用）────────────────────────
  /**
   * 将相机平滑飞到 camPos，镜头朝向 lookAt。
   * @param {THREE.Vector3} camPos    - 目标相机世界坐标
   * @param {THREE.Vector3} lookAt    - OrbitControls 的目标点
   * @param {number}        durationMs
   * @param {Function}      onComplete - 动画结束回调
   */
  function flyTo(camPos, lookAt, durationMs, onComplete) {
    if (!_camera || !_controls) { onComplete?.(); return; }
    const dur        = durationMs || 1500;
    const startCamPos= _camera.position.clone();
    const startTarget= _controls.target.clone();
    const endCamPos  = camPos.clone();
    const endTarget  = lookAt ? lookAt.clone() : new THREE.Vector3(0, 0, 0);
    const startTime  = performance.now();
    _flyTween = {
      update(now) {
        const raw  = Math.min((now - startTime) / dur, 1);
        const ease = raw < 0.5 ? 4*raw*raw*raw : 1 - Math.pow(-2*raw+2, 3)/2;
        _camera.position.lerpVectors(startCamPos, endCamPos, ease);
        _controls.target.lerpVectors(startTarget, endTarget, ease);
        if (raw >= 1) { _flyTween = null; onComplete?.(); }
      }
    };
  }

  /** 锁定或解锁 OrbitControls（Tutorial 期间锁定用户交互）*/
  function setControlsEnabled(enabled) {
    if (_controls) _controls.enabled = !!enabled;
  }

  // ── 岛屿"揭晓"入场动画（首次生成/加载完成后的仪式性揭幕）──
  // 与 flyTo() 的关系：flyTo() 是 Tutorial 专用的通用相机飞行能力，
  // 这里直接复用它做相机运镜部分（不重新发明缓动曲线），额外并行叠加一条
  // 独立的岛屿模型 缩放+透明度 tween（_revealTween，见 _startLoop 里的
  // 驱动逻辑），两条 tween 各自独立结束、各自回调，都完成后才触发
  // playRevealFlight() 的 onComplete。不修改 flyTo() 本身的签名/行为，
  // Tutorial 现有调用方不受影响。
  const REVEAL_DURATION     = 2600;   // ms，比 flyTo() 默认 1500ms 更长——仪式性揭幕而非普通切镜
  // 2026-08-18 第三轮qa-reviewer像素级实测证伪：上一版把 REVEAL_START_OPACITY
  // 从0调到0.1本身"数值生效了"，但用headless Chromium真实截图+像素采样测量
  // 画面中央区域发现，不管opacity是0还是0.1，t<1100ms这段时间的实际渲染结果
  // 跟纯星空背景毫无肉眼可辨的差别——真正原因根本不是opacity，是
  // REVEAL_START_SCALE=0.04：岛屿模型统一被归一化成最长边10个场景单位
  // （见 _loadGLB()），缩小到0.04倍只剩0.4个单位，从起始机位 REVEAL_CAM_POS
  // （原为约70个单位远）看过去大概只占屏幕4个像素，不管透明度设多少，
  // 4像素的东西人眼根本看不见，调透明度这个方向从一开始就点错了技能树。
  // 真正的修复是把起始缩放和起始机位距离都调整到"哪怕在最小状态也有几十
  // 像素可辨认轮廓"的量级，并把岛屿自己的显现曲线从慢启动的
  // ease-in-out（原来用 _easeInOutCubic）换成快启动的 ease-out
  // （_easeOutCubic），让"从若隐若现到清晰"这段视觉变化尽量往动画前段集中，
  // 而不是绝大部分观感变化都堆积在动画后半段——这一系列改动用同一份
  // headless Chromium 像素采样脚本反复迭代验证过，不是只改数值不看渲染结果。
  const REVEAL_START_SCALE  = 0.22;   // 揭晓前岛屿的初始缩放（从0.04调大，配合更近的起始机位，
                                       // 保证起始帧就有肉眼可辨的轮廓，而不是几像素的噪点）
  const REVEAL_START_OPACITY= 0.32;   // 揭晓前岛屿的初始透明度——数值本身早已生效（上一轮已验证），
                                       // 这次问题在scale不在这里，保留一定透明度感制造"若隐若现"，
                                       // 不是"完全清晰"也不是"完全消失"
  const REVEAL_DELAY_RATIO  = 0.05;   // 相机先飞出去一小段（0~5%时长，原为18%）后，岛屿才开始
                                       // 放大/淡入——从原来的468ms延迟大幅缩短到约130ms，避免
                                       // "音效响起后有一整段时间画面毫无变化"的观感，同时仍保留
                                       // 一丝"相机先动、岛屿紧跟着显现"的层次感而不是完全同时

  /** 记录材质原始 transparent/opacity，供动画结束后精确还原（避免污染GLB原始材质设定）*/
  function _setIslandOpacity(group, opacity) {
    if (!group) return;
    group.traverse(c => {
      if (!c.isMesh || !c.material) return;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => {
        if (!m) return;
        if (m.__revealOrigTransparent === undefined) {
          m.__revealOrigTransparent = m.transparent;
          m.__revealOrigOpacity     = m.opacity;
        }
        // needsUpdate=true 会让 three.js 重新初始化材质，只在 transparent
        // 真正从非true翻转成true的这一帧才需要触发；后续每帧只是改opacity
        // 数值本身（uniform），不需要重新触发——2600ms动画期间每帧都调用
        // 本函数，避免每帧都做不必要的材质重初始化开销
        if (m.transparent !== true) {
          m.transparent = true;
          m.needsUpdate = true;
        }
        m.opacity = opacity;
      });
    });
  }

  /** 动画结束后把材质 transparent/opacity 还原成 GLB 原始设定，不留污染 */
  function _restoreIslandMaterials(group) {
    if (!group) return;
    group.traverse(c => {
      if (!c.isMesh || !c.material) return;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => {
        if (!m || m.__revealOrigTransparent === undefined) return;
        m.transparent = m.__revealOrigTransparent;
        m.opacity     = m.__revealOrigOpacity;
        m.needsUpdate = true;
        delete m.__revealOrigTransparent;
        delete m.__revealOrigOpacity;
      });
    });
  }

  function _easeInOutCubic(raw) {
    return raw < 0.5 ? 4*raw*raw*raw : 1 - Math.pow(-2*raw+2, 3)/2;
  }

  // 岛屿显现专用缓动：ease-out（快启动、慢收尾），不同于相机运镜复用的
  // _easeInOutCubic（慢启动、慢收尾、中段快）。2026-08-18 像素级实测调优
  // 时发现，如果岛屿的缩放/透明度也用 ease-in-out，大部分肉眼可辨的变化会
  // 被压缩堆积在动画后半段，配合 REVEAL_DELAY_RATIO 延迟，会让开局显得
  // "很久都没什么变化"。换成 ease-out 后，岛屿从一开始就快速长大/显形，
  // 后段再慢慢收尾定格，视觉上更符合"揭晓"这个动作本身应有的前段冲击感。
  function _easeOutCubic(raw) {
    return 1 - Math.pow(1 - raw, 3);
  }

  /**
   * 岛屿"揭晓"入场：相机从高远俯瞰机位缓缓降落到默认机位，
   * 岛屿模型同步由"近乎不可见"缩放+淡入到完整清晰状态。
   * 调用前提：_islandGroup 已经加载完毕并静态摆在场景里（_loadGLB 已完成）。
   * @param {Function} onComplete - 相机运镜 + 岛屿入场都结束后触发
   */
  function playRevealFlight(onComplete) {
    if (!_camera || !_controls) { onComplete?.(); return; }

    // 动画终点：直接读取调用这一刻相机/target 的当前实际值，而不是重新写死
    // 一份 (0,12,22)/(0,0,0) 数值——避免两处独立硬编码同一份默认机位数据，
    // 以后只改 initScene() 一处默认机位，这里会自动跟着变，不会漂移出不同步
    // （同类坑见 CLAUDE.md 记录的 _computeHash 双实现教训）。
    // 2026-08-18 订正一处曾经写错的断言：这里原注释称此刻"必然还是
    // initScene() 设置的默认机位"——qa-reviewer实测证伪，initScene() 里
    // autoRotate 默认开启（约0.5转速），从app启动到用户真正触发揭幕之间
    // 可能间隔数分钟（八字生成流程耗时），相机方位角会持续漂移：实测让场景
    // 空转9秒，相机已从 (0,12,22) 漂移到约 (-9.696,12.000,19.748)，偏了
    // 26度、9.95个场景单位。这不是bug——半径和高度都完美保持不变，
    // autoRotate 能从任何角度无缝继续转，揭幕动画最终视觉效果依然正常，
    // 只是这里读到的"终点"是"调用 playRevealFlight() 那一刻的实际相机值"，
    // 不是 initScene() 刚设置时的原始默认值本身，两者在等待期间足够长时会
    // 不一致（这本身是预期内的正常行为，不同用户等待时长不同，看到的揭幕
    // 路径终点方位角也会略有不同，不影响揭幕效果）。
    const DEFAULT_CAM_POS = _camera.position.clone();
    const DEFAULT_TARGET  = _controls.target.clone();

    // 揭晓起始机位：比默认机位明显更高更远的俯瞰视角，
    // 制造"从高空缓缓降落靠近"的仪式感（与默认机位拉开足够差距，
    // 否则运镜幅度太小感觉不出"飞"的过程）。
    // 2026-08-18 从 (10,38,58)（距原点约70个场景单位）收近到 (7,24,36)
    // （约44个单位）——原始距离下即便配合调大后的 REVEAL_START_SCALE，
    // 岛屿在起始帧的屏幕占比依然太小；收近机位后经像素采样验证，起始帧
    // 中央区域已经能测出明显偏离背景色的像素占比（不再是噪点量级），仍然
    // 比默认机位（约25个单位）远出接近一倍，"从远处降落靠近"的仪式感保留。
    const REVEAL_CAM_POS  = new THREE.Vector3(7, 24, 36);

    // 揭幕动画期间禁用 OrbitControls 交互：渲染循环里 _flyTween 播放期间会
    // 跳过 controls.update()（见文件头已知问题记录），如果不禁用交互，用户
    // 在动画播放期间拖拽时 OrbitControls 内部的 sphericalDelta/scale 等
    // 累积量会持续累积但不生效，等 tween 结束后第一次 update() 才一次性
    // flush 出来，造成"动画结束瞬间镜头突然甩一下"——而这一刻正好是
    // confetti/badgePop 绽放的"哇"时刻，最不能被意外甩镜头破坏。
    // 参考 tutorial.js flyTo() 调用前后配对 setControlsEnabled(false)/(true)
    // 的现成写法，不发明新机制。
    setControlsEnabled(false);

    // 防御性兜底（2026-08-18 qa-reviewer指出的缺口）：改动前只有"camDone &&
    // islandDone 都满足"这一条路径会调用 setControlsEnabled(true)——如果
    // 内部在此之后、两个tween真正走完之前抛出异常，或者被外部意外打断
    // （比如揭幕播放期间别的地方调用了 flyTo()，会直接覆盖 _flyTween，导致
    // 这里的相机tween onComplete永远不会触发），交互会被永久锁死、
    // confetti/badgePop/_onIslandReady() 全部不会触发，且是静默失效、没有
    // 任何报错提示用户或开发者。用 settled 标记 + 超时兜底双重保护：
    // 1) settled 保证 setControlsEnabled(true)/onComplete 只会被触发一次
    //    （正常路径和兜底路径不会重复触发）；
    // 2) 理论动画时长是 REVEAL_DURATION（2600ms），给 2000ms 安全余量后
    //    仍未正常 settle，说明大概率发生了异常/被打断，强制解锁+触发一次
    //    onComplete——参考 tutorial.js `_showHintBar()`"5秒后无论是否点击
    //    都自动推进"的既有兜底写法，不发明新机制。
    // 注意：目前产品流程里这两种失效场景都不可达（揭幕完成后1秒才自动打开
    // 注册弹窗，Tutorial 的 flyTo() 不可能在揭幕还没播完时被触发），这层
    // 兜底纯粹是为了不让"万一真的触发"变成静默且彻底的锁死。
    let settled = false;
    let _revealSafetyTimer = setTimeout(() => {
      if (settled) return;
      console.warn('[IslandLoader] playRevealFlight 超过预期时长仍未结束（可能内部异常或被中途打断），强制解锁交互兜底');
      _settle();
    }, REVEAL_DURATION + 2000);

    const _settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(_revealSafetyTimer);
      // 动画真正结束（相机运镜 + 岛屿入场都完成，或触发了超时兜底）才恢复
      // 交互，正常路径下此时不会再有动画期间攒起来的输入需要 flush，
      // 用户拖拽即时生效、不会有滞后甩动
      setControlsEnabled(true);
      onComplete?.();
    };

    try {
      // 相机直接摆到揭晓起始机位（这是动画的"起点"，不需要过渡到这里）
      _camera.position.copy(REVEAL_CAM_POS);
      _controls.target.copy(DEFAULT_TARGET);

      let camDone    = false;
      let islandDone = !_islandGroup; // 没有岛屿模型时视为已完成，不阻塞回调
      const _finish = () => {
        if (!camDone || !islandDone) return;
        _settle();
      };

      // 相机运镜：复用 flyTo() 现成的缓动 tween（内部会自动接管 _flyTween，
      // 渲染循环里 _flyTween 播放期间会跳过 controls.update()，见已知问题记录）
      flyTo(DEFAULT_CAM_POS, DEFAULT_TARGET, REVEAL_DURATION, () => {
        camDone = true;
        _finish();
      });

      if (!_islandGroup) return;

      // 岛屿入场：独立的缩放+淡入 tween，由 _startLoop 逐帧驱动
      _islandGroup.scale.setScalar(REVEAL_START_SCALE);
      _setIslandOpacity(_islandGroup, REVEAL_START_OPACITY);

      const startTime = performance.now();
      _revealTween = {
        update(now) {
          const raw = Math.min((now - startTime) / REVEAL_DURATION, 1);
          // REVEAL_DELAY_RATIO 之前岛屿保持"未揭晓"初始状态不动，
          // 之后才开始用同样时长内剩余比例做缓动放大/淡入
          const islandRaw  = Math.max(0, (raw - REVEAL_DELAY_RATIO) / (1 - REVEAL_DELAY_RATIO));
          const islandEase = _easeOutCubic(islandRaw);
          const scale   = REVEAL_START_SCALE   + (1 - REVEAL_START_SCALE)   * islandEase;
          const opacity = REVEAL_START_OPACITY + (1 - REVEAL_START_OPACITY) * islandEase;
          _islandGroup.scale.setScalar(scale);
          _setIslandOpacity(_islandGroup, opacity);

          if (raw >= 1) {
            _revealTween = null;
            _islandGroup.scale.setScalar(1);
            _restoreIslandMaterials(_islandGroup);
            islandDone = true;
            _finish();
          }
        }
      };
    } catch (e) {
      // 同步异常兜底：不必等 REVEAL_DURATION+2000ms 的超时才解锁，
      // 异常发生的瞬间就能确定动画走不完了，立刻 settle
      console.warn('[IslandLoader] playRevealFlight 内部异常，提前解锁交互兜底:', e);
      _settle();
    }
  }

  // ── 公开接口 ─────────────────────────────────────────────
  function getScene()       { return _scene; }
  function getIslandGroup() { return _islandGroup; }
  function getCamera()      { return _camera; }
  function getRenderer()    { return _renderer; }

  // 自动旋转停转锁：2026-08-11 qa-reviewer复查发现，此前 stopAutoRotate/
  // startAutoRotate 是纯布尔覆盖——当前有三处独立调用方会互相打架
  // （main-new.js::_openZonePanel/closeZonePanel、tutorial.js 引导流程、
  // island-annotate.js::_toggleTraitExpand 命盘特点卡片）：
  // 例如用户展开trait卡片（要求停转）后又点开四柱面板（也要求停转，
  // 用布尔覆盖问题不大），但关闭四柱面板时若直接把 autoRotate 设回 true，
  // 会在trait卡片还展开着的情况下让场景意外转起来，卡片又被自转带出视口——
  // 这正是"trait卡片展开后停留阅读会被自转带出视口再次裁切"这个bug的根因。
  // 改为按 reason 记账的 Set：多个来源各自 stop 各自的 reason，只有当
  // 所有 reason 都 start 之后（Set清空）才真正恢复旋转。不传 reason 的
  // 旧调用点（main-new.js/tutorial.js 现状如此）共用同一个默认 key，
  // 互相之间的 idempotent 覆盖行为与改动前完全一致，不会引入新问题；
  // island-annotate.js 改为显式传入独立的 'traitCard' reason，
  // 与它们互不覆盖。
  const _rotateLocks = new Set();
  function stopAutoRotate(reason) {
    _rotateLocks.add(reason || '_default');
    if (_controls) _controls.autoRotate = false;
  }
  function startAutoRotate(reason) {
    _rotateLocks.delete(reason || '_default');
    if (_controls && _rotateLocks.size === 0) _controls.autoRotate = true;
  }

  return {
    initScene, generateIsland, loadFromUrl,
    getScene, getCamera, getRenderer, getIslandGroup,
    stopAutoRotate, startAutoRotate,
    flyTo, setControlsEnabled,
    playRevealFlight,
  };
})();
