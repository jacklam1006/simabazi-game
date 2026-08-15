/**
 * 司马八字 · 五行拖拽维护交互 wuxing-drag.js
 *
 * 第四阶段"五行游戏经营机制"里"①免费维护"的交互实现——固定定位的屏幕底部
 * "维护工具条"（💧灌溉/✂️修剪，水晶态换皮✨消磁）→ 用户拖起对应方向的图标
 * → 幽灵图标跟随手指移动 → 实时矩形碰撞检测匹配方向的热点、命中给出视觉
 * 反馈 → 松手判定最终落点是否命中 → 命中则调用
 * WuxingMaintenance.maintain(baziData, wx, direction, severity) 并根据返回
 * 结果给出对应UI反馈。
 *
 * 技术选型：Pointer Events（pointerdown/pointermove/pointerup +
 * setPointerCapture）+ getBoundingClientRect() 矩形碰撞检测，不用HTML5原生
 * Drag-and-Drop API（移动端支持历来不可靠）。项目里唯一先例是
 * js/scene-builder.js::_bindClickDetection() 的同款三段式pointer监听（那里
 * 只是"点击检测"，"拖起+跟随+命中判定"这套逻辑本文件从零写）。
 *
 * 依赖（均为运行时typeof防御性检查，任一模块尚未就绪/未加载时静默降级，
 * 不阻塞页面其它功能）：
 *   WuxingScene.getActiveMarkers() → Array<{wx,direction,dotEl,tier}>
 *     （js/wuxing-scene.js，frontend-3d领域，本轮同批新增）
 *   WuxingScene.reflectTier(wx,direction,tier)（同上）
 *   WuxingIssues.deriveIssues(baziData) → Array<{wx,direction,severity}>
 *     （js/wuxing-issues.js，bazi-pipeline领域，用于查出目标issue的
 *     severity——WuxingMaintenance.maintain() 签名需要这个参数，而
 *     getActiveMarkers() 按约定形状不带severity字段，不额外扩展那个契约，
 *     改从这个已有的公开纯函数现查，等价、且不引入新的跨模块假设）
 *   WuxingMaintenance.maintain(baziData, wx, direction, severity)
 *     → { ok:true, spiritEarned, newTier:1 } | { ok:false, reason:'daily_limit' }
 *     （js/wuxing-maintenance.js，user-system领域，并行开发中——本文件
 *     全程typeof防御，对方尚未接入时优雅降级为"维护系统尚未就绪"提示，
 *     不报错、不阻塞其它交互）
 *   WuxingMaintenance.getState(baziData, wx, direction, severity) → {tier,ownershipTier,...}
 *     （同上，可选——仅用于"水晶态换皮✨"这个锦上添花的判断，不存在时
 *     工具图标退回默认💧/✂️，不影响核心维护流程）
 *   App._getBaziData()（js/main-new.js，运行时调用，脚本加载顺序不要求
 *     main-new.js在本文件之前，见index.html对应script标签注释）
 *
 * 移动端注意：拖起的图标和跟随手指的幽灵元素都必须加 touch-action:none
 * （见index.html对应CSS）——否则Pointer Events不会阻止浏览器原生滚动/
 * 下拉刷新手势，这是这类交互最容易漏掉的坑。
 */
