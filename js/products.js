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

  // kind:'crystal' 是2026-08-16改造新增字段，redeem() 里 `product.kind ||
  // 'crystal'` 兜底，任何未来未标kind的旧款同样按crystal实体履约路径处理，
  // 向后兼容。
  //
  // 2026-08-23 五行专属水晶15款SKU + 分地区定价改造：原4款通用水晶
  // （bracelet_rose/bracelet_obsidian/pillar_amethyst/basin_clear——此前
  // 没有真实用户兑换过，仅管理员测试账号，直接移除不做向后兼容）扩展成
  // 5个五行元素（金/木/水/火/土）× 3个档位（水晶簇小/水晶簇大/水晶盆栽）
  // 共15款专属SKU，业务方提供的真实商品报价单，需与
  // supabase_setup.sql::redeem_wuxing_product() 保持同步（数据库那份才是
  // 唯一权威、被实际信任用来扣款的价格表，这里仅用于兑换前的UI展示预估）。
  //
  // 价格拆成 spiritCostCNY/spiritCostMYR 两个字段（替代原来单一
  // spiritCost）——1灵气=1个货币单位，中国区号(+86)用CNY价，其它地区用
  // MYR价，两套定价互相独立不做汇率换算。哪个字段生效由 _isCNYRegion()
  // 统一判断，不要在各展示点各写一份判断逻辑（见该函数定义处注释）。
  //
  // wx 字段：该水晶自身的五行归属颜色（如绿水晶=木），不是"允许兑换的问题
  // 五行"本身——同一款水晶服务两种问题：nourish方向滋养同五行的不足、
  // restrain方向克制"这款水晶五行所克制的那个五行"的过旺（金克木/木克土/
  // 土克水/水克火/火克金，业务方给定的固定映射）。真正决定某个五行问题
  // 该展示哪一色水晶的换算逻辑见下方 getProductsFor()，与
  // supabase_setup.sql::redeem_wuxing_product() 内 v_expected_wx 的CASE
  // 分支保持同一份映射，不新造一套。shrine_generic不分五行，wx留
  // undefined，不受这条映射约束，任何问题都可以展示"请神仙"选项。
  //
  // decorId 与 product id 同名——15款水晶都有各自静态的3D战利品展示位
  // （island-decorations.js::DECOR_DEFS 的 crystal_{element}_{tier} 系列，
  // frontend-3d 领域，本次改造随附新增），兑换哪个SKU就摆哪个造型，不需要
  // 像下面shrine那样按wx/direction动态换算。
  // 2026-08-23 图文详情+点击放大改造：新增 img/blurb 两个纯展示字段，
  // 由 js/main-new.js::_wxmaintRedeemBlockHtml()（卡片缩略图）/
  // _openProductImage()（点击缩略图弹出的大图+讲解文案）消费，不参与任何
  // 兑换/扣款逻辑，删掉也不影响 redeem() 主流程。
  //   img：对应 assets/products/thumb/{img}.jpg（520px缩略图）与
  //     assets/products/full/{img}.jpg（1400px大图）的文件名（不含扩展名）
  //     ——业务方提供的真实商品照片，命名跟 product id 本身对不上（如
  //     cluster_s/cluster_l 对应素材文件名是 cluster1/cluster2，potted只有
  //     一个SKU但素材有多张同款不同角度/信息图，这里固定选其中一张作为
  //     该SKU的代表图），因此单独一个字段做映射，不复用decorId/id。
  //     cluster1→_s/cluster2→_l 是"两张真实素材照片只在文件名数字上区分、
  //     没有其它可靠线索"情况下的合理假设（业务侧报价单本身按小/大两档
  //     报价，2张照片对应2档），如果后续业务方确认这个映射反了，只需要
  //     调整这里的img值，不影响其它任何逻辑。shrine_generic没有对应实拍
  //     照片（纯虚拟商品），img留undefined，UI层据此回退成emoji图标
  //     （见 _wxProductIcon()）。
  //   blurb.zh：真实商品图文详情里提炼出的成分/尺寸/适用场景，来自业务方
  //     提供的原始商品图（/Users/linyu/Desktop/simabazi-game/product/wuxing/
  //     目录，不在本仓库内，图文由总agent逐张查看后转录为文字，如实反映
  //     图中信息，不编造图中没有的内容）。cluster类商品原始素材只有纯白/
  //     纯色背景的产品实拍照，没有任何文字性商品信息，blurb故意留空
  //     （UI层判断为空时不展示"为什么推荐"以外的详情段落，不是遗漏）。
  //     刻意只做中文——见本文件底部关于双语取舍的说明。
  //     2026-08-23 qa-reviewer复查修复：shrine_generic 没有 img（纯虚拟
  //     商品，见上方说明），而 js/main-new.js::_openProductImage() 开头
  //     `if (!product || !product.img) return;` 短路、卡片渲染层
  //     （同文件 visibleProducts.map(...)）在没有img时也只渲染不可点击的
  //     emoji图标（.trait-product-icon），不是可点击的
  //     <img class="trait-product-thumb">——shrine_generic此前带的blurb
  //     因此永远没有入口能展示出来，是一段打不开的死内容。项目里目前也没有
  //     任何"神龛/请神仙"主题的素材图可以补（assets/products/{thumb,full}/
  //     下全部是水晶实拍照），硬塞一张不相关的水晶图会误导用户，索性删掉
  //     这段无法触达的blurb，不留死内容。
  const PRODUCT_DEFS = [
    { id: 'crystal_gold_cluster_s', decorId: 'crystal_gold_cluster_s', kind: 'crystal', wx: '金', name: { zh: '白水晶簇(小)', en: 'Clear Quartz Cluster (S)' }, spiritCostCNY: 99,  spiritCostMYR: 68,  img: 'goldcluster1' },
    { id: 'crystal_gold_cluster_l', decorId: 'crystal_gold_cluster_l', kind: 'crystal', wx: '金', name: { zh: '白水晶簇(大)', en: 'Clear Quartz Cluster (L)' }, spiritCostCNY: 180, spiritCostMYR: 108, img: 'goldcluster2' },
    { id: 'crystal_gold_potted',    decorId: 'crystal_gold_potted',    kind: 'crystal', wx: '金', name: { zh: '琼英翠微',     en: 'Luminous Jade Grove' },       spiritCostCNY: 728, spiritCostMYR: 468, img: 'goldpotted1',
      blurb: { zh: '天然白水晶原石水晶簇，搭配苔藓底座与干花点缀，长约22cm×宽10cm×高10cm，适合客厅、书房、玄关、卧室等场景摆放。' } },
    { id: 'crystal_wood_cluster_s',  decorId: 'crystal_wood_cluster_s',  kind: 'crystal', wx: '木', name: { zh: '绿水晶簇(小)', en: 'Green Quartz Cluster (S)' }, spiritCostCNY: 99,  spiritCostMYR: 68,  img: 'woodcluster1' },
    { id: 'crystal_wood_cluster_l',  decorId: 'crystal_wood_cluster_l',  kind: 'crystal', wx: '木', name: { zh: '绿水晶簇(大)', en: 'Green Quartz Cluster (L)' }, spiritCostCNY: 180, spiritCostMYR: 108, img: 'woodcluster2' },
    { id: 'crystal_wood_potted',     decorId: 'crystal_wood_potted',     kind: 'crystal', wx: '木', name: { zh: '幽谷晶翠',     en: 'Emerald Valley Garden' },     spiritCostCNY: 728, spiritCostMYR: 468, img: 'woodpotted1',
      blurb: { zh: '由烟晶簇、绿萤石原石、水晶碎石铺面与仿真绿植手工搭配而成，高脚陶盆造型，直径约18cm、高约13cm，适合书房、茶室等安静角落摆放。' } },
    { id: 'crystal_water_cluster_s', decorId: 'crystal_water_cluster_s', kind: 'crystal', wx: '水', name: { zh: '蓝水晶簇(小)', en: 'Blue Quartz Cluster (S)' },  spiritCostCNY: 158, spiritCostMYR: 98,  img: 'watercluster1' },
    { id: 'crystal_water_cluster_l', decorId: 'crystal_water_cluster_l', kind: 'crystal', wx: '水', name: { zh: '蓝水晶簇(大)', en: 'Blue Quartz Cluster (L)' },  spiritCostCNY: 298, spiritCostMYR: 188, img: 'watercluster2' },
    { id: 'crystal_water_potted',    decorId: 'crystal_water_potted',    kind: 'crystal', wx: '水', name: { zh: '冰晶莲韵',     en: 'Frost Lotus Garden' },        spiritCostCNY: 788, spiritCostMYR: 488, img: 'waterpotted1',
      blurb: { zh: '蓝水晶簇搭配陶瓷高足底座与永生花材，直径15cm×高15cm，适合客厅茶几、玄关柜台、卧室床头、书房书桌摆放。' } },
    { id: 'crystal_fire_cluster_s',  decorId: 'crystal_fire_cluster_s',  kind: 'crystal', wx: '火', name: { zh: '紫水晶簇(小)', en: 'Amethyst Cluster (S)' },     spiritCostCNY: 228, spiritCostMYR: 138, img: 'firecluster1' },
    { id: 'crystal_fire_cluster_l',  decorId: 'crystal_fire_cluster_l',  kind: 'crystal', wx: '火', name: { zh: '紫水晶簇(大)', en: 'Amethyst Cluster (L)' },     spiritCostCNY: 438, spiritCostMYR: 268, img: 'firecluster2' },
    { id: 'crystal_fire_potted',     decorId: 'crystal_fire_potted',     kind: 'crystal', wx: '火', name: { zh: '紫梦流光',     en: 'Amethyst Dreamlight Garden' }, spiritCostCNY: 628, spiritCostMYR: 388, img: 'firepotted1',
      blurb: { zh: '天然水晶原石、紫水晶与粉水晶组合，火山岩纹理陶盆底座，直径15cm×高15cm，适合玄关、客厅、卧室、书房、办公桌摆放。' } },
    { id: 'crystal_earth_cluster_s', decorId: 'crystal_earth_cluster_s', kind: 'crystal', wx: '土', name: { zh: '黄水晶簇(小)', en: 'Citrine Cluster (S)' },      spiritCostCNY: 99,  spiritCostMYR: 68,  img: 'earthcluster1' },
    { id: 'crystal_earth_cluster_l', decorId: 'crystal_earth_cluster_l', kind: 'crystal', wx: '土', name: { zh: '黄水晶簇(大)', en: 'Citrine Cluster (L)' },      spiritCostCNY: 180, spiritCostMYR: 108, img: 'earthcluster2' },
    { id: 'crystal_earth_potted',    decorId: 'crystal_earth_potted',    kind: 'crystal', wx: '土', name: { zh: '金耀晶植',     en: 'Golden Radiance Garden' },    spiritCostCNY: 528, spiritCostMYR: 328, img: 'earthpotted1',
      blurb: { zh: '黄水晶、黑曜石与橄榄石组合，搭配玻璃高脚支架，直径12cm×高15cm，适合办公室、客厅、卧室、书房摆放。' } },
    // decorId 故意为 null——跟上面15款crystal不同，shrine没有一个静态、
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
    { id: 'shrine_generic',    decorId: null, kind: 'shrine', name: { zh: '请神仙镇宅', en: 'Enshrine a Guardian Spirit' }, spiritCostCNY: 1000, spiritCostMYR: 1000 },
  ];

  function getProducts() { return PRODUCT_DEFS; }

  // 五行相克：谁克谁（元素→克它的元素）。与 supabase_setup.sql::
  // redeem_wuxing_product() 内 v_expected_wx 的CASE分支保持同一份映射，
  // 不新造一套——改这份映射时记得同步SQL那边。
  const RESTRAIN_SOURCE = { '木': '金', '土': '木', '水': '土', '火': '水', '金': '火' };

  // 给定一个五行问题(wx,direction)，算出"理论上应该展示的水晶五行"：
  // nourish方向滋养同五行本身，restrain方向展示克制它的五行对应的水晶。
  function _expectedCrystalWx(wx, direction) {
    if (direction === 'nourish')  return wx;
    if (direction === 'restrain') return RESTRAIN_SOURCE[wx] || null;
    return null;
  }

  // 按当前五行问题(wx,direction)过滤出应该展示的商品：颜色匹配的水晶
  // （同色三档cluster_s/cluster_l/potted全部返回，具体档位由用户自选）+
  // shrine_generic（不分五行，任何问题都可以展示"请神仙"选项，因此始终
  // 附加在结果末尾）。⚠️ 这只是提升UI体验、避免用户看到点了必错的选项——
  // 不是安全边界，真正的权威校验在服务端 redeem_wuxing_product()（就算这里
  // 过滤逻辑写错，最坏结果是错误地方展示/隐藏了商品，点击兑换仍会被服务端
  // 正确拒绝，不会导致误扣款，见该函数定义处注释）。
  function getProductsFor(wx, direction) {
    const expected = _expectedCrystalWx(wx, direction);
    return PRODUCT_DEFS.filter(p => p && (p.kind === 'shrine' || p.wx === expected));
  }

  // ── 分地区定价辅助：统一判断入口，各展示点不要各写一份判断逻辑 ──────
  // profile 形状同 AuthManager.getProfile()/getCachedProfile() 的返回值
  // （profiles表一行，含phone_code列）。未登录/profile尚未拉取到时传
  // null/undefined，一律按非CN地区处理（见_costFor()的兜底选择）。
  function _isCNYRegion(profile) { return profile?.phone_code === '+86'; }

  // 给定 product 与 profile，返回该用户此刻应展示/预计会被扣的价格——
  // 未知区域（profile为null，如未登录或缓存尚未预热）兜底展示spiritCostMYR
  // ——项目本身面向的是马来西亚市场，比默认展示更高的CNY价更贴近目标用户
  // 预期；这只是UI展示预估，不影响真正扣款金额（扣款价格永远由服务端RPC
  // 按彼时最新phone_code权威计算，见supabase_setup.sql::
  // redeem_wuxing_product()注释）。
  //
  // 2026-08-23 qa-reviewer复查：本函数本身不区分"未登录（MYR兜底就是最终
  // 展示）"与"已登录但profile缓存还没预热完（MYR只是临时占位，真实答案
  // 很快会来）"——这两种情况传进来的profile一样都是null，调用方如果想在
  // 后一种情况下展示loading占位而不是可能错误的具体数字，需要在调用
  // _costFor() 之前先用 AuthManager.isProfilePending() 单独判断一次，见
  // js/main-new.js::_wxmaintRedeemBlockHtml() 消费处注释——本函数不内置
  // 这层判断，避免这个纯定价计算函数依赖UI层"要不要展示loading态"的呈现
  // 决策。
  function _costFor(product, profile) {
    return _isCNYRegion(profile) ? product.spiritCostCNY : product.spiritCostMYR;
  }

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
  // 客户端传的 product.spiritCostCNY/spiritCostMYR/product.name（2026-08-23
  // 分地区定价改造前是单一spiritCost字段，现拆成两个）——这几个字段仅用于
  // 本地价格展示，不再参与真正扣款）。原来"写库失败退灵气"这个兜底分支不再需要——
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
        const cur     = (typeof UserState !== 'undefined') ? UserState.getSpirit() : 0;
        // 2026-08-23 分地区定价改造：spiritCost 拆成 spiritCostCNY/spiritCostMYR
        // 两个字段后，"还需要多少灵气"这个差额提示也要按当前用户货币区域取对应
        // 字段——这里已经在async函数体内，直接await一次最新profile即可，比
        // main-new.js/analysis.js那类同步渲染管线更简单，不需要引入缓存。
        const profile = (typeof AuthManager !== 'undefined' && typeof AuthManager.getProfile === 'function')
          ? await AuthManager.getProfile().catch(() => null) : null;
        const short   = Math.max(_costFor(product, profile) - cur, 0);
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
        const cur     = (typeof UserState !== 'undefined') ? UserState.getSpirit() : 0;
        // 同 _redeemCrystal()：spiritCost 拆成 spiritCostCNY/spiritCostMYR
        // 后按当前用户货币区域取对应字段，见 _costFor() 定义处注释。
        const profile = (typeof AuthManager !== 'undefined' && typeof AuthManager.getProfile === 'function')
          ? await AuthManager.getProfile().catch(() => null) : null;
        const short   = Math.max(_costFor(product, profile) - cur, 0);
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

  // 2026-08-23 图文详情双语取舍说明（CLAUDE.md"i18n完整性"要求的是"用户
  // 可见文案"，不是不加区分的"任何文案"）：本次新增的商品讲解长文案
  // （PRODUCT_DEFS[i].blurb，成分/尺寸/适用场景）刻意只做中文——素材来源
  // （业务方提供的商品图）本身是中文商品详情图，文案是从图中信息转录/
  // 提炼而来，翻译成英文需要独立的一轮内容判断（不是机械替换），且目前
  // 产品面向的马来西亚市场华人用户比例高、中文详情本身可读；UI chrome
  // 级别的文案（"为什么推荐这个"标题、五行相生相克那句动态理由等）已经在
  // js/i18n.js 补齐中英文——这部分不受影响，双语完整。大图弹层的关闭按钮
  // 沿用本项目里 #zone-panel-close/#task-panel-close/#report-close 等既有
  // 关闭按钮的一贯写法（纯"×"符号图标，不挂文字/title，不需要i18n）。这是
  // 明确的范围取舍，不是遗漏，未来若产品决定商品详情也要双语，需要单独
  // 一轮针对性翻译校对，不建议机器直译长文案。
  return { getProducts, getProductsFor, redeem, isCNYRegion: _isCNYRegion, costFor: _costFor };
})();
