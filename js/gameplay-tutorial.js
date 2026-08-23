/**
 * 司马八字 · 玩法引导 gameplay-tutorial.js
 *
 * js/tutorial.js（命盘引导）只教"认识命盘"——依次高亮四柱/神煞，引导点击
 * 查看详情，完全不涉及真实玩法。本模块是完全独立的第二条引导流程，教
 * "怎么玩"——五行拖拽维护赚灵气、每日任务/今日运势入口。两者是两套独立的
 * DOM/状态/持久化标记，只是共用同一套视觉语言（金色调性/柔和呼吸动画/
 * 居中卡片Modal），互不依赖对方内部私有函数。
 *
 * 触发入口：
 *   1. js/tutorial.js::_showGameplayCTA()——命盘引导完成后的可跳过CTA，
 *      点击「开始教学」才调用 start()，不点/关掉不影响正常使用
 *   2. HUD「🎮 玩法教学」常驻按钮——js/main-new.js::startGameplayTutorial()，
 *      任意时候可手动重玩，不受下方"全局完成标记"限制（与
 *      #hud-tutorial-restart「重玩引导」按钮同一UX惯例：已完成不影响
 *      随时手动重玩）
 *
 * 流程（5步，对应需求文档①-⑤）：
 *   ① 用 WuxingScene.getActiveMarkers() 拿全部热点，配合
 *      WuxingMaintenance.getState(baziData,wx,direction,severity)（severity
 *      现查 WuxingIssues.deriveIssues()，同 js/wuxing-drag.js::_severityFor()
 *      同款写法，各文件各自维护一份是本项目既有惯例）找 tier>1 的第一个
 *   ② 边界情况——找不到（没有热点，或全部tier===1"安泰"）：不卡住，改一段
 *      简短文案直接跳到步骤⑤（任务入口引导），见 _showBalancedStep()
 *   ③ 相机飞到一个能看到全岛热点分布的俯瞰机位（写死坐标，与
 *      js/tutorial.js::STEP_CAM.shensha 同款"俯瞰全岛"数值——五行维护热点
 *      是 js/wuxing-scene.js（frontend-3d领域，本模块不碰）内部管理的CSS2D
 *      标注，世界坐标未通过 WuxingScene.getActiveMarkers() 这个冻结契约
 *      暴露给外部，不新增跨领域API的前提下，退而求其次：飞到俯瞰机位后，
 *      用 #gt-target-ring 在屏幕空间实时跟踪目标热点 dotEl.
 *      getBoundingClientRect() 的中心点做精确视觉指向，两者组合达到"镜头
 *      靠近+精确高亮"的效果），配合一个引导专属的高亮class（.gt-target-
 *      highlight，不复用 js/wuxing-drag.js 拖拽命中时用的 .wx-drop-target-
 *      active——那个是"拖拽悬停在此"的实时反馈语义，混用会在用户真的开始
 *      拖拽时产生视觉冲突），提示文案引导拖底部💧/✂️工具到这个热点
 *   ④ 监听 wuxingMaintainSuccess 事件（js/wuxing-maintenance.js::maintain()
 *      薄包装2026-08-23统一派发，同时覆盖拖拽命中（js/wuxing-drag.js）和
 *      面板"维护一下，赚N灵气"按钮（js/main-new.js::_maintainWuxingIssue()）
 *      两条调用路径——本模块唯一的完成信号来源，不用宽泛的 spiritChanged，
 *      那个信号灵气变化的任何来源都会触发，无法区分"是不是这次教学拖拽
 *      赚的"）判定"用户真正完成了一次维护"，给出"赚了N灵气"反馈；同时监听
 *      同一处派发的 wuxingMaintainFailed 事件 + 60秒超时兜底（见
 *      _listenForSuccess()），避免选中的目标当天已被打理过而永久卡住
 *   ⑤ 引导指向 #hud-task-btn（柔和高亮+居中卡片提示文案），用户点"知道了"
 *      确认后，整个玩法引导标记为全局完成
 *
 * 持久化状态区分（重点）：
 *   localStorage key `gameplay_tutorial_done` = '1'，全局标记——不像命盘
 *   引导 `tutorial_done_<bazi_hash>` 那样按每张命盘内容的哈希分别存。玩法
 *   机制（拖拽维护/任务入口）跟命盘内容本身无关，用户在任意一张命盘上学会
 *   一次后，换一张新命盘不应该再被教一遍。isDone() 因此不接收 baziData 参数，
 *   与 js/tutorial.js::isDone(baziData, gender) 的签名形状刻意不同，调用方
 *   （js/main-new.js）不要混用。
 *
 * 公开 API：
 *   GameplayTutorial.start(baziData)
 *   GameplayTutorial.skip()
 *   GameplayTutorial.forceStop() → 供 js/main-new.js::_showScreen() 换屏时
 *      强制中止用（2026-08-23新增）——跟 skip() 的区别见该函数定义处注释：
 *      不标记"已完成"，纯粹清理DOM/内部状态，避免换屏后DOM覆盖层残留、
 *      以及 _active 卡死导致HUD按钮无法重新触发引导
 *   GameplayTutorial.isDone()   → boolean（全局，无需 baziData）
 *   GameplayTutorial.isActive() → boolean
 */
