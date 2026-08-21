/**
 * 司马八字 · 灵气兑换商品 products.js
 *
 * 第四阶段"五行经营机制"四层付费结构的③④两层：③花灵气兑换实体水晶（纯
 * 展示+外链发货，不做app内真实收款）；④花灵气"请神仙/设炉灶"（纯虚拟购买，
 * 不含实体商品，不走WhatsApp外链履约）。两者由 `kind` 字段区分履约路径，
 * `redeem()` 内部据此分支到 `_redeemCrystal()`/`_redeemShrine()`。
 *
 * 第三阶段"五行维护系统"：兑换挂靠对象从旧trait系统（{kind,idx}——命盘特点的
 * 优势/注意事项）改为五行维护问题（{wx,direction}——五行元素+调理方向
 * 'nourish'|'restrain'）。
 *
 * 第四阶段"五行经营机制"（本次改造）：兑换成功后不再调用
 * `UserState.resolveWuxingIssue()`（第三阶段"兑换=永久resolve、热点翻牌消失"
 * 二元语义，本轮起停用不再调用，函数/旧key原样保留供早期用户数据兼容）——
 * 改为调用 `WuxingMaintenance.setOwnership()`（3档tier+可持续衰减的新数据
 * 模型，见 js/wuxing-maintenance.js 文件头注释）。
 *
 * 依赖：
 *   AuthManager（js/auth.js）        — 登录态判断 + redeemWuxingProduct()
 *     原子兑换RPC（服务端权威扣款+记录归属，2026-08-21第四轮重构取代原来
 *     "spendSpirit()扣钱 + createRedemptionRequest()建记录"两步分开调用）
 *   UserState（js/user-state.js）    — 灵气本地展示同步（setSpiritLocalOnly）
 *   WuxingMaintenance（js/wuxing-maintenance.js） — setOwnership()（本地状态写入，
 *     云端归属已由 redeemWuxingProduct() 原子完成）
 *   IslandDecorations.add(decorId, baziData)（js/island-decorations.js，frontend-3d 领域）
 *   WuxingScene.reflectTier(wx,direction,tier) / markShrined(wx,direction)（js/wuxing-scene.js，frontend-3d 领域）
 *   App.getCurrentIslandId()（js/main-new.js）
 *   CONFIG.ISLAND_API_BASE（js/config.js）
 */
