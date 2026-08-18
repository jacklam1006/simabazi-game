/**
 * 司马八字 · 命理装饰对照表 decoration-catalog.js
 *
 * 十神/神煞/地支关系/天干合共65个3D装饰资产（assets/decorations/tenGods|
 * shensha|interactions/）与命盘数据之间的静态对照表——纯数据，不含任何
 * 判定/摆放逻辑（判定逻辑见 wuxing-issues.js 同级的新增判定模块，摆放逻辑
 * 见 island-annotate.js/island-decorations.js）。
 *
 * 数据来源：`命理概念3D资产完整清单.md`（v5最终版）+ 天干合5个补充设计，
 * 与已放入 assets/decorations/ 的65个真实GLB文件名逐一核对一致。
 */

/* ── 一、十神 → decorId（10个，day柱固定是"日主"不生成装饰，故只有
   year/month/hour三柱可能命中）───────────────────────────────────── */
const TEN_GOD_DECOR = {
  比肩: { decorId: 'tg_bijian',    meaning: '同辈并肩，独立自主' },
  劫财: { decorId: 'tg_jiecai',    meaning: '同辈争夺，冲动竞争' },
  食神: { decorId: 'tg_shishen',   meaning: '才华外泄，温和享受，福气' },
  伤官: { decorId: 'tg_shangguan', meaning: '锋芒外露，才华叛逆，打破常规' },
  正财: { decorId: 'tg_zhengcai',  meaning: '安分挣来的稳定财富' },
  偏财: { decorId: 'tg_piancai',   meaning: '意外之财，投机机遇' },
  正官: { decorId: 'tg_zhengguan', meaning: '正统权威，自律守规' },
  七杀: { decorId: 'tg_qisha',     meaning: '强势压力，果决冲劲' },
  正印: { decorId: 'tg_zhengyin',  meaning: '正统庇护，学识教养' },
  偏印: { decorId: 'tg_pianyin',   meaning: '特立独行的智慧，孤高才艺' },
};

/* ── 二、神煞 → decorId（34个，一柱可能同时命中多个神煞）──────────── */
const SHENSHA_DECOR = {
  天乙贵人: { decorId: 'ss_tianyi_noble',   meaning: '逢凶化吉，贵人相助（最吉神煞）' },
  文昌贵人: { decorId: 'ss_wenchang',       meaning: '文思敏捷，学业有成' },
  禄神:     { decorId: 'ss_lushen',         meaning: '衣食无忧，稳定俸禄' },
  羊刃:     { decorId: 'ss_yangren',        meaning: '锋利刚猛，易有伤灾' },
  红艳:     { decorId: 'ss_hongyan',        meaning: '魅力出众，桃花颇多' },
  驿马:     { decorId: 'ss_yima',           meaning: '奔波变动，出行迁徙' },
  桃花:     { decorId: 'ss_taohua',         meaning: '异性缘旺，人际魅力' },
  华盖:     { decorId: 'ss_huagai',         meaning: '清高孤独，艺术灵性' },
  将星:     { decorId: 'ss_jiangxing',      meaning: '统率之才，领导威仪' },
  天德贵人: { decorId: 'ss_tiande',         meaning: '逢凶化吉，德行护身' },
  月德贵人: { decorId: 'ss_yuede',          meaning: '柔和护佑，化解灾厄' },
  太极贵人: { decorId: 'ss_taiji',          meaning: '灵性顿悟，哲思智慧' },
  魁罡:     { decorId: 'ss_kuigang',        meaning: '刚烈果断，命运大起大落' },
  劫煞:     { decorId: 'ss_jiesha',         meaning: '破财失物，突发损耗' },
  亡神:     { decorId: 'ss_wangshen',       meaning: '暗中耗损，心神不宁' },
  孤辰:     { decorId: 'ss_guchen',         meaning: '六亲缘薄，孤身漂泊' },
  寡宿:     { decorId: 'ss_guasu',          meaning: '感情孤寂，聚少离多' },
  天喜:     { decorId: 'ss_tianxi',         meaning: '喜庆临门，好事将近' },
  红鸾:     { decorId: 'ss_hongluan',       meaning: '姻缘将至，喜结连理' },
  飞刃:     { decorId: 'ss_feiren',         meaning: '突发利刃之灾' },
  金舆:     { decorId: 'ss_jinyu',          meaning: '尊贵享福，姻缘美满' },
  福星贵人: { decorId: 'ss_fuxing',         meaning: '一生多福，逢难呈祥' },
  学堂:     { decorId: 'ss_xuetang',        meaning: '求知向学，读书运佳' },
  截路空亡: { decorId: 'ss_jielukongwang',  meaning: '阻滞受挫，谋事不顺' },
  天医:     { decorId: 'ss_tianyi_healer',  meaning: '医术缘分，健康庇佑' },
  天德合:   { decorId: 'ss_tiandehe',       meaning: '德泽相合，福气加倍' },
  月德合:   { decorId: 'ss_yuedehe',        meaning: '柔德相合，庇佑更深' },
  灾煞:     { decorId: 'ss_zaisha',         meaning: '意外灾厄，需防波折' },
  天罗:     { decorId: 'ss_tianluo',        meaning: '天罗高悬，行动受限' },
  地网:     { decorId: 'ss_diwang',         meaning: '地网低伏，进退两难' },
  岁破:     { decorId: 'ss_suipo',          meaning: '太岁相冲，动荡不安' },
  咸池:     { decorId: 'ss_xianchi',        meaning: '感情冲动，易生桃色' },
  国印贵人: { decorId: 'ss_guoyin',         meaning: '官威加身，权势护体' },
  德秀贵人: { decorId: 'ss_dexiu',          meaning: '才貌双全，气质出众' },
};

