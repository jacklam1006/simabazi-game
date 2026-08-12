/**
 * 司马八字 · 岛屿标注系统 island-annotate.js
 *
 * 功能：
 *   在 Three.js 场景上叠加 CSS2DLabel 标注：
 *   - 四柱石碑标签（年/月/日/时）+ 诊断徽标（✓/⚠）
 *   - 神煞标记（点击 → 分析面板）
 *   - 空亡区域提示
 *
 * 新增公开 API（Tutorial 使用）：
 *   highlightLabel(key)  - 高亮指定标签，其余变暗
 *   clearHighlight()     - 清除所有高亮/变暗
 *   getLabelPositions()  - 返回各标签的3D位置
 *
 * 依赖：CSS2DRenderer（随 Three.js r128 examples 加载）
 */

const IslandAnnotate = (() => {

  // ── 标签布局：相对比例（不是绝对世界坐标）──────────────────
  // 根因（2026-07-29排查确认，见 claude-docs/已知问题与修复记录.md）：
  // 此前这里是写死的绝对 Vector3（如 (-3.5,1.5,-3.0)），是针对某个假想的
  // "标准尺寸岛屿"手动调校出来的。但 island-loader.js::_loadGLB() 只保证把
  // 加载的GLB模型"最长边缩放到10、包围盒居中于原点"——不保证长宽高比例。
  // TripoAI 针对不同八字生成的岛屿模型形状差异很大（扁平宽台/瘦高孤峰/
  // 不对称长条等），沙盒验证（node+three模拟不同长宽高比+真实包围盒射线
  // 检测）证明：当模型长宽高比偏离"假想标准岛屿"时，写死坐标算出的世界
  // 坐标点会大量漂到模型包围盒之外（悬浮空中）或扎进模型内部（被埋住），
  // 偏离真实模型表面达 80%~270%——这就是"标注标签不跟随3D物体位置"的根因。
  //
  // 修复：坐标改为相对模型真实包围盒的比例（frac.x/frac.z ∈ 大致[-1,1]，
  // frac.y ∈ [0,1] 表示包围盒底→顶的插值比例），在 attach() 时用
  // THREE.Box3().setFromObject() 对当次实际加载的模型现算包围盒，再按比例
  // 换算成世界坐标；并对Y轴额外做一次向下的射线检测，贴合模型真实地形
  // 起伏表面（而不是单纯线性插值包围盒高度），进一步降低"悬浮/埋没"的概率。
  const PILLAR_LAYOUT = {
    year : { x:-0.78, z:-0.67, y:0.55, hover:0.45 },
    month: { x: 0.78, z:-0.67, y:0.55, hover:0.45 },
    day  : { x: 0.00, z: 0.00, y:0.85, hover:0.70 },   // 日主 = 中心最高点
    hour : { x: 0.00, z: 0.84, y:0.55, hover:0.45 },
  };

  const PILLAR_LABELS = { year:'年柱', month:'月柱', day:'日柱', hour:'时柱' };

  // 神煞在岛屿边缘的相对位置（按时钟方向分布）
  const SHENSHA_LAYOUT = [
    { x:-1.00, z: 0.00, y:0.25, hover:0.35 },
    { x:-0.71, z: 0.71, y:0.25, hover:0.35 },
    { x: 0.00, z: 1.00, y:0.25, hover:0.35 },
    { x: 0.71, z: 0.71, y:0.25, hover:0.35 },
    { x: 1.00, z: 0.00, y:0.25, hover:0.35 },
    { x: 0.71, z:-0.71, y:0.25, hover:0.35 },
  ];

  const KONGWANG_LAYOUT = { x:-0.71, z:-0.71, y:0.65, hover:0.5 };

  // ── Trait（命盘优势✅ / 注意事项⚠️）环形布局 ─────────────────
  // 2026-08-11：新功能"命盘特点3D标注"第一阶段（见
  // claude-docs 计划 structured-nibbling-duckling），独立于 PILLAR_LAYOUT/
  // SHENSHA_LAYOUT，不复用/不改动它们的数组或生命周期。
  // 6个点，半径取 x/z ≈ 0.26~0.52（换算后再乘 LAYOUT_INSET），刻意比四柱
  // (半径约0.8，y 0.55~0.85) 更靠内、比神煞(半径1.0，y=0.25定高) 更靠内，
  // 高度上也分两层（0.18/0.32）跟神煞的固定0.25错开，降低三类标注互相
  // 重叠/贴脸的概率。
  // 顺序按0°→300°六等分排布，attachTraits() 会用 strengths[i]/cautions[i]
  // 交替（s0,c0,s1,c1,s2,c2）的顺序跟这个数组按下标一一对应，因此这里的
  // 偶数下标（0/2/4）实际固定对应"优势"点位、奇数下标（1/3/5）对应
  // "注意事项"点位——保证环上好/坏类型不相邻（用户明确要求的密度缓解手段之一）。
  // 这组数值是未经真实3D模型验证的起点，已用真实生成岛屿人工核实过并调整
  // （见 island-annotate.js 改动附带的验证记录），不同模型形状仍可能有个别
  // 点位贴合度差异，属于已知可接受范围。
  const TRAIT_LAYOUT = [
    { x: 0.52, z: 0.00, y:0.18, hover:0.22 },  //   0°　优势
    { x: 0.26, z: 0.45, y:0.32, hover:0.30 },  //  60°　注意事项
    { x:-0.26, z: 0.45, y:0.18, hover:0.22 },  // 120°　优势
    { x:-0.52, z: 0.00, y:0.32, hover:0.30 },  // 180°　注意事项
    { x:-0.26, z:-0.45, y:0.18, hover:0.22 },  // 240°　优势
    { x: 0.26, z:-0.45, y:0.32, hover:0.30 },  // 300°　注意事项
  ];

  // 模型尚未加载/获取失败时的兜底包围盒（近似此前写死坐标背后假设的比例），
  // 保证 attach() 在任何异常情况下都不会算出 NaN 或抛错
  const FALLBACK_BOX_MIN = new THREE.Vector3(-5, -1, -5);
  const FALLBACK_BOX_MAX = new THREE.Vector3( 5,  4,  5);

  const _raycaster = new THREE.Raycaster();
  const _DOWN = new THREE.Vector3(0, -1, 0);
  const LAYOUT_INSET = 0.85;   // x/z 略微内收，避免落在包围盒最外角（真实模型多为有机形状，角上常是空的）

  // 供 Tutorial / 外部调用查询的"最近一次计算出的真实世界坐标"
  let _lastPillarWorldPos  = {};
  let _lastShenshaWorldPos = [];

  /** 计算当前场景中岛屿模型的真实包围盒（THREE.Box3），失败时返回兜底值 */
  function _getIslandBox() {
    try {
      const group = (typeof IslandLoader !== 'undefined' && IslandLoader.getIslandGroup)
        ? IslandLoader.getIslandGroup() : null;
      if (group) {
        const box = new THREE.Box3().setFromObject(group);
        if (box && isFinite(box.min.x) && isFinite(box.max.x) && !box.isEmpty()) {
          return { box, group };
        }
      }
    } catch (e) {
      console.warn('[IslandAnnotate] 计算岛屿包围盒失败，改用兜底比例', e);
    }
    return { box: new THREE.Box3(FALLBACK_BOX_MIN.clone(), FALLBACK_BOX_MAX.clone()), group: null };
  }

  /** 把 {x,z,y,hover} 形式的相对比例换算成世界坐标，Y轴尽量贴合真实地形表面 */
  function _layoutToWorld(frac, box, group) {
    const hx = (box.max.x - box.min.x) / 2;
    const hz = (box.max.z - box.min.z) / 2;
    const sizeY = box.max.y - box.min.y;
    const x  = frac.x * hx * LAYOUT_INSET;
    const z  = frac.z * hz * LAYOUT_INSET;
    let y    = box.min.y + frac.y * sizeY;   // 包围盒线性插值兜底

    if (group) {
      try {
        const rayOrigin = new THREE.Vector3(x, box.max.y + 2, z);
        _raycaster.set(rayOrigin, _DOWN);
        _raycaster.far = sizeY + 6;
        const hits = _raycaster.intersectObject(group, true);
        if (hits.length) {
          // 悬浮高度按模型自身竖直尺寸缩放：模型很扁（如宽扁浮空平台）时按比例
          // 降低悬浮高度，避免标签相对显得"浮得过高"；模型正常/瘦高时保持原有悬浮高度
          const hoverScale = Math.min(1, sizeY / 4);
          y = hits[0].point.y + (frac.hover || 0.4) * hoverScale;
        }
      } catch (e) {
        // 射线检测失败（如几何体异常）时静默回退到包围盒插值，不影响标签渲染
      }
    }
    return new THREE.Vector3(x, y, z);
  }

  // ── 定位锚点 / 视觉内容 解耦（教程流程排查，见已知问题记录）──
  // 根因：CSS2DRenderer 每帧都会对传入 THREE.CSS2DObject 的那个DOM元素直接写
  // element.style.transform = 'translate(-50%,-50%) translate(Xpx,Ypx)' 来定位。
  // 但 Tutorial.highlightLabel() 会给同一个元素加 .label-highlighted class，
  // 该class的 CSS @keyframes 动画同样animate了 transform（scale(...)）——
  // 按CSS级联规则，运行中的 CSS Animation 对同一属性的优先级高于该元素自身的
  // 内联style（即使内联style每帧都在重新赋值），于是"位移transform"被"缩放
  // transform"完全顶掉，元素退回到未设置transform时的默认文档流位置（即标注
  // 覆盖层容器的左上角，正好与页面Logo/HUD标题重叠）。用Playwright真实浏览器
  // 实测复现：.label-highlighted元素的 getComputedStyle().transform 结果是
  // 纯scale矩阵（无平移分量），而element.style.transform 内联值仍然是正确的
  // translate(...)——证实二者确实互相打架。
  // 修复：CSS2DObject 拿到的DOM元素("锚点"div)永远不挂任何视觉/动画class，
  // 只负责被CSS2DRenderer定位；实际视觉内容 + highlight/dim class 挂在锚点
  // 内部的子元素上，两者各自独立控制transform，互不覆盖。
  function _wrapAnchor(contentDiv) {
    const anchor = document.createElement('div');
    anchor.appendChild(contentDiv);
    return anchor;
  }

  // 干支五行映射（诊断徽标用）
  const STEM_WX = {
    '甲':'木','乙':'木','丙':'火','丁':'火',
    '戊':'土','己':'土','庚':'金','辛':'金','壬':'水','癸':'水',
  };

  let _labels   = [];    // 所有CSS2DObject引用
  let _labelMap = {};    // key → DOM div，供 highlight 使用

  // Trait标注独立生命周期（不放进 _labels/_labelMap）——attachTraits() 是在
  // AI异步返回后才被调用的，明显晚于 attach()（可能晚几秒到几分钟），如果
  // 混用 _clearLabels() 的数组/时机，换岛屿时容易出现"旧trait标签残留"这类
  // island-decorations.js 曾经踩过的同款故障（见该文件 2026-08-01 注释）。
  let _traitLabels = [];   // [{ css2d: CSS2DObject, div: HTMLElement }]

  // CSS2DRenderer.js 是独立CDN脚本，理论上在 <script> 标签同步加载顺序下
  // 会先于本文件执行完毕；但网络环境不可控时CDN可能加载缓慢/失败，
  // 不能"检查一次没有就永久放弃"，改为限时轮询，正常情况下总能等到它就绪。
  const CSS2D_MAX_WAIT_MS = 5000;
  const CSS2D_POLL_MS     = 100;

  // ── 主入口：创建所有标注 ─────────────────────────────────
  function attach(scene, baziData) {
    _attachWhenReady(scene, baziData, Date.now());
  }

  function _attachWhenReady(scene, baziData, startedAt) {
    if (typeof THREE.CSS2DObject !== 'undefined') {
      _attachLabels(scene, baziData);
      return;
    }
    if (Date.now() - startedAt >= CSS2D_MAX_WAIT_MS) {
      console.warn(`[IslandAnnotate] CSS2DObject 在 ${CSS2D_MAX_WAIT_MS}ms 内仍未就绪（CDN加载失败？），改用固定位置的HTML兜底浮层`);
      _fallbackHtmlOverlay(baziData);
      return;
    }
    setTimeout(() => _attachWhenReady(scene, baziData, startedAt), CSS2D_POLL_MS);
  }

  function _attachLabels(scene, baziData) {
    _clearLabels(scene);
    // 防御性清理：即使目前调用时序下 attachTraits() 总是晚于 attach()，
    // 也要在这里清一次上一个岛屿可能残留的trait标签（换岛屿场景）
    detachTraits(scene);

    const p  = baziData.pillars  || {};
    const ss = Array.isArray(baziData.shenshe) ? baziData.shenshe : [];
    const kw = Array.isArray(baziData.kongwang) ? baziData.kongwang : [];

    // 每次 attach 都现算一次真实包围盒 —— 不同岛屿模型尺寸/比例不同，
    // 不能复用上一次计算结果
    const { box, group } = _getIslandBox();
    _lastPillarWorldPos  = {};
    _lastShenshaWorldPos = [];

    // 四柱标签（含诊断徽标）
    Object.entries(PILLAR_LAYOUT).forEach(([col, frac]) => {
      const pillar = p[col] || {};
      const pos    = _layoutToWorld(frac, box, group);
      const label  = _makePillarLabel(
        PILLAR_LABELS[col],
        pillar.stem   || '—',
        pillar.branch || '—',
        (baziData.nayin||{})[col] || '',
        col === 'day',
        col,
        baziData
      );
      label.position.copy(pos);
      scene.add(label);
      _labels.push(label);
      _lastPillarWorldPos[col] = pos;
    });

    // 神煞标记（最多6个）
    ss.slice(0, 6).forEach((name, i) => {
      const frac  = SHENSHA_LAYOUT[i];
      const pos   = _layoutToWorld(frac, box, group);
      const label = _makeShenshaLabel(name, baziData);
      label.position.copy(pos);
      scene.add(label);
      _labels.push(label);
      _lastShenshaWorldPos.push(pos);
    });

    // 空亡虚空提示
    if (kw.length) {
      const pos   = _layoutToWorld(KONGWANG_LAYOUT, box, group);
      const label = _makeKongwangLabel(kw);
      label.position.copy(pos);
      scene.add(label);
      _labels.push(label);
    }
  }

  // ── 四柱标签 DOM ─────────────────────────────────────────
  function _makePillarLabel(title, stem, branch, nayin, isDay, col, baziData) {
    // ── 诊断徽标逻辑 ──────────────────────────────────────
    const fav    = Array.isArray(baziData.favorable) ? baziData.favorable : (baziData.favorable ? [baziData.favorable] : []);
    const kw     = Array.isArray(baziData.kongwang)  ? baziData.kongwang  : (baziData.kongwang  ? [baziData.kongwang]  : []);
    const stemWx = STEM_WX[stem]      || '';
    let diagClass = '';
    let diagIcon  = '';
    if (kw.includes(branch)) {
      diagClass = 'diag-warn';
      diagIcon  = '⚠';
    } else if (fav.includes(stemWx)) {
      diagClass = 'diag-good';
      diagIcon  = '✓';
    }
    // ──────────────────────────────────────────────────────

    const div = document.createElement('div');
    div.className = 'island-label pillar-label' + (isDay ? ' day-label' : '');
    div.innerHTML = `
      ${diagIcon ? `<div class="label-diag ${diagClass}">${diagIcon}</div>` : ''}
      <div class="label-title">${title}</div>
      <div class="label-stem" style="color:${_stemColor(stem)}">${stem}</div>
      <div class="label-branch">${branch}</div>
      ${nayin ? `<div class="label-nayin">${nayin}</div>` : ''}
    `;
    div.addEventListener('click', () => {
      UIEffects.labelPulse(div);
      if (window.onIslandZoneClick) window.onIslandZoneClick('pillar_' + col, baziData);
    });

    _labelMap['pillar_' + col] = div;
    return new THREE.CSS2DObject(_wrapAnchor(div));
  }

  // ── 神煞标记 DOM ─────────────────────────────────────────
  function _makeShenshaLabel(name, baziData) {
    const isGood = ['将星','禄神','红鸾','天乙','文昌','天德','月德','天厨','福星贵人'].includes(name);
    const isWarn = ['亡神','劫煞','白虎','羊刃','孤辰'].includes(name);
    const cls    = isGood ? 'ss-good' : isWarn ? 'ss-warn' : 'ss-neutral';
    const diagCls= isGood ? 'diag-good' : isWarn ? 'diag-warn' : '';
    const diagIco= isGood ? '✓' : isWarn ? '⚠' : '';

    const div = document.createElement('div');
    div.className = `island-label shensha-label ${cls}`;
    div.innerHTML = `
      ${diagIco ? `<div class="label-diag ${diagCls}" style="top:-6px;right:-6px">${diagIco}</div>` : ''}
      <span class="ss-icon">${_ssIcon(name)}</span>
      <span class="ss-name">${name}</span>
    `;
    div.style.position = 'relative';
    div.addEventListener('click', () => {
      UIEffects.labelPulse(div);
      if (window.onIslandZoneClick) window.onIslandZoneClick('shensha_' + name, baziData);
    });

    _labelMap['shensha_' + name] = div;
    return new THREE.CSS2DObject(_wrapAnchor(div));
  }

  // ── 空亡标记 DOM ─────────────────────────────────────────
  function _makeKongwangLabel(kw) {
    const div = document.createElement('div');
    div.className = 'island-label kongwang-label';
    div.innerHTML = `<span>空亡</span><span style="color:#EB5757;margin-left:4px">${kw.join('、')}</span>`;
    return new THREE.CSS2DObject(_wrapAnchor(div));
  }

  // ── Trait标记 DOM（命盘优势✅ / 注意事项⚠️）─────────────────
  // 默认只显示 .trait-dot 小圆点（可点），.trait-leader/.trait-card 默认
  // opacity:0;pointer-events:none（见 index.html），点击圆点后加 .expanded
  // class 才展开引导线+完整卡片——把"6个新增常驻热点"的视觉负担降到最低。
  function _makeTraitLabel(kind, idx, trait, baziData) {
    const isGood = kind === 'strength';
    const div = document.createElement('div');
    div.className = 'trait-marker ' + (isGood ? 'trait-good' : 'trait-warn');
    div.innerHTML = `
      <span class="trait-dot">${isGood ? '✅' : '⚠️'}</span>
      <div class="trait-leader"></div>
      <div class="trait-card">${(trait && trait.summary) || ''}</div>
    `;

    div.querySelector('.trait-dot').addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleTraitExpand(div);
    });

    div.querySelector('.trait-card').addEventListener('click', (e) => {
      e.stopPropagation();
      UIEffects.labelPulse(div);
      if (window.onIslandZoneClick) {
        // extra数据在创建标签时就通过闭包直接携带summary/detail，不依赖任何
        // 模块级变量在点击那一刻去查——四柱/神煞面板早年就是靠"点击时查全局
        // 缓存"这个模式踩过坑（AI数据从未被真正缓存住，面板一直显示静态兜底
        // 文案），这里的写法从一开始就避开同一类问题。
        // 第三参数 force 留空（trait标签点击不需要绕开教程guard），extra 放在
        // 第四位——main-new.js::_openZonePanel(zoneKey, baziData, force, extra)
        // 用位置区分二者语义（force是Tutorial专用的布尔值，extra是对象），
        // 不能把 extra 传到第三位，否则会被误判成一个 truthy 的 force。
        window.onIslandZoneClick(`trait_${kind}_${idx}`, baziData, false, {
          kind, idx,
          summary: trait && trait.summary,
          detail : trait && trait.detail,
        });
      }
    });

    return { css2d: new THREE.CSS2DObject(_wrapAnchor(div)), div };
  }

  /** 同一时刻只允许一个trait卡片展开：点开新的自动收起其余已展开的；
   *  再次点击已展开的圆点会收起它自己（toggle）。
   *
   *  2026-08-11：qa-reviewer 复查发现"只在展开瞬间算一次位置"这个设计有个
   *  延迟复发漏洞——卡片展开后若用户停留阅读不操作，场景仍在自动旋转
   *  （island-loader.js autoRotateSpeed≈0.5，约3°/秒），锚点会持续横移，
   *  几秒到几十秒后卡片重新漂出视口被裁切。修复：展开时暂停自动旋转
   *  （IslandLoader.stopAutoRotate('traitCard')），收起时恢复
   *  （startAutoRotate('traitCard')）——与 main-new.js::_openZonePanel()
   *  打开完整侧边面板时的既有停转模式保持一致。用独立 reason 而非直接
   *  覆盖布尔值，是为了避免和 zone-panel/Tutorial 各自的停转状态互相
   *  打架（例如trait卡片展开着的同时又点开了四柱面板，关闭四柱面板不应该
   *  让trait卡片的自转暂停被意外解除——见 island-loader.js::stopAutoRotate
   *  实现处注释）。由于本组件"同一时刻最多一张卡片展开"，无需计数器，
   *  只需在"从0张到1张"/"从1张到0张"两个转折点各调用一次即可
   *  （0张→切换到另一张的情况沿途保持锁定，重复 stopAutoRotate 是
   *  幂等的，不会有副作用）。 */
  function _toggleTraitExpand(targetDiv) {
    const wasExpanded = targetDiv.classList.contains('expanded');
    _traitLabels.forEach(({ div }) => {
      div.classList.remove('expanded', 'trait-expand-left');
      const card = div.querySelector('.trait-card');
      if (card) card.style.maxWidth = '';
    });
    if (!wasExpanded) {
      _positionTraitCard(targetDiv);
      targetDiv.classList.add('expanded');
      if (typeof IslandLoader !== 'undefined') IslandLoader.stopAutoRotate('traitCard');
    } else if (typeof IslandLoader !== 'undefined') {
      IslandLoader.startAutoRotate('traitCard');
    }
  }

  /**
   * 展开前判断卡片该往视口哪一侧展开、以及实际能用多宽。
   * 纯CSS无法知道锚点当前投影到屏幕的哪个位置（CSS2DRenderer每帧用内联
   * transform: translate(-50%,-50%) translate(x,y) 更新锚点，具体像素坐标只有
   * 运行时才知道），所以这里在用户点击展开的这一刻用一次 getBoundingClientRect
   * 判断——只在展开动作发生时算一次，不是每帧计算，符合这个组件目前"零JS每帧
   * 开销"的整体设计（对比 index.html 里 .trait-card 的静态CSS规则）。
   * @param {HTMLElement} markerDiv - .trait-marker 容器（含 .trait-dot/.trait-card）
   */
  function _positionTraitCard(markerDiv) {
    const dot  = markerDiv.querySelector('.trait-dot');
    const card = markerDiv.querySelector('.trait-card');
    if (!dot || !card) return;
    const rect   = dot.getBoundingClientRect();
    const vw     = window.innerWidth || document.documentElement.clientWidth;
    const margin = 8;  // 视口边缘留白，避免卡片贴边
    const gap    = 44; // 与 index.html .trait-card 的 left/right:44px 保持一致

    const spaceRight = vw - margin - (rect.left + gap);
    const spaceLeft  = (rect.left + rect.width) - gap - margin;
    const expandLeft = spaceLeft > spaceRight;
    const available  = expandLeft ? spaceLeft : spaceRight;

    markerDiv.classList.toggle('trait-expand-left', expandLeft);
    // CSS里 min-width:130px/max-width:200px 是设计上限；这里按实际可用空间
    // 动态收紧上限（永远在130~200之间），即便锚点落在窄视口正中央、两侧空间
    // 都不足200px时也不会超出更多——真正极端情况（可用空间<130）仍可能有
    // 几像素溢出，这是 min-width 设计意图与屏幕物理宽度冲突的unavoidable边界，
    // 而不是本次要修的裁切bug（该bug是固定 left:44px 完全不感知视口边界）。
    card.style.maxWidth = Math.max(130, Math.min(200, available)) + 'px';
  }

  // 2026-08-11：qa-reviewer 顺带指出展开状态下横竖屏切换/resize不会重算
  // maxWidth。展开期间已暂停自动旋转（见 _toggleTraitExpand），场景不会
  // 再自行漂移，用户主动转屏这种场景也通常不在专注阅读中，风险已大幅降低；
  // 但resize本身容易顺手处理，这里加一个防抖的 resize 监听，仅在存在
  // 已展开卡片时才重算，不引入常态每帧开销。
  let _resizeReflowTimer = null;
  window.addEventListener('resize', () => {
    if (_resizeReflowTimer) clearTimeout(_resizeReflowTimer);
    _resizeReflowTimer = setTimeout(() => {
      const expanded = _traitLabels.find(({ div }) => div.classList.contains('expanded'));
      if (expanded) _positionTraitCard(expanded.div);
    }, 150);
  });

  /**
   * 挂载命盘特点标注（优势✅ / 注意事项⚠️）。
   * 独立于 attach()/_attachLabels() 的生命周期——由AI异步分析完成后单独调用，
   * 可能比 attach() 晚几秒到几分钟。
   * @param {THREE.Scene} scene
   * @param {object} baziData
   * @param {{strengths:Array<{summary,detail}>, cautions:Array<{summary,detail}>}} traits
   */
  function attachTraits(scene, baziData, traits) {
    detachTraits(scene);
    if (!scene || !traits) return;

    const strengths = Array.isArray(traits.strengths) ? traits.strengths.slice(0, 3) : [];
    const cautions  = Array.isArray(traits.cautions)  ? traits.cautions.slice(0, 3)  : [];
    if (!strengths.length && !cautions.length) return;

    // 交替拼接：s0,c0,s1,c1,s2,c2 —— 顺序与 TRAIT_LAYOUT 数组下标一一对应，
    // 环上好/坏类型天然交替不相邻（见 TRAIT_LAYOUT 定义处注释）。
    const items = [];
    for (let i = 0; i < 3; i++) {
      if (strengths[i]) items.push({ kind: 'strength', idx: i, trait: strengths[i] });
      if (cautions[i])  items.push({ kind: 'caution',  idx: i, trait: cautions[i]  });
    }

    const { box, group } = _getIslandBox();

    items.forEach((item, i) => {
      const frac = TRAIT_LAYOUT[i];
      if (!frac) return;
      const pos = _layoutToWorld(frac, box, group);
      const { css2d, div } = _makeTraitLabel(item.kind, item.idx, item.trait, baziData);
      css2d.position.copy(pos);
      scene.add(css2d);
      _traitLabels.push({ css2d, div });
    });
  }

  /** 清理命盘特点标注（独立于 detach()/_clearLabels()，见 _traitLabels 声明处注释）*/
  function detachTraits(scene) {
    _traitLabels.forEach(({ css2d }) => { if (scene) scene.remove(css2d); });
    _traitLabels = [];
    // 2026-08-12 qa-reviewer实测发现：若销毁时恰有一张卡片处于展开状态
    // （'traitCard'停转锁已被占用），_toggleTraitExpand()的"收起"分支
    // 永远不会被走到（DOM直接被这里销毁，不经过用户点击收起），锁会
    // 永久卡住，导致自动旋转整场会话再也无法恢复（轻量刷新AI深析、
    // 切换/重新生成岛屿都会经过这里）。无论展开与否都无条件交还一次锁，
    // startAutoRotate 对一个未被占用的 reason 做 Set.delete 是安全的
    // no-op（见 island-loader.js::startAutoRotate 实现）。
    if (typeof IslandLoader !== 'undefined' && IslandLoader.startAutoRotate) {
      IslandLoader.startAutoRotate('traitCard');
    }
  }

  // ── Tutorial：高亮 / 清除高亮 ───────────────────────────
  /**
   * 高亮指定标签（其余变暗）
   * @param {string} key - 如 'pillar_day'、'shensha_将星'
   */
  function highlightLabel(key) {
    Object.entries(_labelMap).forEach(([k, el]) => {
      el.classList.remove('label-highlighted', 'label-dim');
      if (k === key) {
        el.classList.add('label-highlighted');
      } else {
        el.classList.add('label-dim');
      }
    });
  }

  /** 清除所有高亮与变暗状态 */
  function clearHighlight() {
    Object.values(_labelMap).forEach(el => {
      el.classList.remove('label-highlighted', 'label-dim');
    });
  }

  /**
   * 返回各标签的3D世界坐标（Tutorial 计算飞行目标用）
   * 注意：这是"最近一次 attach() 时实际计算出的世界坐标"（随模型包围盒动态
   * 变化），不是固定值；attach() 之前调用会返回空对象/数组。
   */
  function getLabelPositions() {
    return {
      pillars : _lastPillarWorldPos,
      shensha : _lastShenshaWorldPos,
    };
  }

  // ── fallback：无 CSS2DRenderer 时用 HTML overlay ─────────
  function _fallbackHtmlOverlay(baziData) {
    const existing = document.getElementById('island-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'island-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:20';

    const p = baziData.pillars || {};
    const info = document.createElement('div');
    info.style.cssText = 'position:absolute;top:60px;left:16px;display:flex;flex-direction:column;gap:6px';
    const cols   = ['year','month','day','hour'];
    const labels = { year:'年',month:'月',day:'日',hour:'时' };
    cols.forEach(col => {
      const pl = p[col] || {};
      const tag = document.createElement('div');
      tag.style.cssText = `
        background:rgba(8,8,20,.85);border:1px solid rgba(201,169,110,.3);
        border-radius:6px;padding:4px 10px;font-size:11px;
        color:${_stemColor(pl.stem)};letter-spacing:1px;
        pointer-events:auto;cursor:pointer;
      `;
      tag.textContent = `${labels[col]}｜${pl.stem||'—'}${pl.branch||'—'}`;
      tag.addEventListener('click', () => {
        if (window.onIslandZoneClick) window.onIslandZoneClick('pillar_' + col, baziData);
      });
      info.appendChild(tag);
    });
    overlay.appendChild(info);
    document.getElementById('screen-island')?.appendChild(overlay);
  }

  // ── 清理 ─────────────────────────────────────────────────
  function _clearLabels(scene) {
    _labels.forEach(l => scene.remove(l));
    _labels   = [];
    _labelMap = {};
    const existing = document.getElementById('island-overlay');
    if (existing) existing.remove();
  }

  function detach(scene) { _clearLabels(scene); }

  // ── 工具 ─────────────────────────────────────────────────
  function _stemColor(stem) {
    const map = {
      '甲':'#6FCF97','乙':'#6FCF97',
      '丙':'#EB5757','丁':'#EB5757',
      '戊':'#F2C94C','己':'#F2C94C',
      '庚':'#C8C8D8','辛':'#C8C8D8',
      '壬':'#6EB5FF','癸':'#6EB5FF',
    };
    return map[stem] || '#e8e0d0';
  }

  function _ssIcon(name) {
    const icons = {
      '将星':'⚔','禄神':'💰','红鸾':'🌸','天乙':'🌟','文昌':'📚',
      '驿马':'🐎','亡神':'💀','劫煞':'⚡','白虎':'🐯','羊刃':'🗡',
      '孤辰':'🌙','天德':'☀','月德':'🌕','红艳':'🌹','天喜':'🎉',
    };
    return icons[name] || '✦';
  }

  /** 返回指定标签的 DOM 元素（Tutorial 用于绑定点击） */
  function getLabelElement(key) {
    return _labelMap[key] || null;
  }

  // ── 供其他模块（island-decorations.js）复用的公开工具 ──────
  // 2026-08-01：island-decorations.js 的 DECOR_DEFS 曾经历跟本文件早期
  // PILLAR_POSITIONS/SHENSHA_POSITIONS 完全相同的"写死绝对世界坐标"问题
  // （见已知问题记录），直接复用这里已经验证过的包围盒计算 + 比例换算逻辑，
  // 而不是在 island-decorations.js 里重新实现一份容易失配的复制品。
  // 命名沿用 getIslandBox/layoutToWorld（不带下划线前缀）表示这是有意导出的公开API。
  function getIslandBox() { return _getIslandBox(); }
  function layoutToWorld(frac, box, group) { return _layoutToWorld(frac, box, group); }

  return {
    attach, detach, highlightLabel, clearHighlight, getLabelPositions, getLabelElement,
    getIslandBox, layoutToWorld,
    attachTraits, detachTraits,
  };
})();
