/**
 * 司马八字 · 命理装饰摆放层 decoration-annotate.js
 *
 * 职责：把 js/decoration-resolver.js（bazi-pipeline领域）判定出的
 * Array<{decorId, pillars, name, meaning}> 转换成3D场景里的真实摆放位置 +
 * 可点击热点，是十神/神煞/地支关系/天干合共65个3D装饰这次接入的"摆放+渲染+
 * 点击交互"这一层（frontend-3d领域）。不做任何"命盘命中了什么"的判定——
 * 那是 DecorationResolver 的职责，本文件只消费它的返回值。
 *
 * 核心定位算法（_computeFrac，务必保持）：
 *   - pillars.length === 1（十神/神煞，单柱）：以
 *     IslandAnnotate.getPillarFrac(col) 返回的柱位锚点为中心。同一柱位命中
 *     多个装饰时（例如月柱同时命中"食神"+"天乙贵人"），直接用同一个frac会让
 *     多个模型完全重叠——用 _clusterOffset() 围绕锚点做环形局部散开（半径
 *     0.15起步，超过6个再开第二环、半径略微增大，见该函数实现），offset量级
 *     跟 island-annotate.js::TRAIT_LAYOUT（半径0.26~0.52）/SHENSHA_LAYOUT
 *     （半径1.0）比更靠内，保证视觉上仍然"贴着"对应柱子，不会飘得像独立于
 *     命盘之外的装饰。
 *   - pillars.length >= 2（地支关系/天干合，2~4柱，三合同支重复命中时可能
 *     超过3个）：取这几根柱子各自的 PILLAR_LAYOUT frac，x/z/y 各自取算术
 *     平均值（几何重心）——装饰精确落在触发它的那几根柱子中间，用户能直觉
 *     对应回自己的命盘，这是本次实现的核心价值，不能退化成固定坑位。
 *
 * 生命周期：attach() 内部第一行无条件先 detach()（跟 WuxingScene.attach()/
 * IslandAnnotate._attachLabels() 同一惯例——island-loader.js整个会话复用同一个
 * THREE.Scene，换岛屿/轻量刷新不会自动清空上一张命盘挂载的装饰，必须显式清理，
 * 否则会看到"两张命盘的65个装饰混在同一座岛上"）。main-new.js::_onIslandReady()
 * 在岛屿真正加载完成、包围盒可用之后调用一次即可，不需要调用方额外调用
 * detach()。
 *
 * 点击交互：复用 island-annotate.js::_makeShenshaLabel() 同款"单击直接打开
 * 完整zone-panel"模式（不是 wuxing-scene.js/attachTraits() 那套"先展开小卡片
 * 再点卡片打开面板"的两步交互）——65个装饰数量级明显更大，两步交互需要的
 * leader-line/expand-card密度管理成本不成正比，直接单击打开已有的 zone-panel
 * 侧边面板（跟四柱/神煞面板同一个容器）更简单可靠，内容展示需求（标题+一行
 * 含义）本身也足够简单，不需要中间展开态。
 *
 * 2026-08-18 真实数据实测发现的坑（务必保持修复）：同一个 decorId（十神/
 * 神煞按"命理概念本身"分配，如"天乙贵人"永远是 ss_tianyi_noble）完全可能
 * 被 DecorationResolver.resolve() 同时命中两、三根柱子（比如天乙贵人落年柱
 * 又落时柱），resolve()会为每个命中柱位各输出一条独立记录（decorId相同、
 * pillars不同）。但 IslandDecorations.add() 原先假设"同一decorId只会真正
 * 放置一次"——第二、三个命中柱位会拿到可点击热点，脚下却没有3D模型（被第
 * 一个柱位占用的 `_placed[decorId]` 挡住）。修复：调用 add()/remove() 时
 * 额外传入按"decorId+命中柱位"拼接的 placementKey 第四/第二参数（见
 * island-decorations.js 对应声明处注释），保证同一decorId的多个实例各自
 * 独立追踪加载/移除状态，互不覆盖。
 */
