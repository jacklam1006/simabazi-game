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
  // 权限分两层，缺一不可：RLS 只管"能不能改这一行"(USING/WITH CHECK auth.uid()=id)，
  // "能改哪些列"由 supabase_setup.sql 里的表级 REVOKE + 列白名单 GRANT 另行控制，
  // 防止 spirit_balance / is_admin 等敏感列被绕过前端直接篡改。
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

  // 2026-08-21 灵气服务端权威记账重构第四轮：syncSpiritBalance() 已删除。
  // 它是 reconcile_spirit_balance_up(p_local_value) RPC 的唯一调用点，而
  // 这个 RPC 已经在权威记账重构收尾时被 `REVOKE EXECUTE FROM authenticated`
  // （它接受客户端任意上报数值，正是这次重构要堵住的洞——见上方
  // adjust_spirit_balance 同款收尾注释）。函数体保留在数据库里只是为了
  // 审计留痕，不代表还能被前端合法调用；这里继续保留调用点等于让
  // "本地比云端大就推上去"这条登录合并分支必现失败——用户匿名试用攒的灵气，
  // 登录时永远推不上云端，换设备/清缓存即丢失。见下方 _mergeSpiritBalance()
  // 改造说明。

  // ── 管理员测试专用：任意设置灵气值（不受列级REVOKE限制，走后端RPC内部is_admin校验）──
  // 仅供管理员账号在浏览器控制台手动调用测试用（如 AuthManager.adminSetSpiritBalance(9999)），
  // 不接入任何UI。非管理员账号调用会被数据库RPC内部拒绝并返回error，不会有任何副作用。
  async function adminSetSpiritBalance(value, targetUserId = null) {
    if (!_sb || !_user) { console.warn('[Auth] 未登录，无法调用'); return null; }
    const { data, error } = await _sb.rpc('admin_set_spirit_balance', {
      p_value: value, p_target_id: targetUserId,
    });
    if (error) { console.warn('[Auth] 管理员设置灵气值失败（可能不是管理员账号）:', error.message); return null; }
    console.log('[Auth] 灵气值已设置为:', data);
    if (data != null && typeof UserState !== 'undefined' && (!targetUserId || targetUserId === _user.id)) {
      UserState.setSpiritLocalOnly(data); // 操作对象是自己时，顺带同步本地显示
    } else if (data == null) {
      console.warn('[Auth] 管理员设置灵气值返回空值，可能是目标用户资料尚未建立');
    }
    return data;
  }

  // 2026-08-21 灵气值服务端权威记账重构：以下曾经的 syncSpiritDelta()（RPC
  // adjust_spirit_balance）已删除——旧模式是"客户端先本地加/减好数字，再顺便
  // 把增量推给服务端"，服务端对客户端传入的数值完全不做校验，理论上可以被
  // 篡改成任意增量。现在改为服务端权威：具体业务场景（签到/任务/五行维护/
  // 瞬间调理/灵气兑换）各自显式调用下面这批 SECURITY DEFINER RPC，由服务端
  // 独立计算、独立记账并返回权威新余额，客户端只负责用
  // UserState.setSpiritLocalOnly(new_balance) 同步本地显示，不再自己算钱。
  // 对应的旧 RPC `adjust_spirit_balance`/`reconcile_spirit_balance_up` 均已
  // 被数据库侧 REVOKE EXECUTE，不能再调用——`reconcile_spirit_balance_up`
  // 一度还保留给 syncSpiritBalance() 的登录合并场景用，但该场景本身已在
  // 本轮被废弃删除（登录合并现在永远以服务端为权威，不再存在"本地比云端大
  // 就推上去"这个操作，见 AuthUI._mergeSpiritBalance() 改造说明），
  // syncSpiritBalance() 函数已一并删除，两个旧 RPC 现在彻底没有任何合法
  // 调用点。详见 claude-docs/已知问题与修复记录.md 对应日期条目。

  // ── 每日签到（服务端权威）──────────────────────────────
  // 对应 js/user-state.js::doCheckin() 登录分支。PostgREST 对
  // `RETURNS TABLE(...)` 函数的响应形状是数组（哪怕只有一行），这里统一拆包
  // 成对象，调用方拿到 null 表示请求失败（网络问题等，非"今日已签到"这种
  // 正常业务结果——那种情况 already_done 会是 true 但函数本身仍返回非 null）。
  async function claimDailyCheckin() {
    if (!_sb || !_user) return null;
    try {
      const { data, error } = await _sb.rpc('claim_daily_checkin');
      if (error) { console.warn('[Auth] 签到失败:', error.message); return null; }
      return data && data[0] ? data[0] : null;
    } catch (e) {
      console.warn('[Auth] 签到异常:', e);
      return null;
    }
  }

  // ── 领取任务奖励（服务端权威）────────────────────────────
  // 对应 js/tasks.js::complete() 登录分支。失败（未知任务/已领取/条件不满足/
  // 网络错误）统一走 { error } 形状，调用方据此决定是否在本地补发——原则上
  // 不补发，避免绕过服务端判定。
  async function claimTask(taskId) {
    if (!_sb || !_user) return { error: 'not_logged_in' };
    try {
      const { data, error } = await _sb.rpc('claim_task', { p_task_id: taskId });
      if (error) return { error: error.message };
      return { data: data && data[0] ? data[0] : null };
    } catch (e) {
      console.warn('[Auth] claimTask异常:', e);
      return { error: e.message };
    }
  }

  // ── 读取当前用户的任务完成记录（服务端权威，多设备场景用）───────────
  // 2026-08-22 第八轮遗留PLAUSIBLE③修复：task_completions 表本来就是给
  // 换设备/清缓存场景设计的，但此前全项目没有任何地方读取过。RLS已有
  // `FOR SELECT USING (auth.uid()=user_id)` 策略，不需要新的SQL——这里
  // 直接查得到，供 js/tasks.js::hydrateFromServer() 登录时回灌本地状态。
  async function getTaskCompletions() {
    if (!_sb || !_user) return null;
    try {
      // 2026-08-22 PLAUSIBLE修复：这张表每天最多新增3行（3个daily任务），
      // 不加限制会在约333天后触及PostgREST默认1000行上限，届时早期的
      // onetime任务记录可能被截断查不到，导致"换设备后任务状态不同步"
      // 这个问题静默复发。.limit(5000) 约等于4.5年的用量，足够避免近期
      // 触达，不需要做更复杂的分页/游标方案。明确不按 day_key 过滤/只拉
      // 最近N天——那样会破坏 hydrateFromServer() 依赖读到历史daily记录来
      // 追平装饰解锁状态的既有逻辑（见该函数注释）。
      const { data, error } = await _sb.from('task_completions').select('task_id, day_key').eq('user_id', _user.id).limit(5000);
      if (error) { console.warn('[Auth] 读取任务完成记录失败:', error.message); return null; }
      return data;
    } catch (e) {
      console.warn('[Auth] 读取任务完成记录失败:', e);
      return null;
    }
  }

  // ── 五行免费维护（拖拽维护，服务端权威）──────────────────
  // 对应 js/wuxing-maintenance.js::maintain() 登录分支。
  // baseTier（2026-08-21顺带修复新增第5个可选参数）：服务端RPC签名是
  // `wuxing_free_maintain(p_bazi_key, p_wx, p_direction, p_tier, p_base_tier
  // SMALLINT DEFAULT 1)`——p_base_tier 只在服务端对应行不存在、需要自己
  // INSERT创建时使用，此前前端调用没有传这个参数，会一律用默认值1创建行，
  // 与本地已经算好的真实baseTier（可能是2或3）不一致。不传时保持原有行为
  // （RPC内部COALESCE兜底为1），不会破坏未升级完成前的调用方。
  async function wuxingFreeMaintain(baziKey, wx, direction, tier, baseTier) {
    if (!_sb || !_user) return { error: 'not_logged_in' };
    try {
      const { data, error } = await _sb.rpc('wuxing_free_maintain', {
        p_bazi_key: baziKey, p_wx: wx, p_direction: direction, p_tier: tier, p_base_tier: baseTier,
      });
      if (error) return { error: error.message };
      return { data: data && data[0] ? data[0] : null };
    } catch (e) {
      console.warn('[Auth] wuxingFreeMaintain异常:', e);
      return { error: e.message };
    }
  }

  // ── 五行瞬间调理（花灵气，服务端权威）────────────────────
  // 对应 js/wuxing-maintenance.js::instantFix() 登录分支。baseTier 同上方
  // wuxingFreeMaintain() 的2026-08-21顺带修复说明。
  async function wuxingInstantFix(baziKey, wx, direction, tier, baseTier) {
    if (!_sb || !_user) return { error: 'not_logged_in' };
    try {
      const { data, error } = await _sb.rpc('wuxing_instant_fix', {
        p_bazi_key: baziKey, p_wx: wx, p_direction: direction, p_tier: tier, p_base_tier: baseTier,
      });
      if (error) return { error: error.message };
      return { data: data && data[0] ? data[0] : null };
    } catch (e) {
      console.warn('[Auth] wuxingInstantFix异常:', e);
      return { error: e.message };
    }
  }

  // 2026-08-21 灵气服务端权威记账重构第四轮：spendSpirit()/setWuxingOwnership()
  // 已删除，被下方 redeemWuxingProduct() 取代——原来"先调 spendSpirit() 扣钱、
  // 再调 setWuxingOwnership() 改状态"这种分步设计可以被跳过第二步单独调用、
  // 或反过来只调第二步绕过扣款，是上一轮 C4（花0灵气白嫖shrine）的根因。
  // 新的 redeem_wuxing_product() RPC 在服务端同一个事务里原子完成"校验商品
  // /扣灵气/记录归属"，不再给客户端留下"分步执行、中途绕过"的空间。
  // wuxingFreeMaintain()/wuxingInstantFix() 两个函数不受影响，继续保留——
  // "瞬间调理"是与"购买商品"完全独立的另一条路径，这次改造不涉及。

  // ── 兑换五行维护商品（水晶/请神仙），服务端权威原子操作 ──────
  // 取代旧的"spendSpirit()扣钱 + setWuxingOwnership()改状态"两步分步调用。
  // 服务端 redeem_wuxing_product() 在同一个事务里：①按 p_product_id 查服务端
  // 自己的商品表（不信任客户端传的价格/商品名）；②校验灵气是否足够，不足
  // RAISE EXCEPTION '灵气不足'；③原子扣款；④按商品类型分支——crystal类型
  // 额外在同一事务内插入一行 redemption_requests（返回的 redemption_id 就是
  // 这行的id，供 js/products.js 后续 fire-and-forget 通知业务方用）；shrine
  // 类型纯虚拟购买，不插入该表。未知商品id同样 RAISE EXCEPTION '未知商品'。
  async function redeemWuxingProduct({ productId, baziKey, wx, direction, baseTier, islandId, traitSummary }) {
    if (!_sb || !_user) return { error: 'not_logged_in' };
    try {
      const { data, error } = await _sb.rpc('redeem_wuxing_product', {
        p_product_id: productId, p_bazi_key: baziKey, p_wx: wx, p_direction: direction,
        p_base_tier: baseTier, p_island_id: islandId, p_trait_summary: traitSummary,
      });
      if (error) return { error: error.message };
      return { data: data && data[0] ? data[0] : null };
    } catch (e) {
      console.warn('[Auth] redeemWuxingProduct异常:', e);
      return { error: e.message };
    }
  }

  // 返回值语义：网络/查询失败时返回 null（不是0）——调用方 _mergeSpiritBalance()
  // 靠这个区分"服务端确认余额为0"和"这次根本没问到服务端"，null 时会跳过本地
  // 覆盖、保留原有显示值，避免一次网络抖动把本地灵气显示错误地清零（0 只在
  // 真正查到 profiles 行且 spirit_balance 字段确实是0，或行不存在这种“新用户
  // 尚未初始化”的合法场景下返回）。
  async function getSpiritBalance() {
    if (!_sb || !_user) return null;
    try {
      const { data, error } = await _sb.from('profiles')
        .select('spirit_balance').eq('id', _user.id).maybeSingle();
      if (error) { console.warn('[Auth] 读取灵气值失败:', error.message); return null; }
      return data?.spirit_balance || 0;
    } catch (e) {
      console.warn('[Auth] 读取灵气值失败:', e);
      return null;
    }
  }

  // ── 创建灵气兑换水晶商品请求 ─────────────────────────────
  // 涉及"欠用户一个真实商品发货"的业务承诺，失败不能静默——console.error 打印
  // 详情，返回 null 让调用方（js/products.js）决定要不要提示用户重试/退灵气。
  //
  // 2026-08-21 灵气服务端权威记账重构第四轮：js/products.js 已改为调用
  // redeemWuxingProduct() 原子RPC（服务端同一事务内完成扣款+写
  // redemption_requests，不再是"先扣钱、再单独调这个函数写记录"两步），
  // 这个函数目前没有任何调用点。保留而不删除，是因为不确定是否有历史数据
  // 依赖这条独立写入路径/未来是否有别的场景仍需要单独创建兑换请求——如果
  // 确认彻底不需要了，可以连同 js/products.js::_wxToIndex()/WX_ORDER 一起
  // 清理。
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
  // fire-and-forget upsert，同 updateProfile() 一样的理由用 upsert 不用
  // update（profiles表那个坑：update对不存在的行静默匹配0行"假成功"）。
  // wuxing_maintenance_state 表的主键是自增 id（不是 user_id+bazi_key+wx+
  // direction 这个业务唯一键），所以必须显式传 onConflict 指向
  // supabase_setup.sql::idx_wuxing_maint_unique 这个唯一索引，否则 upsert
  // 默认按主键冲突判断，每次都会插入新行而不是更新已有记录，造成同一条issue
  // 在云端有多行重复记录。
  // 不传 created_at：让数据库首次插入时用 DEFAULT NOW()，之后的 upsert
  // 不在payload里带这个字段就不会覆盖已经写入过的原始创建时间（PostgREST
  // upsert 只对 payload 里出现的列做 ON CONFLICT DO UPDATE）。
  //
  // 【灵气服务端权威记账重构】ownership_tier/ownership_product_id 这两列已
  // 被 supabase_setup.sql 表级REVOKE+列白名单GRANT锁定，只能通过 SECURITY
  // DEFINER 函数写入——2026-08-21第四轮重构后，唯一合法写入路径是
  // redeem_wuxing_product() RPC（见上方 redeemWuxingProduct()）在兑换成功
  // 那一刻原子写入，前端不再有单独的"设置归属"调用点。Postgres 的列权限
  // 检查是"语句里出现了这一列就检查"，不管值是否变化——payload 里只要带
  // 这两个字段，upsert 就必然因权限不足报错。这里不再同步这两列。
  //
  // 2026-08-21 backend-service交接（见claude-docs/已知问题与修复记录.md
  // 对应"C4修复"条目末尾）：C3修复把 base_tier/last_free_maintain_date 也从
  // UPDATE白名单里去掉了（同样只能由 wuxing_free_maintain()/wuxing_instant_
  // fix()/redeem_wuxing_product() 这些SECURITY DEFINER函数写入，防止客户端
  // 直接抹掉"今日已维护"标记或伪造base_tier绕过每日限额/定价）——backend-
  // service本地Postgres实测证实，这两列只要出现在upsert的payload里（不管
  // 是INSERT列表还是DO UPDATE的SET子句），整条语句就会因列权限不足直接
  // 报错，此前"只有真正走到DO UPDATE分支才会失败"的直觉是错的，Postgres对
  // 这类语句的列权限检查覆盖整条语句。这里跟随上面 ownership_tier/
  // ownership_product_id 同款处理，一并从payload里删除这两列。
  // 安全性：这里省略 base_tier/last_free_maintain_date 不会导致本函数触发的
  // INSERT分支因NOT NULL约束报错——依赖的是 wuxing_maintenance_state.base_tier
  // 列本身有 DEFAULT 1 兜底（backend-service侧SQL修复），而不是"这条upsert
  // 反正只会走ON CONFLICT DO UPDATE分支、不会真正走到INSERT"这个前提——
  // INSERT...ON CONFLICT DO UPDATE会先构造并校验完整待插入行、再判断是否
  // 冲突，缺DEFAULT时哪怕最终走DO UPDATE分支同样会报错，实测细节见
  // claude-docs/已知问题与修复记录.md对应条目。base_tier/last_free_maintain_
  // date 的权威写入路径仍然是 wuxing_free_maintain()/wuxing_instant_fix()/
  // redeem_wuxing_product() 这几个SECURITY DEFINER函数（见各自定义处），
  // 此后不该再被客户端这个fire-and-forget同步函数覆盖。
  function syncWuxingMaintenanceState(baziKey, wx, direction, record) {
    if (!_sb || !_user || !baziKey || !wx || !direction || !record) return;
    _sb.from('wuxing_maintenance_state').upsert({
      user_id:                 _user.id,
      bazi_key:                baziKey,
      wx:                      wx,
      direction:               direction,
      last_maintained_at:      record.lastMaintainedAt ? new Date(record.lastMaintainedAt).toISOString() : null,
      first_cycle_consumed:    !!record.firstCycleConsumed,
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
  // 影响岛屿保存本身这条主流程（同 syncWuxingMaintenanceState() 的设计取舍）。
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
    getSpiritBalance, adminSetSpiritBalance, createRedemptionRequest,
    claimDailyCheckin, claimTask, getTaskCompletions, wuxingFreeMaintain, wuxingInstantFix, redeemWuxingProduct,
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
      // 2026-08-21 第四轮重构后说明：_mergeSpiritBalance() 现在永远以服务端
      // 为唯一权威来源、单纯拉取覆盖本地（不再有"本地>远端就推上去"这个分支，
      // 见该函数定义处注释），因此这里先合并再消费邀请关系的顺序，已经不再
      // 像旧版本那样是"避免推送覆盖掉+50奖励"的正确性前提——continue 保留这
      // 个既有调用顺序纯粹是不必要的破坏性改动，不代表顺序本身仍然关键。
      // _consumePendingReferralInsert() 插入成功后内部会再触发一次
      // _mergeSpiritBalance()（见该函数内部注释），把 referrals 插入触发的
      // +50 欢迎奖励从服务端同步拉回本地余额——这一步不管前面合并顺序如何都
      // 会正确生效，因为它读到的永远是服务端此刻的真实值。.finally() 而不是
      // .then()：合并请求失败也不应该阻断邀请关系的消费。
      _mergeSpiritBalance().finally(() => _consumePendingReferralInsert());
      // 2026-08-22 第八轮遗留PLAUSIBLE③修复：登录时把服务端 task_completions
      // 记录回灌本地任务完成状态（换设备/清缓存场景），fire-and-forget，不
      // 阻塞其它登录后逻辑，也不涉及灵气数字（灵气数字由上面的
      // _mergeSpiritBalance() 独立负责）。
      if (typeof Tasks !== 'undefined' && typeof Tasks.hydrateFromServer === 'function') {
        Tasks.hydrateFromServer();
      }
    } else {
      loginBtn?.classList.remove('hidden');
      logoutBtn?.classList.add('hidden');
      myIslandsBtn?.classList.add('hidden');
      settingsBtn?.classList.add('hidden');
      if (userInfo) { userInfo.textContent = ''; userInfo.classList.add('hidden'); }
    }
  }

  // ── 登录时灵气值合并：服务端权威、单向覆盖本地 ─────────────────────
  // 2026-08-21 第四轮重构：不再是"本地(localStorage) vs 云端 取较大值合并"。
  // 旧语义的前提是"本地在未登录期间积累的灵气值，也是一份可信数据，值得在
  // 它比云端大时被推送上去、成为新的权威值"——但灵气值系统已经全面改成
  // 服务端权威记账（签到/任务/五行维护/瞬间调理/灵气兑换全部由服务端独立
  // 计算并记账，见 claimDailyCheckin/claimTask/wuxingFreeMaintain/
  // wuxingInstantFix/redeemWuxingProduct），本地在未登录状态下走的仍是纯
  // 本地计数（UserState.addSpirit()/useSpirit() 的匿名试用路径），这个数字
  // 不再代表任何服务端已确认的真实交易记录，不能被当作可信来源倒推给服务端
  // ——旧的"本地>远端就推上去"分支依赖的 reconcile_spirit_balance_up RPC
  // 也已经在重构收尾时被数据库侧 REVOKE，就算保留这个分支也必然调用失败。
  // 现在的正确语义：服务端 profiles.spirit_balance 是唯一权威来源，登录这
  // 一刻本地无条件用服务端返回值覆盖，不做任何比较、不回推任何东西。
  // 直接影响：匿名试用攒的灵气不再能在注册/登录后带过去——这是架构变化的
  // 直接后果，不是bug（已与用户确认过这个取舍，优先级是"确保没有潜在篡改
  // 风险"，不是保留这段匿名试用体验）。
  async function _mergeSpiritBalance() {
    if (typeof UserState === 'undefined') return;
    try {
      const remote = await AuthManager.getSpiritBalance();
      // remote === null 表示这次读取失败（网络抖动/查询异常），不是服务端确认
      // 余额为0——这种情况必须跳过覆盖、保留本地原有显示值，否则一次网络抖动
      // 就会把用户正确的灵气显示错误地清零，直到下次成功合并才恢复。
      if (remote === null) {
        console.warn('[AuthUI] 灵气值合并跳过：读取远端余额失败，保留本地原值');
        return;
      }
      UserState.setSpiritLocalOnly(remote); // 服务端是唯一权威来源，本地无条件追平
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
      // 2026-08-22 第八轮遗留PLAUSIBLE②修复：这条正是"匿名生成岛屿→之后才
      // 注册"的边缘路径——匿名生成时 first_island 走的是纯本地记账分支
      // （UserState.completeTask('first_island') 已经把本地"已完成"标记
      // 永久写死，这个标记不会随注册重置），如果这里像 main-new.js 那样
      // 直接调用 Tasks.complete('first_island', ...)，会被该函数开头的
      // `isDone(taskId)` 短路直接拦住、永远不会真正调用服务端 claim_task()
      // ——服务端这笔50灵气奖励会永久领不到。用 Tasks.
      // completeIgnoringLocalState() 专门跳过这道本地短路，直接走服务端
      // 权威 claim_task()（真正的防重复发奖机制是服务端自己的幂等去重，
      // 不是本地isDone，见该函数定义处注释）。fire-and-forget，不阻塞
      // 岛屿保存这条主流程。
      if (typeof Tasks !== 'undefined' && typeof Tasks.completeIgnoringLocalState === 'function') {
        Tasks.completeIgnoringLocalState('first_island', payload.baziData);
      }
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