const Products = (() => {

  // redemption_requests.trait_index 是 INTEGER 列（历史上存旧trait系统的
  // 0-2 数组下标），无法直接存 wx 这个中文字符串。五行本身是固定5个值，
  // 用这份跟 bazi-engine.js 全文件一致的顺序（见该文件247行`for (const wx of
  // ['木','火','土','金','水'])`）把 wx 映射成 0-4 整数复用同一列，而不是
  // 改数据库结构——trait_kind 列同理复用来存 direction（'nourish'/'restrain'，
  // 跟旧值'strength'/'caution'同样是字符串，列类型天然兼容，不需要迁移）。
  //
  // 2026-08-21 灵气服务端权威记账重构第四轮：这份映射目前在本文件内没有
  // 任何调用点——_redeemCrystal() 不再自己往 redemption_requests 表写行
  // （AuthManager.createRedemptionRequest() 已被 AuthManager.
  // redeemWuxingProduct() 原子RPC取代，wx 到 trait_index 的映射改由服务端
  // 内部完成，RPC 的 p_wx 参数直接接受 '木'/'火'等中文字符串）。这里保留
  // 这份代码而不是删除，是因为 AuthManager.createRedemptionRequest() 函数
  // 本身还没有被删除（本轮改造未涉及、不确定是否有历史数据/未来功能仍需要
  // 它），留着这份映射工具函数以防万一，如果确认 createRedemptionRequest()
  // 也彻底没有调用点了，可以两者一起清理。
  const WX_ORDER = ['木', '火', '土', '金', '水'];
  function _wxToIndex(wx) {
    const i = WX_ORDER.indexOf(wx);
    return i === -1 ? null : i;
  }

  // kind:'crystal' 是本轮新增字段（4款水晶原有商品补上，不影响现有行为——
  // redeem() 里 `product.kind || 'crystal'` 兜底，任何未来未标kind的旧款
  // 同样按crystal实体履约路径处理，向后兼容）。
  // shrine_generic 定价800-1200区间内取1000——明显高于单个水晶（200-500），
  // 呼应"价格歧视阶梯顶层"的设计意图（js/wuxing-maintenance.js 文件头/方案
  // 文档"四层结构"表格）。
  const PRODUCT_DEFS = [
    { id: 'bracelet_rose',     decorId: 'crystal_rose',     kind: 'crystal', name: { zh: '粉水晶手链', en: 'Rose Quartz Bracelet' },     spiritCost: 200 },
    { id: 'bracelet_obsidian', decorId: 'crystal_obsidian', kind: 'crystal', name: { zh: '黑曜石手链', en: 'Obsidian Bracelet' },         spiritCost: 250 },
    { id: 'pillar_amethyst',   decorId: 'crystal_amethyst', kind: 'crystal', name: { zh: '紫水晶柱',   en: 'Amethyst Pillar' },           spiritCost: 350 },
    { id: 'basin_clear',       decorId: 'crystal_water',    kind: 'crystal', name: { zh: '白水晶盆',   en: 'Clear Quartz Basin' },         spiritCost: 500 },
    // decorId 故意为 null——跟上面4款crystal不同，shrine没有一个静态、
    // 兑换哪个wx/direction都一样的3D装饰位可以指向。真实要挂载的3D造型是
    // 按 wx/direction 动态生成的 `wxmaint_shrine_{wx}_{direction}`（frontend-3d
    // 领域，island-decorations.js::DECOR_DEFS），跟这份静态PRODUCT_DEFS表里
    // 写死一个decorId的语义对不上——product本身不知道用户是为哪个五行问题
    // 购买的，那个信息只在 redeem() 调用时的 {wx,direction} 参数里，不在
    // product定义本身。2026-08-16 qa-reviewer PLAUSIBLE修复：这里此前写的是
    // 已经不存在的旧key 'wxmaint_shrine'（frontend-3d这轮把DECOR_DEFS里的
    // shrine改成了per-issue命名），当前没有实际功能影响（_redeemShrine()
    // 从不读这个字段，3D装饰完全由 WuxingScene.markShrined() 内部按wx/
    // direction自己算出正确的decorId），但留着一个悬空引用会误导未来的人
    // ——若照抄crystal分支"IslandDecorations.add(product.decorId,...)"的写法
    // 给shrine也补一句，会被 IslandDecorations.add() 的 `if(!def) return`
    // 静默吞掉，且线索只有一个查无此key的字符串，很难排查。
    { id: 'shrine_generic',    decorId: null,               kind: 'shrine',  name: { zh: '请神仙镇宅', en: 'Enshrine a Guardian Spirit' }, spiritCost: 1000 },
  ];

  function getProducts() { return PRODUCT_DEFS; }

  // ── i18n 辅助：Lang.t() 本身不支持占位符插值，这里补一层简单替换 ──────
  function _t(key, vars) {
    let s = (typeof Lang !== 'undefined') ? Lang.t(key) : key;
    if (vars) {
      Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    }
    return s;
  }
  function _isZh() { return (typeof Lang === 'undefined') || Lang.getLang() === 'zh'; }

  // ── 轻量提示条（复用 js/tasks.js::_showToast 的视觉样式与交互模式，不用
  //    浏览器原生 alert()）────────────────────────────────────────────
  function _toast(msg, isError) {
    const existing = document.getElementById('product-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'product-toast';
    toast.style.cssText = `
      position:fixed;top:80px;left:50%;transform:translateX(-50%) translateY(-20px);
      background:rgba(8,8,20,.95);
      border:1px solid ${isError ? 'rgba(235,87,87,.5)' : 'rgba(201,169,110,.4)'};
      border-radius:12px;padding:12px 20px;z-index:400;
      display:flex;align-items:center;gap:10px;max-width:320px;
      box-shadow:0 8px 32px rgba(0,0,0,.4);
      opacity:0;transition:all .3s ease;
      font-size:12px;line-height:1.5;color:${isError ? '#ff8a8a' : '#e8e0d0'};
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
    }, 3600);
  }

  // ── 兑换 ──────────────────────────────────────────────────────────
  // redeem(productId, {wx, direction, summary, baziData}) → Promise<boolean>
  // wx: '木'|'火'|'土'|'金'|'水'；direction: 'nourish'（喜用神，需要"补/灌溉"）
  // |'restrain'（忌神，需要"克/除草"）；summary 是该五行问题的AI叙事标题
  // （WuxingScene 点击装饰时闭包携带的 issue.title），供业务方在
  // redemption_requests.trait_summary 一眼看懂"为哪条问题兑换的"（仅③水晶
  // 分支会用到，④神龛纯虚拟购买不写这张表）。
  //
  // 按 kind 分支到两条完全不同的履约路径（见 _redeemCrystal()/_redeemShrine()
  // 定义处注释），公共的前置校验（商品是否存在、wx/direction合法性、登录态）
  // 在这里统一做一次，避免两个分支各自重复。
  async function redeem(productId, { wx, direction, summary, baziData } = {}) {
    const product = PRODUCT_DEFS.find(p => p.id === productId);
    if (!product) return false;

    if (!wx || (direction !== 'nourish' && direction !== 'restrain')) {
      console.error('[Products] 无效的wx/direction:', wx, direction);
      _toast(_t('products.fail'), true);
      return false;
    }

    // 未登录：两条履约路径都要求登录——③涉及线下联系用户发货必须留存联系
    // 方式，④虽然纯虚拟但价值明显高于单个水晶（1000灵气），不登录清缓存
    // 即彻底丢失，同样不允许匿名购买。
    if (typeof AuthManager === 'undefined' || !AuthManager.isLoggedIn()) {
      _toast(_t('products.need_login'), true);
      if (typeof AuthUI !== 'undefined' && typeof AuthUI.showLogin === 'function') {
        AuthUI.showLogin();
      }
      return false;
    }

    // 未标kind的旧款（理论上不会再出现，PRODUCT_DEFS当前全部已标注，这里是
    // 面向未来新增商品条目忘记标kind时的向后兼容兜底）按crystal实体履约路径
    // 处理——那是历史上唯一存在过的兑换路径，是更安全的默认值。
    const kind = product.kind || 'crystal';
    if (kind === 'shrine') {
      return _redeemShrine(product, { wx, direction, baziData });
    }
    return _redeemCrystal(product, { wx, direction, summary, baziData });
  }

  // ── ③ 水晶兑换：实体商品，走现有 redemption_requests + WhatsApp 外链履约 ──
  // 兑换成功后不再"永久resolve"该五行问题（第三阶段旧语义）——第四阶段起
  // 水晶态仍会衰减，只是衰减周期从2-3天拉长到6天（WuxingMaintenance.
  // setOwnership() 内部持久化 ownershipTier:'crystal'，_computeTier() 懒计算
  // 时会读到这个字段自动改用6天节奏），且维护动作换皮成"消磁"（拖拽交互本身
  // 由 js/wuxing-drag.js 负责，本文件不涉及）。
  //
  // 2026-08-21 灵气服务端权威记账重构第四轮：整段"扣灵气→建redemption_
  // requests→通知业务方→本地解锁装饰→setOwnership→3D视觉刷新"里，"扣灵气"
  // 与"建redemption_requests"两步合并成一次 AuthManager.redeemWuxingProduct()
  // 原子RPC调用（服务端同一事务内完成，价格由服务端商品表决定，不再信任
  // 客户端传的 product.spiritCost/product.name——这两个字段仅用于本地价格
  // 展示，不再参与真正扣款）。原来"写库失败退灵气"这个兜底分支不再需要——
  // 原子RPC要么整体成功要么整体失败，不存在"扣了钱但没建成记录"这种中间态。
  async function _redeemCrystal(product, { wx, direction, summary, baziData }) {
    const islandId = (typeof App !== 'undefined' && typeof App.getCurrentIslandId === 'function')
      ? App.getCurrentIslandId() : null;

    // island_id 为 null 时唯一索引 (user_id, island_id, trait_kind, trait_index)
    // 在 PostgreSQL 里形同虚设（B-tree 唯一索引里 NULL 互不相等），同一用户同一条
    // 注意事项可以被无限次重复兑换。必须在真正扣灵气/写库之前拦截，不能静默继续——
    // 也顺带避免"没有岛屿归属的兑换记录，业务方无法定位是给谁发货"的数据质量问题。
    if (!islandId) {
      _toast(_t('products.need_island'), true);
      return false;
    }

    if (typeof AuthManager === 'undefined' || !AuthManager.isLoggedIn || !AuthManager.isLoggedIn()) {
      // 正常调用路径下不会走到这里——redeem() 上层已经做过登录态前置校验，
      // 这里是防御性兜底，跟随既有代码风格。
      _toast(_t('products.need_login'), true);
      return false;
    }

    // baseTier：五行问题创建时按severity算出、不再变化的命理静态属性，供
    // 服务端 redeem_wuxing_product() RPC 正确初始化/记录 wuxing_maintenance_
    // state 行。不传severity——此刻这条issue必然已经在渲染面板时被
    // WuxingMaintenance.getState() 命中创建过record，这里只是读取已持久化
    // 的baseTier，不需要（也没有）severity可传，同 setOwnership() 定义处
    // 同款既有取舍。
    const baseTier = (typeof WuxingMaintenance !== 'undefined' && typeof WuxingMaintenance.getState === 'function')
      ? (WuxingMaintenance.getState(baziData, wx, direction).baseTier || 1) : 1;

    const redeemResult = await AuthManager.redeemWuxingProduct({
      productId: product.id, baziKey: (typeof UserState !== 'undefined' && typeof UserState.baziKey === 'function') ? UserState.baziKey(baziData) : null,
      wx, direction, baseTier, islandId, traitSummary: summary,
    });
    if (redeemResult.error) {
      // 服务端 RAISE EXCEPTION 目前只有两种可能消息：'灵气不足'（正常业务
      // 场景，映射到既有的余额不足提示）与'未知商品'/'无效的wx'（理论上不
      // 该在正常UI流程发生——PRODUCT_DEFS与服务端商品表约定同步一致，见
      // 文件头注释——按字符串包含匹配来判断具体是哪一种，避免把"未知商品"
      // 这种真正的配置不一致错误误报成"余额不足"，误导用户以为多凑点灵气
      // 就能解决）。
      if (String(redeemResult.error).includes('灵气不足')) {
        const cur   = (typeof UserState !== 'undefined') ? UserState.getSpirit() : 0;
        const short = Math.max(product.spiritCost - cur, 0);
        _toast(_t('products.insufficient', { n: short }), true);
      } else {
        console.error('[Products] redeemWuxingProduct失败:', redeemResult.error);
        _toast(_t('products.fail'), true);
      }
      return false;
    }
    if (typeof UserState !== 'undefined' && redeemResult.data) {
      UserState.setSpiritLocalOnly(redeemResult.data.new_balance);
    }

    const productName = _isZh() ? product.name.zh : product.name.en;

    // fire-and-forget 通知业务方，失败不影响用户侧兑换成功的判定。
    // contact_phone 不再从 createRedemptionRequest() 的返回值里取（那个函数
    // 已被 redeemWuxingProduct() 取代，RPC 只返回 {new_balance, redemption_id}
    // 不含联系方式）——这一步不涉及灵气/安全，为了拿手机号单独查一次
    // getProfile()，比为了这一个非安全关键的通知步骤改RPC返回值形状更简单。
    const apiBase = (typeof CONFIG !== 'undefined' && CONFIG.ISLAND_API_BASE) || 'https://simabazi-island.onrender.com';
    const userEmail = (typeof AuthManager !== 'undefined' && typeof AuthManager.currentUser === 'function')
      ? (AuthManager.currentUser()?.email || null) : null;
    AuthManager.getProfile().then(profile => {
      const contactPhone = ((profile?.phone_code || '') + (profile?.phone || '')).trim() || '';
      fetch(apiBase + '/notify-redemption', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name:  productName,
          trait_summary: summary,
          // 后端 NotifyRedemptionRequest 把这些字段声明为 str = ''——默认值只在
          // 字段缺失时生效，显式传 null 会触发 pydantic 校验失败返回422，
          // 静默被下面的 .catch(()=>{}) 吞掉，业务方收不到通知邮件。兜底成空串。
          contact_phone: contactPhone,
          user_email:    userEmail || '',
        }),
      }).catch(() => {});
    }).catch(() => {});

    // 装饰持久化解锁（js/user-state.js）：必须先于 IslandDecorations.add() 调用——
    // add() 只是"往当前3D场景摆一个物件"，不持久化；只有写进 UserState 的已解锁
    // 装饰列表，才能在 IslandDecorations.restoreAll()（换岛屿/刷新页面时触发）
    // 里被重新摆放出来，否则兑换到手的水晶刷新即永久消失。
    if (typeof UserState !== 'undefined' && typeof UserState.unlockDecoration === 'function') {
      UserState.unlockDecoration(product.decorId);
    }
    // 3D 岛屿装饰：摆水晶奖励装饰（这是独立的"战利品"展示位，跟下面
    // wxmaint_ 问题态装饰是两套不同的3D物件，见 island-decorations.js
    // DECOR_DEFS 里 crystal_* 与 wxmaint_* 两组条目）。
    if (typeof IslandDecorations !== 'undefined' && typeof IslandDecorations.add === 'function' && baziData) {
      IslandDecorations.add(product.decorId, baziData);
    }

    // 第四阶段核心改造：不再调用 WuxingScene.markResolved(wx,direction)——
    // 那个函数的设计意图是"翻牌+彻底删除热点"，继续调用会把仍然存活的issue
    // 热点错误地永久删除（该issue以后还是会衰减，热点不该消失）。改为：
    //   1) WuxingMaintenance.setOwnership() 持久化 ownershipTier:'crystal'
    //      到本地（云端归属已经由上面 redeemWuxingProduct() 原子写完，这个
    //      函数现在只做本地状态写入，见该函数定义处2026-08-21第四轮改造
    //      说明），往后 getState()/computeTier() 懒计算会自动改用6天衰减周期；
    //   2) WuxingScene.reflectTier(wx,direction,1) 立即把3D视觉切到档位1
    //      （良好态占位/发光），呼应用户刚花灵气买水晶那一刻应有的即时反馈。
    if (typeof WuxingMaintenance !== 'undefined' && typeof WuxingMaintenance.setOwnership === 'function' && baziData) {
      await WuxingMaintenance.setOwnership(baziData, wx, direction, 'crystal', product.id);
    }
    if (typeof WuxingScene !== 'undefined' && typeof WuxingScene.reflectTier === 'function') {
      WuxingScene.reflectTier(wx, direction, 1);
    }

    _toast(_t('products.success'), false);
    return true;
  }

  // ── ④ 请神仙/设炉灶：纯虚拟购买，跳过实体履约整段 ─────────────────────
  // 不写 redemption_requests、不 fire-and-forget 调用 /notify-redemption——
  // 这条商品不含任何需要业务方线下安排发货的实体物件，没有"通知业务方"的
  // 必要，也就不需要 redemption_requests 那张表里为它留一条记录（那张表的
  // 存在意义是"业务方要看到、要发货"，纯虚拟购买不满足这个前提）。
  // 成功后永久锁定该issue在档位1、彻底退出衰减循环（WuxingMaintenance.
  // setOwnership(...,'shrine',...) → _computeTier() 顶部直接 `if
  // (ownershipTier==='shrine') return 1`，不再进入衰减while循环）。
  async function _redeemShrine(product, { wx, direction, baziData }) {
    // 2026-08-21 灵气服务端权威记账重构第四轮：同 _redeemCrystal()，改为
    // 一次原子 AuthManager.redeemWuxingProduct() 调用（服务端商品表判定这是
    // shrine类型，同一事务内只扣款、不插入 redemption_requests，见该函数
    // 定义处注释）。正常调用路径下必然已登录（redeem() 上层已做前置校验），
    // 这里的 typeof/isLoggedIn 判断只是防御性兜底。
    if (typeof AuthManager === 'undefined' || !AuthManager.isLoggedIn || !AuthManager.isLoggedIn()) {
      _toast(_t('products.need_login'), true);
      return false;
    }

    const baseTier = (typeof WuxingMaintenance !== 'undefined' && typeof WuxingMaintenance.getState === 'function')
      ? (WuxingMaintenance.getState(baziData, wx, direction).baseTier || 1) : 1;
    const islandId = (typeof App !== 'undefined' && typeof App.getCurrentIslandId === 'function')
      ? App.getCurrentIslandId() : null;

    const redeemResult = await AuthManager.redeemWuxingProduct({
      productId: product.id, baziKey: (typeof UserState !== 'undefined' && typeof UserState.baziKey === 'function') ? UserState.baziKey(baziData) : null,
      wx, direction, baseTier, islandId, traitSummary: null, // 纯虚拟购买，不写redemption_requests，不需要trait摘要
    });
    if (redeemResult.error) {
      // 同 _redeemCrystal()：只有真正的"灵气不足"才映射到余额不足提示，
      // 其它（理论上不该发生的）服务端校验失败走通用失败提示，见该处注释。
      if (String(redeemResult.error).includes('灵气不足')) {
        const cur   = (typeof UserState !== 'undefined') ? UserState.getSpirit() : 0;
        const short = Math.max(product.spiritCost - cur, 0);
        _toast(_t('products.insufficient', { n: short }), true);
      } else {
        console.error('[Products] redeemWuxingProduct失败:', redeemResult.error);
        _toast(_t('products.fail'), true);
      }
      return false;
    }
    if (typeof UserState !== 'undefined' && redeemResult.data) {
      UserState.setSpiritLocalOnly(redeemResult.data.new_balance);
    }

    // 云端归属已由上面的原子RPC写完，这里只做本地状态写入（见
    // WuxingMaintenance.setOwnership() 定义处2026-08-21第四轮改造说明）。
    if (typeof WuxingMaintenance !== 'undefined' && typeof WuxingMaintenance.setOwnership === 'function' && baziData) {
      await WuxingMaintenance.setOwnership(baziData, wx, direction, 'shrine', product.id);
    }
    // markShrined()（跟 reflectTier() 不同）——不删除热点DOM，永久保留可点击
    // 查看"已巩固"叙事，只把该issue的3D装饰换成"已巩固"造型。真实decorId不
    // 是 product.decorId（本商品这个字段故意是null，见 PRODUCT_DEFS 定义处
    // 注释）——WuxingScene.markShrined() 内部按传入的 wx/direction 自己算出
    // 对应的 `wxmaint_shrine_{wx}_{direction}` decorId 并调用
    // IslandDecorations 完成替换，这里不需要（也不应该）另外调用
    // IslandDecorations.add()——那是给 crystal_* 这类独立"战利品"展示位用的，
    // 跟 wxmaint_ 系列问题态/已巩固态装饰不是同一条管理路径。

    if (typeof WuxingScene !== 'undefined' && typeof WuxingScene.markShrined === 'function') {
      WuxingScene.markShrined(wx, direction);
    }

    _toast(_t('products.success_shrine'), false);
    return true;
  }

  return { getProducts, redeem };
})();
