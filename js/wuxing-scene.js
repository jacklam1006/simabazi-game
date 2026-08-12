/**
 * 司马八字 · 五行维护系统 3D挂载 wuxing-scene.js
 *
 * 2026-08-13：第三阶段"五行维护系统"（把岛屿地形本身变成命盘问题的具象化
 * 呈现），取代第一/二阶段的✅/⚠️ trait图标标注（island-annotate.js 的
 * TRAIT_LAYOUT/attachTraits()，见该文件顶部停用说明——本模块是替代者）。
 *
 * 职责边界：本文件只负责"把 issues 数组渲染成3D场景里的可点击装饰"，不负责
 * 判定问题（js/wuxing-issues.js::deriveIssues()，bazi-pipeline领域）、不负责
 * AI叙事拼装（main-new.js接线部分，user-system领域）、不负责详情面板渲染
 * （js/analysis.js::buildMaintenancePanel()）。本文件只消费一个约定好形状的
 * issues数组：
 *   Array<{ wx, direction:'nourish'|'restrain', severity:0-2,
 *           title, narrative, action_hint }>
 *
 * 复用 island-annotate.js 已验证过的包围盒定位逻辑（getIslandBox()/
 * layoutToWorld()），不重新实现射线贴地。
 *
 * 交互模式沿用 island-annotate.js::attachTraits() 的"CSS2DObject小圆点热点
 * → 点击展开卡片 → 卡片点击触发 onIslandZoneClick"三段式设计（含同一套
 * "展开时暂停场景自转/避免视口裁切"修复），只是环形布局点数从6个降到
 * 通常2-3个（issues.length，由命理判定动态决定，不强求固定数量）。
 *
 * 关键坑（务必保持）：window.onIslandZoneClick(zoneKey, baziData, force, extra)
 * 调用时的 {wx, direction, severity, title, narrative, action_hint} 必须在
 * 创建热点DOM时就用闭包直接携带，不能指望点击那一刻去查某个模块级变量——
 * 这是四柱/神煞面板早年踩过、trait系统重蹈过一次才修好的坑（见已知问题
 * 与修复记录.md），本文件从一开始就避开同一类问题。
 *
 * 2026-08-13追加：markResolved(wx, direction) —— 灵气兑换成功后（
 * js/products.js::redeem()）调用，把对应"问题"标注/装饰翻转为"已改善"
 * 视觉反馈（翻牌✅+发光过渡后移除），呼应第二阶段
 * island-annotate.js::markTraitResolved() 同一套设计语言。
 */
