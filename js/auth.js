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
    // 清除 main-new.js 里记录的当前岛屿id，防止退出登录后仍残留上一个账号的
    // 岛屿id（风险很低——RLS+user_id过滤已能防止跨账号误写，报告也只能从会设置
    // 这个id的入口打开——但这里是最干净的重置时机，退出登录这一刻状态最明确）
    if (typeof App !== 'undefined' && typeof App._resetCurrentIslandId === 'function') {
      App._resetCurrentIslandId();
    }
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
    const { data } = await _sb.from('profiles').select('*').eq('id', _user.id).maybeSingle();
    return data;
  }

  // ── 更新用户资料（目前仅昵称，供设置面板调用）──────────
  // RLS：profiles 表 UPDATE / INSERT 策略 USING/WITH CHECK (auth.uid()=id) 已存在，不需要额外SQL。
  // 用 upsert 而不是 update：如果 profiles 表里没有这一行（例如注册时因邮箱验证
  // 时序问题、RLS 拒绝了 registerWithProfile() 里的首次 upsert），update 会静默
  // 匹配 0 行成功返回（PostgREST 特性：UPDATE 匹配0行不报错），导致"假成功"——
  // 界面显示保存成功，但数据库里其实什么都没写。upsert 能在行不存在时自愈补写。
  async function updateProfile({ displayName }) {
    if (!_sb || !_user) throw new Error('未登录');
    const { data, error } = await _sb.from('profiles')
      .upsert({ id: _user.id, display_name: displayName })
      .select().maybeSingle();
    if (error) throw error;
    return data;
  }

  // ── 保存岛屿 ────────────────────────────────────────────
  async function saveIsland({ baziData, modelUrl, baziHash, birthInfo, name, aiAnalysis = null }) {
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
      ai_analysis: aiAnalysis || null,
    }).select().single();
    if (error) { console.error('[Auth] 保存岛屿失败:', error.message); return null; }
    console.log('[Auth] 岛屿已保存:', data.id);
    return data;
  }

  // ── 补写 AI 深析内容（3D生成完成但六步AI流水线晚到时使用）──
  async function updateIslandAnalysis(islandId, aiAnalysis) {
    if (!_sb || !_user || !islandId) return false;
    const { error } = await _sb.from('islands')
      .update({ ai_analysis: aiAnalysis })
      .eq('id', islandId)
      .eq('user_id', _user.id); // 双重确认只能改自己的记录，RLS本身也会拦，这里是防御性写法
    if (error) { console.warn('[Auth] 补写AI深析失败:', error.message); return false; }
    return true;
  }

  // ── 重算八字数据后同步回数据库（免费本地重算，见 settings.js refreshAiOnly）──
  async function updateIslandBaziData(islandId, baziData) {
    if (!_sb || !_user || !islandId) return false;
    const { error } = await _sb.from('islands')
      .update({ bazi_data: baziData })
      .eq('id', islandId)
      .eq('user_id', _user.id); // 双重确认只能改自己的记录，RLS本身也会拦，这里是防御性写法
    if (error) { console.warn('[Auth] 同步重算八字数据失败:', error.message); return false; }
    return true;
  }

  // ── 读取我的岛屿 ────────────────────────────────────────
  async function getMyIslands() {
    if (!_sb || !_user) return [];
    const { data, error } = await _sb.from('islands').select('*')
      .eq('user_id', _user.id).order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
  }

  // ── 灵气值同步（灵气兑换水晶商品功能，见 js/products.js）────
  // fire-and-forget：调用方（js/user-state.js 的 addSpirit/useSpirit）不等待
  // 这个 Promise，失败只打警告不影响本地灵气值的即时可用性——灵气不是真实
  // 货币，Supabase 一侧只是"云端备份"用于换设备/重新登录时取回余额。
  // 用 upsert 而不是 update：与 updateProfile() 同样的坑（见上方注释）——如果
  // profiles 表里这一行因邮箱验证时序问题不存在，update 会静默匹配0行"成功"，
  // 灵气值实际从未写入云端，换设备/清缓存登录后会读到0，导致本地灵气被
  // max(0, 0) 覆盖为0，攒的灵气无声消失。upsert 只对 payload 里出现的列做
  // ON CONFLICT DO UPDATE，不会清空 display_name/phone 等既有字段。
  // 返回底层 upsert 的 Promise（而不是像大多数 fire-and-forget 函数一样返回
  // undefined）：绝大多数调用方仍然照旧不 await、纯粹fire-and-forget，行为不受
  // 影响；但 _mergeSpiritBalance() 的"本地>远端"分支需要确保这次绝对值推送真的
  // 落地之后，才能安全地让"消费待插入邀请关系"（可能触发云端+50这类可加操作）
  // 开始执行——否则两者仍可能并发，推送延迟较高时反而会把刚入账的+50覆盖掉
  // （见 _mergeSpiritBalance() 调用处注释）。
  function syncSpiritBalance(balance) {
    if (!_sb || !_user) return Promise.resolve();
    return _sb.from('profiles').upsert({ id: _user.id, spirit_balance: balance })
      .then(({ error }) => { if (error) console.warn('[Auth] 灵气值同步失败:', error.message); })
      .catch(e => console.warn('[Auth] 灵气值同步失败:', e));
  }

  // ── 灵气值增量同步（RPC，配合裂变奖励等"服务端单方面发钱"场景）─────────
  // 与上面 syncSpiritBalance() 的"推绝对值覆盖云端"语义不同：这个函数调用
  // 数据库函数 adjust_spirit_balance(p_delta)，服务端按增量 UPDATE
  // spirit_balance = spirit_balance + p_delta，不会覆盖掉期间内服务端自己
  // 发放的奖励（比如裂变邀请欢迎奖励+50、激活奖励150/80）——这两种奖励是数据库
  // 触发器/SECURITY DEFINER函数单方面写入的，客户端完全不知情，如果客户端后续
  // 用"本地旧值+这次变动"当绝对值推上去（syncSpiritBalance），会把服务端刚发
  // 的钱覆盖抹掉。凡是 js/user-state.js 的 addSpirit()/useSpirit() 这类日常
  // 增减场景，都应该改用这个函数同步，而不是 syncSpiritBalance()。
  // fire-and-forget，同 syncSpiritBalance() 一样的取舍：不阻断本地灵气值的
  // 即时可用性，失败只打警告。
  function syncSpiritDelta(delta) {
    if (!_sb || !_user || !delta) return;
    _sb.rpc('adjust_spirit_balance', { p_delta: delta })
      .then(({ error }) => { if (error) console.warn('[Auth] 灵气值增量同步失败:', error.message); })
      .catch(e => console.warn('[Auth] 灵气值增量同步失败:', e));
  }

  async function getSpiritBalance() {
    if (!_sb || !_user) return 0;
    try {
      const { data, error } = await _sb.from('profiles')
        .select('spirit_balance').eq('id', _user.id).maybeSingle();
      if (error) { console.warn('[Auth] 读取灵气值失败:', error.message); return 0; }
      return data?.spirit_balance || 0;
    } catch (e) {
      console.warn('[Auth] 读取灵气值失败:', e);
      return 0;
    }
  }

  // ── 创建灵气兑换水晶商品请求 ─────────────────────────────
  // 涉及"欠用户一个真实商品发货"的业务承诺，失败不能静默——console.error 打印
  // 详情，返回 null 让调用方（js/products.js）决定要不要提示用户重试/退灵气。
  //
  // 第三阶段"五行维护系统"：kind/idx 两个参数名保持不变（避免这里再改一次
  // 签名），但 js/products.js 调用方传入的实际语义已经变成 direction（
  // 'nourish'/'restrain'）和 wx 映射出的 0-4 整数下标（trait_index 列是
  // INTEGER，存不了'木'这种中文字符串，映射规则见 products.js::_wxToIndex()
  // 定义处注释）——trait_kind/trait_index 这两个数据库列名本身不改（历史
  // 遗留自旧trait系统，字段类型天然兼容新语义，不需要新增列/迁移）。
  async function createRedemptionRequest({ productId, productName, spiritCost, islandId, kind, idx, summary }) {
    if (!_sb || !_user) { console.error('[Auth] 创建兑换请求失败: 未登录'); return null; }
    try {
      const profile = await getProfile();
      const contactPhone = ((profile?.phone_code || '') + (profile?.phone || '')).trim() || null;

      const { data, error } = await _sb.from('redemption_requests').insert({
        user_id:        _user.id,
        product_id:      productId,
        product_name:    productName,
        spirit_cost:     spiritCost,
        island_id:       islandId || null,
        trait_kind:      kind,
        trait_index:     idx,
        trait_summary:   summary,
        contact_phone:   contactPhone,
      }).select().single();

      if (error) { console.error('[Auth] 创建兑换请求失败:', error.message); return null; }
      return data;
    } catch (e) {
      console.error('[Auth] 创建兑换请求失败:', e);
      return null;
    }
  }

  // ── 五行维护状态同步（第四阶段"五行经营机制"，见 js/wuxing-maintenance.js）──
  // fire-and-forget upsert，同 syncSpiritBalance() 一样的理由用 upsert 不用
  // update（profiles表那个坑：update对不存在的行静默匹配0行"假成功"）。
  // wuxing_maintenance_state 表的主键是自增 id（不是 user_id+bazi_key+wx+
  // direction 这个业务唯一键），所以必须显式传 onConflict 指向
  // supabase_setup.sql::idx_wuxing_maint_unique 这个唯一索引，否则 upsert
  // 默认按主键冲突判断，每次都会插入新行而不是更新已有记录，造成同一条issue
  // 在云端有多行重复记录。
  // 不传 created_at：让数据库首次插入时用 DEFAULT NOW()，之后的 upsert
  // 不在payload里带这个字段就不会覆盖已经写入过的原始创建时间（PostgREST
  // upsert 只对 payload 里出现的列做 ON CONFLICT DO UPDATE）。
  function syncWuxingMaintenanceState(baziKey, wx, direction, record) {
    if (!_sb || !_user || !baziKey || !wx || !direction || !record) return;
    _sb.from('wuxing_maintenance_state').upsert({
      user_id:                 _user.id,
      bazi_key:                baziKey,
      wx:                      wx,
      direction:               direction,
      base_tier:               record.baseTier,
      last_maintained_at:      record.lastMaintainedAt ? new Date(record.lastMaintainedAt).toISOString() : null,
      first_cycle_consumed:    !!record.firstCycleConsumed,
      ownership_tier:          record.ownershipTier || 'none',
      ownership_product_id:    record.ownershipProductId || null,
      last_free_maintain_date: record.lastFreeMaintainUTCDate || null,
      updated_at:              new Date().toISOString(),
    }, { onConflict: 'user_id,bazi_key,wx,direction' })
      .then(({ error }) => { if (error) console.warn('[Auth] 五行维护状态同步失败:', error.message); })
      .catch(e => console.warn('[Auth] 五行维护状态同步失败:', e));
  }

  // 登录成功/岛屿加载时调用（见 js/wuxing-maintenance.js::syncFromCloud()），
  // 只按 bazi_key 过滤——同一账号下不同命盘（比如给家人算的命盘）各自独立，
  // 不应该把无关命盘的维护记录也拉回来参与合并。
  async function getWuxingMaintenanceStates(baziKey) {
    if (!_sb || !_user || !baziKey) return [];
    try {
      const { data, error } = await _sb.from('wuxing_maintenance_state')
        .select('*').eq('user_id', _user.id).eq('bazi_key', baziKey);
      if (error) { console.warn('[Auth] 读取五行维护状态失败:', error.message); return []; }
      return data || [];
    } catch (e) {
      console.warn('[Auth] 读取五行维护状态失败:', e);
      return [];
    }
  }

  // ── 裂变邀请：解析邀请码 → 邀请人 user id ────────────────
  // 对应数据库函数 resolve_referral_code(p_code TEXT) RETURNS UUID，anon 和
  // authenticated 角色都可调用（用户可能在还没登录/注册的匿名阶段就带着
  // ?ref=CODE 链接访问）。找不到对应用户时数据库函数返回 null。
  async function resolveReferralCode(code) {
    if (!_sb || !code) return null;
    try {
      const { data, error } = await _sb.rpc('resolve_referral_code', { p_code: code });
      if (error) { console.warn('[Auth] resolveReferralCode失败:', error.message); return null; }
      return data || null;
    } catch (e) {
      console.warn('[Auth] resolveReferralCode异常:', e);
      return null;
    }
  }

  // ── 裂变邀请：插入一行 referrals 记录（referrer_id 邀请人 / invitee_id 被
  //    邀请人自己）──────────────────────────────────────────
  // RLS 只允许 INSERT invitee_id=当前登录用户自己的一行，所以这个调用必须在
  // 真正建立 session 之后才能成功（调用方 AuthUI._consumePendingReferralInsert()
  // 负责保证这个时机，见该函数注释）。插入成功后，被邀请人的欢迎奖励由数据库
  // 触发器自动、仅一次发放（+50灵气），这里不需要额外调用任何东西去发奖。
  async function insertReferral(referrerId, inviteeId) {
    if (!_sb || !referrerId || !inviteeId || referrerId === inviteeId) return false;
    try {
      const { error } = await _sb.from('referrals').insert({
        referrer_id: referrerId,
        invitee_id:  inviteeId,
      });
      if (error) { console.warn('[Auth] insertReferral失败:', error.message); return false; }
      return true;
    } catch (e) {
      console.warn('[Auth] insertReferral异常:', e);
      return false;
    }
  }

  // ── 裂变邀请：被邀请人成功生成/保存岛屿后调用，标记自己这条待激活的邀请
  //    记录为已激活、触发给邀请人的奖励 ──────────────────────
  // 对应数据库函数 activate_my_referral()（无参数，内部按当前登录用户身份
  // 判断"我是不是有一条待激活的被邀请记录"）。这个函数是幂等的——不管调用
  // 多少次，只有真正存在待激活记录的那一次调用会有实际效果，所以调用方不需要
  // 自己判断"这是不是第一次生成岛屿"，每次成功生成/保存岛屿后都可以直接调用。
  // fire-and-forget：不返回 Promise 给调用方 await，失败只打警告，不阻断/不
  // 影响岛屿保存本身这条主流程（同 syncSpiritBalance() 的设计取舍）。
  function activateMyReferral() {
    if (!_sb || !_user) return;
    _sb.rpc('activate_my_referral')
      .then(({ error }) => { if (error) console.warn('[Auth] activate_my_referral失败:', error.message); })
      .catch(e => console.warn('[Auth] activate_my_referral异常:', e));
  }

  // ── 裂变邀请：我邀请过的人（供任务面板展示邀请进度）──────
  // RLS 只允许 SELECT referrer_id=自己的行，能看到自己邀请出去的全部记录
  // （包含尚未激活的），调用方按 activated_at 是否非空自行过滤统计。
  async function getMyReferrals() {
    if (!_sb || !_user) return [];
    try {
      const { data, error } = await _sb.from('referrals').select('*').eq('referrer_id', _user.id);
      if (error) { console.warn('[Auth] 读取邀请记录失败:', error.message); return []; }
      return data || [];
    } catch (e) {
      console.warn('[Auth] 读取邀请记录失败:', e);
      return [];
    }
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
    logout, sendPasswordReset, getProfile, updateProfile,
    saveIsland, updateIslandAnalysis, updateIslandBaziData, getMyIslands, checkEmailExists,
    syncSpiritBalance, syncSpiritDelta, getSpiritBalance, createRedemptionRequest,
    syncWuxingMaintenanceState, getWuxingMaintenanceStates,
    resolveReferralCode, insertReferral, activateMyReferral, getMyReferrals,
    isLoggedIn: () => !!_user,
    currentUser: () => _user,
  };
})();


