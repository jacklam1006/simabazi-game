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
    _syncSpiritToCloud(cur + amount);
    return cur + amount;
  }

  function useSpirit(amount) {
    const cur = getSpirit();
    if (cur < amount) return false;
    set('spirit', cur - amount);
    _emit('spiritChanged', cur - amount);
    _syncSpiritToCloud(cur - amount);
    return true;
  }

  // 登录用户：灵气值变化后 fire-and-forget 同步回 Supabase profiles 表，方便
  // 换设备/重新登录时能取回余额（合并逻辑见 auth.js::_onAuthChange，取较大值，
  // 灵气不是真实货币，多设备并发误差可接受，不追求强一致性）。
  function _syncSpiritToCloud(balance) {
    if (typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn && AuthManager.isLoggedIn()) {
      try { AuthManager.syncSpiritBalance(balance); } catch (e) { /* fire-and-forget，不阻断本地操作 */ }
    }
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

  // ── 灵气兑换：注意事项/命盘特点已改善标记 ──────────────────
  // 记录"哪条命盘（baziKey）的哪条注意事项（kind+idx）已经通过灵气兑换水晶商品
  // 标记为已改善"，供 js/products.js 兑换成功后调用、js/island-annotate.js /
  // 详情面板读取渲染"已改善"状态。
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
    getSpirit, addSpirit, useSpirit,
    getCheckinInfo, doCheckin,
    getCompletedTasks, completeTask, isTaskDone,
    getDecorations, unlockDecoration, hasDecoration,
    getResolvedTraits, resolveTrait, isTraitResolved,
    getAchievements,
    clearAll, on,
  };
})();