const GameplayTutorial = (() => {

  const DONE_KEY           = 'gameplay_tutorial_done';
  const TOOL_ICON           = { nourish: '💧', restrain: '✂️' };
  const ROTATE_LOCK_REASON  = 'gameplayTutorial';

  // 俯瞰全岛机位——与 js/tutorial.js::STEP_CAM.shensha 数值一致，理由见
  // 本文件头部"流程③"注释。写死坐标，不做包围盒相对化（同 tutorial.js
  // 头部注释里记录的教训：island-loader.js 的GLB归一化已经保证运行时
  // 包围盒恒定为"以原点对称、最大边=10"，写死坐标本身就是安全的）。
  const OVERVIEW_CAM  = { x: 0, y: 12, z: 18 };
  const OVERVIEW_LOOK = { x: 0, y: 0,  z: 0 };

  let _active    = false;
  let _phase     = null;   // 'balanced' | 'hotspot' | 'waiting' | 'task'
  let _baziData  = null;
  let _target    = null;   // { wx, direction, dotEl }
  let _ringRaf   = null;
  let _successFn = null;   // window 'wuxingMaintainSuccess' 监听函数引用，供移除
  let _failFn    = null;   // window 'wuxingMaintainFailed' 监听函数引用，供移除
  let _waitTimeoutTimer = null; // 步骤④"等待拖拽"超时兜底（2026-08-23新增，见 _listenForSuccess()）

  // 步骤④等待拖拽的超时兜底时长——见 _listenForSuccess() 注释。
  const WAIT_TIMEOUT_MS = 60000;

  // ── i18n 辅助（同款写法见 js/wuxing-drag.js::_t()，各文件各自维护一份，
  //    不抽公共模块，是本项目既有惯例）──────────────────────────────────
  function _t(key, fallback, vars) {
    let s = (typeof Lang !== 'undefined') ? Lang.t(key) : fallback;
    if (vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }

  // ── 轻量toast（qa-reviewer第三轮PLAUSIBLE②新增）：跟 js/wuxing-drag.js::
  //    _toast() 是同款写法，各文件各自维护一份是本项目既有惯例（见文件头
  //    部注释）。不复用对方那份是因为两个模块加载顺序不保证先后、且各自
  //    是独立领域，不引入跨文件私有函数依赖。────────────────────────────
  function _toast(msg) {
    const existing = document.getElementById('gt-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'gt-toast';
    toast.style.cssText = `
      position:fixed;top:80px;left:50%;transform:translateX(-50%) translateY(-20px);
      background:rgba(8,8,20,.95);border:1px solid rgba(201,169,110,.4);
      border-radius:12px;padding:12px 20px;z-index:920;
      max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,.4);
      opacity:0;transition:all .3s ease;
      font-size:12px;line-height:1.5;color:#e8e0d0;text-align:center;
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
    }, 2600);
  }

  // ── 公开：全局完成标记 ───────────────────────────────────────
  function isDone() {
    try { return !!localStorage.getItem(DONE_KEY); } catch (e) { return false; }
  }
  function isActive() { return _active; }

  // ── 公开：高亮热点被点击但被 js/main-new.js::_openZonePanel() 的引导
  //    guard 挡住时调用（qa-reviewer第三轮PLAUSIBLE②修复）——此前用户点
  //    被高亮的热点卡片，会先触发 js/wuxing-scene.js 里的 labelPulse 视觉
  //    反馈，然后被guard挡住（面板不打开），用户会觉得"点了有反应，但什么
  //    都没发生"。这里给一个明确的摇晃+toast提示，同款模式抄
  //    js/wuxing-drag.js::_rejectTier3()。只在"等待拖拽"阶段、且点击的
  //    正是当前引导目标热点时才提示，避免跟其它无关点击场景混淆。────────
  function notifyBlockedClick(zoneKey) {
    if (!_active || _phase !== 'waiting' || !_target) return;
    const expectedKey = 'wxmaint_' + _target.wx + '_' + _target.direction;
    if (zoneKey !== expectedKey) return;
    const markerEl = _target.dotEl && _target.dotEl.closest('.wx-marker');
    if (markerEl) {
      markerEl.classList.remove('wx-locked-shake');
      // 强制reflow，确保动画能在同一元素上重新触发（同款写法见
      // js/wuxing-drag.js::_rejectTier3()）
      void markerEl.offsetWidth;
      markerEl.classList.add('wx-locked-shake');
      setTimeout(() => markerEl.classList.remove('wx-locked-shake'), 500);
    }
    _toast(_t('gameplay.click_blocked_toast', '请拖拽下方工具到这个标记上试试'));
  }

  function _markDone() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
    // 供 js/main-new.js 监听刷新 HUD「玩法教学」按钮的呼吸提示动画，同款
    // 约定见 js/tutorial.js::_markDone() 里的 'tutorialDone' 事件。
    window.dispatchEvent(new CustomEvent('gameplayTutorialDone'));
  }

  // ── severity 现查（同 js/wuxing-drag.js::_severityFor() 同款写法）──────
  function _severityFor(baziData, wx, direction) {
    if (typeof WuxingIssues === 'undefined' || typeof WuxingIssues.deriveIssues !== 'function') return 1;
    try {
      const issues = WuxingIssues.deriveIssues(baziData) || [];
      const found = issues.find(i => i.wx === wx && i.direction === direction);
      return (found && typeof found.severity === 'number') ? found.severity : 1;
    } catch (e) { return 1; }
  }

  // ── 步骤①：找第一个"值得教、且相对更可能被免费拖拽教成功"的热点 ─────
  // 只选 tier===2，不是泛泛的 tier>1：js/wuxing-drag.js::_performMaintain()
  // 里 2026-08-23 同批新增的 tier3 拦截（_rejectTier3()）会让 tier===3
  // （"已达最重档"）的热点在免费拖拽命中时永远被摇晃+toast拒绝、不会触发
  // wuxingMaintainSuccess——只有花灵气的"瞬间调理"付费入口能处理tier3，
  // 所以tier3绝对不选。tier1（"安泰"）不选是因为演示"拖拽解决一个问题"时
  // 挑一个真的有问题的热点才有教学意义。
  // 注意（2026-08-23 qa-reviewer CONFIRMED②订正）：选tier2**不等于**保证
  // 这次拖拽一定会成功——WuxingMaintenance.maintain() 的每日限额判定
  // （daily_limit/daily_total_limit，见 js/wuxing-maintenance.js）跟"这条
  // issue今天有没有被维护过"直接相关，不是tier本身能保证的。这条issue完全
  // 可能在被这里选中之前，就已经通过面板/拖拽被维护过一次（tier此时懒计算
  // 出来还是2，是因为维护后立即变回1、随时间衰减又慢慢回升到2，today的
  // 每日额度判定跟tier数值是两套独立状态）。tier===2只是"矮子里拔将军"——
  // 相对tier1/tier3而言更可能走通，不是必然。因此步骤④"等待拖拽"必须有
  // 失败/超时兜底（见 _listenForFailure()/_waitTimeoutTimer），不能假设
  // 这里选出来的目标一定会成功。
  function _findTarget(baziData) {
    if (typeof WuxingScene === 'undefined' || typeof WuxingScene.getActiveMarkers !== 'function') return null;
    if (typeof WuxingMaintenance === 'undefined' || typeof WuxingMaintenance.getState !== 'function') return null;
    let markers = [];
    try { markers = WuxingScene.getActiveMarkers() || []; } catch (e) { markers = []; }
    for (const m of markers) {
      if (!m.dotEl || !m.dotEl.isConnected) continue;
      const severity = _severityFor(baziData, m.wx, m.direction);
      let tier = 1;
      try {
        const st = WuxingMaintenance.getState(baziData, m.wx, m.direction, severity);
        tier = st ? Number(st.tier) : 1;
      } catch (e) { tier = 1; }
      if (tier === 2) return m;
    }
    return null;
  }

  // ── 公开：启动 ────────────────────────────────────────────
  function start(baziData) {
    if (!baziData || _active) return;
    _active   = true;
    _baziData = baziData;

    const target = _findTarget(baziData);
    if (!target) {
      _showBalancedStep();
    } else {
      _target = target;
      _showHotspotStep();
    }
  }

  // ── 公开：跳过（任意阶段可调用，视同"已经学会"，标记全局完成）──────
  function skip() {
    if (!_active) return;
    _markDone();
    _cleanup();
  }

  // ── 公开：强制中止（2026-08-23新增，qa-reviewer CONFIRMED③修复）─────
  // 供 js/main-new.js::_showScreen() 换屏（比如设置面板"修改出生信息"/
  // "完全重新生成"）时调用——跟 skip() 的区别：不代表用户"学会了"，不写
  // DONE_KEY，纯粹是"当前这轮引导所依附的命盘场景已经不存在了，清理掉
  // 别让DOM覆盖层和内部状态残留"。不调用会导致两个问题：① #gt-overlay/
  // #gt-target-ring 等DOM覆盖层残留浮在新页面上方；② _active 永久卡在
  // true，之后HUD「玩法教学」按钮再点 start() 会被开头的 `_active` 早退
  // 挡住，只能刷新页面才能恢复。幂等——非激活状态调用是no-op。
  function forceStop() {
    if (!_active) return;
    _cleanup();
  }

  function _cleanup() {
    _active = false;
    _phase  = null;
    _clearSuccessListener();
    _clearFailureListener();
    _clearWaitTimeout();
    _hideRing();
    _hideHint();
    _hideModal();
    _hideOverlay();
    if (typeof IslandLoader !== 'undefined') {
      IslandLoader.setControlsEnabled(true);
      IslandLoader.startAutoRotate(ROTATE_LOCK_REASON);
    }
    document.getElementById('hud-task-btn')?.classList.remove('gt-hud-attn');
    document.getElementById('gt-skip-btn')?.classList.remove('gt-skip-btn-clear');
    _target = null;
  }

  // ── 覆盖层显示/隐藏（#gt-overlay：跳过按钮，跟 #tutorial-overlay 同款
  //    半透明背景+pointer-events:none 容器，子元素各自开启） ──────────
  function _showOverlay() { document.getElementById('gt-overlay')?.classList.remove('hidden'); }
  function _hideOverlay() { document.getElementById('gt-overlay')?.classList.add('hidden'); }

  function _showHint(html) {
    const bar = document.getElementById('gt-hint-bar');
    if (!bar) return;
    bar.innerHTML = html;
    bar.classList.remove('hidden');
  }
  function _hideHint() { document.getElementById('gt-hint-bar')?.classList.add('hidden'); }

  function _showModal(bodyHtml, btnLabel, onBtn) {
    const content = document.getElementById('gt-modal-content');
    const btn     = document.getElementById('gt-modal-btn');
    if (content) content.innerHTML = bodyHtml;
    if (btn) {
      btn.textContent = btnLabel;
      btn.onclick = onBtn;
    }
    const modal = document.getElementById('gt-modal');
    if (modal) {
      requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('gt-modal-show')));
    }
  }
  function _hideModal() { document.getElementById('gt-modal')?.classList.remove('gt-modal-show'); }

  // ── 步骤②：边界情况——找不到tier2教学目标，直接跳到步骤⑤ ────────
  // 2026-08-23 qa-reviewer第四轮PLAUSIBLE②修复：文案曾经断言"命盘五行很
  // 均衡"，但 _findTarget() 只挑 tier2（免费拖拽相对更可能成功的教学目标，
  // 见该函数定义处注释），走到这条降级分支只代表"没有tier2目标"，命盘完全
  // 可能还挂着tier3（最严重档，只是免费拖拽已不适用）——真机复现：把唯一的
  // tier2维护掉之后再触发一次玩法引导，命盘其实还有两个tier3在场，此时仍
  // 显示"很均衡、没有需要维护的地方"跟事实不符。改为只描述"这次没有合适的
  // 演示目标"，不对命盘整体状态做断言。
  function _showBalancedStep() {
    _phase = 'balanced';
    _showOverlay();
    _showModal(
      _t('gameplay.balanced_msg', '这次没有合适的问题可以演示拖拽维护，我们直接看看每日任务吧！'),
      _t('gameplay.balanced_next', '知道了 →'),
      () => { _hideModal(); _showTaskStep(); }
    );
  }

  // ── 步骤③：飞到概览机位 + 高亮目标热点 + 提示拖拽 ──────────────
  function _showHotspotStep() {
    _phase = 'hotspot';
    _showOverlay();

    if (typeof IslandLoader !== 'undefined') {
      IslandLoader.setControlsEnabled(false);
      IslandLoader.stopAutoRotate(ROTATE_LOCK_REASON);
    }

    const proceed = () => {
      if (!_active || _phase !== 'hotspot') return; // 飞行途中被 skip() 打断
      _startRingTracking();
      const icon = TOOL_ICON[_target.direction] || '💧';
      _showHint('<span style="font-size:18px;margin-right:4px">' + icon + '</span>' +
        _t('gameplay.hotspot_hint', '👇 拖动下方工具到高亮的五行标记上试试'));
      _listenForSuccess();
    };

    if (typeof IslandLoader !== 'undefined' && typeof THREE !== 'undefined' && IslandLoader.flyTo) {
      const camPos = new THREE.Vector3(OVERVIEW_CAM.x, OVERVIEW_CAM.y, OVERVIEW_CAM.z);
      const lookAt = new THREE.Vector3(OVERVIEW_LOOK.x, OVERVIEW_LOOK.y, OVERVIEW_LOOK.z);
      IslandLoader.flyTo(camPos, lookAt, 1200, proceed);
    } else {
      setTimeout(proceed, 600);
    }
  }

  // ── 高亮环：每帧跟踪目标热点 dotEl 的屏幕坐标（CSS2D标注元素只有屏幕
  //    坐标可读，见文件头部"流程③"注释），同时给热点本体加引导专属高亮
  //    class（不复用 wuxing-drag.js 拖拽悬停用的 .wx-drop-target-active，
  //    避免用户真正开始拖拽时两套视觉反馈打架）─────────────────────────
  function _startRingTracking() {
    const ring = document.getElementById('gt-target-ring');
    if (!ring || !_target || !_target.dotEl) return;
    ring.classList.remove('hidden');
    _target.dotEl.closest('.wx-marker')?.classList.add('gt-target-highlight');
    const tick = () => {
      if (!_active || (_phase !== 'hotspot' && _phase !== 'waiting')) return;
      if (!_target || !_target.dotEl || !_target.dotEl.isConnected) { _hideRing(); return; }
      const r = _target.dotEl.getBoundingClientRect();
      ring.style.left = (r.left + r.width / 2) + 'px';
      ring.style.top  = (r.top  + r.height / 2) + 'px';
      _ringRaf = requestAnimationFrame(tick);
    };
    _ringRaf = requestAnimationFrame(tick);
  }
  function _hideRing() {
    if (_ringRaf) cancelAnimationFrame(_ringRaf);
    _ringRaf = null;
    document.getElementById('gt-target-ring')?.classList.add('hidden');
    if (_target && _target.dotEl) {
      _target.dotEl.closest('.wx-marker')?.classList.remove('gt-target-highlight');
    }
  }

  // ── 步骤④：监听真正的维护成功信号（js/wuxing-maintenance.js::maintain()
  //    薄包装里统一派发的专属事件，见文件头部"流程④"注释），以及失败/超时
  //    兜底（2026-08-23 qa-reviewer CONFIRMED②修复：_findTarget() 选中的
  //    tier2目标不保证一定能维护成功——见 _findTarget() 定义处订正后的注释，
  //    这条issue完全可能当天已经被打理过、命中每日限额。此前这一步只监听
  //    成功事件，没有任何失败/超时出口，会让用户永远卡在"等待拖拽"，只能靠
  //    常驻的「跳过引导」按钮脱身。写法照抄 js/tutorial.js::_autoAdvanceTimer
  //    "N秒后无论是否命中都自动推进"这套本项目已经踩过同一个坑并修过一次
  //    的既有模式——这里额外加一层"失败事件立即响应"，不用死等满60秒超时才
  //    给反馈：daily_limit/daily_total_limit这类失败原因一旦发生就已经确定
  //    不会再变好，没必要让用户干等）───────────────────────────────────
  function _listenForSuccess() {
    _phase = 'waiting';
    _clearSuccessListener();
    _clearFailureListener();
    _clearWaitTimeout();
    _successFn = (ev) => {
      const d = ev.detail || {};
      if (!_target || d.wx !== _target.wx || d.direction !== _target.direction) return; // 不是这次教学目标，忽略
      _onMaintainSuccess(d.spiritEarned);
    };
    _failFn = (ev) => {
      const d = ev.detail || {};
      if (!_target || d.wx !== _target.wx || d.direction !== _target.direction) return; // 不是这次教学目标，忽略
      _onMaintainFailure();
    };
    window.addEventListener('wuxingMaintainSuccess', _successFn);
    window.addEventListener('wuxingMaintainFailed', _failFn);
    // qa-reviewer第三轮PLAUSIBLE①修复：超时兜底跟"确切收到失败事件"分开走
    // 独立函数（_onWaitTimeout），不再复用 _onMaintainFailure()——此前两条
    // 路径共用同一函数，导致60秒超时（用户可能只是还没搞懂要拖拽，压根没
    // 触发过一次维护）也显示"今天这条已经打理过了"这句每日限额专属措辞，
    // 对纯粹手慢的新用户是失实陈述。
    _waitTimeoutTimer = setTimeout(_onWaitTimeout, WAIT_TIMEOUT_MS);
  }
  function _clearSuccessListener() {
    if (_successFn) window.removeEventListener('wuxingMaintainSuccess', _successFn);
    _successFn = null;
  }
  function _clearFailureListener() {
    if (_failFn) window.removeEventListener('wuxingMaintainFailed', _failFn);
    _failFn = null;
  }
  function _clearWaitTimeout() {
    if (_waitTimeoutTimer) clearTimeout(_waitTimeoutTimer);
    _waitTimeoutTimer = null;
  }

  function _onMaintainSuccess(spiritEarned) {
    if (!_active || _phase !== 'waiting') return; // 已经因失败/超时/skip等提前退出这一步，忽略迟到的信号
    _clearSuccessListener();
    _clearFailureListener();
    _clearWaitTimeout();
    _hideRing();
    _hideHint();
    const n = (typeof spiritEarned === 'number') ? spiritEarned : 0;
    _showModal(
      _t('gameplay.success_msg', '🎉 学会了！你刚刚赚了 {n} 灵气', { n }),
      _t('gameplay.balanced_next', '知道了 →'),
      () => { _hideModal(); _showTaskStep(); }
    );
  }

  // ── 步骤④明确失败兜底："这条issue今天已经维护过"这类由
  //    wuxingMaintainFailed事件明确带回来的失败原因，措辞可以如实点出
  //    "已经打理过了"。────────────────────────────────────────────
  function _onMaintainFailure() {
    if (!_active || _phase !== 'waiting') return; // 已经因成功/skip等提前退出这一步，忽略迟到/重复触发
    // 2026-08-23 qa-reviewer第四轮PLAUSIBLE①修复：此前触发兜底后没有把
    // _phase 从 'waiting' 改掉——真机复现：兜底卡片已经显示"直接看看每日
    // 任务吧"之后，用户若又点了那张之前高亮的热点卡片，notifyBlockedClick()
    // （见该函数定义处，条件是 _phase === 'waiting'）仍会弹出"请拖拽下方
    // 工具到这个标记上试试"的toast，跟已经展示的兜底文案自相矛盾。这里
    // 提前把 _phase 置空，让 notifyBlockedClick() 的守卫条件不再成立，
    // _showTaskStep() 稍后点"知道了"确认时会再把 _phase 正式推进到 'task'。
    _phase = null;
    _clearSuccessListener();
    _clearFailureListener();
    _clearWaitTimeout();
    _hideRing();
    _hideHint();
    _showModal(
      _t('gameplay.wait_fallback_msg', '今天这条已经打理过了，直接看看每日任务吧！'),
      _t('gameplay.balanced_next', '知道了 →'),
      () => { _hideModal(); _showTaskStep(); }
    );
  }

  // ── 步骤④超时兜底（qa-reviewer第三轮PLAUSIBLE①修复）：60秒内没等到
  //    任何成功/失败信号，不代表用户"已经打理过了"——用户完全可能只是
  //    还没搞懂要拖拽，压根没触发过一次维护。用中性措辞，不复用
  //    _onMaintainFailure() 的每日限额专属文案，避免对手慢的新用户做出
  //    失实陈述。────────────────────────────────────────────────
  function _onWaitTimeout() {
    if (!_active || _phase !== 'waiting') return; // 已经因成功/失败/skip等提前退出这一步，忽略迟到触发
    // 2026-08-23 qa-reviewer第四轮PLAUSIBLE①修复：同 _onMaintainFailure()
    // 定义处注释——超时兜底也必须把 _phase 从 'waiting' 改掉，否则兜底
    // 文案（"随时可以自己试试"）跟 notifyBlockedClick() 后续可能弹出的
    // "请拖拽下方工具到这个标记上试试"toast互相矛盾。
    _phase = null;
    _clearSuccessListener();
    _clearFailureListener();
    _clearWaitTimeout();
    _hideRing();
    _hideHint();
    _showModal(
      _t('gameplay.wait_timeout_msg', '没关系，随时可以自己试试，先看看每日任务吧！'),
      _t('gameplay.balanced_next', '知道了 →'),
      () => { _hideModal(); _showTaskStep(); }
    );
  }

  // ── 步骤⑤：引导指向每日任务/今日运势入口，确认后整个玩法引导完成 ──────
  // qa-reviewer第六轮CONFIRMED修复：这一步是唯一需要用户真的能点到
  // #hud-task-btn 的阶段，而 #gt-skip-btn 默认位置（top:60px;right:14px）
  // 完全盖住它（见 index.html #gt-skip-btn.gt-skip-btn-clear 定义处注释）。
  // 只在这一步给跳过按钮加挪位class，_cleanup() 统一负责移除（覆盖"点了
  // 知道了完成"/"中途点跳过"/"forceStop强制中止"三种退出路径，不会残留）。
  function _showTaskStep() {
    _phase = 'task';
    if (typeof IslandLoader !== 'undefined') {
      IslandLoader.setControlsEnabled(true);
      IslandLoader.startAutoRotate(ROTATE_LOCK_REASON);
    }
    document.getElementById('hud-task-btn')?.classList.add('gt-hud-attn');
    document.getElementById('gt-skip-btn')?.classList.add('gt-skip-btn-clear');
    _showModal(
      _t('gameplay.task_hint', '每天都有任务和运势可以查看，继续赚灵气吧！'),
      _t('gameplay.task_done_btn', '知道了 ✓'),
      () => { _markDone(); _cleanup(); }
    );
  }

  return { start, skip, forceStop, isDone, isActive, notifyBlockedClick };
})();
