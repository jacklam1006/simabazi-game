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

  // ── 成就弹窗 ─────────────────────────────────────────────
  function _showToast(def) {
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
    toast.innerHTML = `
      <span style="font-size:24px">${def.icon}</span>
      <div>
        <div style="font-size:11px;color:#c9a96e;letter-spacing:2px;margin-bottom:2px">任务完成</div>
        <div style="font-size:13px;color:#e8e0d0;font-weight:600">${def.name}</div>
        <div style="font-size:11px;color:rgba(232,224,208,.5);margin-top:2px">+${def.spirit} 灵气值${def.unlock ? ' · 解锁新装饰' : ''}</div>
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

    const spirit  = UserState.getSpirit();
    const checkin = UserState.getCheckinInfo();
    const daily   = getDailyTasks();
    const onetime = getOnetimeTasks().filter(t => !t.done).slice(0, 5);

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

      <!-- 进行中成就 -->
      ${onetime.length ? `
      <div>
        <div style="font-size:10px;letter-spacing:2px;color:rgba(201,169,110,.55);margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(201,169,110,.1)">成就</div>
        ${onetime.map(t => _taskCard(t, baziData)).join('')}
      </div>` : ''}
    `;

    // 绑定点击
    container.querySelectorAll('[data-task]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tid = btn.dataset.task;
        if (!isDone(tid)) complete(tid, baziData);
        renderPanel(container, baziData);
      });
    });
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

  return { complete, isDone, getAllStatus, getDailyTasks, getOnetimeTasks, renderPanel };
})();