/* ════════════════════════════════════════════════
   AuthUI — 弹窗 UI 控制器
════════════════════════════════════════════════ */
const AuthUI = (() => {

  // 注册后"待保存岛屿"暂存 key（见 _saveCurrentIsland / _consumePendingIslandSave）。
  // 命名沿用 js/user-state.js 的 smb_ 前缀习惯。
  const PENDING_ISLAND_KEY = 'smb_pending_island_save';

  // ── 裂变邀请：两个暂存 key（见 _captureReferralFromUrl / _registerPendingReferral /
  //    _consumePendingReferralInsert）───────────────────────────────────
  // PENDING_REFERRAL_KEY：页面加载时从 URL ?ref=CODE 捕获的原始邀请码字符串，
  // 在用户真正决定注册前可能要存活很久（填表→生成岛屿→注册，中间可能跨越
  // 分钟级时间），注册尝试那一刻才会被消费/清除。
  // PENDING_REFERRAL_INSERT_KEY：注册成功、resolve_referral_code() 解析出
  // referrer_id 之后，真正写入 referrals 表前的中间态暂存——之所以要有这第二
  // 段暂存，是因为 referrals 表的 INSERT 需要 auth.uid()=invitee_id 通过 RLS，
  // 而 registerWithProfile() 成功返回的那一刻（本项目 Supabase 开启了邮箱验证）
  // 通常还没有真正的 session，此刻直接 insert 会被 RLS 拒绝——跟
  // claude-docs/已知问题与修复记录.md 2026-08-16"邮箱注册后岛屿必现丢失"是
  // 同一类时序陷阱，这里复用同一套"本地暂存+真正建立session后再补写"模式
  // （见 _saveCurrentIsland / _consumePendingIslandSave）。
  const PENDING_REFERRAL_KEY        = 'smb_pending_referral_code';
  const PENDING_REFERRAL_INSERT_KEY = 'smb_pending_referral_insert';

  // 页面一加载（AuthUI 这个IIFE被解析执行的这一刻）就尝试捕获 URL 里的
  // ?ref=CODE——不依赖 DOMContentLoaded，纯读 location.search + 写
  // localStorage，不碰 DOM，可以在脚本解析阶段立刻安全执行。函数声明在下方，
  // 但 function 声明会被提升到当前作用域顶部，这里调用时已可用。
  _captureReferralFromUrl();

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
    // 确保显示表单视图，隐藏成功视图
    document.getElementById('reg-form-view')?.classList.remove('hidden');
    document.getElementById('reg-success-view')?.classList.add('hidden');
    _setVal('reg-name',  opts.name  || '');
    _setVal('reg-email', opts.email || '');
    _clearError('reg-error');
    // 国家/区号下拉框此前从未被填充过（index.html 里 #reg-country 是空的
    // <select>，_populateCountrySelect() 写好了却没有任何调用点）——每次打开
    // 注册弹窗都调用一次，函数内部已有 sel.options.length > 1 的幂等保护，
    // 重复调用不会重复插入 option。
    _populateCountrySelect();
  }

  // ── 清除字段错误（输入时调用）──────────────────────────
  function clearFieldErr(id) { _clearError(id); }

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
      // 自动加载最新命盘
      _autoLoadLatestIsland();
    } catch (e) {
      _setError('auth-login-error', _friendlyError(e));
    } finally {
      const _t2 = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
      _setLoading(btn, false, _t2('login.submit'));
    }
  }

  // 登录后自动加载最新岛屿
  async function _autoLoadLatestIsland() {
    try {
      const islands = await AuthManager.getMyIslands();
      if (!islands.length) return;
      const latest = islands[0]; // 已按 created_at 倒序
      if (latest.model_url && typeof App !== 'undefined' && typeof App.loadSavedIsland === 'function') {
        App.loadSavedIsland(latest);
      }
    } catch (e) {
      console.warn('[AuthUI] _autoLoadLatestIsland:', e);
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
    const name      = _getVal('reg-name');
    const email     = _getVal('reg-email');
    const password  = _getVal('reg-password');
    const country   = _getVal('reg-country');
    const phoneCode = document.getElementById('reg-phone-code')?.textContent?.trim() || '+86';
    const phone     = _getVal('reg-phone');

    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    if (!name)                          { _setError('reg-error', _t('auth_err.nickname'));   return; }
    if (!email || !email.includes('@')) { _setError('reg-error', _t('auth_err.valid_email')); return; }
    if (!password || password.length < 6) { _setError('reg-error', _t('auth_err.short_pass')); return; }

    const btn = document.getElementById('reg-submit-btn');
    _setLoading(btn, true, _t('reg.creating'));
    try {
      const regResult = await AuthManager.registerWithProfile({ email, password, displayName: name, country, phoneCode, phone });
      _clearError('reg-error');
      _saveCurrentIsland(name);
      // 裂变邀请：若本地存着待处理的邀请码，解析出邀请人id并暂存，等真正建立
      // session后由 _consumePendingReferralInsert() 补写进 referrals 表（同
      // _saveCurrentIsland 一样的"注册这一刻不一定有session"陷阱，见该函数注释）。
      // signUp() 响应里 user.id 不需要 session 就能拿到，可以在这里直接读。
      _registerPendingReferral(regResult?.user?.id, email);
      _showRegSuccess(email);
    } catch (e) {
      _setError('reg-error', _friendlyError(e));
    } finally {
      const _t2 = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
      _setLoading(btn, false, _t2('reg.submit'));
    }
  }

  // ── 注册成功引导 ────────────────────────────────────────
  function _showRegSuccess(email) {
    document.getElementById('reg-form-view')?.classList.add('hidden');
    const sv = document.getElementById('reg-success-view');
    if (sv) sv.classList.remove('hidden');
    const emailEl = document.getElementById('reg-success-email');
    if (emailEl) emailEl.textContent = email;
  }

  // ── 国家码同步 ──────────────────────────────────────────
  function onCountryChange() {
    const country = _getVal('reg-country');
    const entry   = COUNTRY_CODES.find(c => c.code === country);
    const el      = document.getElementById('reg-phone-code');
    if (el && entry) el.textContent = entry.phone;
  }

  // ── 顶部 #auth-user-info 展示刷新（优先 display_name，否则邮箱）─────
  // 从 _onAuthChange() 抽出，供登录态变化和 SettingsUI.saveProfile() 保存
  // 昵称成功后共同调用，确保改完昵称立刻在顶部同步、不用等下次登录/刷新页面。
  function _refreshUserInfoDisplay() {
    const user     = AuthManager.currentUser();
    const userInfo = document.getElementById('auth-user-info');
    if (!user || !userInfo) return;
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

  // ── 认证状态变化（AuthManager 回调）────────────────────
  function _onAuthChange(user) {
    const loginBtn      = document.getElementById('auth-login-btn');
    const logoutBtn     = document.getElementById('auth-logout-btn');
    const userInfo      = document.getElementById('auth-user-info');
    const myIslandsBtn  = document.getElementById('auth-my-islands-btn');
    const settingsBtn   = document.getElementById('auth-settings-btn');

    if (user) {
      loginBtn?.classList.add('hidden');
      logoutBtn?.classList.remove('hidden');
      myIslandsBtn?.classList.remove('hidden');
      settingsBtn?.classList.remove('hidden');
      _refreshUserInfoDisplay();
      _mergeWuxingMaintenanceState();
      _consumePendingIslandSave(); // 补写注册时因尚无session而暂存本地的岛屿数据（见该函数注释）
      // 顺序很重要：必须先跑完一次灵气值合并（建立基线——如果本地余额比云端
      // 大，把本地这个更大的值确实推上云端），再消费"待插入邀请关系"暂存记录
      // （可能触发数据库端欢迎奖励+50灵气入账）——不能反过来。
      // 原因：referrals行插入触发的欢迎奖励是数据库端"cloud.spirit_balance +=
      // 50"这类可加操作，天然不怕在谁之后执行；但 _mergeSpiritBalance() 的
      // "本地>远端"分支会把本地值当作新的权威值*绝对*推回云端（这是校准/对齐
      // 操作，不在这次delta化改造范围内，见该函数顶部注释）——如果这次绝对值
      // 推送发生在+50入账*之后*，会把刚到账的+50直接覆盖抹掉（本地170 vs
      // 插入后云端0+50=50，取max若在+50入账后才推送，170>50，直接用170覆盖
      // 云端，50灵气凭空消失）。反过来，先合并（此时云端还是0，本地170>0，
      // 推送后云端=170）、再插入邀请关系（触发器在170基础上+50=220，天然正确
      // ）——顺序对了，"取max绝对值覆盖"这条既有逻辑本身完全不用改。
      // _consumePendingReferralInsert() 成功后内部本来就会再触发一次
      // _mergeSpiritBalance()（见该函数内部注释），把这笔+50同步拉回本地余额，
      // 这里不需要再手动追加一次。用 .finally() 而不是 .then()：不管这次登录
      // 本地灵气是否比云端大、要不要真的推送，都要在合并跑完（无论成功失败）
      // 之后再继续消费邀请关系，保证顺序而不是纯粹并发触发。
      _mergeSpiritBalance().finally(() => _consumePendingReferralInsert());
    } else {
      loginBtn?.classList.remove('hidden');
      logoutBtn?.classList.add('hidden');
      myIslandsBtn?.classList.add('hidden');
      settingsBtn?.classList.add('hidden');
      if (userInfo) { userInfo.textContent = ''; userInfo.classList.add('hidden'); }
    }
  }

  // ── 登录时灵气值合并：本地(localStorage) vs 云端(profiles.spirit_balance)
  //    取较大值，避免换设备/重新登录时余额突然变少。不是强一致性同步——灵气
  //    不是真实货币，多设备并发误差可接受。────────────────────────────────
  // 2026-08-18 更新：remote > local 分支改用 UserState.setSpiritLocalOnly()
  // 而不是 UserState.addSpirit(diff)——自从 addSpirit() 的云端同步从"推绝对值"
  // 改造成"推增量"（配合裂变奖励等服务端单方面发钱场景，见 syncSpiritDelta()
  // 注释）之后，这里如果继续借用 addSpirit()，会把"本地追平云端已有权威值"
  // 误当成一次真实本地新增，把云端余额从 remote 又推高成 remote+(remote-local)，
  // 凭空多出一笔灵气。这个分支的本意只是把本地存储追平远端，远端数值本身没有
  // 变化，不需要（也不应该）再往云端推送任何东西——用不碰云端的
  // setSpiritLocalOnly() 才是正确语义，取max/reconcile的合并逻辑本身不变。
  async function _mergeSpiritBalance() {
    if (typeof UserState === 'undefined') return;
    try {
      const remote = await AuthManager.getSpiritBalance();
      const local  = UserState.getSpirit();
      if (remote > local) {
        UserState.setSpiritLocalOnly(remote); // 本地追平远端权威值，远端未变化，不回推云端
      } else if (local > remote) {
        // 本地是较大值（例如登录前匿名试用已攒了灵气）——立即推送云端，不用
        // 等到下一次 addSpirit/useSpirit 触发才同步，避免合并后云端数值仍
        // 落后本地的窗口期。
        //
        // await（而不是像其它 fire-and-forget 调用一样丢在一边不管）：
        // _onAuthChange() 依赖 _mergeSpiritBalance() 这个 Promise 真正 resolve
        // 时，这次绝对值推送已经落地到云端，才会继续消费"待插入邀请关系"暂存
        // 记录（那一步可能触发数据库端"云端+=50"这类可加操作，见调用处注释）。
        // 如果这里不 await，_mergeSpiritBalance() 的 Promise 会在 upsert 请求
        // 真正完成之前就提前 resolve，_onAuthChange() 那边的顺序保证就形同虚设
        // ——插入邀请关系仍可能在这次推送真正落地之前抢先完成，云端+50 落在
        // 推送前的旧值上，随后这次迟到的绝对值推送反而会把 +50 覆盖掉。
        // 只在这一个分支加 await，不影响函数其它地方——如果调用方本身不关心
        // 这个时序（比如未来别的地方也调用 _mergeSpiritBalance() 但不需要严格
        // 顺序），await 与否对函数最终产生的效果（本地/云端各自的值）完全一致，
        // 只是让"完成"这件事对外部可观察。
        await AuthManager.syncSpiritBalance(local);
      }
    } catch (e) {
      console.warn('[AuthUI] 灵气值合并失败:', e);
    }
  }

  // ── 五行维护状态合并（第四阶段，登录时触发的另一半——main-new.js::
  //    _onIslandReady() 是"岛屿加载时"触发的另一半，两处覆盖方案文档要求的
  //    "登录成功/岛屿加载时"两个时机）─────────────────────────────────────
  // 与 _mergeSpiritBalance() 不同：五行维护状态是按 baziKey 归属的复合对象，
  // 没有当前命盘（比如刚打开首页、尚未生成/加载任何岛屿）时无法确定要合并
  // 哪一份记录，直接跳过——不是遗漏，_onIslandReady() 会在岛屿真正加载完成时
  // 自己再调一次 WuxingMaintenance.syncFromCloud()，两处调用互补不冲突
  // （syncFromCloud() 内部逐字段单调合并，重复调用是安全的幂等操作）。
  async function _mergeWuxingMaintenanceState() {
    if (typeof WuxingMaintenance === 'undefined' || typeof WuxingMaintenance.syncFromCloud !== 'function') return;
    try {
      const bd = (typeof App !== 'undefined' && typeof App._getBaziData === 'function') ? App._getBaziData() : null;
      if (!bd) return;
      await WuxingMaintenance.syncFromCloud(bd);
    } catch (e) {
      console.warn('[AuthUI] 五行维护状态合并失败:', e);
    }
  }

  // ── 我的岛屿面板 ────────────────────────────────────────
  let _cachedIslands = []; // 用于 onclick 引用，避免 JSON 转义问题

  async function showMyIslands() {
    const panel = document.getElementById('my-islands-panel');
    const list  = document.getElementById('my-islands-list');
    if (!panel) return;
    panel.classList.remove('hidden');
    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    list.innerHTML = `<div style="color:rgba(232,224,208,.4);text-align:center;padding:20px">${_t('islands.loading')}</div>`;

    let fetchOk = false;
    try {
      _cachedIslands = await AuthManager.getMyIslands();
      fetchOk = true;
    } catch(e) {
      console.warn('[AuthUI] getMyIslands error:', e);
    }
    if (!fetchOk) {
      list.innerHTML = `<div style="color:rgba(235,87,87,.7);text-align:center;padding:20px;font-size:12px">加载失败，请检查网络后重试</div>`;
      return;
    }
    if (!_cachedIslands.length) {
      list.innerHTML = `<div style="color:rgba(232,224,208,.4);text-align:center;padding:20px">${_t('islands.empty')}</div>`;
      return;
    }
    const isZh = (typeof Lang !== 'undefined') ? Lang.getLang() === 'zh' : true;
    list.innerHTML = _cachedIslands.map((isl, i) => `
      <div class="island-card" onclick="AuthUI._loadIslandByIndex(${i})" style="cursor:pointer">
        <div class="island-card-name">${isl.name || (isZh ? '命盘岛屿' : 'My Island')}</div>
        <div class="island-card-meta">
          ${isl.birth_year || ''}${isZh?'年':'/'} ${isl.birth_month || ''}${isZh?'月':'/'} ${isl.birth_day || ''}${isZh?'日':''}
          · ${isl.gender || ''}
          · ${new Date(isl.created_at).toLocaleDateString(isZh?'zh-CN':'en-US')}
        </div>
        <div style="font-size:9px;color:rgba(201,169,110,.4);margin-top:6px;letter-spacing:1px">${isZh?'点击进入命盘':'Tap to enter'} →</div>
      </div>
    `).join('');
  }

  function _loadIslandByIndex(i) {
    const isl = _cachedIslands[i];
    if (!isl) return;
    if (typeof App !== 'undefined' && typeof App.loadSavedIsland === 'function') {
      App.loadSavedIsland(isl);
    }
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

  // ── 注册后：暂存当前岛屿数据，等真正建立 session 后再补写 ──────────
  // 为什么不直接调用 AuthManager.saveIsland()：本项目 Supabase 项目开启了
  // 邮箱验证（见 i18n.js 'reg.success_desc'/'auth_err.unconfirm' 文案），
  // signUp() 成功返回后在用户点击验证链接之前不会有有效 session——此刻
  // AuthManager 内部闭包变量 _user 仍是 null，直接调用 saveIsland() 会被它
  // 内部 `if (!_sb || !_user) return null` 静默拦截，且原先的
  // `.catch(() => {})` 把这个失败原地吞掉，岛屿数据从此再也没有第二次写入
  // 的机会——每一个走邮箱注册的新用户都会必现丢失岛屿（不是偶发）。
  // 改法：先把数据存进 localStorage，真正登录成功（_onAuthChange 拿到非空
  // user，不管是首次登录、邮箱验证后自动登录、还是任何后续登录）时，由
  // _consumePendingIslandSave() 补写。doRegister() 调用这里时永远是匿名
  // 状态（这个弹窗只在未登录时出现），所以不需要再判断"当前是否已登录"这个
  // 分支——统一走暂存+补写这一条路径即可。
  // 注意（若某天关闭邮箱验证）：即使 Supabase 项目关闭邮箱验证、signUp()
  // 立刻建立 session，也不等价于"立即保存"——supabase-js 在 signUp() 内部
  // 就已经派发完 SIGNED_IN 事件了，而这里（_saveCurrentIsland）要等
  // registerWithProfile() 里还多一次 profiles.upsert 网络往返之后才真正把
  // 暂存记录写进 localStorage，消费时机（onAuthStateChange 触发）早于写入
  // 时机（doRegister 里这一步）——这种配置下会滞留到下一次 auth 事件（比如
  // 刷新页面）才真正入库，不是"很快自动补上"。对当前生产配置（邮箱验证
  // 开启，本来就是这次修复的前提）没有影响，仅记录以免误导以后关掉邮箱验证
  // 时的排查方向。
  function _saveCurrentIsland(displayName) {
    try {
      const bd  = typeof App !== 'undefined' && typeof App._getBaziData === 'function'
                  ? App._getBaziData() : null;
      const bi  = typeof App !== 'undefined' && typeof App._getBirthInfo === 'function'
                  ? App._getBirthInfo() : null;
      const url = typeof App !== 'undefined' && typeof App._getLastUrl === 'function'
                  ? App._getLastUrl() : null;
      if (!bd || !url) return;
      const payload = {
        baziData:  bd,
        modelUrl:  url,
        baziHash:  null,
        birthInfo: bi,
        name:      (displayName || '我') + ' 的命盘',
        // 记录注册时填的邮箱，供 _consumePendingIslandSave() 核对身份，
        // 防止同一设备上先后用不同账号登录时张冠李戴（见下方注释）。
        _email:    _getVal('reg-email') || null,
      };
      localStorage.setItem(PENDING_ISLAND_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('[AuthUI] _saveCurrentIsland:', e);
    }
  }

  // ── 消费"待保存岛屿"暂存记录 ─────────────────────────────
  // 在 _onAuthChange() 里、user 非空（真正建立了有效 session）时调用。
  //
  // 先移除、再保存：一进函数就先从 localStorage 里移除这条记录，不等保存
  // 结果——这样 onAuthStateChange 短时间内连续触发多次（比如 SIGNED_IN 紧跟
  // 着 TOKEN_REFRESHED）时，不会有两个并发的 saveIsland() 调用同时读到同一条
  // 记录、重复写库。JS 单线程 + 这里在第一个 await 之前就完成了
  // removeItem，能保证这一点。
  //
  // 但"消费一次"不等于"允许失败后丢失"：AuthManager.saveIsland() 失败时是
  // `console.error(...); return null`，不 throw（网络抖动/RLS拒绝/PostgREST
  // 5xx 都走这条路径，不是罕见情况）——如果只在 catch 分支里处理失败，会漏掉
  // 这整类"正常返回但没真正写进去"的失败。所以下面显式检查 saveIsland() 的
  // 返回值：只有真正拿到非空结果（insert 确认成功）才算这条暂存记录被消费
  // 完毕；不管是返回 null 还是抛异常，都把原始 payload 写回
  // localStorage，留到下一次 _onAuthChange（下次登录/刷新页面重新触发
  // getSession）再重试——不会因为这一次网络抖动就让已经花掉 Gemini 图片额度+
  // Tripo 3D额度生成出来的岛屿无声消失。
  //
  // 邮箱核对：如果暂存记录里的邮箱和当前登录用户的邮箱对不上（例如 A 注册后
  // 没有验证邮箱就退出，同一设备上 B 用自己已有账号登录），直接丢弃，不把
  // A 的命盘数据错误地写进 B 的账号。
  //
  // 已知限制（可接受，见任务要求）：如果用户换了设备/清了浏览器缓存再去点
  // 邮箱验证链接，这条暂存记录不在新设备上，救不回来——比起改动前"100%必
  // 现丢失"，这个方案至少覆盖了"同一设备继续使用"这个最常见场景。
  async function _consumePendingIslandSave() {
    let raw;
    try { raw = localStorage.getItem(PENDING_ISLAND_KEY); } catch { return; }
    if (!raw) return;
    localStorage.removeItem(PENDING_ISLAND_KEY); // 先清除，避免并发触发重复写库；失败时下方会写回

    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    if (!payload) return;

    const user = AuthManager.currentUser();
    if (payload._email && user?.email && payload._email.toLowerCase() !== user.email.toLowerCase()) {
      console.warn('[AuthUI] 待保存岛屿记录邮箱与当前登录账号不匹配，已丢弃');
      return;
    }

    let saved = null;
    try {
      saved = await AuthManager.saveIsland({
        baziData:  payload.baziData,
        modelUrl:  payload.modelUrl,
        baziHash:  payload.baziHash,
        birthInfo: payload.birthInfo,
        name:      payload.name,
      });
    } catch (e) {
      console.warn('[AuthUI] 补写待保存岛屿失败:', e);
    }

    if (saved && saved.id) {
      // 回填岛屿id给 main-new.js，跟"已登录用户立刻保存"路径同款写法（见
      // main-new.js:286 附近），否则这条经暂存补写入库的记录，
      // ai_analysis 字段永远补不上（updateIslandAnalysis() 需要这个id才能
      // 定位到具体行）。
      if (typeof App !== 'undefined' && typeof App._setCurrentIslandId === 'function') {
        App._setCurrentIslandId(saved.id);
      }
      // 裂变邀请：这条路径正是最常见的"被邀请人首次生成岛屿"场景——先生成后
      // 注册的新用户，岛屿在这里补写入库才算真正保存成功。fire-and-forget
      // 触发激活检测，理由同 main-new.js:284 附近那处调用点的注释
      // （activate_my_referral() 幂等，不需要判断是否首次）。
      AuthManager.activateMyReferral();
    } else {
      // 没拿到非空结果——不管是 saveIsland() 内部捕获错误后返回 null，还是
      // 这里 catch 到真正抛出的异常，都算没有真正保存成功，把原始 payload
      // 写回去，留给下一次 _onAuthChange 重试，不能让它就此消失。
      try { localStorage.setItem(PENDING_ISLAND_KEY, raw); } catch (e) {
        console.warn('[AuthUI] 补写岛屿失败后写回暂存记录也失败:', e);
      }
      console.warn('[AuthUI] 补写岛屿失败，已保留待重试记录');
    }
  }

  // ── 裂变邀请：页面加载时捕获 URL 里的 ?ref=CODE ──────────────
  // 只在 URL 真的带 ref 参数时写入/覆盖暂存值；没带这个参数的普通页面加载
  // （比如用户从表单页跳到岛屿页、刷新页面）不应该清空已经存在的暂存邀请码——
  // 用户可能是先点了邀请链接、填完表单生成岛屿、过了一会儿才决定注册，这段
  // 时间内页面可能已经被刷新过、URL 参数早已不在地址栏里了。
  function _captureReferralFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if (ref && ref.trim()) {
        localStorage.setItem(PENDING_REFERRAL_KEY, ref.trim());
      }
    } catch (e) {
      // URLSearchParams 理论上现代浏览器都支持，防御性 try/catch 避免极端环境报错
      console.warn('[AuthUI] _captureReferralFromUrl:', e);
    }
  }

  // ── 裂变邀请：注册成功后，解析暂存邀请码 → 暂存"待插入邀请关系" ──────
  // 在 doRegister() 里 registerWithProfile() 成功返回后调用，此时已经拿到
  // 新用户的 id（data.user.id，signUp() 响应里直接带，不需要 session）。
  // 不 await 这个函数——resolve_referral_code() 是一次额外的网络往返，没必要
  // 让用户在"注册成功"提示出现前多等这一步；解析结果通过 fire-and-forget
  // 的方式异步写入 localStorage，真正的 DB 写入（insertReferral）留给
  // _consumePendingReferralInsert() 在真正建立 session 后执行。
  function _registerPendingReferral(inviteeId, inviteeEmail) {
    try {
      if (!inviteeId) return;
      const code = localStorage.getItem(PENDING_REFERRAL_KEY);
      if (!code) return;
      if (typeof AuthManager === 'undefined' || typeof AuthManager.resolveReferralCode !== 'function') return;

      AuthManager.resolveReferralCode(code).then(referrerId => {
        // 不管解析成功与否，这个原始邀请码这次都算"处理完毕"——避免同一个
        // 暂存邀请码在用户后续退出重新登录、或换设备登录等操作中被误重复
        // 消费/绑定到别的账号上。
        try { localStorage.removeItem(PENDING_REFERRAL_KEY); } catch (e) {}

        if (!referrerId) return; // 邀请码无效/查无此人，静默放弃
        if (referrerId === inviteeId) return; // 用户拿自己的邀请链接注册自己，低成本防御，静默放弃

        try {
          localStorage.setItem(PENDING_REFERRAL_INSERT_KEY, JSON.stringify({
            referrerId,
            inviteeId,
            _email: inviteeEmail || null, // 供 _consumePendingReferralInsert() 核对身份，防止张冠李戴
          }));
          // 主动补一次消费尝试，不完全依赖被动的下一次 _onAuthChange：如果本项目
          // 生产配置某天关闭了邮箱验证，signUp() 内部会在 resolveReferralCode()
          // 这次网络请求完成前就已经派发过 SIGNED_IN 事件了（_onAuthChange 早于
          // 这里写完 localStorage 的时机），错过那次被动触发窗口，要等到下一次
          // auth 事件（刷新页面等）才会重试。_consumePendingReferralInsert() 本身
          // 有"先移除再处理"的防重复保护，这里重复调用是安全的。当前生产配置
          // （邮箱验证开启）下这一步是无害的空跑（此刻还没有 session，函数内部
          // AuthManager.currentUser() 校验会直接短路返回）。
          if (typeof _consumePendingReferralInsert === 'function') _consumePendingReferralInsert();
        } catch (e) {
          console.warn('[AuthUI] 暂存待插入邀请关系失败:', e);
        }
      }).catch(e => {
        console.warn('[AuthUI] resolveReferralCode 失败:', e);
        try { localStorage.removeItem(PENDING_REFERRAL_KEY); } catch (e2) {}
      });
    } catch (e) {
      console.warn('[AuthUI] _registerPendingReferral:', e);
    }
  }

  // ── 裂变邀请：消费"待插入邀请关系"暂存记录，真正写入 referrals 表 ──────
  // 在 _onAuthChange() 里、user 非空（真正建立了有效 session）时调用，跟
  // _consumePendingIslandSave() 同一个触发时机、同一套"先移除再处理"的并发
  // 保护手法（避免 SIGNED_IN 紧跟 TOKEN_REFRESHED 短时间内触发两次插入）。
  //
  // 插入失败时写回重试（跟 _consumePendingIslandSave() 同一套模式，不再是
  // "失败就永久放弃"）：这一行 referrals 记录是两笔奖励（被邀请人+50欢迎奖励、
  // 邀请人+150/80激活奖励）的唯一凭据，插不进去等于两边都拿不到奖励，产品里
  // 又没有任何补救入口——网络抖动/RLS拒绝/PostgREST 5xx 都不是罕见情况，值得
  // 留到下一次 _onAuthChange（下次登录/刷新页面重新触发 getSession）再重试，
  // 而不是这一次失败就永久丢弃。
  async function _consumePendingReferralInsert() {
    let raw;
    try { raw = localStorage.getItem(PENDING_REFERRAL_INSERT_KEY); } catch { return; }
    if (!raw) return;
    localStorage.removeItem(PENDING_REFERRAL_INSERT_KEY); // 先清除，避免并发触发重复插入；失败时下方会写回

    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    if (!payload || !payload.referrerId || !payload.inviteeId) return;

    const user = AuthManager.currentUser();
    if (!user || user.id !== payload.inviteeId) {
      // 当前登录用户跟暂存时的被邀请人对不上（同设备先后用不同账号登录），丢弃
      return;
    }
    if (payload._email && user.email && payload._email.toLowerCase() !== user.email.toLowerCase()) {
      return;
    }

    let ok = false;
    try {
      ok = await AuthManager.insertReferral(payload.referrerId, payload.inviteeId);
    } catch (e) {
      console.warn('[AuthUI] 插入邀请关系失败:', e);
    }

    if (ok) {
      // 插入成功 = 数据库触发器已经给被邀请人（自己）的 spirit_balance 加了
      // 50 灵气欢迎奖励（见接口约定，不需要额外调用任何东西去发这个奖），
      // 立刻重新合并一次云端灵气值，让 UI 尽快反映这笔奖励，而不是等到
      // 下次登录才看到余额变化。
      if (typeof _mergeSpiritBalance === 'function') _mergeSpiritBalance();
      _toast((typeof Lang !== 'undefined') ? Lang.t('tasks.referral_welcome_toast') : '🎉 邀请码生效！你已获得灵气欢迎奖励');
    } else {
      // insertReferral() 内部已经区分了"referrals 表 UNIQUE(invitee_id) 冲突"
      // （同一被邀请人已经插入过一行，属于正常的重复消费保护，不该重试）跟
      // "网络/RLS/5xx 等真失败"吗？——没有，insertReferral() 目前对所有失败
      // 都统一返回 false，无法在这里区分。但写回重试是安全的：即便是 UNIQUE
      // 冲突导致的失败，下一次重试时 insertReferral() 会再次失败（依然是
      // false），只是多一次无害的网络请求，不会产生副作用或重复发奖——数据库
      // 一侧 INSERT 失败就是失败，不会插入半行。所以统一写回重试不需要先做
      // 这个区分。
      try { localStorage.setItem(PENDING_REFERRAL_INSERT_KEY, raw); } catch (e) {
        console.warn('[AuthUI] 插入邀请关系失败后写回暂存记录也失败:', e);
      }
      console.warn('[AuthUI] 插入邀请关系失败，已保留待重试记录');
    }
  }

  // ── 轻量 toast（跟 js/tasks.js::_wxToast() 同款视觉风格，本文件独立实现
  //    一份而不是跨模块调用——理由同 tasks.js 里那份注释：避免给
  //    auth.js/tasks.js 增加不必要的相互依赖，两处各自维护同款小组件是本
  //    项目既有惯例）──────────────────────────────────────────
  function _toast(msg) {
    const existing = document.getElementById('auth-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'auth-toast';
    toast.style.cssText = `
      position:fixed;top:80px;left:50%;transform:translateX(-50%) translateY(-20px);
      background:rgba(8,8,20,.95);border:1px solid rgba(201,169,110,.4);
      border-radius:12px;padding:12px 20px;z-index:9500;
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

  // ── 裂变邀请：拼出当前登录用户的完整分享链接（供设置面板展示/复制）────
  // 只在已登录时有意义——referral_code 是 profiles 表列，未登录用户没有
  // AuthManager._user，getProfile() 内部本身也会因 !_user 直接返回 null。
  async function getReferralLink() {
    if (typeof AuthManager === 'undefined' || !AuthManager.isLoggedIn()) return null;
    try {
      const profile = await AuthManager.getProfile();
      const code = profile?.referral_code;
      if (!code) return null;
      return window.location.origin + '/?ref=' + encodeURIComponent(code);
    } catch (e) {
      console.warn('[AuthUI] getReferralLink:', e);
      return null;
    }
  }

  // ── 裂变邀请：复制邀请链接到剪贴板，带降级兜底 ───────────────
  // 不是所有环境都支持 navigator.clipboard（非安全上下文/极老浏览器/部分
  // webview），降级用传统的 execCommand('copy')（临时插入一个 textarea，
  // 选中后执行复制指令，再移除）。两种方式都失败时返回 false，调用方（
  // js/settings.js）自行决定展示什么提示。
  async function copyReferralLink(link) {
    if (!link) return false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(link);
        return true;
      } catch (e) {
        // 继续走降级方案，不直接返回失败
      }
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = link;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      console.warn('[AuthUI] copyReferralLink 降级方案也失败:', e);
      return false;
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
    clearFieldErr, onMainEmailBlur, onCountryChange,
    showMyIslands, _loadIslandByIndex,
    _onAuthChange, _refreshUserInfoDisplay,
    getReferralLink, copyReferralLink,
  };
})();
