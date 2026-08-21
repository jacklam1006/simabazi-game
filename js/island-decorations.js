/**
 * 司马八字 · 岛屿装饰管理 island-decorations.js
 *
 * 任务/成就解锁后，在基础岛屿上叠加小型3D装饰物件（GLB）。
 * 装饰物件预生成后放在 /assets/decorations/ 目录下。
 *
 * 未来接入真实GLB之前，用Three.js几何体作为占位符（placeholder）。
 */

const IslandDecorations = (() => {

  // ── 装饰定义（id → 配置）─────────────────────────────────
  // 2026-08-01：此前这里的 `pos` 是写死的绝对世界坐标（如 welcome_glow
  // [0,6,0]），是针对某个假想"标准尺寸岛屿"手动调校的，跟 island-annotate.js
  // 修复前的 PILLAR_POSITIONS/SHENSHA_POSITIONS 是同一类问题：TripoAI 针对
  // 不同八字生成的岛屿模型长宽高比例差异很大，写死坐标在比例偏离较大的模型上
  // 会出现装饰物悬空或埋进模型里。
  //
  // 修复：改用 `frac`（相对岛屿真实包围盒的比例，跟 island-annotate.js 的
  // PILLAR_LAYOUT/SHENSHA_LAYOUT 同款格式：x/z ∈ 大致[-1,1]，y ∈ [0,1]表示
  // 包围盒底→顶插值比例，可以略超出[0,1]表示"明显高于/低于模型本体"，
  // hover 表示在地形射线检测命中点之上再叠加的悬浮高度）。实际换算复用
  // island-annotate.js 已经验证过的 getIslandBox()/layoutToWorld()（见该文件
  // 2026-08-01 新增的公开API），不重复实现一份容易失配的复制品。
  //
  // ring 类型（shensha_glow 环绕光环 / island_expand 岛屿扩展光环）的"位置"
  // 含义是"围绕整个岛屿"而不是单点贴地，额外用 radiusFrac 表示光环半径相对
  // 岛屿水平半径的比例，随模型尺寸动态缩放，不再是写死的 5.0/6.0。半径基准用
  // Math.max(hx, hz)（水平最长维度）而不是 (hx+hz)/2（平均值）——footprint
  // 非正方形时（如10×4的长条岛屿）用平均值算出的半径会比较窄的那个维度还窄，
  // 导致"环绕全岛"的光环反而比岛屿本体窄、被埋进模型里看不见（2026-08-01
  // qa-reviewer 用真实模块代码实测复现，见已知问题日志同日期条目）。
  // island_expand 额外标记 noRaycast:true——它的原始设计意图是贴着岛屿"基座"
  // 环绕一圈（原绝对坐标 y=-0.5 接近包围盒底部），如果对它做地形射线检测，
  // 命中的会是光环中心那一列（x=0,z=0）的地形高度，对多峰/不规则模型来说
  // 那一点可能正好是最高的山峰而不是岛屿边缘的基座高度，反而更容易算错；
  // 所以这类"环绕全岛"的光环改用纯包围盒线性插值，不做地形吸附。
  const DECOR_DEFS = {
    // 任务解锁
    welcome_glow    : { frac:{x: 0.00, z: 0.00, y:1.40, hover:2.50}, type:'glow',    color:0xc9a96e, size:0.8, glb:null },
    sprout_plant    : { frac:{x:-0.40, z:-0.40, y:0.40, hover:0.15}, type:'crystal', color:0x6FCF97, size:0.4, glb:'sprout.glb' },
    cherry_blossom  : { frac:{x: 0.40, z: 0.40, y:0.50, hover:0.20}, type:'tree',    color:0xffb7c5, size:1.2, glb:'cherry.glb' },
    moon_shrine     : { frac:{x: 0.00, z:-0.80, y:0.50, hover:0.25}, type:'crystal', color:0xaad4ff, size:1.5, glb:'moon_shrine.glb' },
    share_flower    : { frac:{x: 0.60, z:-0.20, y:0.30, hover:0.15}, type:'crystal', color:0xff9cdf, size:0.5, glb:'flower.glb' },
    shensha_glow    : { frac:{x: 0.00, z: 0.00, y:1.00, hover:1.00}, type:'ring', color:0xc9a96e, size:5.0, radiusFrac:1.0, glb:null },
    island_expand   : { frac:{x: 0.00, z: 0.00, y:0.10, hover:0.00}, type:'ring', color:0x6EB5FF, size:6.0, radiusFrac:1.2, noRaycast:true, glb:null },

    // 水晶商品购买后（预留）
    crystal_water   : { frac:{x:-0.60, z: 0.20, y:0.30, hover:0.15}, type:'crystal', color:0x6EB5FF, size:0.8, glb:'basin_clear.glb' },
    crystal_amethyst: { frac:{x: 0.00, z:-0.60, y:0.30, hover:0.15}, type:'crystal', color:0x9b59b6, size:0.8, glb:'pillar_amethyst.glb' },
    crystal_rose    : { frac:{x: 0.60, z:-0.20, y:0.30, hover:0.15}, type:'crystal', color:0xffb7c5, size:0.6, glb:'bracelet_rose.glb' },
    crystal_obsidian: { frac:{x:-0.60, z:-0.40, y:0.30, hover:0.15}, type:'crystal', color:0x1a1a2e, size:0.7, glb:'bracelet_obsidian.glb' },

    // ── 十神/神煞/地支关系/天干合 共65个（2026-08-18新增，
    // js/decoration-resolver.js 判定命中 → js/decoration-annotate.js 摆放）──
    // 下面每一条的 `frac` 都只是防御性占位（跟第三阶段 wxmaint_* 系列同一
    // 惯例，见本文件顶部2026-08-13注释）：这65个decorId全部只会通过
    // `add(decorId, baziData, overridePos)` 第三参数拿到
    // decoration-annotate.js 按命盘真实柱位算出的世界坐标，不会走
    // `_computePlacement()` 查这里的 frac。`type:'crystal'`/`color:0xc9a96e`
    // 同理只是GLB加载失败时的占位符兜底外观，正常路径下65个GLB都已就位
    // （见 assets/decorations/tenGods|shensha|interactions/，与
    // decoration-catalog.js 逐条核对过文件名一致），理论上不会触发。
    // `size:0.6` 是初始起点，实际显示密度已用真实浏览器验证过（见本次改动
    // 附带的验证记录），如未来实测发现某类资产偏大/偏小可单独调整，不需要
    // 整批统一改。

    // ── 十神（10个，year/month/hour三柱可能命中，摆放于对应柱位附近，见 decoration-annotate.js::_computeFrac） ──
    tg_bijian           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'tenGods/tg_bijian.glb' },
    tg_jiecai           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'tenGods/tg_jiecai.glb' },
    tg_shishen          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'tenGods/tg_shishen.glb' },
    tg_shangguan        : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'tenGods/tg_shangguan.glb' },
    tg_zhengcai         : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'tenGods/tg_zhengcai.glb' },
    tg_piancai          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'tenGods/tg_piancai.glb' },
    tg_zhengguan        : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'tenGods/tg_zhengguan.glb' },
    tg_qisha            : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'tenGods/tg_qisha.glb' },
    tg_zhengyin         : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'tenGods/tg_zhengyin.glb' },
    tg_pianyin          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'tenGods/tg_pianyin.glb' },

    // ── 神煞（34个，四柱各自可能命中，同柱多神煞由 decoration-annotate.js 做局部散开） ──
    ss_tianyi_noble     : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_tianyi_noble.glb' },
    ss_wenchang         : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_wenchang.glb' },
    ss_lushen           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_lushen.glb' },
    ss_yangren          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_yangren.glb' },
    ss_hongyan          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_hongyan.glb' },
    ss_yima             : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_yima.glb' },
    ss_taohua           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_taohua.glb' },
    ss_huagai           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_huagai.glb' },
    ss_jiangxing        : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_jiangxing.glb' },
    ss_tiande           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_tiande.glb' },
    ss_yuede            : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_yuede.glb' },
    ss_taiji            : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_taiji.glb' },
    ss_kuigang          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_kuigang.glb' },
    ss_jiesha           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_jiesha.glb' },
    ss_wangshen         : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_wangshen.glb' },
    ss_guchen           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_guchen.glb' },
    ss_guasu            : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_guasu.glb' },
    ss_tianxi           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_tianxi.glb' },
    ss_hongluan         : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_hongluan.glb' },
    ss_feiren           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_feiren.glb' },
    ss_jinyu            : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_jinyu.glb' },
    ss_fuxing           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_fuxing.glb' },
    ss_xuetang          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_xuetang.glb' },
    ss_jielukongwang    : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_jielukongwang.glb' },
    ss_tianyi_healer    : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_tianyi_healer.glb' },
    ss_tiandehe         : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_tiandehe.glb' },
    ss_yuedehe          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_yuedehe.glb' },
    ss_zaisha           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_zaisha.glb' },
    ss_tianluo          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_tianluo.glb' },
    ss_diwang           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_diwang.glb' },
    ss_suipo            : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_suipo.glb' },
    ss_xianchi          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_xianchi.glb' },
    ss_guoyin           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_guoyin.glb' },
    ss_dexiu            : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'shensha/ss_dexiu.glb' },

    // ── 地支六冲（6个，二柱关系，摆放在两柱几何重心） ──
    chong_zi_wu         : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/chong_zi_wu.glb' },
    chong_chou_wei      : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/chong_chou_wei.glb' },
    chong_yin_shen      : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/chong_yin_shen.glb' },
    chong_mao_you       : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/chong_mao_you.glb' },
    chong_chen_xu       : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/chong_chen_xu.glb' },
    chong_si_hai        : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/chong_si_hai.glb' },

    // ── 地支六合（6个，二柱关系，摆放在两柱几何重心） ──
    he_zi_chou          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/he_zi_chou.glb' },
    he_yin_hai          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/he_yin_hai.glb' },
    he_mao_xu           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/he_mao_xu.glb' },
    he_chen_you         : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/he_chen_you.glb' },
    he_si_shen          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/he_si_shen.glb' },
    he_wu_wei           : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/he_wu_wei.glb' },

    // ── 地支三合（4个，按结果五行，三柱及以上关系，摆放在命中柱几何重心） ──
    sanhe_water         : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/sanhe_water.glb' },
    sanhe_fire          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/sanhe_fire.glb' },
    sanhe_metal         : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/sanhe_metal.glb' },
    sanhe_wood          : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/sanhe_wood.glb' },

    // ── 天干五合（5个，二柱关系，摆放在两柱几何重心） ──
    ganhe_jia_ji        : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/ganhe_jia_ji.glb' },
    ganhe_yi_geng       : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/ganhe_yi_geng.glb' },
    ganhe_bing_xin      : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/ganhe_bing_xin.glb' },
    ganhe_ding_ren      : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/ganhe_ding_ren.glb' },
    ganhe_wu_gui        : { frac:{x:0,z:0,y:0.5,hover:0.2}, type:'crystal', color:0xc9a96e, size:0.6, glb:'interactions/ganhe_wu_gui.glb' },
  };

  // ── 五行维护系统装饰（第三阶段2026-08-13新增占位 → 第四阶段2026-08-15
  //    扩展为三档 + 接入首批真实GLB资产）──────────────────────────────
  // js/wuxing-scene.js::attach()/reflectTier()/markShrined() 按当次命盘
  // WuxingIssues.deriveIssues() 算出的 {wx, direction} 组合 + 动态"维护档位"
  // （tier 1安泰/2见微/3亟待，懒计算，见 js/wuxing-maintenance.js）决定挂哪个
  // decorId、挂在哪——世界坐标由调用方通过本文件的 add(decorId, baziData,
  // overridePos) 第三参数直接给出，这里的 frac 字段因此实际上不会被用到
  // （overridePos 总是有值），只是为了防御性兜底（万一将来某处误调用不传
  // overridePos，也不会因为 DECOR_DEFS 里没有这个 key 而直接跳过渲染）保留
  // 一个占位坐标，不代表真实设计位置。
  //
  // decorId 命名规则：`wxmaint_{wx}_{nourish|restrain}_t{1|2|3}`（三层循环，
  // 5行×2方向×3档=30条）+ `wxmaint_shrine_{wx}_{direction}`（10条，"请神仙/
  // 设炉灶"永久巩固后的款式，虽然视觉上全部复用同一个 shrine_generic.glb
  // 模型文件，但每个 wx+direction 组合各自注册独立的 decorId）。此前（第三
  // 阶段）decorId 不带 `_t{tier}` 后缀、每个 wx+direction 只有一条占位——
  // 本轮改为三档后旧的无后缀 key 直接废弃替换（不保留），js/wuxing-scene.js
  // 相应改为按 tier 选取 decorId。
  //
  // 2026-08-16 qa-reviewer CONFIRMED修复："请神仙"decorId此前是单一通用款
  // `wxmaint_shrine`（不分五行方向）——但 add(decorId,...) 第一行是
  // `if (_placed[decorId]) return`（同一个decorId只会真正放置一次）。同一张
  // 命盘如果有多条issue先后被markShrined()，第二条起 add('wxmaint_shrine',
  // ...) 会因为decorId已存在直接被跳过，但markShrined()自己remove()掉的是
  // 上一条issue的旧问题态decorId——净效果是"花1000灵气巩固第二条issue，3D
  // 装饰反而从场景里凭空消失一个，什么也没补上"（qa-reviewer用真实
  // BaziEngine+真实IslandDecorations实测复现：3条issue全部markShrined后，
  // 3个CSS2D热点仍在，但3D装饰只剩1个）。修复：decorId 改成
  // per-issue（`wxmaint_shrine_{wx}_{direction}`），5行×2方向=10条，`glb`
  // 字段全部继续指向同一个 shrine_generic.glb 文件（视觉上还是同一个模型，
  // 只是不共享同一个decorId、不会互相顶掉），js/wuxing-scene.js::attach()/
  // markShrined() 生成decorId的地方同步改成per-issue拼接方式。
  //
  // 首批3D美术资产已由离线脚本（island_service/generate_wuxing_assets.py）
  // 生成，落地在 assets/decorations/wuxing/ 下，文件名用英文（GLB_BASE +
  // 'wuxing/{wx_en}_{direction}_t{tier}.glb'）——五行中文名→英文文件名前缀
  // 映射见下方 WX_EN_PREFIX（这是JS端独立维护的一份，风格参考
  // island_service/bazi_prompt.py 里同类中英映射的写法，但两侧语言不同不复用
  // 同一份定义）。2026-08-22：水行（水→water）6个组合（2方向×3档）此前因
  // 预算原因暂缺，用户已用TripoAI Studio手动生成补齐，原始导出是未压缩高模
  // （单文件最大57.8MB，是同目录其余24个文件的15-60倍），已用与本项目此前
  // 65个装饰物同款的gltf-transform管线离线压缩（weld+simplify网格简化到约
  // 1.0-1.6万顶点+resize到1024x1024+webp贴图压缩，全程不使用Draco/meshopt，
  // 三档GLTFLoader无对应decoder会加载报错），压缩后单文件约0.6-0.75MB，与
  // 其余四行同一量级——五行资产已全部到位，`hasAsset` 常量恒为true，不再有
  // "某行缺资产走占位兜底"的例外分支，占位几何体路径只在GLB本身加载失败/
  // GLTFLoader不可用等异常情况才会触发。
  //
  // 视觉隐喻区分方向（与 wuxing-scene.js 里 💧/✂️ 图标呼应，不靠颜色区分
  // 方向）：nourish（喜用神不足，需要"培育/灌溉"）用 tree（幼苗）占位类型；
  // restrain（忌神过旺，需要"约束/克制"）用 ring（锁环）占位类型——占位类型
  // 仅作为 _loadGLB() 异常路径的兜底显示，正常情况下五行全部走真实GLB模型。
  // 颜色统一复用 CONFIG.WUXING_COLORS[wx].hex（不新造配色系统，跨全项目
  // 一致）。shrine 款不分五行，用统一的暖金色（呼应"庄重已巩固"调性）。
  const WX_EN_PREFIX = { '木': 'wood', '火': 'fire', '土': 'earth', '金': 'metal', '水': 'water' };
  (function _registerWuxingMaintenanceDecors() {
    const WX_LIST = ['木', '火', '土', '金', '水'];
    const DIRECTIONS = ['nourish', 'restrain'];
    WX_LIST.forEach(wx => {
      const hex = (typeof CONFIG !== 'undefined' && CONFIG.WUXING_COLORS && CONFIG.WUXING_COLORS[wx])
        ? CONFIG.WUXING_COLORS[wx].hex : 0xc9a96e;
      const enPrefix = WX_EN_PREFIX[wx];
      const hasAsset = true;   // 2026-08-22：五行（含水行）3D资产已全部补齐到位
      DIRECTIONS.forEach(direction => {
        [1, 2, 3].forEach(tier => {
          DECOR_DEFS[`wxmaint_${wx}_${direction}_t${tier}`] = {
            frac: { x: 0.00, z: 0.00, y: 0.30, hover: 0.15 },
            type: direction === 'nourish' ? 'tree' : 'ring',
            color: hex,
            size: direction === 'nourish' ? 0.9 : 0.5,
            glb: hasAsset ? `wuxing/${enPrefix}_${direction}_t${tier}.glb` : null,
          };
        });
      });
    });
    // "请神仙/设炉灶"永久巩固款——视觉上是同一个通用造型（灵位/香炉意象，
    // 不分五行），但每个 wx+direction 各自注册一条独立 decorId（见上方
    // 2026-08-16修复注释），避免共享同一个decorId导致add()的"已存在则
    // 跳过"逻辑把后续issue的巩固装饰顶掉。
    WX_LIST.forEach(wx => {
      DIRECTIONS.forEach(direction => {
        DECOR_DEFS[`wxmaint_shrine_${wx}_${direction}`] = {
          frac: { x: 0.00, z: 0.00, y: 0.30, hover: 0.15 },
          type: 'crystal', color: 0xc9a96e, size: 0.9,
          glb: 'wuxing/shrine_generic.glb',
        };
      });
    });
  })();

  // IslandAnnotate 计算包围盒失败/未就绪时的最终兜底（与 island-annotate.js
  // 的 FALLBACK_BOX 保持一致比例），只在异常路径触发，正常情况下走
  // IslandAnnotate.getIslandBox() 现算真实包围盒
  const FALLBACK_BOX = { min:{x:-5,y:-1,z:-5}, max:{x:5,y:4,z:5} };

  const GLB_BASE  = '/assets/decorations/';
  let _scene      = null;
  let _placed     = {};   // decorId → THREE.Object3D
  // 2026-08-16 qa-reviewer两轮修复迭代到这个最终版本：
  //
  // 第一轮问题（PLAUSIBLE）：GLTFLoader是异步的，`_loadGLB()`发出请求到
  // 成功/失败回调之间有一段真实存在的时间窗口，这段时间里`_placed[decorId]`
  // 还没被赋值。如果这段窗口内调用方对同一个decorId调了一次remove()
  // （reflectTier()/markShrined()的"remove旧→add新"两连击最容易撞上），
  // 旧档位的GLB如果还没加载完，remove()会因为_placed[旧]为空而直接no-op，
  // 但稍后GLTFLoader的成功回调仍会无条件`_scene.add(model)`，旧档位模型
  // 就永久残留在场景里、跟新装饰重叠。
  //
  // 第一轮的修复方案（用_loading/_pendingRemoved两个Set + add()里
  // `if(_loading.has(decorId)) return`拦一次并发）引入了第二轮CONFIRMED
  // 回归：`add(X)→remove(X)（仍在途）→add(X)`这个序列里，第二次add(X)会被
  // "已经在加载"的守卫直接吞掉、什么也不做，随后X的GLTFLoader回调触发时
  // 又因为_pendingRemoved标记把模型丢弃——最终这个decorId对应的装饰一个
  // 都没有。qa-reviewer指出这不是构造出来的边界情况：`wxmaint_*`系列
  // decorId只由`{wx}_{direction}_t{tier}`决定、不含baziKey，跨命盘会撞
  // 同一个id；GLB体积大（约1MB/个），移动网络加载窗口是数秒级，用户在这
  // 几秒内切岛屿/轻量刷新AI深析，新旧两张命盘刚好命中同一个五行方向+档位
  // 组合时就会真实触发。
  //
  // 最终修复（本轮，token机制）：不再用"是否正在加载"这个布尔状态去拦截
  // 后续add()调用（那正是回归的根源——拦截意味着"忽略"，而忽略了的这次
  // add()诉求就永远丢了），改为让每次add()都能真正发起一次新的加载请求，
  // 但给每个decorId维护一个单调递增的"版本号"（_loadToken[decorId]）：
  // `_loadGLB()`发起时读取+自增当前版本号并记住"这是我的版本号"，GLTFLoader
  // 的回调触发时只有当自己的版本号仍然等于`_loadToken[decorId]`当前值（即
  // "我是这个decorId最后一次被请求的那次"）才真正落地`_scene.add()`/写
  // `_placed`，否则静默丢弃自己这次的加载结果——不管丢弃的是"过期"还是
  // "被取消"的那次。`remove()`同样只需要把版本号自增一次（不需要真的
  // 知道"是否正在加载"），后续任何仍在途的旧版本回调天然就不再匹配。
  // 这样无论中途发生多少次"remove又add"，只有**最后一次add()**捕获到的
  // placement/内容会真正生效——因为每次add()都会重新计算并闭包捕获当次
  // 调用传入的placement（见_computePlacement()/_placementFromOverride()
  // 调用点），不会退回到某次更早请求时的旧坐标。
  // 代价：remove()后紧跟着add()同一decorId时，前一次尚未完成的网络请求会
  // 被浪费（继续下载但结果被丢弃），不做真正的HTTP层面取消——GLB文件不大
  // 且这类"边加载边改主意"的场景本身低频，用少量带宽换正确性是合理取舍，
  // 不引入 AbortController 这类更复杂的机制。
  let _loadToken = {};   // decorId → 最新一次_loadGLB()请求的版本号（整数）

  // ── 初始化（传入scene引用）───────────────────────────────
  function init(scene) { _scene = scene; }

  // ── 恢复已解锁装饰（每次进岛屿后调用）──────────────────
  // 2026-08-01：`_placed` 是模块级变量，整个浏览器会话共用同一个 THREE.Scene
  // （island-loader.js 的 initScene 有 `if (_scene) return` 守卫，不会重建
  // 场景），切换岛屿（loadSavedIsland/retryGenerate）时旧岛屿的装饰物从未被
  // 清理——`add()` 里 `if (_placed[decorId]) return` 会认为"已经摆过"直接跳过，
  // 导致装饰带着上一个岛屿的包围盒坐标残留在新岛屿上（形状差异越大越明显）。
  // 修复：每次 restoreAll（换岛屿必经的唯一装饰恢复入口）开头先 clearAll()，
  // 保证按当次岛屿的真实包围盒重新摆放。
  function restoreAll(baziData) {
    clearAll();
    const decorations = UserState.getDecorations();
    decorations.forEach(d => add(d.id, baziData));
  }

  // ── 清空当前场景里所有已摆放的装饰（换岛屿前调用）──────
  function clearAll() {
    if (!_scene) { _placed = {}; return; }
    Object.keys(_placed).forEach(decorId => remove(decorId));
    _placed = {};   // 兜底：remove() 理论上已逐一删除，这里确保万无一失
    // 换岛屿/清空这一刻仍在异步加载中的装饰（还没进_placed，上面基于
    // Object.keys(_placed) 的 remove() 循环覆盖不到）也需要让它们的
    // token失效，否则加载完成后会凭空挂在新场景/新一批装饰之间（见
    // _loadToken 声明处注释的token机制）。这里没有一份"当前正在加载的
    // decorId列表"可以精确遍历，改为把 _loadToken 里出现过的每个decorId
    // 的token都递增一次——已经完成加载的那些（早被上面remove()清过）
    // 再碰一次token是无副作用的no-op，仍在途的那些则被正确标记为过期。
    Object.keys(_loadToken).forEach(decorId => {
      _loadToken[decorId] = (_loadToken[decorId] || 0) + 1;
    });
  }

  // ── 添加单个装饰 ─────────────────────────────────────────
  // 2026-08-13：新增可选第三参数 overridePos（THREE.Vector3 或 {x,y,z} 世界
  // 坐标）——js/wuxing-scene.js 的五行维护装饰点位是按当次命盘问题动态算出的
  // （环形分布，数量2-3个），不是 DECOR_DEFS 里写死的静态 frac 比例。传入时
  // 直接使用该坐标，跳过 _computePlacement() 内部查 DECOR_DEFS[decorId].frac
  // 那一步；不传（undefined）时行为与改动前完全一致——全部既有调用方
  // （本文件 restoreAll()、tasks.js:139、products.js:198）都只传两个参数，
  // 不受此次改动影响（已逐一核实，见本次改动的验证记录）。
  //
  // 2026-08-18：新增可选第四参数 placementKey——js/decoration-annotate.js
  // 消费 DecorationResolver.resolve() 的输出时发现一个真实bug（真实脚本
  // + 真实BaziEngine命例实测复现，不是构造场景）：十神/神煞类decorId是按
  // "命理概念本身"分配的（比如"天乙贵人"永远是 ss_tianyi_noble），但同一个
  // 神煞完全可能同时命中两根、三根柱子（比如天乙贵人落在年柱又落在时柱），
  // resolve() 会为每个命中柱位各输出一条独立记录（decorId相同、pillars不同，
  // 这是有意设计，因为这是两个独立的视觉锚点）。但本函数原先"同一decorId
  // 只会真正放置一次"（`if (_placed[decorId]) return`）的假设，对 wxmaint_*
  // 系列（decorId已经把wx+direction+tier编码进去，天然一对一）成立，对这批
  // 新增装饰不成立——会导致同一命盘里第二、三个命中该decorId的柱位处，
  // 点击热点能弹出面板，但脚下没有3D模型（被第一个柱位的add()占用的
  // `_placed[decorId]`挡住）。
  // 修复：`_placed`/`_loadToken` 的追踪键改用 `placementKey`（不传时默认退化
  // 为 decorId 本身，保证全部既有调用方——本文件 restoreAll()、tasks.js、
  // products.js、wuxing-scene.js——行为完全不变，已逐一核实）；`DECOR_DEFS`
  // 查找/GLB路径仍然按真实的 decorId 走（多个占用不同placementKey的实例
  // 可以共享同一份GLB定义，各自独立追踪加载/移除状态，互不覆盖）。
  function add(decorId, baziData, overridePos, placementKey) {
    if (!_scene) return;
    const pKey = placementKey || decorId;
    if (_placed[pKey]) return;   // 已存在
    // 2026-08-16：此前这里有一道"该decorId已经有一次GLTFLoader请求在途就
    // 直接return"的守卫，本意是防止并发重复加载，但引入了CONFIRMED回归——
    // `add(X)→remove(X)（仍在途）→add(X)`序列里第二次add(X)会被这道守卫
    // 直接吞掉、什么也不做，随后GLTFLoader的回调再因为"已被remove()取消"
    // 把模型丢弃，最终这个decorId一个装饰都没有。已改为不在这里拦截，让
    // 每次add()都能真正发起一次新的加载请求，用_loadGLB()内部的token机制
    // （见_loadToken声明处注释）保证"无论中途发生多少次remove又add，只有
    // 最后一次的坐标/内容会真正生效"，不会静默丢失这次add()的诉求。

    const def = DECOR_DEFS[decorId];
    if (!def) return;

    // 每次 add() 都现算一次真实包围盒——不同岛屿模型尺寸/比例不同，
    // 不能复用上一次或其他装饰算出的结果（overridePos 有值时跳过这步）
    const placement = overridePos ? _placementFromOverride(overridePos, def) : _computePlacement(def);

    // 有GLB文件优先加载，否则用几何占位——追踪/回调用 pKey（保证同一
    // decorId的多个实例各自独立追踪），实际GLB路径仍来自 def.glb（同一份
    // 定义，多个实例共享同一个模型文件是预期行为）。
    if (def.glb && typeof THREE.GLTFLoader !== 'undefined') {
      _loadGLB(pKey, def, placement);
    } else {
      _addPlaceholder(pKey, def, placement);
    }
  }

  // ── 外部直接给定世界坐标时的占位换算 ──────────────────────
  // 只做 Vector3/{x,y,z} → [x,y,z] 数组的形状归一化 + 沿用 def.size，不做
  // ring 类型的 radiusFrac 动态缩放（那需要现算包围盒 hx/hz，而 overridePos
  // 路径的设计意图就是跳过包围盒计算）——目前唯一的 overridePos 调用方
  // （wuxing-scene.js）传入的 decorId 都不是 radiusFrac 类型，不受影响；
  // 未来若有新调用方需要 ring+radiusFrac+overridePos 组合，需要另外扩展。
  function _placementFromOverride(overridePos, def) {
    const pos = (overridePos && typeof overridePos.x === 'number')
      ? [overridePos.x, overridePos.y, overridePos.z]
      : [0, 0, 0];
    return { pos, size: def.size };
  }

  // ── 相对比例 → 世界坐标 ──────────────────────────────────
  // 复用 island-annotate.js 已验证过的 getIslandBox()/layoutToWorld()（同一套
  // "用当次实际加载模型的真实包围盒按比例换算+地形射线检测贴合"逻辑，见该文件
  // 2026-08-01 新增的公开API），避免在这里重复实现一份容易失配的复制品。
  function _computePlacement(def) {
    let box = null, group = null;
    if (typeof IslandAnnotate !== 'undefined' && IslandAnnotate.getIslandBox) {
      try {
        ({ box, group } = IslandAnnotate.getIslandBox());
      } catch (e) {
        console.warn('[IslandDecorations] IslandAnnotate.getIslandBox() 失败，改用兜底比例', e);
      }
    }

    let pos, hx, hz;
    if (box && typeof IslandAnnotate !== 'undefined' && IslandAnnotate.layoutToWorld) {
      // ring 类型且标记 noRaycast 时传 group=null，让 layoutToWorld 退化为
      // 纯包围盒线性插值，不做地形吸附（见 DECOR_DEFS 上方注释）
      const useGroup = def.noRaycast ? null : group;
      pos = IslandAnnotate.layoutToWorld(def.frac, box, useGroup);
      hx  = (box.max.x - box.min.x) / 2;
      hz  = (box.max.z - box.min.z) / 2;
    } else {
      // IslandAnnotate 理论上不会缺席（index.html 已保证 island-annotate.js
      // 先于 island-decorations.js 加载），这里只是极端异常下的最终安全网
      const f  = def.frac || { x:0, z:0, y:0.4 };
      hx = (FALLBACK_BOX.max.x - FALLBACK_BOX.min.x) / 2;
      hz = (FALLBACK_BOX.max.z - FALLBACK_BOX.min.z) / 2;
      const sizeY = FALLBACK_BOX.max.y - FALLBACK_BOX.min.y;
      pos = new THREE.Vector3(
        f.x * hx,
        FALLBACK_BOX.min.y + f.y * sizeY,
        f.z * hz
      );
    }

    let size = def.size;
    if (def.type === 'ring' && def.radiusFrac) {
      // 用最长维度而不是水平半宽/半深的平均值——footprint 非正方形（如
      // 10×4 的长条形岛屿）时，(hx+hz)/2 会比较窄的那个维度还窄，导致
      // "环绕全岛"的光环反而被岛屿本体挡住/埋进模型里看不见
      size = Math.max(hx, hz) * def.radiusFrac;
    }

    return { pos: [pos.x, pos.y, pos.z], size };
  }

  // ── 移除装饰 ─────────────────────────────────────────────
  // 2026-08-18：新增可选第二参数 placementKey，语义与 add() 第四参数
  // 完全对应（同一decorId的多个独立实例场景，见 add() 声明处注释）——不传
  // 时退化为 decorId 本身，全部既有调用方（clearAll()/wuxing-scene.js等）
  // 行为不变。
  function remove(decorId, placementKey) {
    const pKey = placementKey || decorId;
    if (_placed[pKey]) {
      _scene.remove(_placed[pKey]);
      delete _placed[pKey];
    }
    // 无论此刻这个pKey是否已经真正放置/是否还有GLTFLoader请求在途，都
    // 让它的"版本号"自增一次——仍在途的旧请求的回调触发时，token比对会
    // 发现自己已经不是最新版本，从而静默丢弃这次加载结果，不会把即将被
    // 移除的旧装饰又添加进场景（见 _loadToken 声明处注释的token机制）。
    // 对从没add()过的pKey调用remove()，这里只是把它的token从0变成1，
    // 无副作用、不影响该pKey未来第一次真正的add()。
    _loadToken[pKey] = (_loadToken[pKey] || 0) + 1;
  }

  // ── 只读查询已放置的THREE.Object3D ───────────────────────
  // 2026-08-15新增，供 js/wuxing-scene.js 做档位切换的"缩小淡出/弹性回弹"
  // 过渡动画时直接操作真实模型的 scale/材质opacity 用，不额外维护一份
  // 平行的引用表（复用 _placed 这唯一权威数据源）。找不到时返回
  // null（尚未放置/仍在异步GLB加载中/已被remove）——调用方必须自行判空
  // 降级，本函数不假设一定拿得到，也不做任何副作用（不触发加载、不修改
  // _placed），纯只读查询。2026-08-18新增可选第二参数placementKey，语义
  // 同 add()/remove()。
  function get(decorId, placementKey) {
    return _placed[placementKey || decorId] || null;
  }

  // ── 加载真实 GLB ─────────────────────────────────────────
  // 2026-08-18：第一个参数改名为 placedKey（原名 decorId）——调用方
  // （add()）现在传入的是"追踪键"（可能是 placementKey，也可能就是
  // decorId本身，见 add() 声明处注释），不再假设它一定等于 DECOR_DEFS 的
  // key；真实的GLB路径始终来自 def.glb，不受影响。
  function _loadGLB(placedKey, def, placement) {
    // token机制（见 _loadToken 声明处注释）：每次发起加载都占用一个新的
    // 版本号并记住"这是我的版本号"（闭包变量 myToken）。回调触发时只有
    // 自己的版本号仍然等于 _loadToken[placedKey] 当前值（即"我是这个
    // placedKey最后一次被请求的那次"）才真正落地，否则说明中途发生过
    // remove()/新的add()，静默丢弃——不管是被"取消"还是被"更新的请求"
    // 取代，处理方式相同：只有最后一次赢。
    const myToken = (_loadToken[placedKey] || 0) + 1;
    _loadToken[placedKey] = myToken;
    new THREE.GLTFLoader().load(
      GLB_BASE + def.glb,
      (gltf) => {
        if (_loadToken[placedKey] !== myToken) return;   // 已被后续remove()/add()淘汰，丢弃这次结果，不进场景
        const model = gltf.scene;
        // 2026-08-18：包围盒归一化保护——TripoAI针对不同提示词导出的原始
        // 模型尺寸不一致（构图占比、模型复杂度都会导致差异），此前直接把
        // 原始尺寸乘以 placement.size 当缩放倍数会让不同装饰视觉大小参差
        // 不齐。改用跟 island-loader.js::_loadGLB()（加载主岛屿模型）同款
        // 的手法：现算真实包围盒，用"最大边长归一化到目标值"反推缩放系数，
        // 同时把模型中心平移抵消，消除GLB自身pivot不在几何中心导致的偏移。
        // 语义变化：placement.size 从"原始模型缩放倍数"变成"归一化后的
        // 目标最大边长"。2026-08-18实测校验：用脚本解析
        // assets/decorations/wuxing/ 下现有25个真实GLB（五行4行×2方向×3档
        // +shrine_generic）的POSITION accessor包围盒，maxDim全部≈0.998、
        // 几何中心全部≈(0,0,0)——TripoAI导出本身已按惯例把模型归一化到单位
        // 包围盒内，新旧两套语义下最终渲染尺寸差异<0.3%、pivot修正位移
        // <1cm（岛屿场景尺度~10单位），肉眼不可辨，因此DECOR_DEFS里这25条
        // 对应的def.size数值未做调整。crystal_water/amethyst/rose/obsidian
        // 这4个水晶战利品 + sprout_plant/cherry_blossom/moon_shrine/
        // share_flower 这4个任务解锁装饰，共8个decorId引用的GLB文件
        // （basin_clear.glb/sprout.glb等）在当前代码库/assets目录下实际
        // 尚不存在（find遍历确认），加载会404回退占位符，不受本次改动影响，
        // 待真实文件到位后建议按同样方法核实一次包围盒再决定是否需要调整
        // size（占位符路径下size是几何体半径语义，跟归一化后的目标最大边长
        // 语义不同，真实GLB到位前不要直接沿用现有size数值）。
        const box    = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale  = maxDim > 0 ? placement.size / maxDim : 1;   // 防御maxDim为0（异常空模型）
        model.scale.setScalar(scale);
        model.position.set(...placement.pos);
        model.position.sub(center.multiplyScalar(scale));   // 抵消GLB自身pivot偏移，让模型几何中心真正落在placement.pos上
        model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        _scene.add(model);
        _placed[placedKey] = model;
        _addEntryAnimation(model);
      },
      undefined,
      () => {
        if (_loadToken[placedKey] !== myToken) return;   // 同上：已过期，加载失败也不用回退占位了
        _addPlaceholder(placedKey, def, placement);       // 加载失败回退占位
      }
    );
  }

  // ── 几何占位符（GLB未就绪时）────────────────────────────
  // 2026-08-18：第一个参数同 _loadGLB() 改名为 placedKey，语义同上。
  function _addPlaceholder(placedKey, def, placement) {
    let mesh;
    const size = placement.size;
    const mat = new THREE.MeshStandardMaterial({
      color      : def.color,
      emissive   : def.color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity    : 0.85,
    });

    switch (def.type) {
      case 'glow': {
        // 发光球
        const geo = new THREE.SphereGeometry(size, 16, 16);
        mesh = new THREE.Mesh(geo, mat);
        // 添加点光源——挂载为 mesh 的子对象（而不是直接 _scene.add），
        // 这样 clearAll()/remove() 只需移除 mesh 本体，点光源作为其子节点
        // 会随场景图一起被移除，不会残留成永久生效的孤儿光源（2026-08-01：
        // 换岛屿时 restoreAll 会重复 add() 同一个已解锁装饰，若光源脱离
        // mesh 单独挂在 _scene 上，每次都会新增一个删不掉的点光源）。
        const light = new THREE.PointLight(def.color, 1.5, 6);
        mesh.add(light);   // 局部坐标 (0,0,0)，随 mesh.position 一起定位
        break;
      }
      case 'ring': {
        // 光环（半径已在 _computePlacement 里按岛屿包围盒尺寸动态缩放）
        const geo = new THREE.TorusGeometry(size, 0.05, 8, 64);
        mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = Math.PI / 2;
        break;
      }
      case 'tree': {
        // 锥形树
        const group = new THREE.Group();
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.1, size * 0.6, 6),
          new THREE.MeshStandardMaterial({ color: 0x8B6914 })
        );
        const crown = new THREE.Mesh(
          new THREE.ConeGeometry(size * 0.5, size, 8),
          mat
        );
        crown.position.y = size * 0.8;
        group.add(trunk, crown);
        mesh = group;
        break;
      }
      default: {
        // 水晶柱
        const geo = new THREE.ConeGeometry(size * 0.3, size, 6);
        mesh = new THREE.Mesh(geo, mat);
      }
    }

    mesh.position.set(...placement.pos);
    _scene.add(mesh);
    _placed[placedKey] = mesh;
    _addEntryAnimation(mesh);
  }

  // ── 入场动画（从下方浮现）───────────────────────────────
  function _addEntryAnimation(obj) {
    const startY = obj.position.y - 3;
    const endY   = obj.position.y;
    obj.position.y = startY;

    let elapsed = 0;
    const duration = 1200;
    const startTime = Date.now();

    const tick = () => {
      elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);   // cubic ease-out
      obj.position.y = startY + (endY - startY) * ease;
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
  }

  // ── 流年/大运触发的氛围变化 ──────────────────────────────
  function applyLiunianEffect(liuNianElement) {
    const colorMap = {
      '木': 0x6FCF97, '火': 0xEB5757,
      '土': 0xF2C94C, '金': 0xC8C8D8, '水': 0x6EB5FF,
    };
    const color = colorMap[liuNianElement] || 0xc9a96e;

    // 修改环境光色调
    if (_scene) {
      _scene.traverse(obj => {
        if (obj.isAmbientLight) obj.color.setHex(color);
      });
    }
  }

  return { init, restoreAll, clearAll, add, remove, get, applyLiunianEffect };
})();