const WuxingScene = (() => {

  // ── 环形布局参数 ──────────────────────────────────────────
  // 半径/高度刻意跟四柱（PILLAR_LAYOUT，半径约0.8，y 0.55~0.85）、神煞
  // （SHENSHA_LAYOUT，半径1.0，y=0.25定高）、以及已停用但代码仍保留的
  // 旧trait环（TRAIT_LAYOUT，半径0.26~0.52，y 0.18/0.32）都错开，降低
  // 多套标注/装饰互相重叠视觉冲突的概率。起始角度 30° 是刻意选的，避免
  // 与四柱/神煞常用的 0°/45°/90° 整数角完全对齐（见 SHENSHA_LAYOUT 里
  // x/z 组合换算出的角度集合：0/45/90/135/180/315）。
  const RADIUS = 0.58;
  const START_ANGLE_DEG = 30;
  const Y_BY_DIRECTION     = { nourish: 0.20, restrain: 0.34 };
  const HOVER_BY_DIRECTION = { nourish: 0.22, restrain: 0.28 };
  // 拖拽维护交互（下一轮独立子阶段）预告的隐喻在这里先用图标体现：
  // nourish（喜用神不足，需要"灌溉"）= 💧，restrain（忌神过旺，需要"除草/
  // 克制"）= ✂️。与 island-decorations.js 里对应 decorId 的3D占位形状
  // （tree=需要培育的幼苗 / ring=需要约束的锁环）呼应同一套隐喻，不是
  // 随意选的图标。
  const ICON_BY_DIRECTION = { nourish: '💧', restrain: '✂️' };

  // i18n查表辅助（2026-08-13新增）——跟 js/products.js::_t()/js/analysis.js::_t()
  // 同款写法，Lang.t()本身不支持占位符插值，这里补一层简单replace；Lang模块
  // 未加载时原样返回key，不报错（不同文件各自维护一份同款小helper是本项目
  // 既有惯例，见 products.js/main-new.js/settings.js/analysis.js 里同名函数）。
  function _t(key, vars) {
    let s = (typeof Lang !== 'undefined') ? Lang.t(key) : key;
    if (vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }

  let _markers = [];   // [{ css2d: CSS2DObject, div: HTMLElement, wx, direction, decorId }]
  // attach() 时记录的场景引用，供 markResolved() 在没有 scene 参数的调用签名下
  // （见 js/products.js::redeem() 既定调用 WuxingScene.markResolved(wx, direction)
  // 的约定，不传scene）仍能把对应CSS2DObject从场景移除。detach() 会清空它。
  let _scene = null;

  /** 按 issues.length 均分角度，2条→180°对置，3条→120°三等分，以此类推 */
  function _computeAngles(n) {
    if (!n) return [];
    const spacing = 360 / n;
    const out = [];
    for (let i = 0; i < n; i++) {
      const rad = (START_ANGLE_DEG + i * spacing) * Math.PI / 180;
      out.push({ x: Math.cos(rad) * RADIUS, z: Math.sin(rad) * RADIUS });
    }
    return out;
  }

  /**
   * 挂载五行维护装饰。独立于 IslandAnnotate.attach()/attachTraits() 的
   * 生命周期——由AI异步分析完成后单独调用（main-new.js接线部分）。
   * @param {THREE.Scene} scene
   * @param {object} baziData
   * @param {Array<{wx,direction,severity,title,narrative,action_hint}>} issues
   */
  function attach(scene, baziData, issues) {
    detach(scene);
    if (!scene || !Array.isArray(issues) || !issues.length) return;
    if (typeof IslandAnnotate === 'undefined' ||
        !IslandAnnotate.getIslandBox || !IslandAnnotate.layoutToWorld) {
      console.warn('[WuxingScene] IslandAnnotate 定位API不可用，跳过挂载');
      return;
    }

    _scene = scene;
    const { box, group } = IslandAnnotate.getIslandBox();
    const angles = _computeAngles(issues.length);

    issues.forEach((issue, i) => {
      if (!issue || !issue.wx) return;
      const wx        = issue.wx;
      const direction = issue.direction === 'restrain' ? 'restrain' : 'nourish';
      const angle     = angles[i] || { x: 0, z: 0 };
      const frac = {
        x: angle.x,
        z: angle.z,
        y: Y_BY_DIRECTION[direction],
        hover: HOVER_BY_DIRECTION[direction],
      };
      const pos = IslandAnnotate.layoutToWorld(frac, box, group);
      const decorId = `wxmaint_${wx}_${direction}`;

      // 3D占位装饰（tree=需要培育 / ring=需要约束，见 island-decorations.js
      // 新增的 DECOR_DEFS 条目）——overridePos 是本轮新增的第三参数，跳过
      // DECOR_DEFS 里静态 frac 坐标，直接用这里动态算出的世界坐标。
      if (typeof IslandDecorations !== 'undefined' && IslandDecorations.add) {
        IslandDecorations.add(decorId, baziData, pos);
      }

      // 点击热点（CSS2DObject小圆点+展开卡片），闭包直接携带完整issue数据
      const { css2d, div } = _makeHotspot(wx, direction, issue, baziData);
      css2d.position.copy(pos);
      scene.add(css2d);
      // 记录 wx/direction/decorId，供 markResolved(wx, direction) 按key查找——
      // 不依赖数组下标（issues顺序理论上稳定，但按语义key查找更稳妥，跟
      // island-annotate.js::markTraitResolved() 按 kind+idx 查找是同一思路）。
      _markers.push({ css2d, div, wx, direction, decorId });
    });
  }

  /**
   * 清理五行维护装饰——CSS2D热点 + 对应的3D占位装饰网格都要清（qa-reviewer
   * 2026-08-13复查发现：此前这里只清了CSS2D热点，`wxmaint_*` 网格完全没人
   * 移除，唯一真正清理它们的路径只有 island-decorations.js::clearAll()，
   * 而那个函数只从 main-new.js::restoreAll() 触发——"轻量刷新AI深析"这条
   * 不经过 restoreAll() 的路径下，重算出的新issue集合会跟旧issue遗留的
   * 网格错位（新一批issue重新计算环形角度，但旧decorId因为
   * IslandDecorations.add() 的"已存在则直接return"逻辑，位置停留在旧坐标，
   * 造成热点跟3D物体对不上）。修复：detach() 对 _markers 里每个条目都补一句
   * IslandDecorations.remove(decorId)。
   *
   * 与 markResolved() 的关系：markResolved() 处理"单个issue被兑换后清理"，
   * detach() 处理"整批issue因换岛屿/重新生成而整体作废"，触发场景不同，但
   * 都会调 IslandDecorations.remove(decorId)——如果某个issue在detach()之前
   * 已经被 markResolved() 处理过（decorId已经remove过一次），这里对同一个
   * decorId再调一次remove()不会报错：island-decorations.js::remove() 内部
   * 用 `if (_placed[decorId])` 判空，对不存在的decorId是安全的no-op（已读
   * 该函数源码确认，不是假设），不需要在这里额外加判断跳过。
   */
  function detach(scene) {
    _markers.forEach(({ css2d, decorId }) => {
      if (scene) scene.remove(css2d);
      if (typeof IslandDecorations !== 'undefined' && IslandDecorations.remove) {
        IslandDecorations.remove(decorId);
      }
    });
    _markers = [];
    _scene = null;
    // 无条件交还自转停转锁——与 island-annotate.js::detachTraits() 同一个
    // 修复模式（见该函数2026-08-12注释）：即使销毁时恰有卡片展开
    // （'wxCard'锁被占用），DOM直接被移除也不会经过用户点击收起那条路径，
    // 不无条件释放的话会让锁永久卡住、自转再也无法恢复。
    if (typeof IslandLoader !== 'undefined' && IslandLoader.startAutoRotate) {
      IslandLoader.startAutoRotate('wxCard');
    }
  }

  /**
   * 兑换实体商品"改善"某条五行问题成功后调用（js/products.js::redeem()）。
   * 契约：调用方只传 (wx, direction)，不传scene——世界坐标/场景引用已经在
   * attach() 时存进了闭包(_markers条目)/模块变量(_scene)，不需要调用方
   * 重新提供。视觉过渡沿用 island-annotate.js::markTraitResolved() 的设计
   * 语言（翻牌scale+rotateY，中点切图标，末尾发光收尾），做完过渡后才真正
   * 清理，让用户能感知"这条问题被处理了"，不是无声无息的DOM消失：
   *   1) 热点圆点翻牌成 ✅ 并短暂发光（CSS .wx-resolving，见index.html）；
   *   2) 3D"问题"占位装饰立即用 IslandDecorations.remove(decorId) 移除
   *      （该函数早已实现但此前从未被业务逻辑调用过，这是第一个真实调用
   *      场景，按计划文档明确要求复用，不重新实现一份）；
   *   3) 翻牌+发光动画播完后（约1s），热点本身也从场景/DOM彻底移除，避免
   *      残留死节点/事件监听器——对齐 detach() 的清理力度，只是这里只清理
   *      这一个entry，不影响场上其余未resolve的issue。
   * @param {string} wx        - 五行，如 '木'
   * @param {string} direction - 'nourish' | 'restrain'
   */
  function markResolved(wx, direction) {
    const entry = _markers.find(m => m.wx === wx && m.direction === direction);
    if (!entry) {
      // 防御性：可能AI分析尚未挂载完成/已被 detach()（换岛屿、刷新AI深析）
      // 清理掉，不是代码异常——灵气已扣、后端记录已写入，3D视觉只是暂时
      // 没能同步，不应该让兑换流程崩溃（同款处理见 markTraitResolved()）。
      console.warn(`[WuxingScene] markResolved 未找到对应标注 wx=${wx} direction=${direction}（可能尚未挂载或已被清理）`);
      return;
    }

    const { div, css2d, decorId } = entry;
    // 防止同一条被重复触发两次动画（如兑换成功回调因网络重试被意外调用两次）
    if (div.dataset.wxResolved === '1') return;
    div.dataset.wxResolved = '1';

    // 若恰好正展开着，先收起（避免翻牌/淡出动画期间卡片还悬在那）
    if (div.classList.contains('expanded')) {
      div.classList.remove('expanded', 'wx-expand-left');
      const card = div.querySelector('.wx-card');
      if (card) card.style.maxWidth = '';
      if (typeof IslandLoader !== 'undefined') IslandLoader.startAutoRotate('wxCard');
    }

    // 3D"问题"占位装饰立即移除——不用等视觉过渡播完，用户点开兑换弹窗时
    // 视线焦点在弹窗上，装饰这时候就该开始消失
    if (typeof IslandDecorations !== 'undefined' && IslandDecorations.remove) {
      IslandDecorations.remove(decorId);
    }

    // 热点翻牌成✅ + 短暂发光，动画期间禁用交互避免用户在过渡中途误触
    const dotEl = div.querySelector('.wx-dot');
    if (dotEl) {
      dotEl.textContent = '✅';
      dotEl.style.pointerEvents = 'none';
    }
    div.classList.add('wx-resolving');

    // 动画播完（翻牌.5s + 发光停留.2s + 淡出.3s ≈ 1.0s，见index.html对应
    // @keyframes 时长，留20ms余量避免setTimeout精度导致边缘截断）后彻底清理：
    // 从场景移除CSS2DObject、从_markers里摘掉这一条，不留死引用。
    setTimeout(() => {
      if (_scene) _scene.remove(css2d);
      const i = _markers.indexOf(entry);
      if (i !== -1) _markers.splice(i, 1);
    }, 1020);
  }

  // ── 热点 DOM ─────────────────────────────────────────────
  function _makeHotspot(wx, direction, issue, baziData) {
    const div = document.createElement('div');
    const severity = Math.max(0, Math.min(2, issue.severity | 0));
    div.className = `wx-marker wx-${direction} wx-sev-${severity}`;

    const wxColor = (typeof CONFIG !== 'undefined' && CONFIG.WUXING_COLORS && CONFIG.WUXING_COLORS[wx])
      ? CONFIG.WUXING_COLORS[wx] : null;
    if (wxColor) {
      div.style.setProperty('--wx-color', wxColor.primary);
      div.style.setProperty('--wx-glow', wxColor.glow);
    }

    const icon  = ICON_BY_DIRECTION[direction] || '❔';
    // 2026-08-13修复（qa-reviewer复查PLAUSIBLE）：兜底文案此前硬编码中文，
    // AI叙事漏了某条issue的title时（现在因缓存校验放宽为"非空即有效"，属于
    // 会被长期缓存下来的常态情况，不是罕见边界）英文界面会直接漏出中文。
    // 复用 js/i18n.js 已有的 wxmaint.title_fallback_nourish/restrain
    // 两个key（js/analysis.js::buildMaintenancePanel() 同一兜底场景已经在用，
    // 不新增key）。wxSuffix 对齐 analysis.js 同款处理："行"是中文语法后缀
    // （"木行"=Wood element），英文不需要。
    const isZh     = (typeof Lang === 'undefined') || Lang.getLang() === 'zh';
    const wxSuffix = isZh ? '行' : '';
    const title = issue.title || _t(
      direction === 'nourish' ? 'wxmaint.title_fallback_nourish' : 'wxmaint.title_fallback_restrain',
      { wx: wx + wxSuffix }
    );

    div.innerHTML = `
      <span class="wx-dot">${icon}</span>
      <div class="wx-leader"></div>
      <div class="wx-card">${title}</div>
    `;

    div.querySelector('.wx-dot').addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleExpand(div);
    });

    div.querySelector('.wx-card').addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof UIEffects !== 'undefined' && UIEffects.labelPulse) UIEffects.labelPulse(div);
      if (window.onIslandZoneClick) {
        // extra 数据在创建热点时就通过闭包直接携带，不依赖点击那一刻去查
        // 任何模块级缓存变量（见文件头注释"关键坑"）。force 固定传 false——
        // 这批热点不需要绕开教程guard，跟 island-annotate.js::attachTraits()
        // 的既有4参数约定保持一致。
        window.onIslandZoneClick(`wxmaint_${wx}_${direction}`, baziData, false, {
          wx, direction,
          severity: issue.severity,
          title: issue.title,
          narrative: issue.narrative,
          action_hint: issue.action_hint,
        });
      }
    });

    return { css2d: new THREE.CSS2DObject(_wrapAnchor(div)), div };
  }

  // 同款"定位锚点/视觉内容解耦"写法，见 island-annotate.js::_wrapAnchor()
  // 处的详细根因注释（CSS2DRenderer每帧写内联transform定位锚点，若锚点
  // 自身又挂了会动画transform的class会互相打架）——本模块热点虽然目前不会
  // 被 Tutorial highlightLabel 之类逻辑加class，但保持同一套防御结构，
  // 成本为零、且未来若需要接入高亮不会重新踩坑。
  function _wrapAnchor(contentDiv) {
    const anchor = document.createElement('div');
    anchor.appendChild(contentDiv);
    return anchor;
  }

  /** 同一时刻只允许一张卡片展开；展开时暂停自转（避免自转把卡片带出视口
   *  被裁切——island-annotate.js::_toggleTraitExpand() 修过的同一类问题，
   *  这里直接照搬同款修复，不重新踩一次）。*/
  function _toggleExpand(targetDiv) {
    const wasExpanded = targetDiv.classList.contains('expanded');
    _markers.forEach(({ div }) => {
      div.classList.remove('expanded', 'wx-expand-left');
      const card = div.querySelector('.wx-card');
      if (card) card.style.maxWidth = '';
    });
    if (!wasExpanded) {
      _positionCard(targetDiv);
      targetDiv.classList.add('expanded');
      if (typeof IslandLoader !== 'undefined') IslandLoader.stopAutoRotate('wxCard');
    } else if (typeof IslandLoader !== 'undefined') {
      IslandLoader.startAutoRotate('wxCard');
    }
  }

  /** 展开前判断该往视口哪一侧展开、以及实际能用多宽——同款逻辑见
   *  island-annotate.js::_positionTraitCard() 的详细注释，只在展开这一刻
   *  算一次（不是每帧），gap/margin 数值对齐本文件底部 index.html 里
   *  .wx-card 的 left/right:50px。*/
  function _positionCard(markerDiv) {
    const dot  = markerDiv.querySelector('.wx-dot');
    const card = markerDiv.querySelector('.wx-card');
    if (!dot || !card) return;
    const rect   = dot.getBoundingClientRect();
    const vw     = window.innerWidth || document.documentElement.clientWidth;
    const margin = 8;
    const gap    = 50;

    const spaceRight = vw - margin - (rect.left + gap);
    const spaceLeft  = (rect.left + rect.width) - gap - margin;
    const expandLeft = spaceLeft > spaceRight;
    const available  = expandLeft ? spaceLeft : spaceRight;

    markerDiv.classList.toggle('wx-expand-left', expandLeft);
    card.style.maxWidth = Math.max(120, Math.min(190, available)) + 'px';
  }

  // resize时若有卡片正展开，重算一次位置/宽度（防抖，同款见
  // island-annotate.js 底部对应实现的注释）
  let _resizeReflowTimer = null;
  window.addEventListener('resize', () => {
    if (_resizeReflowTimer) clearTimeout(_resizeReflowTimer);
    _resizeReflowTimer = setTimeout(() => {
      const expanded = _markers.find(({ div }) => div.classList.contains('expanded'));
      if (expanded) _positionCard(expanded.div);
    }, 150);
  });

  return { attach, detach, markResolved };
})();
