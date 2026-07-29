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

  // 干支五行映射（诊断徽标用）
  const STEM_WX = {
    '甲':'木','乙':'木','丙':'火','丁':'火',
    '戊':'土','己':'土','庚':'金','辛':'金','壬':'水','癸':'水',
  };

  let _labels   = [];    // 所有CSS2DObject引用
  let _labelMap = {};    // key → DOM div，供 highlight 使用

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
    return new THREE.CSS2DObject(div);
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
    return new THREE.CSS2DObject(div);
  }

  // ── 空亡标记 DOM ─────────────────────────────────────────
  function _makeKongwangLabel(kw) {
    const div = document.createElement('div');
    div.className = 'island-label kongwang-label';
    div.innerHTML = `<span>空亡</span><span style="color:#EB5757;margin-left:4px">${kw.join('、')}</span>`;
    return new THREE.CSS2DObject(div);
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

  return { attach, detach, highlightLabel, clearHighlight, getLabelPositions, getLabelElement };
})();