/* ── 三、地支关系/天干合 → decorId ──────────────────────────────────
   key统一用 BaziEngine 内部同款的确定性拼接方式（[a,b].sort().join('')，
   跟 js/bazi-engine.js::pairKey() 逐字节一致——这是本项目已经踩过两次坑
   的地方：手写猜顺序会导致查表miss，这里直接复用同一个排序拼接算法，
   不要改成手写书写顺序的key）。
   三合按结果五行（水/火/金/木）作key，不是分支组合，因为_interactions()
   三合结果的desc/判定本身就是按结果五行分类的四种局，不存在"顺序"歧义。 */
// 以下key均为Node实测 [a,b].sort().join('') 的真实输出（见交付时的验证记录），
// 不是手写猜测的书写顺序——手写这类key历史上已经出过两次bug（HE_LIU/
// CHONG_MEANING），本文件编写过程中也曾手写猜错三张表，已用脚本核对订正。
// 每条新增 `name`：按命理惯用书写顺序（子午/丑未/寅申……不是sort()后的key
// 顺序），供resolver直接展示，不要再用触发时遇到的柱位顺序动态拼接
// ——同一关系可能因为地支重复出现而同时命中两组不同柱位（比如子午冲同时
// 发生在月日之间和日时之间），如果显示名跟着遇到顺序动态拼，用户会同时
// 看到"子午冲"和"午子冲"两种写法，像是两个不同的东西，其实是同一种关系。
const CHONG_DECOR = {
  午子: { decorId: 'chong_zi_wu',    name: '子午冲', meaning: '情绪起伏·感情不稳' },
  丑未: { decorId: 'chong_chou_wei', name: '丑未冲', meaning: '事业变动·财务波折' },
  寅申: { decorId: 'chong_yin_shen', name: '寅申冲', meaning: '驿马奔波·意外多' },
  卯酉: { decorId: 'chong_mao_you',  name: '卯酉冲', meaning: '是非口舌·婚姻摩擦' },
  戌辰: { decorId: 'chong_chen_xu',  name: '辰戌冲', meaning: '刑伤官非·需注意健康' },
  亥巳: { decorId: 'chong_si_hai',   name: '巳亥冲', meaning: '精神压力·漂泊感' },
};

const HE_DECOR = {
  丑子: { decorId: 'he_zi_chou',  name: '子丑合', meaning: '化土' },
  亥寅: { decorId: 'he_yin_hai',  name: '寅亥合', meaning: '化木' },
  卯戌: { decorId: 'he_mao_xu',   name: '卯戌合', meaning: '化火' },
  辰酉: { decorId: 'he_chen_you', name: '辰酉合', meaning: '化金' },
  巳申: { decorId: 'he_si_shen',  name: '巳申合', meaning: '化水' },
  午未: { decorId: 'he_wu_wei',   name: '午未合', meaning: '化火土' },
};

// 三合结果五行 → decorId（不是分支pairKey，是_interactions()三合判定本身
// 输出的"结果局"，四种：申子辰→水/寅午戌→火/巳酉丑→金/亥卯未→木）
const SANHE_DECOR = {
  水: { decorId: 'sanhe_water', meaning: '申子辰三合水局' },
  火: { decorId: 'sanhe_fire',  meaning: '寅午戌三合火局' },
  金: { decorId: 'sanhe_metal', meaning: '巳酉丑三合金局' },
  木: { decorId: 'sanhe_wood',  meaning: '亥卯未三合木局' },
};

// 天干五合，key同样用 pairKey([a,b].sort().join(''))（Node实测值）
const GANHE_DECOR = {
  己甲: { decorId: 'ganhe_jia_ji',   name: '甲己合', meaning: '化土' },
  乙庚: { decorId: 'ganhe_yi_geng',  name: '乙庚合', meaning: '化金' },
  丙辛: { decorId: 'ganhe_bing_xin', name: '丙辛合', meaning: '化水' },
  丁壬: { decorId: 'ganhe_ding_ren', name: '丁壬合', meaning: '化木' },
  戊癸: { decorId: 'ganhe_wu_gui',   name: '戊癸合', meaning: '化火' },
};

/* ── 四、当前尚未生成3D资产的地支关系类型（三会/三刑/自刑/六害/六破）──
   `js/bazi-engine.js::_interactions()` 已经在计算这五类（type分别为
   '三会'/'三刑'/'自刑'/'害'/'破'），但对应的23个GLB资产尚未生成/放置。
   消费方（resolver）遇到这五类type时应该跳过、不产生装饰（不是报错，
   也不是退化成占位符——直接不生成这条装饰记录），待资产就位后再补充
   对应的 decorId 对照表，届时只需要在这个文件里新增
   SANHUI_DECOR/XING_DECOR/ZIXING_DECOR/HAI_DECOR/PO_DECOR 四张表，
   resolver 那边的分支结构已经预留了这个扩展点，不需要改resolver主体逻辑。 */
