/**
 * config.js · 全局配置 + 八字知识库
 * v0.2.0 - 加入天干地支完整阴阳定义，用于精准生成 3D 场景
 */

const CONFIG = {
  API_BASE: 'https://simabazi-api.onrender.com',

  // 五行颜色（3D hex + CSS）
  WUXING_COLORS: {
    木: { primary: '#6FCF97', hex: 0x6FCF97, emissive: 0x1a4a20, glow: 'rgba(111,207,151,0.3)' },
    火: { primary: '#EB5757', hex: 0xEB5757, emissive: 0x661100, glow: 'rgba(235,87,87,0.3)'   },
    土: { primary: '#F2C94C', hex: 0xF2C94C, emissive: 0x4a3a00, glow: 'rgba(242,201,76,0.3)'  },
    金: { primary: '#C8C8D8', hex: 0xC8C8D8, emissive: 0x2a2a3a, glow: 'rgba(200,200,216,0.3)' },
    水: { primary: '#6EB5FF', hex: 0x6EB5FF, emissive: 0x0a2244, glow: 'rgba(110,181,255,0.3)' },
  },

  /**
   * 十天干 · 阴阳 + 形象 + 3D 视觉风格
   *
   * yang:true  → 形体高大、棱角分明、气势磅礴（阳刚之象）
   * yang:false → 形体小巧、圆润有机、精致细腻（阴柔之象）
   */
  STEMS_INFO: {
    甲: { wx:'木', yang:true,  shape:'tall-tree',     gloss:'参天大树·刚直挺拔·领导进取' },
    乙: { wx:'木', yang:false, shape:'vine-flower',   gloss:'柔藤花草·婉转柔和·亲和灵活' },
    丙: { wx:'火', yang:true,  shape:'sun-volcano',   gloss:'烈日炎阳·光明普照·领袖气质' },
    丁: { wx:'火', yang:false, shape:'candle-lantern', gloss:'灯烛微光·温暖内敛·文艺细腻' },
    戊: { wx:'土', yang:true,  shape:'mountain',      gloss:'厚重山岳·稳如泰山·踏实可靠' },
    己: { wx:'土', yang:false, shape:'fertile-plain', gloss:'肥沃田园·滋养万物·包容耕耘' },
    庚: { wx:'金', yang:true,  shape:'sword-blade',   gloss:'利刃铁器·刚强果决·执行力强' },
    辛: { wx:'金', yang:false, shape:'pearl-gem',     gloss:'珠宝首饰·精致玲珑·审美高雅' },
    壬: { wx:'水', yang:true,  shape:'ocean-river',   gloss:'江海大川·奔涌不息·谋略远大' },
    癸: { wx:'水', yang:false, shape:'rain-mist',     gloss:'雨露甘霖·滋润细腻·内在智慧' },
  },

  /**
   * 十二地支 · 五行归属 + 阴阳 + 藏干（权重）
   *
   * 藏干权重说明：本气0.6, 中气0.3, 余气0.1
   * 在计算五行强弱时，藏干权重再 ×0.5（地支藏干影响力低于明干）
   */
  BRANCHES_INFO: {
    子: { wx:'水', yang:true,  season:'冬', hidden:[{s:'壬',w:1.0}] },
    丑: { wx:'土', yang:false, season:'冬', hidden:[{s:'己',w:0.6},{s:'癸',w:0.3},{s:'辛',w:0.1}] },
    寅: { wx:'木', yang:true,  season:'春', hidden:[{s:'甲',w:0.6},{s:'丙',w:0.3},{s:'戊',w:0.1}] },
    卯: { wx:'木', yang:false, season:'春', hidden:[{s:'乙',w:1.0}] },
    辰: { wx:'土', yang:true,  season:'春', hidden:[{s:'戊',w:0.6},{s:'乙',w:0.3},{s:'癸',w:0.1}] },
    巳: { wx:'火', yang:false, season:'夏', hidden:[{s:'丙',w:0.6},{s:'庚',w:0.3},{s:'戊',w:0.1}] },
    午: { wx:'火', yang:true,  season:'夏', hidden:[{s:'丁',w:0.7},{s:'己',w:0.3}] },
    未: { wx:'土', yang:false, season:'夏', hidden:[{s:'己',w:0.6},{s:'乙',w:0.3},{s:'丁',w:0.1}] },
    申: { wx:'金', yang:true,  season:'秋', hidden:[{s:'庚',w:0.6},{s:'壬',w:0.3},{s:'戊',w:0.1}] },
    酉: { wx:'金', yang:false, season:'秋', hidden:[{s:'辛',w:1.0}] },
    戌: { wx:'土', yang:true,  season:'秋', hidden:[{s:'戊',w:0.6},{s:'辛',w:0.3},{s:'丁',w:0.1}] },
    亥: { wx:'水', yang:false, season:'冬', hidden:[{s:'壬',w:0.7},{s:'甲',w:0.3}] },
  },

  // 十神对照（用于标注卡描述）
  SHISHEN_DESC: {
    比肩:'同类同性·独立自主', 劫财:'同类异性·竞争进取',
    食神:'我生同性·才艺休闲', 伤官:'我生异性·创意变革',
    偏财:'我克同性·偏财机缘', 正财:'我克异性·稳定财富',
    七杀:'克我同性·压力权威', 正官:'克我异性·规则地位',
    偏印:'生我同性·直觉智慧', 正印:'生我异性·母爱学识',
  },

  // 神煞对应的 3D 物件类型
  SHENSHA_3D: {
    文昌星: { obj:'book',    wx:'木', desc:'学识才华·表达清晰·适合知识型事业' },
    桃花:   { obj:'peach',   wx:'水', desc:'人际魅力·社交吸引·感情丰富' },
    驿马:   { obj:'horse',   wx:'火', desc:'奔波迁移·变动机遇·适合出行创业' },
    天乙贵人:{ obj:'jade',   wx:'土', desc:'贵人相助·逢凶化吉·贵气护身' },
    太极贵人:{ obj:'taiji',  wx:'土', desc:'玄学缘分·智慧通达' },
    禄神:   { obj:'seal',    wx:'木', desc:'禄位稳固·财禄自来' },
    将星:   { obj:'flag',    wx:'金', desc:'统帅之才·领导力强' },
    红鸾:   { obj:'lantern', wx:'火', desc:'婚姻感情·红鸾动年' },
    天喜:   { obj:'star',    wx:'火', desc:'喜庆吉祥·逢喜得喜' },
    羊刃:   { obj:'blade',   wx:'金', desc:'刚烈果断·需防意外' },
    亡神:   { obj:'shadow',  wx:'水', desc:'智谋深算·需防损失' },
    劫煞:   { obj:'storm',   wx:'金', desc:'劫煞入命·需防劫夺' },
    孤辰:   { obj:'moon',    wx:'水', desc:'孤独内省·独立自强' },
    国印贵人:{ obj:'crown',  wx:'土', desc:'贵气护身·官场有助' },
    福星贵人:{ obj:'star2',  wx:'木', desc:'福气常在·吉星守护' },
    红艳:   { obj:'flower',  wx:'火', desc:'风流多情·魅力四射' },
    德秀贵人:{ obj:'virtue', wx:'土', desc:'品德高洁·受人尊重' },
  },

  SCENE: { fogColor: 0x060810 },
  FEATURES: { multiplayer:false, shareLink:false, dailyTasks:false },
  VERSION: '0.2.0-yinyang',
};
