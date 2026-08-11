/**
 * 司马八字 · 设置面板 settings.js
 *
 * SettingsUI — 编辑账号昵称 / 轻量刷新AI深析 / 完全重新生成岛屿 / 修改出生信息重新生成
 *
 * 只编排调用其他领域已暴露好的函数，不重新实现任何底层逻辑：
 *   - AuthManager.updateProfile() / getProfile()          （js/auth.js）
 *   - BaziAnalysis.getAnalysis(d, gender, {forceRefresh})  （js/bazi-analysis.js）
 *   - Analysis.refreshAiAnalysis(analysis)                  （js/analysis.js，只渲染不请求）
 *   - App.regenerateCurrentIsland() / _getBaziData() / _getBirthInfo() / _showScreen()（js/main-new.js）
 */
const SettingsUI = (() => {

  function _t(key) { return (typeof Lang !== 'undefined') ? Lang.t(key) : key; }
  function _isZh()  { return (typeof Lang === 'undefined') || Lang.getLang() === 'zh'; }

  // ── 出生信息展示文案（只读展示，不可在此编辑——出生信息属于岛屿级字段，
  //    改动会导致八字四柱变化，必须走"修改出生信息后重新生成"完整流程）───
  function _formatBirthInfo(info) {
    if (!info) return _isZh() ? '尚未生成命盘' : 'No island generated yet';
    const genderLabel = info.gender === '女'
      ? (_isZh() ? '女' : 'Female')
      : (_isZh() ? '男' : 'Male');
    if (_isZh()) {
      return `当前岛屿：${info.year}年${info.month}月${info.day}日 · ${genderLabel}`;
    }
    return `Current island: ${info.year}-${info.month}-${info.day} · ${genderLabel}`;
  }

  // ── 显示 / 关闭面板 ──────────────────────────────────────
  function show() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;

    // 预填出生信息（只读展示）
    const birthInfo = (typeof App !== 'undefined' && typeof App._getBirthInfo === 'function')
      ? App._getBirthInfo() : null;
    const birthEl = document.getElementById('settings-birth-info');
    if (birthEl) birthEl.textContent = _formatBirthInfo(birthInfo);

    // 预填昵称
    _clearProfileMsg();
    const nicknameEl = document.getElementById('settings-nickname');
    if (nicknameEl) nicknameEl.value = '';
    if (typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn()) {
      AuthManager.getProfile().then(profile => {
        if (nicknameEl) nicknameEl.value = profile?.display_name || '';
      }).catch(() => {});
    }

    panel.classList.remove('hidden');
  }

  function hide() {
    document.getElementById('settings-panel')?.classList.add('hidden');
  }

  // ── 账户资料：保存昵称 ───────────────────────────────────
  async function saveProfile() {
    const nicknameEl = document.getElementById('settings-nickname');
    const displayName = (nicknameEl?.value || '').trim();
    _clearProfileMsg();

    if (!displayName) {
      _setProfileMsg(_isZh() ? '昵称不能为空' : 'Nickname cannot be empty', true);
      return;
    }
    if (typeof AuthManager === 'undefined' || !AuthManager.isLoggedIn()) {
      _setProfileMsg(_isZh() ? '请先登录' : 'Please sign in first', true);
      return;
    }

    const btn = document.getElementById('settings-save-btn');
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = _isZh() ? '保存中...' : 'Saving...'; }

    try {
      await AuthManager.updateProfile({ displayName });
      // 立刻同步顶部 #auth-user-info，不用等下次登录/刷新页面
      if (typeof AuthUI !== 'undefined' && typeof AuthUI._refreshUserInfoDisplay === 'function') {
        AuthUI._refreshUserInfoDisplay();
      }
      _setProfileMsg(_isZh() ? '✓ 已保存' : '✓ Saved', false);
    } catch (e) {
      _setProfileMsg((e && e.message) || (_isZh() ? '保存失败，请重试' : 'Save failed, please try again'), true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText || _t('settings.save'); }
    }
  }

  function _setProfileMsg(msg, isError) {
    const el = document.getElementById('settings-profile-error');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#ff6b6b' : '#6FCF97';
  }
  function _clearProfileMsg() { _setProfileMsg('', false); }

  // ── 轻量刷新：只重新拉取AI深析文字，保留3D模型不变 ──────
  async function refreshAiOnly() {
    const baziData = (typeof App !== 'undefined' && typeof App._getBaziData === 'function')
      ? App._getBaziData() : null;
    if (!baziData) {
      alert(_isZh() ? '还没有生成过命盘，无法刷新' : 'No island generated yet — nothing to refresh');
      return;
    }
    const gender = (typeof App !== 'undefined' && typeof App._getBirthInfo === 'function')
      ? (App._getBirthInfo()?.gender || '男') : '男';

    // ── 免费本地重算八字数据（同步、纯本地计算，不花任何API费用）───────
    // 修复：旧存档 bazi_data 里缺失后续新增字段（如 strengthScore，2026-08-04加入
    // bazi-engine.js::_strength()）时，"总览"页身强身弱仪表盘只能显示兜底文案。
    // 借"轻量刷新AI深析"这个入口顺带用当前 BaziEngine 重新计算一份完整数据、原地
    // 刷新仪表盘、并同步回数据库——不新增按钮，也不走"完全重新生成"/"编辑出生
    // 信息"那两条真实花费API费用的路径。重算失败（理论上不该发生，防御性兜底）
    // 时退回旧数据，不阻断后面的AI刷新流程。
    const recalculated = (typeof App !== 'undefined' && typeof App.recalcBaziData === 'function')
      ? App.recalcBaziData() : null;
    const effectiveBaziData = recalculated || baziData; // 重算失败时退回旧数据，不阻断AI刷新流程

    if (typeof Analysis !== 'undefined' && typeof Analysis.refreshStrengthGauge === 'function') {
      Analysis.refreshStrengthGauge(effectiveBaziData);
    }

    if (recalculated && typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn()
        && typeof App !== 'undefined' && typeof App.getCurrentIslandId === 'function') {
      const islandId = App.getCurrentIslandId();
      if (islandId) {
        AuthManager.updateIslandBaziData(islandId, recalculated).catch(() => {});
      }
    }

    const btn = document.getElementById('settings-refresh-ai-btn');
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = _isZh() ? '刷新中...' : 'Refreshing...'; }

    // 请求发起那一刻快照当前"岛屿会话世代"（与 analysis.js::_loadAndRenderAi 同款
    // 防护）。轻量刷新耗时可达数分钟，若在其运行期间用户经由"修改出生信息重新
    // 生成"切换到了另一个岛屿，_islandGeneration 会被重新赋值，此时不应再把这次
    // （已经不对应当前岛屿的）刷新结果渲染到画面上或补写进新岛屿的数据库记录。
    const genAtRequest = (typeof App !== 'undefined' && App.getIslandGeneration)
      ? App.getIslandGeneration() : null;

    try {
      // 若报告弹窗当前开着，在请求发起前先展示"更新中"提示条（非破坏性，不清空
      // 已有内容），refreshAiAnalysis()完成时会自动清除这个提示（无论成败）。
      if (typeof Analysis !== 'undefined' && typeof Analysis.showAiRefreshing === 'function') {
        Analysis.showAiRefreshing();
      }

      // 这里是本次刷新唯一一次向后端发起请求的地方——Analysis.refreshAiAnalysis()
      // 只负责用这里拿到的结果原地渲染，内部不会再自己发起请求（2026-08-03
      // 修复"点一次轻量刷新触发两次AI流水线"的接口契约问题，详见已知问题日志）。
      const analysis = await BaziAnalysis.getAnalysis(effectiveBaziData, gender, { forceRefresh: true });

      // 世代已变化 → 用户已经切换到另一个岛屿，这次结果不再对应当前画面，
      // 静默丢弃（不渲染、不补写），避免把A岛屿的AI深析错误地展示/落库到B岛屿。
      const genNow = (typeof App !== 'undefined' && App.getIslandGeneration)
        ? App.getIslandGeneration() : null;
      if (genNow !== genAtRequest) {
        // 这次提前return会跳过下面 Analysis.refreshAiAnalysis() 内部的banner清除
        // 逻辑（典型场景：刷新请求飞行中用户登出，或新岛屿生成失败后回头打开旧
        // 报告）。清除动作已经统一收口到下方 finally 块（覆盖这里+catch两个出口，
        // 详见已知问题日志第21条，2026-08-11修复+同日qa复查后再收口），这里不用
        // 重复调用。
        return;
      }

      // 若报告弹窗当前开着，原地渲染显示；未开过则静默不做事（refreshAiAnalysis内部处理）
      if (typeof Analysis !== 'undefined' && typeof Analysis.refreshAiAnalysis === 'function') {
        Analysis.refreshAiAnalysis(analysis);
      }

      // 已登录且当前岛屿已保存过 → 补写回数据库（fire-and-forget，失败不影响UI）
      // 注：这是本次刷新唯一一处补写——refreshAiAnalysis()改为纯渲染后不再重复补写。
      if (analysis && typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn()
          && typeof App !== 'undefined' && typeof App.getCurrentIslandId === 'function') {
        const islandId = App.getCurrentIslandId();
        if (islandId) {
          AuthManager.updateIslandAnalysis(islandId, analysis).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[SettingsUI] refreshAiOnly 失败:', e);
      alert(_isZh() ? 'AI深析刷新失败，请稍后重试' : 'Failed to refresh AI insight, please try again later');
    } finally {
      // 2026-08-11 qa复查发现：catch分支不会清除showAiRefreshing()插入的banner
      // （只有世代不一致的提前return分支和正常成功路径的refreshAiAnalysis()内部
      // 会清）。理论可达性极低——BaziAnalysis.getAnalysis()契约上恒不reject（内部
      // try/catch后resolve(null)）——但finally里幂等调用一次成本为零，一次性
      // 覆盖包括这个理论分支在内的全部出口，不用逐个补。
      if (typeof Analysis !== 'undefined' && typeof Analysis.clearAiRefreshing === 'function') {
        Analysis.clearAiRefreshing();
      }
      if (btn) { btn.disabled = false; btn.textContent = originalText || _t('settings.refresh_ai_btn'); }
    }
  }

  // ── 完全重新生成：真实调用付费API，需二次确认 ───────────
  function confirmFullRegen() {
    const msg = _isZh()
      ? '确定要重新生成吗？这会真实调用Gemini图像API和TripoAI进行完整的岛屿重建，预计花费$0.13-0.24以上，且需要几分钟时间。'
      : 'Are you sure? This will make real paid calls to the Gemini image API and TripoAI to fully rebuild your island — estimated cost $0.13-0.24+, and it will take several minutes.';
    if (!confirm(msg)) return;

    hide();
    if (typeof App !== 'undefined' && typeof App.regenerateCurrentIsland === 'function') {
      App.regenerateCurrentIsland();
    }
  }

  // ── 修改出生信息后重新生成：切回表单页，预填现有数据，让用户自己确认/修改 ──
  function editBirthInfo() {
    hide();

    const birthInfo = (typeof App !== 'undefined' && typeof App._getBirthInfo === 'function')
      ? App._getBirthInfo() : null;

    if (typeof App !== 'undefined' && typeof App._showScreen === 'function') {
      App._showScreen('screen-form');
    }

    // #screen-form 默认没有返回出口（它原本是全新用户专属首屏）。只有从这个
    // 入口（已有岛屿、中途改主意想放弃修改）进入时，才显示"取消"按钮；
    // 普通新用户首次填表流程中这个按钮保持 index.html 里预设的 hidden 状态。
    document.getElementById('form-cancel-btn')?.classList.remove('hidden');

    if (birthInfo) {
      const yearEl  = document.getElementById('inp-year');
      const monthEl = document.getElementById('inp-month');
      const dayEl   = document.getElementById('inp-day');
      const hourEl  = document.getElementById('inp-hour');
      if (yearEl)  yearEl.value  = birthInfo.year;
      if (monthEl) monthEl.value = birthInfo.month;
      if (dayEl)   dayEl.value   = birthInfo.day;
      if (hourEl)  hourEl.value  = birthInfo.hour;
      if (typeof App.setGender === 'function') {
        App.setGender(birthInfo.gender === '女' ? '女' : '男');
      }
    }

    // 昵称预填（若已登录）
    if (typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn()) {
      AuthManager.getProfile().then(profile => {
        const nameEl = document.getElementById('inp-name');
        if (nameEl && profile?.display_name) nameEl.value = profile.display_name;
      }).catch(() => {});
    }
    // 不自动提交，用户确认或修改后自己点提交按钮
  }

  return { show, hide, saveProfile, refreshAiOnly, confirmFullRegen, editBirthInfo };
})();