const WuxingDrag = (() => {

  const ICON_BY_DIRECTION = { nourish: '💧', restrain: '✂️' };
  const CRYSTAL_ICON = '✨';
  const HIT_TOLERANCE = 16;   // px，松手判定命中的容错范围（矩形外扩）

  let _toolbar   = null;
  let _ghost     = null;
  let _dragState = null;   // { direction, targetEntry } 拖拽进行中才非空
  let _refreshTimer = null;

  // ── i18n/toast 辅助（同款写法见 js/products.js::_t()/_toast()，各文件
  //    各自维护一份是本项目既有惯例，不抽公共模块）─────────────────────
  function _t(key, vars) {
    let s = (typeof Lang !== 'undefined') ? Lang.t(key) : key;
    if (vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }

  function _toast(msg, isError) {
    const existing = document.getElementById('wxdrag-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'wxdrag-toast';
    toast.style.cssText = `
      position:fixed;top:80px;left:50%;transform:translateX(-50%) translateY(-20px);
      background:rgba(8,8,20,.95);
      border:1px solid ${isError ? 'rgba(235,87,87,.5)' : 'rgba(201,169,110,.4)'};
      border-radius:12px;padding:12px 20px;z-index:920;
      display:flex;align-items:center;gap:10px;max-width:320px;
      box-shadow:0 8px 32px rgba(0,0,0,.4);
      opacity:0;transition:all .3s ease;
      font-size:12px;line-height:1.5;color:${isError ? '#ff8a8a' : '#e8e0d0'};
      pointer-events:none;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-20px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function _getBaziData() {
    return (typeof App !== 'undefined' && typeof App._getBaziData === 'function')
      ? App._getBaziData() : null;
  }

  // severity 不在 WuxingScene.getActiveMarkers() 的约定返回形状里（那份契约
  // 已冻结，不额外扩展），也不是 WuxingMaintenance.getState(baziData,wx,
  // direction,severity) 第4个参数的可选项——同一命盘同一wx+direction的
  // severity是 WuxingIssues.deriveIssues() 算出的确定性静态值，现查即可，
  // 不需要在别处额外传递/缓存一份。两处用到severity的地方（_iconFor()判断
  // 水晶态、_performMaintain()真正调用maintain()）共用这一份，避免出现"面板
  // 传对了、这里传漏了"两处不同步。
  function _severityFor(baziData, wx, direction) {
    if (typeof WuxingIssues === 'undefined' || typeof WuxingIssues.deriveIssues !== 'function') return 1;
    try {
      const issues = WuxingIssues.deriveIssues(baziData) || [];
      const found = issues.find(i => i.wx === wx && i.direction === direction);
      return (found && typeof found.severity === 'number') ? found.severity : 1;
    } catch (e) { return 1; }
  }

  // ── 工具条构建/刷新 ──────────────────────────────────────────────
  // 每次刷新都重建按钮（数量恒为0~2个，成本可忽略）——按"当前场上是否还有
  // 该方向的活跃问题"决定是否显示对应图标，没有该方向问题就不给一个空转的
  // 拖拽入口。水晶态换皮判断：该方向下所有活跃marker都已是crystal/shrine所
  // 有权时才整体换成✨（WuxingMaintenance.getState 不存在/未实现时优雅降级
  // 为默认图标，不报错）。
  function _iconFor(direction, markers) {
    const list = markers.filter(m => m.direction === direction);
    if (!list.length) return null;
    if (typeof WuxingMaintenance === 'undefined' || typeof WuxingMaintenance.getState !== 'function') {
      return ICON_BY_DIRECTION[direction];
    }
    const baziData = _getBaziData();
    if (!baziData) return ICON_BY_DIRECTION[direction];
    const allCrystal = list.every(m => {
      try {
        const severity = _severityFor(baziData, m.wx, direction);
        const st = WuxingMaintenance.getState(baziData, m.wx, direction, severity);
        return st && (st.ownershipTier === 'crystal' || st.ownershipTier === 'shrine');
      } catch (e) { return false; }
    });
    return allCrystal ? CRYSTAL_ICON : ICON_BY_DIRECTION[direction];
  }

  function _ensureToolbar() {
    if (_toolbar) return _toolbar;
    _toolbar = document.createElement('div');
    _toolbar.id = 'wx-maint-toolbar';
    document.body.appendChild(_toolbar);
    return _toolbar;
  }

  function refresh() {
    if (_dragState) return;   // 拖拽进行中不重建DOM（避免中途把正在拖的按钮换掉）
    if (typeof WuxingScene === 'undefined' || typeof WuxingScene.getActiveMarkers !== 'function') return;

    let markers = [];
    try { markers = WuxingScene.getActiveMarkers() || []; } catch (e) { markers = []; }

    if (!markers.length) {
      if (_toolbar) _toolbar.style.display = 'none';
      return;
    }

    const bar = _ensureToolbar();
    bar.style.display = 'flex';
    bar.innerHTML = '';

    ['nourish', 'restrain'].forEach(direction => {
      const icon = _iconFor(direction, markers);
      if (!icon) return;
      const btn = document.createElement('div');
      btn.className = 'wx-maint-tool';
      btn.dataset.direction = direction;
      btn.textContent = icon;
      btn.addEventListener('pointerdown', (e) => _onToolPointerDown(e, btn, direction));
      bar.appendChild(btn);
    });
  }

  // ── 拖拽手势 ─────────────────────────────────────────────────────
  function _onToolPointerDown(e, toolEl, direction) {
    e.preventDefault();
    if (_dragState) return;   // 防止多指同时拖两个工具

    if (typeof WuxingScene === 'undefined' || typeof WuxingScene.getActiveMarkers !== 'function') return;
    let markers = [];
    try { markers = WuxingScene.getActiveMarkers() || []; } catch (err) { markers = []; }
    const candidates = markers.filter(m => m.direction === direction);
    if (!candidates.length) return;   // 理论上不会发生（工具按钮已按此过滤才渲染），防御一下

    try { toolEl.setPointerCapture(e.pointerId); } catch (err) { /* 部分浏览器/元素不支持，忽略 */ }
    toolEl.classList.add('wx-tool-dragging');

    _ghost = document.createElement('div');
    _ghost.className = 'wx-drag-ghost';
    _ghost.textContent = toolEl.textContent;
    document.body.appendChild(_ghost);
    _positionGhost(e.clientX, e.clientY);

    _dragState = {
      pointerId: e.pointerId,
      direction,
      toolEl,
      candidates,
      hitEntry: null,
    };

    if (typeof IslandLoader !== 'undefined' && IslandLoader.stopAutoRotate) {
      IslandLoader.stopAutoRotate('wxDrag');
    }

    const onMove = (ev) => { if (ev.pointerId === _dragState?.pointerId) _onPointerMove(ev); };
    const onUp   = (ev) => { if (ev.pointerId === _dragState?.pointerId) _onPointerUp(ev, onMove, onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function _positionGhost(x, y) {
    if (!_ghost) return;
    _ghost.style.transform = `translate(${x - 26}px, ${y - 26}px)`;
  }

  function _onPointerMove(e) {
    if (!_dragState) return;
    _positionGhost(e.clientX, e.clientY);

    const hit = _findHit(e.clientX, e.clientY);
    if (hit !== _dragState.hitEntry) {
      if (_dragState.hitEntry) _dragState.hitEntry.dotEl.closest('.wx-marker')?.classList.remove('wx-drop-target-active');
      if (hit) hit.dotEl.closest('.wx-marker')?.classList.add('wx-drop-target-active');
      _dragState.hitEntry = hit;
    }
  }

  function _findHit(x, y) {
    if (!_dragState) return null;
    for (const m of _dragState.candidates) {
      if (!m.dotEl || !m.dotEl.isConnected) continue;
      const r = m.dotEl.getBoundingClientRect();
      if (x >= r.left - HIT_TOLERANCE && x <= r.right + HIT_TOLERANCE &&
          y >= r.top  - HIT_TOLERANCE && y <= r.bottom + HIT_TOLERANCE) {
        return m;
      }
    }
    return null;
  }

  function _onPointerUp(e, onMove, onUp) {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);

    const state = _dragState;
    _dragState = null;

    if (state?.toolEl) {
      try { state.toolEl.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      state.toolEl.classList.remove('wx-tool-dragging');
    }
    if (state?.hitEntry) {
      state.hitEntry.dotEl.closest('.wx-marker')?.classList.remove('wx-drop-target-active');
    }
    if (_ghost) { _ghost.remove(); _ghost = null; }
    if (typeof IslandLoader !== 'undefined' && IslandLoader.startAutoRotate) {
      IslandLoader.startAutoRotate('wxDrag');
    }

    if (state?.hitEntry) {
      _performMaintain(state.hitEntry.wx, state.direction);
    }
    // 工具条数据可能因为这次维护发生变化（tier回1、水晶态判断等），
    // 刷新一次不影响没命中的情况（重建成本可忽略）
    refresh();
  }

  // ── 命中后执行维护 ───────────────────────────────────────────────
  function _performMaintain(wx, direction) {
    if (typeof WuxingMaintenance === 'undefined' || typeof WuxingMaintenance.maintain !== 'function') {
      _toast(_t('wxmaint.drag_not_ready'), true);
      return;
    }
    const baziData = _getBaziData();
    if (!baziData) {
      _toast(_t('wxmaint.drag_not_ready'), true);
      return;
    }

    const severity = _severityFor(baziData, wx, direction);

    let result;
    try {
      result = WuxingMaintenance.maintain(baziData, wx, direction, severity);
    } catch (e) {
      console.error('[WuxingDrag] WuxingMaintenance.maintain 调用异常:', e);
      _toast(_t('wxmaint.drag_fail'), true);
      return;
    }

    // maintain() 可能是同步返回、也可能返回Promise（对方实现细节不确定，
    // 两种都兼容处理，不假设其中一种）
    if (result && typeof result.then === 'function') {
      result.then(_handleMaintainResult).catch(() => _toast(_t('wxmaint.drag_fail'), true));
    } else {
      _handleMaintainResult(result);
    }

    function _handleMaintainResult(res) {
      if (res && res.ok) {
        // js/wuxing-maintenance.js::maintain() 冻结返回形状是
        // { ok:true, spiritEarned, newTier:1 }——spiritEarned是权威字段名，
        // 其余几个是对方实现细节未定稿前的防御性兜底，保留以防万一改名。
        const gained = res.spiritEarned ?? res.spiritGained ?? res.reward ?? res.amount ?? res.spirit;
        _toast(typeof gained === 'number' ? _t('wxmaint.drag_gained', { n: gained }) : _t('wxmaint.resolved_badge'));
        if (typeof WuxingScene !== 'undefined' && typeof WuxingScene.reflectTier === 'function') {
          WuxingScene.reflectTier(wx, direction, 1);
        }
        refresh();
      } else if (res && res.reason === 'daily_limit') {
        _toast(_t('wxmaint.drag_daily_limit'), true);
      } else if (res && res.reason === 'already_shrined') {
        // 换设备/清缓存后云端同步落地前的极短窗口内，3D场景可能还没被
        // main-new.js::_onIslandReady()里sync完成后的markShrined()纠正过来，
        // 用户在这个窗口拖拽到一个其实已经"请神仙"永久巩固的issue上——
        // 用通用的"维护失败，请稍后再试"会让人误以为是网络故障，这里给出
        // 准确的原因。
        _toast(_t('wxmaint.drag_already_shrined'), true);
        if (typeof WuxingScene !== 'undefined' && typeof WuxingScene.markShrined === 'function') {
          WuxingScene.markShrined(wx, direction);
        }
      } else {
        _toast(_t('wxmaint.drag_fail'), true);
      }
    }
  }

  // ── 定期轮询刷新工具条（本模块与 WuxingScene.attach()/main-new.js 之间
  //    没有事件总线，最简单可靠的解耦方式是轻量轮询——2-3个热点规模下
  //    getActiveMarkers()成本可忽略，不需要引入MutationObserver等更重的
  //    机制）──────────────────────────────────────────────────────────
  function _startPolling() {
    refresh();
    _refreshTimer = setInterval(refresh, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startPolling);
  } else {
    _startPolling();
  }

  return { refresh };
})();
