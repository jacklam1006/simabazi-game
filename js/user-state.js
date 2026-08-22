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

  // 2026-08-21 灵气值服务端权威记账重构：addSpirit()/useSpirit() 不再有任何
  // 隐式云端副作用——这是刻意的架构变化，不是遗漏。旧模式是"本地先加/减好
  // 数字，再顺便把增量同步给服务端"（曾经的 _syncSpiritDeltaToCloud()/
  // AuthManager.syncSpiritDelta()/数据库RPC adjust_spirit_balance()，现已
  // 全部删除），服务端对客户端传来的增量完全不做校验，理论上可以被篡改成
  // 任意数值——这正是要修的安全漏洞。
  //
  // 现在的原则：这两个函数变成纯本地操作，只管 localStorage 读写 +
  // 'spiritChanged' 事件广播。登录用户的灵气值变化必须由每个具体业务场景
  // （签到 UserState.doCheckin()、任务 Tasks.complete()、五行维护/瞬间调理
  // js/wuxing-maintenance.js、灵气兑换 js/products.js）各自显式调用对应的
  // 服务端权威 RPC（见 js/auth.js 新增的 claimDailyCheckin/claimTask/
  // wuxingFreeMaintain/wuxingInstantFix/redeemWuxingProduct），服务端算好新余额返回后，
  // 调用方再用 setSpiritLocalOnly(new_balance) 同步本地显示——不能反过来先本地
  // addSpirit()/useSpirit() 再"顺便"通知服务端。
  //
  // 未登录（匿名试用）用户完全不受影响：这两个函数本来就是他们唯一的灵气
  // 记账入口，继续原样纯本地工作，服务端根本没有他们的账号行可同步。
  function addSpirit(amount) {
    const cur = getSpirit();
    set('spirit', cur + amount);
    _emit('spiritChanged', cur + amount);
    return cur + amount;
  }

  function useSpirit(amount) {
    const cur = getSpirit();
    if (cur < amount) return false;
    set('spirit', cur - amount);
    _emit('spiritChanged', cur - amount);
    return true;
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

  // 2026-08-21 服务端权威记账重构：doCheckin() 从同步函数改为 async——登录
  // 用户签到改走服务端权威 RPC claim_daily_checkin()（防止本地伪造签到奖励/
  // 连续天数），未登录（匿名试用）用户继续走纯本地逻辑（_doCheckinLocal()，
  // 行为完全不变）。调用方（js/main-new.js）需要 await 这个返回的 Promise
  // 才能拿到 {alreadyDone, streak, bonus} 这个既有返回形状。
  async function doCheckin() {
    const isLoggedIn = typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn && AuthManager.isLoggedIn();
    if (isLoggedIn) {
      const result = await AuthManager.claimDailyCheckin();
      if (!result) {
        // 服务端调用失败（网络问题等）：退回本地兜底逻辑，不让用户当天完全
        // 签不到——本地兜底不会同步到云端，下次登录/换设备时以云端记录为准。
        return _doCheckinLocal();
      }
      // 2026-08-21 顺带修复（PLAUSIBLE，跨设备streak不同步）：streak 字段
      // 无条件写回本地，不再只在 `!already_done` 分支才更新。修复前的问题：
      // 手机上签到过、电脑打开网页时 already_done=true（服务端已记录今日
      // 签到），但本地 localStorage 从未被写过这台设备的 streak，永远停留
      // 在初始值0——导致依赖 streak 的成就判定（streak_3/streak_7/streak_30）
      // 在这台设备上永远无法触发，哪怕服务端记录的连续天数早已达标。
      set('streak', result.streak);
      if (!result.already_done) {
        set('checkin', _todayStr());
        setSpiritLocalOnly(result.new_balance);
        if (result.streak === 7)  _unlockAchievement('streak_7');
        if (result.streak === 30) _unlockAchievement('streak_30');
        _emit('checkinDone', { streak: result.streak, bonus: result.bonus });
      }
      return { alreadyDone: result.already_done, streak: result.streak, bonus: result.bonus };
    }
    return _doCheckinLocal();
  }

  // 未登录（匿名试用）用户的原有本地签到逻辑，改名保留，行为完全不变——
  // 也作为登录用户在服务端调用失败时的兜底路径（见上方 doCheckin() 注释）。
  function _doCheckinLocal() {
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

  // opts.silent：仅追平本地状态、不触发 'taskCompleted' 事件——供
  // js/tasks.js::_syncTaskDoneLocally() 的换设备自愈分支使用（hydrate/自愈
  // 场景只是把本地状态追平服务端已有的历史记录，不代表"刚刚发生了一次新的
  // 完成动作"，不应该播放 main-new.js 挂在这个事件上的音效/彩带/徽标弹跳）。
  // 不传 opts 时行为与改动前完全一致，不影响任何现有调用点。
  function completeTask(taskId, opts) {
    const tasks = getCompletedTasks();
    if (tasks.includes(taskId)) return false;
    tasks.push(taskId);
    set('tasks', tasks);
    if (!opts || !opts.silent) _emit('taskCompleted', taskId);
    return true;
  }

  function isTaskDone(taskId) { return getCompletedTasks().includes(taskId); }

  // ── 装饰解锁 ──────────────────────────────────────────────
  function getDecorations() { return get('decorations') || []; }

  // opts.silent：同上 completeTask() 的静默选项，供换设备自愈场景使用，
  // 不传 opts 时行为与改动前完全一致。
  function unlockDecoration(decorId, opts) {
    const list = getDecorations();
    if (list.find(d => d.id === decorId)) return false;
    list.push({ id: decorId, unlockedAt: Date.now() });
    set('decorations', list);
    if (!opts || !opts.silent) _emit('decorationUnlocked', decorId);
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
