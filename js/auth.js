/**
 * 司马八字 · 用户认证模块 auth.js
 *
 * 功能：
 *   - 邮箱 + 密码 注册 / 登录 / 登出
 *   - 登录态持久化（Supabase 自动处理）
 *   - 岛屿数据保存 / 读取（islands 表）
 *
 * 依赖：
 *   - Supabase JS SDK（在 index.html 的 CDN 引入）
 *   - window.SUPABASE_URL 和 window.SUPABASE_ANON_KEY（在 config.js 配置）
 */

const AuthManager = (() => {

  let _supabase = null;
  let _currentUser = null;

  // ── 初始化 Supabase 客户端 ───────────────────────────────
  function init() {
    const url = window.CONFIG?.SUPABASE_URL;
    const key = window.CONFIG?.SUPABASE_ANON_KEY;

    if (!url || !key) {
      console.warn('[Auth] Supabase 未配置，用户系统不可用');
      return;
    }

    _supabase = supabase.createClient(url, key);

    // 监听登录态变化
    _supabase.auth.onAuthStateChange((event, session) => {
      _currentUser = session?.user ?? null;
      _updateUI();
      if (event === 'SIGNED_IN') {
        console.log('[Auth] 用户已登录:', _currentUser.email);
      }
    });

    // 检查已有会话
    _supabase.auth.getSession().then(({ data }) => {
      _currentUser = data.session?.user ?? null;
      _updateUI();
    });
  }

  // ── 注册 ────────────────────────────────────────────────
  async function register(email, password) {
    if (!_supabase) throw new Error('Supabase 未初始化');
    const { data, error } = await _supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  // ── 登录 ────────────────────────────────────────────────
  async function login(email, password) {
    if (!_supabase) throw new Error('Supabase 未初始化');
    const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  // ── 登出 ────────────────────────────────────────────────
  async function logout() {
    if (!_supabase) return;
    await _supabase.auth.signOut();
    _currentUser = null;
    _updateUI();
  }

  // ── 保存岛屿到数据库 ────────────────────────────────────
  async function saveIsland({ baziData, modelUrl, baziHash, birthInfo, name }) {
    if (!_supabase || !_currentUser) {
      console.log('[Auth] 未登录，岛屿仅保存在本地');
      return null;
    }

    const { data, error } = await _supabase.from('islands').insert({
      user_id:     _currentUser.id,
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

    if (error) {
      console.error('[Auth] 保存岛屿失败:', error);
      return null;
    }

    console.log('[Auth] 岛屿已保存:', data.id);
    return data;
  }

  // ── 读取用户的所有岛屿 ──────────────────────────────────
  async function getMyIslands() {
    if (!_supabase || !_currentUser) return [];

    const { data, error } = await _supabase
      .from('islands')
      .select('*')
      .eq('user_id', _currentUser.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Auth] 读取岛屿列表失败:', error);
      return [];
    }

    return data || [];
  }

  // ── 更新 UI 状态 ────────────────────────────────────────
  function _updateUI() {
    const loginBtn  = document.getElementById('auth-login-btn');
    const logoutBtn = document.getElementById('auth-logout-btn');
    const userInfo  = document.getElementById('auth-user-info');
    const myIslandsBtn = document.getElementById('auth-my-islands-btn');

    if (_currentUser) {
      // 已登录
      if (loginBtn)  loginBtn.classList.add('hidden');
      if (logoutBtn) logoutBtn.classList.remove('hidden');
      if (myIslandsBtn) myIslandsBtn.classList.remove('hidden');
      if (userInfo)  {
        userInfo.textContent = _currentUser.email;
        userInfo.classList.remove('hidden');
      }
    } else {
      // 未登录
      if (loginBtn)  loginBtn.classList.remove('hidden');
      if (logoutBtn) logoutBtn.classList.add('hidden');
      if (myIslandsBtn) myIslandsBtn.classList.add('hidden');
      if (userInfo)  userInfo.classList.add('hidden');
    }
  }

  // ── 公开API ─────────────────────────────────────────────
  return {
    init,
    login,
    register,
    logout,
    saveIsland,
    getMyIslands,
    isLoggedIn: () => !!_currentUser,
    currentUser: () => _currentUser,
  };

})();
