/**
 * 司马八字 · 任务/成就/灵气值系统 tasks.js
 *
 * 任务分两类：
 *   daily  → 每天重置，每日签到/读分析/分享
 *   onetime → 一次性完成，邀请好友/连续签到7天等
 *
 * 完成任务 → 积累灵气值 → 解锁装饰 → 岛屿变化
 */

const Tasks = (() => {

  // ── 任务定义表 ────────────────────────────────────────────
  const TASK_DEFS = {
    // 每日任务（每天重置）
    daily_checkin: {
      type    : 'daily',
      name    : '每日登岛',
      desc    : '登入命盘查看今日运势',
      icon    : '🏝️',
      spirit  : 10,
      unlock  : null,
    },
    daily_read_analysis: {
      type    : 'daily',
      name    : '研读命理',
      desc    : '阅读一篇分析内容',
      icon    : '📖',
      spirit  : 15,
      unlock  : null,
    },
    daily_share: {
      type    : 'daily',
      name    : '分享命盘',
      desc    : '分享你的命盘给朋友',
      icon    : '🔗',
      spirit  : 20,
      unlock  : 'share_flower',   // 解锁：岛上开出一朵花
    },

    // 一次性任务
    first_island: {
      type    : 'onetime',
      name    : '初临仙岛',
      desc    : '首次生成你的命盘岛屿',
      icon    : '✨',
      spirit  : 50,
      unlock  : 'welcome_glow',   // 岛屿金光特效
    },
    streak_3: {
      type    : 'onetime',
      name    : '三日之约',
      desc    : '连续登岛3天',
      icon    : '🌱',
      spirit  : 30,
      unlock  : 'sprout_plant',   // 岛上长出嫩芽装饰
    },
    streak_7: {
      type    : 'onetime',
      name    : '七日守候',
      desc    : '连续登岛7天',
      icon    : '🌸',
      spirit  : 80,
      unlock  : 'cherry_blossom', // 岛上樱花盛开
    },
    streak_30: {
      type    : 'onetime',
      name    : '月圆之盟',
      desc    : '连续登岛30天',
      icon    : '🌕',
      spirit  : 300,
      unlock  : 'moon_shrine',    // 岛上出现月神祠
    },
    read_dayun: {
      type    : 'onetime',
      name    : '大运初探',
      desc    : '查看你的大运分析',
      icon    : '🌊',
      spirit  : 25,
      unlock  : null,
    },
    read_shensha: {
      type    : 'onetime',
      name    : '神煞揭秘',
      desc    : '查看所有神煞解析',
      icon    : '⚔',
      spirit  : 25,
      unlock  : 'shensha_glow',   // 神煞标注发光
    },
    invite_friend: {
      type    : 'onetime',
      name    : '邀君同游',
      desc    : '邀请一位朋友注册',
      icon    : '👥',
      spirit  : 100,
      unlock  : 'island_expand',  // 岛屿扩大一圈
    },
  };

  // ── 邀君同游：真实邀请进度缓存（第五阶段裂变系统）───────────────────
  // 不再是"点一下就领"的荣誉制任务——invite_friend 这条 TASK_DEFS 定义只保留
  // 用于展示 icon/name（_inviteCard() 复用），不再接入 complete() 那条通用
  // 发奖流程。loaded=false 表示还没成功拉取过一次真实数据（区分"真的是0个
  // 好友"和"还没查到"两种状态，避免刚打开面板瞬间就先闪一下"0"造成误导）。
  let _referralState = { activatedCount: 0, totalCount: 0, loaded: false };
  let _referralFetchInFlight = false;

  // ── 每日任务key（每天重置用）────────────────────────────
  function _todayKey(taskId) {
    return taskId + '_' + new Date().toISOString().slice(0, 10);
  }

  // ── 检查任务是否已完成 ────────────────────────────────────
  function isDone(taskId) {
    const def = TASK_DEFS[taskId];
    if (!def) return false;
    if (def.type === 'daily') {
      return !!localStorage.getItem('smb_dtask_' + _todayKey(taskId));
    }
    return UserState.isTaskDone(taskId);
  }

  // ── 完成任务 ─────────────────────────────────────────────
  function complete(taskId, baziData) {
    const def = TASK_DEFS[taskId];
    if (!def || isDone(taskId)) return false;

    // 标记完成
    if (def.type === 'daily') {
      localStorage.setItem('smb_dtask_' + _todayKey(taskId), '1');
      // 每日任务不走 UserState.completeTask，手动触发特效
      setTimeout(() => {
        if (typeof UIEffects !== 'undefined') { UIEffects.confetti(15); UIEffects.badgePop(); }
        if (typeof AudioManager !== 'undefined') AudioManager.playSfx('task_complete');
      }, 200);
    } else {
      if (!UserState.completeTask(taskId)) return false;
    }

    // 灵气奖励
    UserState.addSpirit(def.spirit);

    // 解锁装饰
    if (def.unlock) {
      const isNew = UserState.unlockDecoration(def.unlock);
      if (isNew && baziData) {
        IslandDecorations.add(def.unlock, baziData);
      }
    }

    // 显示成就弹窗
    _showToast(def);

    return true;
  }

  // ── 获取当前所有任务状态（用于UI渲染）────────────────────
  function getAllStatus() {
    return Object.entries(TASK_DEFS).map(([id, def]) => ({
      id,
      ...def,
      done : isDone(id),
    }));
  }

  function getDailyTasks()  { return getAllStatus().filter(t => t.type === 'daily'); }
  function getOnetimeTasks(){ return getAllStatus().filter(t => t.type === 'onetime'); }

  // ── 第四阶段"五行经营机制"：动态维护任务卡片 ──────────────────────
  // 不进 TASK_DEFS 静态字典——这批卡片数量/内容按当次命盘的五行判定动态
  // 生成（WuxingIssues.deriveIssues()），跟其它固定任务的"一次性定义"性质
  // 不同。关键不变式：这类卡片的完成条件只能是真实拖拽维护/瞬间调理
  // （js/wuxing-maintenance.js::maintain()/instantFix() 内部已经各自发过一次
  // 灵气），点卡片本身绝不能调用 Tasks.complete()（那会走 UserState.
  // addSpirit(def.spirit) 再发一次，造成灵气重复发放）——本函数返回的数据
  // 只用于渲染+"定位到对应3D热点"的引导交互，不接入 complete() 那条流程。
  function getDynamicWuxingTasks(baziData) {
    if (!baziData) return [];
    if (typeof WuxingIssues === 'undefined' || typeof WuxingIssues.deriveIssues !== 'function') return [];
    if (typeof WuxingMaintenance === 'undefined' || typeof WuxingMaintenance.getState !== 'function') return [];

    let issues = [];
    try { issues = WuxingIssues.deriveIssues(baziData) || []; } catch (e) { return []; }

    return issues
      .map(issue => {
        let state;
        try { state = WuxingMaintenance.getState(baziData, issue.wx, issue.direction, issue.severity); }
        catch (e) { return null; }
        if (!state) return null;
        // ownershipTier==='shrine' 已彻底退出维护循环（永久档位1），不再需要
        // "今日维护"提示；tier<=1（安泰）同样没有维护紧迫感，不生成卡片。
        if (state.ownershipTier === 'shrine' || (state.tier || 1) <= 1) return null;
        return {
          wx:            issue.wx,
          direction:     issue.direction,
          severity:      issue.severity,
          tier:          state.tier,
          ownershipTier: state.ownershipTier,
        };
      })
      .filter(Boolean);
  }

  // 简易 toast（同款视觉/交互风格见 js/products.js::_toast()，本文件独立实现
  // 一份而不是跨模块调用——避免给 products.js 增加"被 tasks.js 反向依赖"的
  // 耦合，两处各自维护同款小组件是本项目既有惯例，见多个 _t()/_toast() 重复
  // 实现的先例）。
  function _wxToast(msg) {
    const existing = document.getElementById('wxtask-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'wxtask-toast';
    toast.style.cssText = `
      position:fixed;top:80px;left:50%;transform:translateX(-50%) translateY(-20px);
      background:rgba(8,8,20,.95);border:1px solid rgba(201,169,110,.4);
      border-radius:12px;padding:12px 20px;z-index:400;
      max-width:280px;font-size:12px;line-height:1.5;color:#e8e0d0;
      box-shadow:0 8px 32px rgba(0,0,0,.4);
      opacity:0;transition:all .3s ease;
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

  // 点击动态维护卡片：只做"定位/高亮"引导，不触发任何完成/发奖流程（见上方
  // getDynamicWuxingTasks() 注释里的关键不变式）。WuxingScene.getActiveMarkers()
  // 是 frontend-3d 领域按并行接口契约要实现的只读导出，此处 typeof 防御——
  // 若对方尚未实现完毕，退化成"只弹toast提示"，不报错也不影响其余任务卡片。
  //
  // 2026-08-16 qa-reviewer PLAUSIBLE修复：此前不管是否真的定位到热点，toast
  // 都统一显示"已为你定位"这类文案——但当时调用的 `m.dotEl.scrollIntoView(...)`
  // 作用在 CSS2DRenderer 每帧用内联transform绝对定位的覆盖层div上，没有任何
  // 可滚动的祖先容器，实际什么都不会移动，是一句虚假承诺。改为两处真实动作
  // 而不是伪装的滚动：① 收起任务抽屉面板（如果当前正打开着——面板从左侧
  // 滑入会遮挡3D场景，收起后才能真的看到下面的脉冲效果，不是新写一套相机
  // 转向逻辑那种高成本方案）；② 复用已经真实生效的 UIEffects.labelPulse()
  // 在目标热点上播放脉冲动画。只有这两步都成功触发时才使用"已为你定位"文案，
  // 找不到对应热点（比如3D标注尚未挂载完成）时改用不做定位承诺的措辞。
  function _highlightWuxingTarget(wx, direction) {
    let handled = false;
    if (typeof WuxingScene !== 'undefined' && typeof WuxingScene.getActiveMarkers === 'function') {
      try {
        const markers = WuxingScene.getActiveMarkers() || [];
        const m = markers.find(mk => mk && mk.wx === wx && mk.direction === direction);
        if (m && m.dotEl) {
          if (typeof UIEffects !== 'undefined' && typeof UIEffects.labelPulse === 'function') {
            UIEffects.labelPulse(m.dotEl);
          }
          // 收起任务抽屉，让用户真的能看见上面这个脉冲效果——通过
          // App.toggleTaskPanel()（main-new.js里专门同步DOM class与内部
          // _taskPanelOpen布尔状态的入口）触发，不直接操作
          // document.getElementById('task-panel').classList：那样会让
          // main-new.js内部的_taskPanelOpen状态跟DOM实际显示状态错位，
          // 造成下次用户点任务按钮"看起来该打开却打不开"的错觉bug。
          // 注：main-new.js::_showScreen() 离开岛屿页面时也会单独对
          // #task-panel 做 classList.remove('open') 却不重置
          // _taskPanelOpen——这是本文件改动之前就存在的既有desync（不属于
          // 本次改动范围，这里不修复那个更早的问题本身），只是提醒
          // toggleTaskPanel() 并不是"唯一"会触碰这块DOM class的地方，只是
          // 这里（响应用户点击任务卡片）该走的、最正确的入口。
          const panelEl = document.getElementById('task-panel');
          if (panelEl && panelEl.classList.contains('open')
            && typeof App !== 'undefined' && typeof App.toggleTaskPanel === 'function') {
            App.toggleTaskPanel();
          }
          handled = true;
        }
      } catch (e) { /* 防御性：定位失败不影响toast兜底 */ }
    }
    const key = handled ? 'tasks.wxmaint_hint_toast' : 'tasks.wxmaint_hint_toast_fallback';
    const msg = (typeof Lang !== 'undefined') ? Lang.t(key) : '请前往岛屿上找到对应的五行标记，拖拽维护';
    _wxToast(msg);
  }

  // ── 邀君同游：拉取真实邀请进度（第五阶段裂变系统）───────────────────
  // 关键不变式：这个函数只负责"读取+展示+按真实数据解锁装饰"，绝不能反过来
  // 从这里调用 Tasks.complete('invite_friend', ...)——那会走 UserState.
  // addSpirit(def.spirit) 再发一次灵气，而邀请人的灵气奖励本来就已经由数据库
  // 函数 activate_my_referral() 在被邀请人那一侧触发时自动发放过了，重复调用
  // complete() 会造成灵气重复发放（呼应 getDynamicWuxingTasks() 顶部同款注释
  // 的既有约定，见该处）。
  //
  // fire-and-forget，不返回 Promise 给调用方 await：renderPanel() 每次打开
  // 面板都会同步渲染一份"上一次已知"的进度（初始为0/loading占位），这里异步
  // 拉取真实数据，若发现人数变化了才触发一次 renderPanel() 重渲染——避免每次
  // 打开面板都要等一次网络往返才能看到内容，也避免因为无脑每次都重渲染而跟
  // 自身形成递归重渲染死循环（第二次 renderPanel() 内部会再调用一次本函数，
  // 但那次读到的数据和上一次相同，changed 判定为 false，不会再触发第三次）。
  function _refreshReferralState(container, baziData) {
    if (typeof AuthManager === 'undefined' || !AuthManager.isLoggedIn || !AuthManager.isLoggedIn()) return;
    if (typeof AuthManager.getMyReferrals !== 'function') return;
    if (_referralFetchInFlight) return; // 避免面板短时间内被反复打开/刷新时并发发起多个请求
    _referralFetchInFlight = true;

    AuthManager.getMyReferrals().then(rows => {
      _referralFetchInFlight = false;
      const activated    = (rows || []).filter(r => r && r.activated_at);
      const newCount  = activated.length;
      const prevCount = _referralState.activatedCount;
      const wasLoaded = _referralState.loaded;
      const changed   = !wasLoaded || newCount !== prevCount;
      _referralState = { activatedCount: newCount, totalCount: (rows || []).length, loaded: true };

      if (newCount > 0 && typeof UserState !== 'undefined' && typeof UserState.unlockDecoration === 'function') {
        // 第一次检测到真实成功邀请 → 解锁"岛屿扩大一圈"装饰（原先是点击就领，
        // 现在改成真实数据驱动；unlockDecoration() 内部本身有重复解锁保护，
        // 不需要在这里再包一层"是否已解锁"判断）。
        const isNewDecor = UserState.unlockDecoration('island_expand');
        if (isNewDecor) {
          if (baziData && typeof IslandDecorations !== 'undefined' && typeof IslandDecorations.add === 'function') {
            IslandDecorations.add('island_expand', baziData);
          }
          // 不用默认的 `+${def.spirit} 灵气值` 那行（def.spirit=100 是旧荣誉制
          // 时代写死的静态值，跟数据库实际发放的150/80对不上，见 _showToast()
          // 顶部注释）——这里显式传入不带具体数字的通用文案+解锁提示。
          const rewardLine = ((typeof Lang !== 'undefined') ? Lang.t('tasks.invite_first_toast') : '灵气奖励已到账') + ' · 解锁新装饰';
          _showToast(TASK_DEFS.invite_friend, rewardLine);
        } else if (wasLoaded && newCount > prevCount) {
          // 装饰早就解锁过了（不是第一次邀请成功），但这次检测到邀请人数又
          // 增加了——对应 is_first_referral=false 的后续邀请，灵气奖励已经由
          // 数据库函数自动发放，这里只展示提示，不需要自己计算发多少。
          const msg = (typeof Lang !== 'undefined') ? Lang.t('tasks.invite_bonus_toast') : '再次邀请成功！你获得了额外灵气奖励';
          _wxToast(msg);
        }
      }

      if (changed && container) renderPanel(container, baziData);
    }).catch(() => { _referralFetchInFlight = false; });
  }

  // 邀君同游卡片渲染——跟 _taskCard() 同款视觉风格，但不显示"点击领取"，
  // 只展示真实进度；点击行为见 renderPanel() 里 [data-invite-card] 的绑定
  // （跳转设置面板复制邀请链接，不触发任何完成/发奖逻辑）。
  function _inviteCard() {
    const def      = TASK_DEFS.invite_friend;
    const _t2      = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    const loggedIn = typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn && AuthManager.isLoggedIn();
    const count    = _referralState.activatedCount;

    let desc;
    if (!loggedIn) {
      desc = _t2('tasks.invite_login_hint');
    } else if (count > 0) {
      desc = _t2('tasks.invite_progress').replace('{n}', count);
    } else {
      desc = _t2('tasks.invite_progress_zero');
    }

    return `
      <div data-invite-card style="
        display:flex;align-items:center;gap:10px;padding:10px;
        border-radius:8px;margin-bottom:6px;cursor:${loggedIn ? 'pointer' : 'default'};
        background:${count > 0 ? 'rgba(111,207,151,.06)' : 'rgba(255,255,255,.03)'};
        border:1px solid ${count > 0 ? 'rgba(111,207,151,.2)' : 'rgba(255,255,255,.08)'};
        transition:background .2s;
      ">
        <span style="font-size:18px">${def.icon}</span>
        <div style="flex:1">
          <div style="font-size:12px;color:${count > 0 ? 'rgba(111,207,151,.8)' : '#e8e0d0'};letter-spacing:1px">${def.name}</div>
          <div style="font-size:10px;color:rgba(232,224,208,.35);margin-top:2px">${desc}</div>
        </div>
        <div style="font-size:10px;text-align:right">
          ${count > 0 ? '<span style="color:#6FCF97">✓</span>' : ''}
        </div>
      </div>
    `;
  }

  // ── 成就弹窗 ─────────────────────────────────────────────
  // rewardLine（可选）：默认用 `+${def.spirit} 灵气值` 这行静态文案——对绝大多数
  // TASK_DEFS 条目成立，因为 complete() 发的灵气数量固定等于 def.spirit。
  // 但 invite_friend 这条不适用：它不走 complete()/UserState.addSpirit(def.spirit)
  // 这条流程（见 _refreshReferralState() 顶部注释——灵气奖励由数据库函数
  // activate_my_referral() 在被邀请人那一侧自动发放，且金额是动态的：首次邀请
  // 150、之后每次80，跟这里写死的 TASK_DEFS.invite_friend.spirit=100 对不上）。
  // 调用方在这类"实际金额跟 def.spirit 不一致"的场景下显式传入 rewardLine
  // （通常是不带具体数字的通用文案），避免展示一个跟实际到账不符的数字。
  function _showToast(def, rewardLine) {
    const existing = document.getElementById('task-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'task-toast';
    toast.style.cssText = `
      position:fixed;top:80px;left:50%;transform:translateX(-50%) translateY(-20px);
      background:rgba(8,8,20,.95);border:1px solid rgba(201,169,110,.4);
      border-radius:12px;padding:12px 20px;z-index:200;
      display:flex;align-items:center;gap:12px;
      box-shadow:0 8px 32px rgba(201,169,110,.2);
      opacity:0;transition:all .3s ease;min-width:240px;
    `;
    const line = rewardLine !== undefined ? rewardLine : `+${def.spirit} 灵气值${def.unlock ? ' · 解锁新装饰' : ''}`;
    toast.innerHTML = `
      <span style="font-size:24px">${def.icon}</span>
      <div>
        <div style="font-size:11px;color:#c9a96e;letter-spacing:2px;margin-bottom:2px">任务完成</div>
        <div style="font-size:13px;color:#e8e0d0;font-weight:600">${def.name}</div>
        <div style="font-size:11px;color:rgba(232,224,208,.5);margin-top:2px">${line}</div>
      </div>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-20px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ── 任务面板UI渲染 ─────────────────────────────────────
  function renderPanel(container, baziData) {
    if (!container) return;

    const spirit   = UserState.getSpirit();
    const checkin  = UserState.getCheckinInfo();
    const daily    = getDailyTasks();
    // invite_friend 不再走通用"点击即完成+发奖"流程（裂变系统改造，见
    // _inviteCard()/_refreshReferralState() 关键不变式），从这份列表里排除，
    // 单独渲染一个真实数据驱动的邀请进度卡片。
    const onetime  = getOnetimeTasks().filter(t => !t.done && t.id !== 'invite_friend').slice(0, 5);
    const wxTasks  = getDynamicWuxingTasks(baziData);
    const _tt      = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);

    container.innerHTML = `
      <!-- 灵气值 -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <div style="font-size:10px;color:rgba(201,169,110,.6);letter-spacing:2px">灵气值</div>
          <div style="font-size:22px;font-weight:700;color:#c9a96e">${spirit}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;color:rgba(232,224,208,.35);letter-spacing:1px">连续登岛</div>
          <div style="font-size:18px;color:#e8e0d0">${checkin.streak} <span style="font-size:11px;color:rgba(232,224,208,.4)">天</span></div>
        </div>
      </div>

      <!-- 每日任务 -->
      <div style="margin-bottom:14px">
        <div style="font-size:10px;letter-spacing:2px;color:rgba(201,169,110,.55);margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(201,169,110,.1)">每日任务</div>
        ${daily.map(t => _taskCard(t, baziData)).join('')}
      </div>

      <!-- 五行维护（第四阶段动态生成，插在"每日任务"与"成就"之间，见方案文档
           要求；卡片本身不接入 complete() 发奖流程，见 getDynamicWuxingTasks()
           注释里的关键不变式） -->
      ${wxTasks.length ? `
      <div style="margin-bottom:14px">
        <div style="font-size:10px;letter-spacing:2px;color:rgba(201,169,110,.55);margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(201,169,110,.1)">${_tt('tasks.wxmaint_section')}</div>
        ${wxTasks.map(_wxTaskCard).join('')}
      </div>` : ''}

      <!-- 邀君同游（第五阶段裂变系统，展示真实邀请进度，不是点击即领——见
           _inviteCard()/_refreshReferralState() 关键不变式） -->
      <div style="margin-bottom:14px">
        <div style="font-size:10px;letter-spacing:2px;color:rgba(201,169,110,.55);margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(201,169,110,.1)">${_tt('tasks.invite_section')}</div>
        ${_inviteCard()}
      </div>

      <!-- 进行中成就 -->
      ${onetime.length ? `
      <div>
        <div style="font-size:10px;letter-spacing:2px;color:rgba(201,169,110,.55);margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(201,169,110,.1)">成就</div>
        ${onetime.map(t => _taskCard(t, baziData)).join('')}
      </div>` : ''}
    `;

    // 绑定点击（固定任务：完成+发奖）
    container.querySelectorAll('[data-task]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tid = btn.dataset.task;
        if (!isDone(tid)) complete(tid, baziData);
        renderPanel(container, baziData);
      });
    });

    // 绑定点击（动态五行维护卡片：只定位/高亮，不发奖——见 _highlightWuxingTarget()）
    container.querySelectorAll('[data-wxtask]').forEach(el => {
      el.addEventListener('click', () => {
        const [wx, direction] = (el.dataset.wxtask || '').split('|');
        if (wx && direction) _highlightWuxingTarget(wx, direction);
      });
    });

    // 邀君同游卡片点击：打开设置面板，让用户复制邀请链接分享（这张卡片本身
    // 只做"进度展示"，真正的分享入口在设置面板，见 SettingsUI.copyReferralLink()）。
    // 未登录时不做任何跳转——设置面板本来就是登录用户专属，_inviteCard() 已
    // 展示"登录后查看邀请进度"的提示文案，此时点击没有意义。
    const inviteEl = container.querySelector('[data-invite-card]');
    if (inviteEl) {
      inviteEl.addEventListener('click', () => {
        if (typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn && AuthManager.isLoggedIn()
            && typeof SettingsUI !== 'undefined' && typeof SettingsUI.show === 'function') {
          SettingsUI.show();
        }
      });
    }

    // 拉取真实邀请进度（异步，fire-and-forget；数据变化时会自行触发一次
    // renderPanel 重渲染，见 _refreshReferralState() 注释）。
    _refreshReferralState(container, baziData);
  }

  // 动态五行维护卡片渲染——跟 _taskCard() 同款视觉风格，但右侧展示当前档位
  // （T2/T3）而不是灵气奖励数字（这类卡片本身不直接发奖，见文件头关键不变式）。
  function _wxTaskCard(t) {
    const isZh     = (typeof Lang === 'undefined') || Lang.getLang() === 'zh';
    const wxSuffix = isZh ? '行' : '';
    const icon     = t.direction === 'nourish' ? '💧' : '✂️';
    const _t2      = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    const action   = _t2(t.direction === 'nourish' ? 'tasks.wxmaint_verb_nourish' : 'tasks.wxmaint_verb_restrain');
    const target   = t.wx + wxSuffix;
    const title    = _t2('tasks.wxmaint_title').replace('{action}', action).replace('{target}', target);
    const desc     = _t2('tasks.wxmaint_go_hint');
    const crystalNote = t.ownershipTier === 'crystal'
      ? `<span style="margin-left:4px;opacity:.6">${_t2('tasks.wxmaint_crystal_note')}</span>`
      : '';

    return `
      <div data-wxtask="${t.wx}|${t.direction}" style="
        display:flex;align-items:center;gap:10px;padding:10px;
        border-radius:8px;margin-bottom:6px;cursor:pointer;
        background:rgba(255,255,255,.03);
        border:1px solid rgba(255,255,255,.08);
        transition:background .2s;
      ">
        <span style="font-size:18px">${icon}</span>
        <div style="flex:1">
          <div style="font-size:12px;color:#e8e0d0;letter-spacing:1px">${title}${crystalNote}</div>
          <div style="font-size:10px;color:rgba(232,224,208,.35);margin-top:2px">${desc}</div>
        </div>
        <div style="font-size:10px;text-align:right;color:#c9a96e">T${t.tier}</div>
      </div>
    `;
  }

  function _taskCard(t, baziData) {
    return `
      <div data-task="${t.id}" style="
        display:flex;align-items:center;gap:10px;padding:10px;
        border-radius:8px;margin-bottom:6px;cursor:${t.done?'default':'pointer'};
        background:${t.done ? 'rgba(111,207,151,.06)' : 'rgba(255,255,255,.03)'};
        border:1px solid ${t.done ? 'rgba(111,207,151,.2)' : 'rgba(255,255,255,.08)'};
        transition:background .2s;
      ">
        <span style="font-size:18px">${t.icon}</span>
        <div style="flex:1">
          <div style="font-size:12px;color:${t.done ? 'rgba(111,207,151,.8)' : '#e8e0d0'};letter-spacing:1px">${t.name}</div>
          <div style="font-size:10px;color:rgba(232,224,208,.35);margin-top:2px">${t.desc}</div>
        </div>
        <div style="font-size:10px;text-align:right">
          ${t.done
            ? '<span style="color:#6FCF97">✓</span>'
            : `<span style="color:#c9a96e">+${t.spirit}</span><div style="color:rgba(232,224,208,.3);font-size:9px">灵气</div>`
          }
        </div>
      </div>
    `;
  }

  return { complete, isDone, getAllStatus, getDailyTasks, getOnetimeTasks, getDynamicWuxingTasks, renderPanel };
})();
