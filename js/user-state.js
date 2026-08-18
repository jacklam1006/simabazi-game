/**
 * 司马八字 · 用户状态持久化 user-state.js
 *
 * 全部存在 localStorage，无需账号。
 * Key 前缀: "smb_"
 *
 * 存储内容：
 *   smb_profile      出生信息 + 八字计算结果
 *   smb_island_cache 八字MD5 → GLB URL（避免重复生成）
 *   smb_spirit       灵气值
 *   smb_checkin      最近签到日期
 *   smb_streak       连续签到天数
 *   smb_tasks        已完成任务列表
 *   smb_decorations  已解锁装饰列表
 *   smb_achievements 已获得成就
 *   smb_trait_resolved  旧trait系统（已停用）：已兑换改善的{baziKey,kind,idx}
 *   smb_wuxing_resolved 五行维护系统：已兑换改善的{baziKey,wx,direction}
 */

const UserState = (() => {

  const PREFIX = 'smb_';
  const get = k => { try { return JSON.parse(localStorage.getItem(PREFIX + k)); } catch { return null; } };
  const set = (k, v) => localStorage.setItem(PREFIX + k, JSON.stringify(v));

  // ── 八字档案 ──────────────────────────────────────────────
  function saveProfile(birthInfo, baziData) {
    set('profile', { birth: birthInfo, bazi: baziData, savedAt: Date.now() });
  }

  function getProfile() { return get('profile'); }

  function hasSavedProfile() { return !!get('profile'); }

  // ── 岛屿 GLB 缓存 ─────────────────────────────────────────
  // baziKey：命盘唯一标识（日主+年月日时干支），供本模块内部（岛屿URL缓存）
  // 与外部模块（js/products.js 标记"哪条命盘的哪条注意事项已经兑换过"）复用，
  // 只有这一处实现，不要另外新写一份重复的哈希逻辑。
  function baziKey(baziData) {
    const p = baziData.pillars || {};
    return [
      p.year?.stem, p.year?.branch,
      p.month?.stem, p.month?.branch,
      p.day?.stem, p.day?.branch,
      p.hour?.stem, p.hour?.branch,
    ].join('');
  }

  function saveIslandUrl(baziData, url) {
    const cache = get('island_cache') || {};
    cache[baziKey(baziData)] = { url, savedAt: Date.now() };
    set('island_cache', cache);
  }

  function getIslandUrl(baziData) {
    const cache = get('island_cache') || {};
    const entry = cache[baziKey(baziData)];
    if (!entry) return null;
    // URL 已永久存储到 Supabase Storage，无需过期检查
    return entry.url || null;
  }

  // ── 灵气值 ────────────────────────────────────────────────
  function getSpirit() { return get('spirit') || 0; }

  function addSpirit(amount) {
    const cur = getSpirit();
    set('spirit', cur + amount);
    _emit('spiritChanged', cur + amount);
    _syncSpiritDeltaToCloud(amount);
    return cur + amount;
  }

  function useSpirit(amount) {
    const cur = getSpirit();
    if (cur < amount) return false;
    set('spirit', cur - amount);
    _emit('spiritChanged', cur - amount);
    _syncSpiritDeltaToCloud(-amount);
    return true;
  }

  // 登录用户：灵气值变化后 fire-and-forget 同步回 Supabase profiles 表，方便
  // 换设备/重新登录时能取回余额。
  //
  // 用增量（delta）而不是绝对值：这里同步的是"这一次变化了多少"，服务端用
  // adjust_spirit_balance() RPC 做 spirit_balance += delta——跟旧版
  // syncSpiritBalance(绝对值) 的"推整个余额覆盖云端"语义不同。旧版会在裂变
  // 邀请奖励（欢迎奖励+50、激活奖励150/80）这类"服务端单方面发钱"的场景下
  // 把服务端刚发的奖励覆盖抹掉——奖励在云端入账那一刻，本地完全不知情，之后
  // 任何一次本地"本地旧值+这次变动"当绝对值推上去，都会把云端余额直接覆盖，
  // 取 max 也救不回来（本地余额本来就可能比服务端刚发的新值大）。增量式同步
  // 天然不会覆盖期间内服务端自己写入的任何值。
  // 注意：登录时的多设备合并（auth.js::_mergeSpiritBalance()）是另一种场景——
  // 那里是"读取远端真实值、跟本地取max、reconcile后的结果视为新的权威绝对值
  // 再写回"，本质是校准/对齐操作，继续用 syncSpiritBalance(绝对值) 是对的，
  // 不在这个函数的改动范围内。
  function _syncSpiritDeltaToCloud(delta) {
    if (typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn && AuthManager.isLoggedIn()) {
      try { AuthManager.syncSpiritDelta(delta); } catch (e) { /* fire-and-forget，不阻断本地操作 */ }
    }
  }

  // ── 本地余额直接赋值，不触发云端增量同步 ─────────────────────────────
  // 专供 auth.js::_mergeSpiritBalance() 的"远端 > 本地"分支使用：那个场景是把
  // 本地余额追平云端已经存在的权威值，云端数值本身没有任何变化，不应该再往
  // 云端推送任何增量。如果借用 addSpirit(remote-local) 走一遍上面的云端delta
  // 同步，会把"追平本地"误当成一次真实的本地新增，把云端余额从 remote 推高到
  // remote+(remote-local)，凭空多出一笔灵气——这是把 addSpirit() 从"推绝对值"
  // 改造成"推增量"之后才会暴露的坑（旧实现里 addSpirit 推的是绝对值 remote，
  // 覆盖回云端本来就等于 remote，天然幂等无害；新实现下必须用这个不碰云端的
  // 版本，避免混淆"本地追平远端"和"本地产生了新的真实变化"这两种场景）。
  function setSpiritLocalOnly(value) {
    set('spirit', value);
    _emit('spiritChanged', value);
    return value;
  }

  // ── 签到 ──────────────────────────────────────────────────
  function getCheckinInfo() {
    return {
      lastDate : get('checkin')   || null,
      streak   : get('streak')    || 0,
    };
  }

  function doCheckin() {
    const today    = _todayStr();
    const info     = getCheckinInfo();

    if (info.lastDate === today) return { alreadyDone: true, streak: info.streak };

    const yesterday = _dateStr(-1);
    const newStreak = info.lastDate === yesterday ? info.streak + 1 : 1;

    set('checkin', today);
    set('streak', newStreak);

    // 灵气奖励
    const bonus = newStreak >= 7 ? 30 : newStreak >= 3 ? 20 : 10;
    addSpirit(bonus);

    // 连续7天成就
    if (newStreak === 7)  _unlockAchievement('streak_7');
    if (newStreak === 30) _unlockAchievement('streak_30');

    _emit('checkinDone', { streak: newStreak, bonus });
    return { alreadyDone: false, streak: newStreak, bonus };
  }

  // ── 任务 ──────────────────────────────────────────────────
  function getCompletedTasks() { return get('tasks') || []; }

  function completeTask(taskId) {
    const tasks = getCompletedTasks();
    if (tasks.includes(taskId)) return false;
    tasks.push(taskId);
    set('tasks', tasks);
    _emit('taskCompleted', taskId);
    return true;
  }

  function isTaskDone(taskId) { return getCompletedTasks().includes(taskId); }

  // ── 装饰解锁 ──────────────────────────────────────────────
  function getDecorations() { return get('decorations') || []; }

  function unlockDecoration(decorId) {
    const list = getDecorations();
    if (list.find(d => d.id === decorId)) return false;
    list.push({ id: decorId, unlockedAt: Date.now() });
    set('decorations', list);
    _emit('decorationUnlocked', decorId);
    return true;
  }

  function hasDecoration(decorId) {
    return getDecorations().some(d => d.id === decorId);
  }

  // ── 灵气兑换：注意事项/命盘特点已改善标记（旧trait系统，仅供已停用的
  //    ✅/⚠️浮动图标标注 island-annotate.js::TRAIT_LAYOUT/attachTraits() 及
  //    js/analysis.js::buildTraitPanel() 使用）─────────────────────────
  // 第三阶段"五行维护系统"上线后，图标标注已被3D装饰物取代、不再从
  // main-new.js 的调用点触发，但 attachTraits()/buildTraitPanel() 代码本身
  // 保留（未来可能复用坐标验证经验），它们仍在用 (baziKey, kind, idx) 这套
  // 旧签名调用 resolveTrait()/isTraitResolved()——这两个函数原样保留，不
  // 跟随本次重构改签名，避免这些"保留但不触发"的旧代码因为参数类型不匹配
  // 产生隐藏bug。新的五行维护系统请使用下方 resolveWuxingIssue()/
  // isWuxingIssueResolved()，两套函数共享 get()/set() 底层辅助但存在各自
  // 独立的 localStorage key（trait_resolved vs wuxing_resolved），刻意不
  // 混用同一份存储，避免"同一个key、两种数据形状"的语义混乱。
  function getResolvedTraits() { return get('trait_resolved') || []; }

  function resolveTrait(baziKey, kind, idx, productId) {
    const list = getResolvedTraits();
    if (list.find(t => t.baziKey === baziKey && t.kind === kind && t.idx === idx)) return false;
    list.push({ baziKey, kind, idx, productId, resolvedAt: Date.now() });
    set('trait_resolved', list);
    _emit('traitResolved', { kind, idx });
    return true;
  }

  function isTraitResolved(baziKey, kind, idx) {
    return getResolvedTraits().some(t => t.baziKey === baziKey && t.kind === kind && t.idx === idx);
  }

  // ── 灵气兑换：五行维护问题已改善标记（第三阶段新系统）───────────────
  // 记录"哪条命盘（baziKey）的哪个五行方向（wx+direction）已经通过灵气兑换
  // 水晶商品标记为已改善"，供 js/products.js 兑换成功后调用、
  // js/wuxing-scene.js / 维护详情面板读取渲染"已改善"状态。
  function getResolvedWuxingIssues() { return get('wuxing_resolved') || []; }

  function resolveWuxingIssue(baziKey, wx, direction, productId) {
    const list = getResolvedWuxingIssues();
    if (list.find(t => t.baziKey === baziKey && t.wx === wx && t.direction === direction)) return false;
    list.push({ baziKey, wx, direction, productId, resolvedAt: Date.now() });
    set('wuxing_resolved', list);
    _emit('wuxingIssueResolved', { wx, direction });
    return true;
  }

  function isWuxingIssueResolved(baziKey, wx, direction) {
    return getResolvedWuxingIssues().some(t => t.baziKey === baziKey && t.wx === wx && t.direction === direction);
  }

  // ── 成就 ──────────────────────────────────────────────────
  function getAchievements() { return get('achievements') || []; }

  function _unlockAchievement(id) {
    const list = getAchievements();
    if (list.includes(id)) return;
    list.push(id);
    set('achievements', list);
    _emit('achievementUnlocked', id);
  }

  // ── 清除（调试用）────────────────────────────────────────
  function clearAll() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .forEach(k => localStorage.removeItem(k));
  }

  // ── 事件总线 ─────────────────────────────────────────────
  const _listeners = {};
  function _emit(event, data) {
    (_listeners[event] || []).forEach(fn => fn(data));
  }
  function on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  }

  // ── 日期工具 ─────────────────────────────────────────────
  function _todayStr() {
    return new Date().toISOString().slice(0, 10);
  }
  function _dateStr(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  return {
    saveProfile, getProfile, hasSavedProfile,
    baziKey,
    saveIslandUrl, getIslandUrl,
    getSpirit, addSpirit, useSpirit, setSpiritLocalOnly,
    getCheckinInfo, doCheckin,
    getCompletedTasks, completeTask, isTaskDone,
    getDecorations, unlockDecoration, hasDecoration,
    getResolvedTraits, resolveTrait, isTraitResolved,
    getResolvedWuxingIssues, resolveWuxingIssue, isWuxingIssueResolved,
    getAchievements,
    clearAll, on,
  };
})();
