/**
 * 司马八字 · 用户认证 auth.js v2.0
 *
 * AuthManager — Supabase 数据层（登录/注册/登出/岛屿保存）
 * AuthUI      — 弹窗 UI 控制器（登录弹窗/注册弹窗/忘记密码）
 *
 * 依赖：
 *   CONFIG.SUPABASE_URL / SUPABASE_ANON_KEY
 *   CONFIG.ISLAND_API_BASE（用于 /auth/check-email）
 */

/* ════════════════════════════════════════════════
   国家 / 区号 数据
════════════════════════════════════════════════ */
const COUNTRY_CODES = [
  { code:'CN', name:'中国',         phone:'+86'  },
  { code:'HK', name:'香港',         phone:'+852' },
  { code:'TW', name:'台湾',         phone:'+886' },
  { code:'SG', name:'新加坡',       phone:'+65'  },
  { code:'MY', name:'马来西亚',     phone:'+60'  },
  { code:'US', name:'美国',         phone:'+1'   },
  { code:'CA', name:'加拿大',       phone:'+1'   },
  { code:'GB', name:'英国',         phone:'+44'  },
  { code:'AU', name:'澳大利亚',     phone:'+61'  },
  { code:'NZ', name:'新西兰',       phone:'+64'  },
  { code:'JP', name:'日本',         phone:'+81'  },
  { code:'KR', name:'韩国',         phone:'+82'  },
  { code:'IN', name:'印度',         phone:'+91'  },
  { code:'ID', name:'印度尼西亚',   phone:'+62'  },
  { code:'VN', name:'越南',         phone:'+84'  },
  { code:'TH', name:'泰国',         phone:'+66'  },
  { code:'PH', name:'菲律宾',       phone:'+63'  },
  { code:'DE', name:'德国',         phone:'+49'  },
  { code:'FR', name:'法国',         phone:'+33'  },
  { code:'ZA', name:'南非',         phone:'+27'  },
];