const DecorationAnnotate = (() => {

  let _items = [];   // [{ decorId, css2d }]，供 detach() 逐一清理

  // 同柱多装饰局部散开：第一环最多6个点（半径0.15），超过则开第二环
  // （半径0.15+0.08=0.23），以此类推——跟 island-annotate.js::SHENSHA_LAYOUT
  // 的"六等分环绕"排布思路一致，只是这里是围绕单柱局部小范围散开，不是环绕
  // 整个岛屿边缘。
  const CLUSTER_PER_RING   = 6;
  const CLUSTER_BASE_RADIUS = 0.15;
  const CLUSTER_RING_STEP   = 0.08;

  function _clusterOffset(index, total) {
    if (total <= 1) return { dx: 0, dz: 0 };
    const ring        = Math.floor(index / CLUSTER_PER_RING);
    const idxInRing    = index % CLUSTER_PER_RING;
    const countInRing  = Math.min(CLUSTER_PER_RING, total - ring * CLUSTER_PER_RING);
    const radius       = CLUSTER_BASE_RADIUS + ring * CLUSTER_RING_STEP;
    const angle        = (idxInRing / countInRing) * Math.PI * 2;
    return { dx: radius * Math.cos(angle), dz: radius * Math.sin(angle) };
  }

  /**
   * 挂载65个命理装饰。
   * @param {THREE.Scene} scene
   * @param {object} baziData - BaziEngine.calculate() 完整输出
   */
  function attach(scene, baziData) {
    detach(scene);
    if (!scene || !baziData) return;
    if (typeof DecorationResolver === 'undefined' || typeof DecorationResolver.resolve !== 'function') {
      // bazi-pipeline领域的判定层尚未加载/不可用——静默跳过，不影响岛屿主流程
      // （四柱/神煞/五行维护等其它标注系统都是独立生命周期，互不依赖）。
      return;
    }
    if (typeof IslandAnnotate === 'undefined' ||
        !IslandAnnotate.getIslandBox || !IslandAnnotate.layoutToWorld || !IslandAnnotate.getPillarFrac) {
      console.warn('[DecorationAnnotate] IslandAnnotate 定位API不可用，跳过挂载');
      return;
    }
    if (typeof IslandDecorations === 'undefined' || !IslandDecorations.add) {
      console.warn('[DecorationAnnotate] IslandDecorations 不可用，跳过挂载');
      return;
    }

    let list = [];
    try {
      list = DecorationResolver.resolve(baziData) || [];
    } catch (e) {
      console.warn('[DecorationAnnotate] DecorationResolver.resolve() 失败', e);
      return;
    }
    if (!Array.isArray(list) || !list.length) return;

    const { box, group } = IslandAnnotate.getIslandBox();

    // 先统计每个"单柱"柱位命中了多少条装饰，供 _clusterOffset() 按下标散开
    const pillarCounts = {};
    list.forEach(item => {
      if (item && Array.isArray(item.pillars) && item.pillars.length === 1) {
        const col = item.pillars[0];
        pillarCounts[col] = (pillarCounts[col] || 0) + 1;
      }
    });
    const pillarSeenIndex = {};

    list.forEach(item => {
      if (!item || !item.decorId || !Array.isArray(item.pillars) || !item.pillars.length) return;

      const frac = _computeFrac(item.pillars, pillarCounts, pillarSeenIndex);
      if (!frac) return;

      const pos = IslandAnnotate.layoutToWorld(frac, box, group);

      // 同一decorId可能被多根柱子各命中一次（见文件头2026-08-18注释）——
      // 用 decorId+命中柱位 拼出每条记录独立的 placementKey，避免
      // IslandDecorations 内部"同一decorId只放置一次"的假设吞掉第二、三个
      // 实例。pillars.join('_') 对单柱（十神/神煞）就是那一个柱位名；多柱
      // 关系（地支关系/天干合）同一decorId也**确实可能**因为地支/天干重复
      // 出现而命中两组不同柱位组合（比如子午冲同时发生在月日之间和日时
      // 之间）——decoration-resolver.js::emitRelation() 的去重键是
      // `decorId+柱位组合`而不是单纯decorId（2026-08-18 qa-reviewer 发现
      // 并打回过"按decorId全局去重会误删合法的第二组"这个bug），所以这里
      // 拼出的 placementKey 天然跟resolver的去重粒度一致，两种情形不需要
      // 分开处理，但"该decorId不会重复"这个前提本身不成立，不要照抄。
      const placementKey = item.decorId + '@' + item.pillars.join('_');

      // 3D装饰本体——overridePos 跳过 DECOR_DEFS 里的静态frac，直接用这里
      // 按命盘真实柱位算出的世界坐标（跟 wxmaint_* 系列同一套调用方式）。
      IslandDecorations.add(item.decorId, baziData, pos, placementKey);

      // 点击热点（CSS2DObject，单击直接打开zone-panel，见文件头注释）
      const css2d = _makeMarker(item, baziData);
      css2d.position.copy(pos);
      scene.add(css2d);
      _items.push({ decorId: item.decorId, placementKey, css2d });
    });
  }

  /**
   * 计算单条装饰的相对布局锚点（frac）。
   * @param {string[]} pillars
   * @param {object} pillarCounts     - { col: 该柱位命中的装饰总数 }
   * @param {object} pillarSeenIndex  - { col: 已经分配过散开下标的计数 }（本函数会原地递增）
   * @returns {{x:number,z:number,y:number,hover:number}|null}
   */
  function _computeFrac(pillars, pillarCounts, pillarSeenIndex) {
    if (pillars.length === 1) {
      const col  = pillars[0];
      const base = IslandAnnotate.getPillarFrac(col);
      if (!base) return null;
      const total = pillarCounts[col] || 1;
      const idx   = pillarSeenIndex[col] || 0;
      pillarSeenIndex[col] = idx + 1;
      const { dx, dz } = _clusterOffset(idx, total);
      return { x: base.x + dx, z: base.z + dz, y: base.y, hover: base.hover };
    }

    // 地支关系/天干合（2~4柱）：几何重心——x/z/y/hover 各自取算术平均值。
    const fracs = pillars.map(col => IslandAnnotate.getPillarFrac(col)).filter(Boolean);
    if (!fracs.length) return null;
    const avg = (key) => fracs.reduce((sum, f) => sum + f[key], 0) / fracs.length;
    return { x: avg('x'), z: avg('z'), y: avg('y'), hover: avg('hover') };
  }

  // ── 点击热点 DOM ─────────────────────────────────────────
  // 单击直接触发 onIslandZoneClick（不做展开小卡片的中间态，见文件头注释），
  // zoneKey 统一 `decor_${decorId}` 前缀，供 main-new.js::_renderZonePanelHtml()
  // 分派到新增的 decor_ 分支（Analysis.buildDecorationPanel()）。
  function _makeMarker(item, baziData) {
    const div = document.createElement('div');
    div.className = 'decor-marker';
    div.innerHTML = `<span class="decor-marker-name">${item.name || ''}</span>`;
    div.addEventListener('click', () => {
      if (typeof UIEffects !== 'undefined' && UIEffects.labelPulse) UIEffects.labelPulse(div);
      if (window.onIslandZoneClick) {
        // extra 数据在创建热点时就通过闭包直接携带 name/meaning，不依赖点击
        // 那一刻去查任何模块级变量——跟四柱/神煞/trait/wxmaint系列同一惯例
        // （见这几处代码各自"关键坑"注释），避免重蹈"AI数据从未真正缓存住"
        // 那类历史问题。
        window.onIslandZoneClick(`decor_${item.decorId}`, baziData, false, {
          name: item.name, meaning: item.meaning,
        });
      }
    });
    return new THREE.CSS2DObject(_wrapAnchor(div));
  }

  // 同款"定位锚点/视觉内容解耦"写法，见 island-annotate.js::_wrapAnchor() 处的
  // 详细根因注释（CSS2DRenderer每帧写内联transform定位锚点，若锚点自身又挂了
  // 会动画transform的class会互相打架）。本模块目前不会被高亮逻辑加class，但
  // 保持同一套防御结构成本为零，未来若需要接入不会重新踩坑。
  function _wrapAnchor(contentDiv) {
    const anchor = document.createElement('div');
    anchor.appendChild(contentDiv);
    return anchor;
  }

  /** 清理本模块挂载的全部CSS2D热点 + 对应的3D装饰。 */
  function detach(scene) {
    _items.forEach(({ decorId, placementKey, css2d }) => {
      if (scene) scene.remove(css2d);
      if (typeof IslandDecorations !== 'undefined' && IslandDecorations.remove) {
        IslandDecorations.remove(decorId, placementKey);
      }
    });
    _items = [];
  }

  return { attach, detach };
})();
