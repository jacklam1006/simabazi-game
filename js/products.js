/**
 * 司马八字 · 灵气兑换水晶商品 products.js
 *
 * 纯展示 + 外链发货（不做app内真实收款）：用户在详情面板（bazi-pipeline 领域
 * 实现的兑换UI）用"灵气"兑换实体水晶商品，兑换请求写入 Supabase
 * `redemption_requests` 表（backend-service 领域建表），由业务方通过
 * WhatsApp 联系用户线下安排发货。
 *
 * 第三阶段"五行维护系统"：兑换挂靠对象从旧trait系统（{kind,idx}——命盘特点的
 * 优势/注意事项）改为新的五行维护问题（{wx,direction}——五行元素+调理方向
 * 'nourish'|'restrain'）。`redeem()`签名、`UserState.resolveTrait()`调用、
 * `AuthManager.createRedemptionRequest()`调用都随之改成 wx/direction 语义。
 *
 * 依赖：
 *   AuthManager（js/auth.js）  — 登录态判断 + 创建兑换请求
 *   UserState（js/user-state.js） — 灵气值增减 + baziKey + resolveWuxingIssue
 *   IslandDecorations.add(decorId, baziData)（js/island-decorations.js，frontend-3d 领域）
 *   WuxingScene.markResolved(wx, direction)（js/wuxing-scene.js，frontend-3d 领域）
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
  const WX_ORDER = ['木', '火', '土', '金', '水'];
  function _wxToIndex(wx) {
    const i = WX_ORDER.indexOf(wx);
    return i === -1 ? null : i;
  }

  const PRODUCT_DEFS = [
    { id: 'bracelet_rose',     decorId: 'crystal_rose',     name: { zh: '粉水晶手链', en: 'Rose Quartz Bracelet' }, spiritCost: 200 },
    { id: 'bracelet_obsidian', decorId: 'crystal_obsidian', name: { zh: '黑曜石手链', en: 'Obsidian Bracelet' },     spiritCost: 250 },
    { id: 'pillar_amethyst',   decorId: 'crystal_amethyst', name: { zh: '紫水晶柱',   en: 'Amethyst Pillar' },       spiritCost: 350 },
    { id: 'basin_clear',       decorId: 'crystal_water',    name: { zh: '白水晶盆',   en: 'Clear Quartz Basin' },     spiritCost: 500 },
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
  // redemption_requests.trait_summary 一眼看懂"为哪条问题兑换的"。
  async function redeem(productId, { wx, direction, summary, baziData } = {}) {
    const product = PRODUCT_DEFS.find(p => p.id === productId);
    if (!product) return false;

    // wx 必须能映射到 redemption_requests.trait_index（INTEGER列）能接受的
    // 0-4 整数——提前校验、失败即中止，不能等到扣完灵气/写库失败才发现，
    // 那样会退灵气但用户体验很差（见下方 record 为空时的退灵气兜底同理）。
    const wxIndex = _wxToIndex(wx);
    if (wxIndex === null || (direction !== 'nourish' && direction !== 'restrain')) {
      console.error('[Products] 无效的wx/direction:', wx, direction);
      _toast(_t('products.fail'), true);
      return false;
    }

    // 未登录：引导登录（兑换涉及线下联系用户发货，必须先有账号留存联系方式）
    if (typeof AuthManager === 'undefined' || !AuthManager.isLoggedIn()) {
      _toast(_t('products.need_login'), true);
      if (typeof AuthUI !== 'undefined' && typeof AuthUI.showLogin === 'function') {
        AuthUI.showLogin();
      }
      return false;
    }

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

    if (typeof UserState === 'undefined' || !UserState.useSpirit(product.spiritCost)) {
      const cur   = (typeof UserState !== 'undefined') ? UserState.getSpirit() : 0;
      const short = Math.max(product.spiritCost - cur, 0);
      _toast(_t('products.insufficient', { n: short }), true);
      return false;
    }

    const productName = _isZh() ? product.name.zh : product.name.en;

    let record = null;
    try {
      record = await AuthManager.createRedemptionRequest({
        productId:   product.id,
        productName: product.name.zh, // 数据库记录统一存中文名，方便业务方线下处理
        spiritCost:  product.spiritCost,
        islandId,
        // trait_kind/trait_index 两列（表结构不变）现在存五行维护系统的语义：
        // trait_kind 存 direction 字符串（'nourish'/'restrain'，跟旧值
        // 'strength'/'caution'一样是TEXT列，天然兼容）；trait_index 存 wx
        // 映射出的0-4整数（见上方 WX_ORDER/_wxToIndex 定义处注释，INTEGER列
        // 存不了'木'这种字符串，所以先映射成固定顺序下标）。
        kind: direction, idx: wxIndex, summary,
      });
    } catch (e) {
      console.error('[Products] 创建兑换请求异常:', e);
    }

    if (!record) {
      // 写入失败：不能让用户"扣了灵气但没有真实兑换记录"，把已扣的灵气退回去
      UserState.addSpirit(product.spiritCost);
      _toast(_t('products.fail'), true);
      return false;
    }

    // fire-and-forget 通知业务方，失败不影响用户侧兑换成功的判定
    const apiBase = (typeof CONFIG !== 'undefined' && CONFIG.ISLAND_API_BASE) || 'https://simabazi-island.onrender.com';
    const userEmail = (typeof AuthManager !== 'undefined' && typeof AuthManager.currentUser === 'function')
      ? (AuthManager.currentUser()?.email || null) : null;
    fetch(apiBase + '/notify-redemption', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_name:  productName,
        trait_summary: summary,
        // 后端 NotifyRedemptionRequest 把这些字段声明为 str = ''——默认值只在
        // 字段缺失时生效，显式传 null 会触发 pydantic 校验失败返回422，
        // 静默被下面的 .catch(()=>{}) 吞掉，业务方收不到通知邮件。兜底成空串。
        contact_phone: record.contact_phone || '',
        user_email:    userEmail || '',
      }),
    }).catch(() => {});

    // 本地标记该命盘的这个五行维护问题已兑换改善
    if (typeof UserState !== 'undefined' && baziData) {
      const bKey = UserState.baziKey(baziData);
      UserState.resolveWuxingIssue(bKey, wx, direction, product.id);
    }

    // 装饰持久化解锁（js/user-state.js）：必须先于 IslandDecorations.add() 调用——
    // add() 只是"往当前3D场景摆一个物件"，不持久化；只有写进 UserState 的已解锁
    // 装饰列表，才能在 IslandDecorations.restoreAll()（换岛屿/刷新页面时触发）
    // 里被重新摆放出来，否则兑换到手的水晶刷新即永久消失（且因 resolveWuxingIssue
    // 已标记"已改善"、唯一索引挡住重复兑换，用户将无法再次拿回这个装饰）。
    if (typeof UserState !== 'undefined' && typeof UserState.unlockDecoration === 'function') {
      UserState.unlockDecoration(product.decorId);
    }
    // 3D 岛屿装饰 + 五行问题标注状态更新（frontend-3d 领域实现，按约定签名
    // 调用）：先摆水晶奖励装饰，再把该五行问题的"问题态"3D装饰切到"良好态"。
    if (typeof IslandDecorations !== 'undefined' && typeof IslandDecorations.add === 'function' && baziData) {
      IslandDecorations.add(product.decorId, baziData);
    }
    // WuxingScene.markResolved(wx, direction)：取代旧 IslandAnnotate.
    // markTraitResolved(kind, idx) 调用点，语义从"trait标签⚠️→✅翻牌"改为
    // "移除该五行问题的3D占位装饰、切换成良好态"（frontend-3d 领域并行实现，
    // 本次未改动 js/wuxing-scene.js 本身，这里只是按第三阶段计划文档约定的
    // 命名调用——若最终导出的函数名不同，需要 qa-reviewer 复查时核实调用点
    // 是否对齐，typeof 防御保证对方尚未实现时不会报错）。
    if (typeof WuxingScene !== 'undefined' && typeof WuxingScene.markResolved === 'function') {
      WuxingScene.markResolved(wx, direction);
    }

    _toast(_t('products.success'), false);
    return true;
  }

  return { getProducts, redeem };
})();