/* ════════════════════════════════════════════════
   AuthManager — Supabase 数据层
════════════════════════════════════════════════ */
const AuthManager = (() => {
  let _sb   = null;
  let _user = null;

  // ── 初始化 ─────────────────────────────────────────────
  function init() {
    const url = CONFIG?.SUPABASE_URL;
    const key = CONFIG?.SUPABASE_ANON_KEY;
    if (!url || !key) { console.warn('[Auth] Supabase 未配置 — 缺少 URL 或 ANON_KEY'); return; }

    // 检查 Supabase SDK 是否加载成功
    if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
      console.error('[Auth] Supabase SDK 未加载，请检查网络或 CDN');
      return;
    }

    try {
      _sb = supabase.createClient(url, key);
    } catch (e) {
      console.error('[Auth] Supabase 客户端初始化失败:', e);
      return;
    }

    _sb.auth.onAuthStateChange((event, session) => {
      _user = session?.user ?? null;
      AuthUI._onAuthChange(_user);
    });

    _sb.auth.getSession().then(({ data }) => {
      _user = data.session?.user ?? null;
      AuthUI._onAuthChange(_user);
    }).catch(e => console.warn('[Auth] getSession 失败:', e));
  }

  // ── 登录 ────────────────────────────────────────────────
  async function login(email, password) {
    if (!_sb) throw new Error('网络或配置问题，请刷新页面后重试');
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  // ── 注册（含用户资料）──────────────────────────────────
  async function registerWithProfile({ email, password, displayName, country, phoneCode, phone }) {
    if (!_sb) throw new Error('网络或配置问题，请刷新页面后重试');
    const { data, error } = await _sb.auth.signUp({ email, password });
    if (error) throw error;

    const userId = data.user?.id;
    if (userId) {
      // 写入 profiles 表（忽略失败，不阻断注册流程）
      const { error: profileErr } = await _sb.from('profiles').upsert({
        id:           userId,
        display_name: displayName || '',
        country:      country     || 'CN',
        phone_code:   phoneCode   || '+86',
        phone:        phone       || '',
      });
      if (profileErr) console.warn('[Auth] profile upsert:', profileErr.message);
    }
    return data;
  }

  // ── 兼容旧版 register（无 profile）───────────────────
  async function register(email, password) {
    return registerWithProfile({ email, password });
  }

  // ── 登出 ────────────────────────────────────────────────
  async function logout() {
    if (!_sb) return;
    await _sb.auth.signOut();
    _user = null;
    AuthUI._onAuthChange(null);
  }

  // ── 忘记密码 ────────────────────────────────────────────
  async function sendPasswordReset(email) {
    if (!_sb) throw new Error('Supabase 未初始化');
    const { error } = await _sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
  }

  // ── 读取用户资料 ────────────────────────────────────────
  async function getProfile() {
    if (!_sb || !_user) return null;
    const { data } = await _sb.from('profiles').select('*').eq('id', _user.id).single();
    return data;
  }

  // ── 保存岛屿 ────────────────────────────────────────────
  async function saveIsland({ baziData, modelUrl, baziHash, birthInfo, name }) {
    if (!_sb || !_user) return null;
    const { data, error } = await _sb.from('islands').insert({
      user_id:     _user.id,
      birth_year:  birthInfo?.year,
      birth_month: birthInfo?.month,
      birth_day:   birthInfo?.day,
      birth_hour:  birthInfo?.hour,
      gender:      birthInfo?.gender,
      bazi_data:   baziData,
      model_url:   modelUrl,
      bazi_hash:   baziHash,
      name:        name || '我的命盘岛屿',
    }).select().single();
    if (error) { console.error('[Auth] 保存岛屿失败:', error.message); return null; }
    console.log('[Auth] 岛屿已保存:', data.id);
    return data;
  }

  // ── 读取我的岛屿 ────────────────────────────────────────
  async function getMyIslands() {
    if (!_sb || !_user) return [];
    const { data, error } = await _sb.from('islands').select('*')
      .eq('user_id', _user.id).order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
  }

  // ── 检查邮箱是否已注册 ──────────────────────────────────
  async function checkEmailExists(email) {
    try {
      const base = CONFIG?.ISLAND_API_BASE || 'https://simabazi-island.onrender.com';
      const resp = await fetch(base + '/auth/check-email', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await resp.json();
      return !!data.exists;
    } catch {
      return false; // 网络错误时不阻断用户
    }
  }

  return {
    init, login, register, registerWithProfile,
    logout, sendPasswordReset, getProfile,
    saveIsland, getMyIslands, checkEmailExists,
    isLoggedIn: () => !!_user,
    currentUser: () => _user,
  };
})();


/* ════════════════════════════════════════════════
   AuthUI — 弹窗 UI 控制器
════════════════════════════════════════════════ */
const AuthUI = (() => {

  // ── 显示登录弹窗 ────────────────────────────────────────
  function showLogin(opts = {}) {
    _showOverlay('auth-modal-overlay');
    _switchAuthView('auth-view-login');
    _clearError('auth-login-error');
    if (opts.prefillEmail) _setVal('auth-login-email', opts.prefillEmail);
  }

  // ── 显示忘记密码 ────────────────────────────────────────
  function showForgotPassword() {
    _switchAuthView('auth-view-forgot');
    // 带入登录框的邮箱
    const email = _getVal('auth-login-email');
    if (email) _setVal('auth-forgot-email', email);
    _clearError('auth-forgot-error');
    document.getElementById('auth-forgot-success')?.classList.add('hidden');
  }

  // ── 返回登录 ────────────────────────────────────────────
  function backToLogin() {
    _switchAuthView('auth-view-login');
  }

  // ── 显示注册弹窗（生成后）──────────────────────────────
  function showRegister(opts = {}) {
    _showOverlay('reg-modal-overlay');
    _populateCountrySelect();
    _setVal('reg-name',  opts.name  || '');
    _setVal('reg-email', opts.email || '');
    _clearError('reg-error');
  }

  // ── 隐藏所有弹窗 ────────────────────────────────────────
  function hideModal() {
    document.getElementById('auth-modal-overlay')?.classList.add('hidden');
    document.getElementById('reg-modal-overlay')?.classList.add('hidden');
  }

  // ── 跳过注册 ────────────────────────────────────────────
  function skipReg() { hideModal(); }

  // ── 注册弹窗 → 切换到登录 ─────────────────────────────
  function showLoginFromReg() {
    const email = _getVal('reg-email');
    hideModal();
    showLogin({ prefillEmail: email });
  }

  // ── 提交登录 ────────────────────────────────────────────
  async function doLogin() {
    const email = _getVal('auth-login-email');
    const pass  = _getVal('auth-login-password');
    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    if (!email || !pass) { _setError('auth-login-error', _t('auth_err.fill')); return; }

    const btn = document.getElementById('auth-login-submit-btn');
    _setLoading(btn, true, _t('login.loading'));
    try {
      await AuthManager.login(email, pass);
      hideModal();
      _clearError('auth-login-error');
    } catch (e) {
      _setError('auth-login-error', _friendlyError(e));
    } finally {
      const _t2 = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
      _setLoading(btn, false, _t2('login.submit'));
    }
  }

  // ── 提交忘记密码 ────────────────────────────────────────
  async function doForgotPassword() {
    const email = _getVal('auth-forgot-email');
    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    if (!email) { _setError('auth-forgot-error', _t('auth_err.fill_email')); return; }

    const btn = document.getElementById('auth-forgot-submit-btn');
    _setLoading(btn, true, _t('forgot.sending'));
    try {
      await AuthManager.sendPasswordReset(email);
      _clearError('auth-forgot-error');
      document.getElementById('auth-forgot-success')?.classList.remove('hidden');
      document.getElementById('auth-forgot-submit-btn').disabled = true;
    } catch (e) {
      _setError('auth-forgot-error', _friendlyError(e));
    } finally {
      const _t3 = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
      _setLoading(btn, false, _t3('forgot.submit'));
    }
  }

  // ── 提交注册 ────────────────────────────────────────────
  async function doRegister() {
    const name     = _getVal('reg-name');
    const email    = _getVal('reg-email');
    const country  = _getVal('reg-country');
    const phoneCode= document.getElementById('reg-phone-code')?.textContent?.trim() || '+86';
    const phone    = _getVal('reg-phone');
    const password = _getVal('reg-password');

    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    if (!name)                     { _setError('reg-error', _t('auth_err.nickname'));   return; }
    if (!email || !email.includes('@')) { _setError('reg-error', _t('auth_err.valid_email')); return; }
    if (!password || password.length < 6) { _setError('reg-error', _t('auth_err.short_pass')); return; }

    const btn = document.getElementById('reg-submit-btn');
    _setLoading(btn, true, _t('reg.creating'));
    try {
      await AuthManager.registerWithProfile({ email, password, displayName: name, country, phoneCode, phone });
      hideModal();
      _clearError('reg-error');
      _saveCurrentIsland(name);
    } catch (e) {
      const msg = _friendlyError(e);
      _setError('reg-error', msg);
    } finally {
      const _t2 = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
      _setLoading(btn, false, _t2('reg.submit'));
    }
  }

  // ── 国家码同步 ──────────────────────────────────────────
  function onCountryChange() {
    const country = _getVal('reg-country');
    const entry   = COUNTRY_CODES.find(c => c.code === country);
    const el      = document.getElementById('reg-phone-code');
    if (el && entry) el.textContent = entry.phone;
  }

  // ── 认证状态变化（AuthManager 回调）────────────────────
  function _onAuthChange(user) {
    const loginBtn     = document.getElementById('auth-login-btn');
    const logoutBtn    = document.getElementById('auth-logout-btn');
    const userInfo     = document.getElementById('auth-user-info');
    const myIslandsBtn = document.getElementById('auth-my-islands-btn');

    if (user) {
      loginBtn?.classList.add('hidden');
      logoutBtn?.classList.remove('hidden');
      myIslandsBtn?.classList.remove('hidden');
      if (userInfo) {
        // 优先显示 display_name
        AuthManager.getProfile()
          .then(profile => {
            userInfo.textContent = profile?.display_name || user.email;
            userInfo.classList.remove('hidden');
          })
          .catch(() => {
            userInfo.textContent = user.email;
            userInfo.classList.remove('hidden');
          });
      }
    } else {
      loginBtn?.classList.remove('hidden');
      logoutBtn?.classList.add('hidden');
      myIslandsBtn?.classList.add('hidden');
      if (userInfo) { userInfo.textContent = ''; userInfo.classList.add('hidden'); }
    }
  }

  // ── 我的岛屿面板 ────────────────────────────────────────
  async function showMyIslands() {
    const panel = document.getElementById('my-islands-panel');
    const list  = document.getElementById('my-islands-list');
    if (!panel) return;
    panel.classList.remove('hidden');
    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    list.innerHTML = `<div style="color:rgba(232,224,208,.4);text-align:center;padding:20px">${_t('islands.loading')}</div>`;

    const islands = await AuthManager.getMyIslands();
    if (!islands.length) {
      list.innerHTML = `<div style="color:rgba(232,224,208,.4);text-align:center;padding:20px">${_t('islands.empty')}</div>`;
      return;
    }
    list.innerHTML = islands.map(isl => `
      <div class="island-card">
        <div class="island-card-name">${isl.name || '命盘岛屿'}</div>
        <div class="island-card-meta">
          ${isl.birth_year || ''}年${isl.birth_month || ''}月${isl.birth_day || ''}日
          · ${isl.gender || ''}
          · ${new Date(isl.created_at).toLocaleDateString('zh-CN')}
        </div>
      </div>
    `).join('');
  }

  // ── 主页邮箱实时检测 ────────────────────────────────────
  let _emailTimer = null;
  async function onMainEmailBlur() {
    const email  = document.getElementById('inp-email')?.value?.trim() || '';
    const status = document.getElementById('email-status');
    if (!status) return;
    if (!email || !email.includes('@')) { status.innerHTML = ''; return; }

    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    status.innerHTML = `<span style="color:rgba(232,224,208,.35);font-size:10px;letter-spacing:1px">${_t('email.checking')}</span>`;
    clearTimeout(_emailTimer);
    _emailTimer = setTimeout(async () => {
      const exists = await AuthManager.checkEmailExists(email);
      const _t2 = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
      if (exists) {
        status.innerHTML = `<span style="color:#c9a96e;font-size:10px;letter-spacing:1px">
          ${_t2('email.exists_pre')}
          <span onclick="AuthUI.showLogin({prefillEmail:'${email.replace(/'/g,"\\'")}'})"
                style="text-decoration:underline;cursor:pointer">${_t2('email.login_here')}</span>
        </span>`;
      } else {
        status.innerHTML = `<span style="color:rgba(111,207,151,.7);font-size:10px;letter-spacing:1px">${_t2('email.available')}</span>`;
      }
    }, 600);
  }

  // ── 注册后保存当前岛屿 ──────────────────────────────────
  function _saveCurrentIsland(displayName) {
    try {
      const bd  = typeof App !== 'undefined' && typeof App._getBaziData === 'function'
                  ? App._getBaziData() : null;
      const bi  = typeof App !== 'undefined' && typeof App._getBirthInfo === 'function'
                  ? App._getBirthInfo() : null;
      const url = typeof App !== 'undefined' && typeof App._getLastUrl === 'function'
                  ? App._getLastUrl() : null;
      if (bd && url) {
        AuthManager.saveIsland({
          baziData: bd,
          modelUrl: url,
          baziHash: null,
          birthInfo: bi,
          name: (displayName || '我') + ' 的命盘',
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('[AuthUI] _saveCurrentIsland:', e);
    }
  }

  // ── 填充国家下拉框 ──────────────────────────────────────
  function _populateCountrySelect() {
    const sel = document.getElementById('reg-country');
    if (!sel || sel.options.length > 1) return; // 已填充
    sel.innerHTML = COUNTRY_CODES.map(c =>
      `<option value="${c.code}"${c.code === 'CN' ? ' selected' : ''}>${c.name}（${c.phone}）</option>`
    ).join('');
  }

  // ── 工具函数 ─────────────────────────────────────────────
  function _showOverlay(id) { document.getElementById(id)?.classList.remove('hidden'); }

  function _switchAuthView(activeId) {
    ['auth-view-login', 'auth-view-forgot'].forEach(id => {
      document.getElementById(id)?.classList.toggle('hidden', id !== activeId);
    });
  }

  function _getVal(id) { return (document.getElementById(id)?.value || '').trim(); }
  function _setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

  function _setError(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; }
  function _clearError(id)    { _setError(id, ''); }

  function _setLoading(btn, loading, text) {
    if (!btn) return;
    btn.disabled    = loading;
    btn.textContent = text;
  }

  function _friendlyError(e) {
    const msg = e?.message || String(e);
    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    if (msg.includes('Invalid login credentials'))         return _t('auth_err.invalid');
    if (msg.includes('Email not confirmed'))               return _t('auth_err.unconfirm');
    if (msg.includes('User already registered') ||
        msg.includes('already registered'))                return _t('auth_err.exists');
    if (msg.includes('Password should be at least 6'))    return _t('auth_err.weak_pass');
    if (msg.includes('Unable to validate email'))         return _t('auth_err.bad_email');
    if (msg.includes('rate limit') || msg.includes('too many')) return _t('auth_err.rate');
    return msg;
  }

  return {
    showLogin, showForgotPassword, backToLogin,
    showRegister, hideModal, skipReg, showLoginFromReg,
    doLogin, doForgotPassword, doRegister,
    onCountryChange, onMainEmailBlur,
    showMyIslands,
    _onAuthChange,
  };
})();
