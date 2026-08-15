/**
 * bazi-engine.js · 司马八字完整计算引擎 v1.0
 *
 * 依赖：lunar-javascript (6tail/lunar-javascript) CDN 加载后暴露全局 Solar
 * 计算范围：四柱 / 五行强弱 / 阴阳比 / 十神 / 藏干 / 纳音 / 十二长生
 *           空亡 / 神煞(34颗) / 刑冲合害 / 大运 / 流年 / 流月 / 身强弱 / 喜用神
 *
 * 对外接口：
 *   const result = BaziEngine.calculate(year, month, day, hour, minute, gender)
 *   result 即 baziData，可直接传入 SceneBuilder.buildFromBazi(baziData)
 */

class BaziEngine {

  /* ══════════════════════════════════════════════════════════
   * 静态数据表
   * ══════════════════════════════════════════════════════════ */

  static S = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
  static B = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

  static STEM_WX   = {甲:'木',乙:'木',丙:'火',丁:'火',戊:'土',己:'土',庚:'金',辛:'金',壬:'水',癸:'水'};
  static BRANCH_WX = {子:'水',丑:'土',寅:'木',卯:'木',辰:'土',巳:'火',午:'火',未:'土',申:'金',酉:'金',戌:'土',亥:'水'};
  static STEM_YANG   = {甲:1,乙:0,丙:1,丁:0,戊:1,己:0,庚:1,辛:0,壬:1,癸:0};
  static BRANCH_YANG = {子:1,丑:0,寅:1,卯:0,辰:1,巳:0,午:1,未:0,申:1,酉:0,戌:1,亥:0};

  static HIDDEN = {
    子:[{s:'壬',w:1.0}],
    丑:[{s:'己',w:.6},{s:'癸',w:.3},{s:'辛',w:.1}],
    寅:[{s:'甲',w:.6},{s:'丙',w:.3},{s:'戊',w:.1}],
    卯:[{s:'乙',w:1.0}],
    辰:[{s:'戊',w:.6},{s:'乙',w:.3},{s:'癸',w:.1}],
    巳:[{s:'丙',w:.6},{s:'庚',w:.3},{s:'戊',w:.1}],
    午:[{s:'丁',w:.7},{s:'己',w:.3}],
    未:[{s:'己',w:.6},{s:'乙',w:.3},{s:'丁',w:.1}],
    申:[{s:'庚',w:.6},{s:'壬',w:.3},{s:'戊',w:.1}],
    酉:[{s:'辛',w:1.0}],
    戌:[{s:'戊',w:.6},{s:'辛',w:.3},{s:'丁',w:.1}],
    亥:[{s:'壬',w:.7},{s:'甲',w:.3}],
  };

  // 十二长生表（日主起）
  static LIFE = {
    甲:{亥:'长生',子:'沐浴',丑:'冠带',寅:'临官',卯:'帝旺',辰:'衰',巳:'病',午:'死',未:'墓',申:'绝',酉:'胎',戌:'养'},
    乙:{午:'长生',巳:'沐浴',辰:'冠带',卯:'临官',寅:'帝旺',丑:'衰',子:'病',亥:'死',戌:'墓',酉:'绝',申:'胎',未:'养'},
    丙:{寅:'长生',卯:'沐浴',辰:'冠带',巳:'临官',午:'帝旺',未:'衰',申:'病',酉:'死',戌:'墓',亥:'绝',子:'胎',丑:'养'},
    丁:{酉:'长生',申:'沐浴',未:'冠带',午:'临官',巳:'帝旺',辰:'衰',卯:'病',寅:'死',丑:'墓',子:'绝',亥:'胎',戌:'养'},
    戊:{寅:'长生',卯:'沐浴',辰:'冠带',巳:'临官',午:'帝旺',未:'衰',申:'病',酉:'死',戌:'墓',亥:'绝',子:'胎',丑:'养'},
    己:{酉:'长生',申:'沐浴',未:'冠带',午:'临官',巳:'帝旺',辰:'衰',卯:'病',寅:'死',丑:'墓',子:'绝',亥:'胎',戌:'养'},
    庚:{巳:'长生',午:'沐浴',未:'冠带',申:'临官',酉:'帝旺',戌:'衰',亥:'病',子:'死',丑:'墓',寅:'绝',卯:'胎',辰:'养'},
    辛:{子:'长生',亥:'沐浴',戌:'冠带',酉:'临官',申:'帝旺',未:'衰',午:'病',巳:'死',辰:'墓',卯:'绝',寅:'胎',丑:'养'},
    壬:{申:'长生',酉:'沐浴',戌:'冠带',亥:'临官',子:'帝旺',丑:'衰',寅:'病',卯:'死',辰:'墓',巳:'绝',午:'胎',未:'养'},
    癸:{卯:'长生',寅:'沐浴',丑:'冠带',子:'临官',亥:'帝旺',戌:'衰',酉:'病',申:'死',未:'墓',午:'绝',巳:'胎',辰:'养'},
  };

  // 60甲子纳音（每对两个，数组共60项，直接按60甲子序号索引）
  static NAYIN60 = [
    '海中金','海中金','炉中火','炉中火','大林木','大林木',
    '路旁土','路旁土','剑锋金','剑锋金','山头火','山头火',
    '涧下水','涧下水','城头土','城头土','白蜡金','白蜡金',
    '杨柳木','杨柳木','泉中水','泉中水','屋上土','屋上土',
    '霹雳火','霹雳火','松柏木','松柏木','长流水','长流水',
    '沙中金','沙中金','山下火','山下火','平地木','平地木',
    '壁上土','壁上土','金箔金','金箔金','覆灯火','覆灯火',
    '天河水','天河水','大驿土','大驿土','钗钏金','钗钏金',
    '桑柘木','桑柘木','大溪水','大溪水','沙中土','沙中土',
    '天上火','天上火','石榴木','石榴木','大海水','大海水',
  ];

  // 日主性格描述
  static DM_NATURE = {
    甲:'参天大树·刚直领导·开拓进取·思想正直',
    乙:'柔藤花草·亲和灵活·善于沟通·温柔坚韧',
    丙:'烈日炎阳·光明热情·领袖气质·善于表达',
    丁:'灯烛微光·细腻内敛·艺术敏感·温暖周到',
    戊:'厚重山岳·稳重踏实·可靠诚信·包容大度',
    己:'肥沃田园·耕耘滋养·细心谨慎·善于积累',
    庚:'利刃铁器·果断刚强·执行力强·直率豪爽',
    辛:'珠宝首饰·精致审美·完美主义·敏感聪慧',
    壬:'江海大川·智谋深远·胸怀宽广·善于谋划',
    癸:'雨露甘霖·直觉细腻·内在智慧·温和沉静',
  };

  /* ══════════════════════════════════════════════════════════
   * 核心计算入口
   * ══════════════════════════════════════════════════════════ */

  static calculate(year, month, day, hour, minute=0, gender='男') {
    if (typeof Solar === 'undefined') {
      throw new Error('lunar-javascript 库未加载，请检查网络连接');
    }

    // ① 四柱排盘（lunar-javascript 处理所有节气/历法转换）
    const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0);
    const lunar  = solar.getLunar();
    const bazi   = lunar.getEightChar();
    const dm     = bazi.getDayGan();

    const pillars = {
      year:  { stem: bazi.getYearGan(),  branch: bazi.getYearZhi(),  label:'年' },
      month: { stem: bazi.getMonthGan(), branch: bazi.getMonthZhi(), label:'月' },
      day:   { stem: bazi.getDayGan(),   branch: bazi.getDayZhi(),   label:'日' },
      hour:  { stem: bazi.getTimeGan(),  branch: bazi.getTimeZhi(),  label:'时' },
    };

    // 附加五行阴阳属性
    for (const k in pillars) {
      const p = pillars[k];
      p.stemWx     = BaziEngine.STEM_WX[p.stem]     || '木';
      p.branchWx   = BaziEngine.BRANCH_WX[p.branch] || '土';
      p.stemYang   = BaziEngine.STEM_YANG[p.stem]   ?? 1;
      p.branchYang = BaziEngine.BRANCH_YANG[p.branch] ?? 1;
    }

    // ② 五行强弱（月令×1.5，藏干×0.5）
    const wuxingRaw = BaziEngine._calcWuxing(pillars);
    const wxTotal   = Object.values(wuxingRaw).reduce((a,b)=>a+b, 0);
    const wuxing    = {};
    for (const k in wuxingRaw) wuxing[k] = Math.round(wuxingRaw[k]/wxTotal*100);

    // ③ 各五行阴阳比例
    const yangRatio = BaziEngine._calcYangRatio(pillars);

    // ④ 十神
    const tenGods = {};
    for (const k in pillars) {
      tenGods[k] = k==='day' ? '日主' : BaziEngine._shishen(dm, pillars[k].stem);
    }

    // ⑤ 藏干 + 藏干十神
    const hiddenStems = {};
    for (const k in pillars) {
      hiddenStems[k] = (BaziEngine.HIDDEN[pillars[k].branch] || []).map(({s,w}) => ({
        stem:s, weight:w, wx:BaziEngine.STEM_WX[s],
        yang: BaziEngine.STEM_YANG[s],
        shishen: BaziEngine._shishen(dm,s),
      }));
    }

    // ⑥ 十二长生
    const lifePhases = {};
    for (const k in pillars) lifePhases[k] = BaziEngine.LIFE[dm]?.[pillars[k].branch] || '';

    // ⑦ 纳音
    const nayin = BaziEngine._calcNayin(bazi, pillars);

    // ⑧ 空亡
    const kongwang = BaziEngine._calcKongwang(bazi);

    // ⑨ 神煞（逐柱，34颗完整神煞）
    const zhis = ['year','month','day','hour'].map(k => pillars[k].branch);
    const shensha = {};
    for (const k of ['year','month','day','hour']) {
      shensha[k] = BaziEngine._shensha(
        dm, zhis[2], zhis[0], zhis[1], pillars[k].stem, pillars[k].branch, gender
      );
    }
    const shenshe = [...new Set(Object.values(shensha).flat())];

    // ⑩ 刑冲合害
    const interactions = BaziEngine._interactions(zhis);

    // ⑪ 大运（lunar-javascript 精确计算节气距离）
    const gNum = gender==='男' ? 1 : 0;
    const yun = bazi.getYun(gNum);
    const qiyun = `出生后 ${yun.getStartYear()} 年 ${yun.getStartMonth()} 月起运`;
    const dayuns = BaziEngine._extractDayuns(dm, yun);
    const todayYear = new Date().getFullYear();
    const currentDayun = dayuns.find(d=>d.startYear<=todayYear && d.endYear>=todayYear) || dayuns[0] || null;

    // ⑫ 流年 + 流月
    const liunian   = BaziEngine._liunianByYear(todayYear);
    const liuyue    = BaziEngine._liuyue(todayYear, new Date().getMonth()+1);
    const futureYrs = [0,1,2,3].map(i => BaziEngine._liunianByYear(todayYear+i));

    // ⑬ 身强弱
    // _strength() 返回 {category, score}：category 是既有的三分类字符串（'身强'/
    // '中和'/'身弱'，很多地方依赖它判断，取值逻辑未变），score 是新增的 0-100 数值
    // 刻度（供仪表盘等UI画精确指针用，见 _strength() 内部注释的映射公式）。
    // 下面的 `strength` 变量沿用旧名、只存字符串，保持所有既有消费方的假设不变；
    // 数值另存为 strengthScore，两者在返回对象里并列存在，不覆盖/不改变旧字段语义。
    const strengthResult = BaziEngine._strength(dm, pillars, wuxingRaw);
    const strength = strengthResult.category;
    const strengthScore = strengthResult.score;

    // ⑭ 喜用神
    const { favorable, unfavorable, favorable2 } = BaziEngine._favorable(strength, dm, wuxingRaw);

    return {
      // ── 核心 ──
      pillars, wuxing, yangRatio,
      dayMaster: dm, dayMasterWx: BaziEngine.STEM_WX[dm],
      dayMasterNature: BaziEngine.DM_NATURE[dm] || '',
      // ── 结构分析 ──
      tenGods, hiddenStems, lifePhases, nayin, kongwang,
      // ── 神煞 ──
      shensha, shenshe,
      // ── 地支关系 ──
      interactions,
      // ── 时间维度 ──
      dayuns, dayun: currentDayun,
      liunian, liuyue, futureYrs, qiyun,
      // ── 格局 ──
      strength, strengthScore, favorable, unfavorable, favorable2,
      // ── 快捷字段（供 scene-builder 使用）──
      lifePhase: lifePhases.day,
      gender,
      // ── 原始输入 ──
      input: { year, month, day, hour, minute, gender },
    };
  }

  /* ══════════════════════════════════════════════════════════
   * 五行 · 阴阳
   * ══════════════════════════════════════════════════════════ */

  static _calcWuxing(pillars) {
    const counts = {木:0,火:0,土:0,金:0,水:0};
    for (const k of ['year','month','day','hour']) {
      const p = pillars[k];
      const mb = k==='month' ? 1.5 : 1; // 月令加成
      const sWx = BaziEngine.STEM_WX[p.stem];
      const bWx = BaziEngine.BRANCH_WX[p.branch];
      if (sWx) counts[sWx]+=1;
      if (bWx) counts[bWx]+=mb;
      for (const {s,w} of (BaziEngine.HIDDEN[p.branch]||[])) {
        const hWx = BaziEngine.STEM_WX[s];
        if (hWx) counts[hWx] += w*0.5*mb;
      }
    }
    return counts;
  }

  static _calcYangRatio(pillars) {
    const yang={木:0,火:0,土:0,金:0,水:0}, yin={木:0,火:0,土:0,金:0,水:0};
    for (const k in pillars) {
      const p=pillars[k];
      const sw=BaziEngine.STEM_WX[p.stem], bw=BaziEngine.BRANCH_WX[p.branch];
      if (sw){ BaziEngine.STEM_YANG[p.stem] ? yang[sw]++ : yin[sw]++; }
      if (bw){ BaziEngine.BRANCH_YANG[p.branch] ? yang[bw]++ : yin[bw]++; }
      for (const {s,w} of (BaziEngine.HIDDEN[p.branch]||[])) {
        const hw=BaziEngine.STEM_WX[s];
        if (hw){ BaziEngine.STEM_YANG[s] ? (yang[hw]+=w*.5) : (yin[hw]+=w*.5); }
      }
    }
    const ratio={};
    for (const wx of ['木','火','土','金','水']) {
      const t=yang[wx]+yin[wx];
      ratio[wx] = t>0 ? +( yang[wx]/t).toFixed(2) : 0.5;
    }
    return ratio;
  }

  /* ══════════════════════════════════════════════════════════
   * 十神
   * ══════════════════════════════════════════════════════════ */

  static _shishen(dm, target) {
    const dmWx=BaziEngine.STEM_WX[dm]||'土', tWx=BaziEngine.STEM_WX[target]||'土';
    const rel={木:{木:'比劫',火:'食伤',土:'财星',金:'官杀',水:'印枭'},
               火:{火:'比劫',土:'食伤',金:'财星',水:'官杀',木:'印枭'},
               土:{土:'比劫',金:'食伤',水:'财星',木:'官杀',火:'印枭'},
               金:{金:'比劫',水:'食伤',木:'财星',火:'官杀',土:'印枭'},
               水:{水:'比劫',木:'食伤',火:'财星',土:'官杀',金:'印枭'}};
    const base=rel[dmWx]?.[tWx]||'比劫';
    const yang=new Set(['甲','丙','戊','庚','壬']);
    const same=(yang.has(dm))===(yang.has(target));
    const m={比劫:same?'比肩':'劫财',食伤:same?'食神':'伤官',
             财星:same?'偏财':'正财',官杀:same?'七杀':'正官',印枭:same?'偏印':'正印'};
    return m[base]||'比肩';
  }

  /* ══════════════════════════════════════════════════════════
   * 纳音
   * ══════════════════════════════════════════════════════════ */

  static _calcNayin(bazi, pillars) {
    // 优先使用 lunar-javascript 内置纳音
    try {
      const raw = {
        year:  bazi.getYearNaYin(),
        month: bazi.getMonthNaYin(),
        day:   bazi.getDayNaYin(),
        hour:  bazi.getTimeNaYin(),
      };
      // lunar-javascript 返回完整字符串如"大溪水"或"【大溪水】甲寅、乙卯"
      const parse = s => typeof s==='string' ? s.replace(/【|】.*/g,'') : s;
      return { year:parse(raw.year), month:parse(raw.month), day:parse(raw.day), hour:parse(raw.hour) };
    } catch(e) {
      // fallback：自算
      const n = {};
      for (const k in pillars) n[k] = BaziEngine._nayin(pillars[k].stem, pillars[k].branch);
      return n;
    }
  }

  static _nayin(stem, branch) {
    const si=BaziEngine.S.indexOf(stem), bi=BaziEngine.B.indexOf(branch);
    if (si<0||bi<0) return '-';
    const idx=((6*si-5*bi)%60+60)%60;
    return BaziEngine.NAYIN60[idx]||'-';
  }

  /* ══════════════════════════════════════════════════════════
   * 空亡
   * ══════════════════════════════════════════════════════════ */

  static _calcKongwang(bazi) {
    try {
      // lunar-javascript: bazi.getDayXunKong() 返回 "戌亥" 或 ["戌","亥"]
      const raw = bazi.getDayXunKong();
      if (typeof raw==='string') return raw.split('');
      if (Array.isArray(raw)) return raw;
      return [];
    } catch(e) { return []; }
  }

  /* ══════════════════════════════════════════════════════════
   * 神煞（34颗，移植自 bazi_engine.py，完整保留）
   * ══════════════════════════════════════════════════════════ */

  static _shensha(dm, dayZhi, yearZhi, monthZhi, g, z, gender='男') {
    const stars = [];
    // 天乙贵人
    if ((('甲戊庚'.includes(dm))&&'丑未'.includes(z))||
        (('乙己'.includes(dm))&&'子申'.includes(z))||
        (('丙丁'.includes(dm))&&'亥酉'.includes(z))||
        (('壬癸'.includes(dm))&&'巳卯'.includes(z))||
        (dm==='辛'&&'午寅'.includes(z))) stars.push('天乙贵人');
    // 文昌贵人
    const wc={甲:'巳',乙:'午',丙:'申',丁:'酉',戊:'申',己:'酉',庚:'亥',辛:'子',壬:'寅',癸:'卯'};
    if (z===wc[dm]) stars.push('文昌贵人');
    // 禄神
    const lu={甲:'寅',乙:'卯',丙:'巳',丁:'午',戊:'巳',己:'午',庚:'申',辛:'酉',壬:'亥',癸:'子'};
    if (z===lu[dm]) stars.push('禄神');
    // 羊刃
    const yr={甲:'卯',乙:'辰',丙:'午',丁:'未',戊:'午',己:'未',庚:'酉',辛:'戌',壬:'子',癸:'丑'};
    if (z===yr[dm]) stars.push('羊刃');
    // 红艳
    const hy={甲:'午',乙:'申',丙:'寅',丁:'未',戊:'辰',己:'辰',庚:'戌',辛:'酉',壬:'子',癸:'申'};
    if (z===hy[dm]) stars.push('红艳');
    // 驿马/桃花/华盖/将星
    for (const base of [yearZhi, dayZhi]) {
      if (('申子辰'.includes(base)&&z==='寅')||('寅午戌'.includes(base)&&z==='申')||
          ('巳酉丑'.includes(base)&&z==='亥')||('亥卯未'.includes(base)&&z==='巳')) stars.push('驿马');
      if (('申子辰'.includes(base)&&z==='酉')||('寅午戌'.includes(base)&&z==='卯')||
          ('巳酉丑'.includes(base)&&z==='午')||('亥卯未'.includes(base)&&z==='子')) stars.push('桃花');
      if (('申子辰'.includes(base)&&z==='辰')||('寅午戌'.includes(base)&&z==='戌')||
          ('巳酉丑'.includes(base)&&z==='丑')||('亥卯未'.includes(base)&&z==='未')) stars.push('华盖');
      if (('申子辰'.includes(base)&&z==='子')||('寅午戌'.includes(base)&&z==='午')||
          ('巳酉丑'.includes(base)&&z==='酉')||('亥卯未'.includes(base)&&z==='卯')) stars.push('将星');
    }
    // 天德
    const td={寅:'丁',卯:'申',辰:'壬',巳:'辛',午:'亥',未:'甲',申:'癸',酉:'寅',戌:'丙',亥:'乙',子:'巳',丑:'庚'};
    if (td[monthZhi]&&(g===td[monthZhi]||z===td[monthZhi])) stars.push('天德贵人');
    // 月德
    if (('寅午戌'.includes(monthZhi)&&g==='丙')||('申子辰'.includes(monthZhi)&&g==='壬')||
        ('亥卯未'.includes(monthZhi)&&g==='甲')||('巳酉丑'.includes(monthZhi)&&g==='庚'))
      stars.push('月德贵人');
    // 太极贵人
    const tj={甲:['子','午'],乙:['子','午'],丙:['卯','酉'],丁:['卯','酉'],
              戊:['辰','戌','丑','未'],己:['辰','戌','丑','未'],
              庚:['寅','亥'],辛:['寅','亥'],壬:['巳','申'],癸:['巳','申']};
    if ((tj[dm]||[]).includes(z)) stars.push('太极贵人');
    // 魁罡
    if (['庚辰','庚戌','壬辰','戊戌'].includes(g+z)) stars.push('魁罡');
    // 劫煞
    const jsha={申:'巳',子:'巳',辰:'巳',寅:'亥',午:'亥',戌:'亥',巳:'寅',酉:'寅',丑:'寅',亥:'申',卯:'申',未:'申'};
    for (const base of [yearZhi,dayZhi]) if (jsha[base]===z) stars.push('劫煞');
    // 亡神
    const ws={申:'亥',子:'亥',辰:'亥',寅:'巳',午:'巳',戌:'巳',巳:'申',酉:'申',丑:'申',亥:'寅',卯:'寅',未:'寅'};
    for (const base of [yearZhi,dayZhi]) if (ws[base]===z) stars.push('亡神');
    // 孤辰
    const gc={寅:'巳',卯:'巳',辰:'巳',巳:'申',午:'申',未:'申',申:'亥',酉:'亥',戌:'亥',亥:'寅',子:'寅',丑:'寅'};
    if (gc[yearZhi]===z) stars.push('孤辰');
    // 寡宿
    const gu={寅:'丑',卯:'丑',辰:'丑',巳:'辰',午:'辰',未:'辰',申:'未',酉:'未',戌:'未',亥:'戌',子:'戌',丑:'戌'};
    if (gu[yearZhi]===z) stars.push('寡宿');
    // 天喜
    const tx={子:'酉',丑:'申',寅:'未',卯:'午',辰:'巳',巳:'辰',午:'卯',未:'寅',申:'丑',酉:'子',戌:'亥',亥:'戌'};
    if (tx[yearZhi]===z) stars.push('天喜');
    // 红鸾
    const hl={子:'卯',丑:'寅',寅:'丑',卯:'子',辰:'亥',巳:'戌',午:'酉',未:'申',申:'未',酉:'午',戌:'巳',亥:'辰'};
    if (hl[yearZhi]===z) stars.push('红鸾');
    // 飞刃
    const fl={甲:'酉',乙:'戌',丙:'子',丁:'丑',戊:'子',己:'丑',庚:'卯',辛:'辰',壬:'午',癸:'未'};
    if (z===fl[dm]) stars.push('飞刃');
    // 金舆
    const jy={甲:'辰',乙:'巳',丙:'未',丁:'申',戊:'未',己:'申',庚:'戌',辛:'亥',壬:'丑',癸:'寅'};
    if (z===jy[dm]) stars.push('金舆');
    // 福星贵人
    const fx={甲:'寅',乙:'丑',丙:'子',丁:'亥',戊:'子',己:'亥',庚:'申',辛:'未',壬:'午',癸:'巳'};
    if (z===fx[dm]) stars.push('福星贵人');
    // 学堂
    const xtd={甲:'亥',乙:'午',丙:'寅',丁:'酉',戊:'寅',己:'酉',庚:'巳',辛:'子',壬:'申',癸:'卯'};
    if (z===xtd[dm]) stars.push('学堂');
    // 截路空亡
    const jl={甲:['申','酉'],乙:['午','未'],丙:['辰','巳'],丁:['寅','卯'],戊:['子','丑'],
              己:['申','酉'],庚:['午','未'],辛:['辰','巳'],壬:['寅','卯'],癸:['子','丑']};
    if ((jl[dm]||[]).includes(z)) stars.push('截路空亡');
    // 天医
    const tym={寅:'丑',卯:'寅',辰:'卯',巳:'辰',午:'巳',未:'午',申:'未',酉:'申',戌:'酉',亥:'戌',子:'亥',丑:'子'};
    if (tym[monthZhi]===z) stars.push('天医');
    // 天德合
    const tdh={寅:'壬',辰:'丁',巳:'丙',未:'己',申:'戊',戌:'辛',亥:'庚',丑:'乙'};
    if (g===tdh[monthZhi]) stars.push('天德合');
    // 月德合
    const mdh={寅:'辛',午:'辛',戌:'辛',申:'丁',子:'丁',辰:'丁',亥:'己',卯:'己',未:'己',巳:'乙',酉:'乙',丑:'乙'};
    if (g===mdh[monthZhi]) stars.push('月德合');
    // 灾煞
    for (const base of [yearZhi,dayZhi]) {
      if (('申子辰'.includes(base)&&z==='午')||('寅午戌'.includes(base)&&z==='子')||
          ('巳酉丑'.includes(base)&&z==='卯')||('亥卯未'.includes(base)&&z==='酉')) stars.push('灾煞');
    }
    // 天罗/地网
    if ('壬癸'.includes(g)&&'辰巳'.includes(z)) stars.push('天罗');
    if ('甲乙'.includes(g)&&'戌亥'.includes(z)) stars.push('地网');
    // 岁破
    const sp={子:'午',丑:'未',寅:'申',卯:'酉',辰:'戌',巳:'亥',午:'子',未:'丑',申:'寅',酉:'卯',戌:'辰',亥:'巳'};
    if (sp[yearZhi]===z) stars.push('岁破');
    // 咸池（沐浴桃花）
    const xc={甲:'午',乙:'子',丙:'卯',丁:'酉',戊:'卯',己:'酉',庚:'午',辛:'子',壬:'卯',癸:'酉'};
    if (z===xc[dm]) stars.push('咸池');
    // 国印贵人（贵气护身，正官帝旺）
    const giy={甲:'午',乙:'巳',丙:'申',丁:'卯',戊:'申',己:'卯',庚:'亥',辛:'午',壬:'寅',癸:'亥'};
    if (z===giy[dm]) stars.push('国印贵人');
    // 德秀贵人
    const dxg={甲:'午',乙:'申',丙:'寅',丁:'亥',戊:'寅',己:'亥',庚:'巳',辛:'子',壬:'申',癸:'卯'};
    if (z===dxg[dm]) stars.push('德秀贵人');

    return [...new Set(stars)];
  }

  /* ══════════════════════════════════════════════════════════
   * 刑冲合害
   * ══════════════════════════════════════════════════════════ */

  static _interactions(zhis) {
    const results = [];
    const labels = ['年支','月支','日支','时支'];
    const CHONG = {子:'午',丑:'未',寅:'申',卯:'酉',辰:'戌',巳:'亥',午:'子',未:'丑',申:'寅',酉:'卯',戌:'辰',亥:'巳'};
    const HE_SAN = [['申','子','辰','水局'],['寅','午','戌','火局'],['巳','酉','丑','金局'],['亥','卯','未','木局']];
    // 三会（同一季度相邻三月，气最纯，比跨季度的三合更集中）
    const HE_HUI = [['寅','卯','辰','东方木'],['巳','午','未','南方火'],['申','酉','戌','西方金'],['亥','子','丑','北方水']];
    // 三刑：寅巳申/丑戌未需三支皆现；子卯只需两支同现，仍归类"三刑"
    const XING_SAN = [['寅','巳','申','无恩之刑','恩将仇报、官非诉讼'],['丑','戌','未','恃势之刑','倚势逞强、六亲缘薄']];
    const XING_LIU_MEANING = '失礼冒犯、家庭不睦';
    // 自刑：同一地支在四柱中重复出现≥2次
    const ZI_XING_MEANING = {辰:'自我拉扯·反复纠结', 午:'急躁耗神·情绪反复', 酉:'挑剔纠结·人际内耗', 亥:'多疑纠结·精神内耗'};
    // pairKey：与下方pairwise查表用的 [a,b].sort().join('') 完全一致的key生成方式，
    // 避免手写表时按"命理习惯书写顺序"敲错字符顺序导致查表永远miss。
    // 所有pairwise表（冲/六合/六害/六破/三刑子卯）一律通过pairKey()/buildPairTable()生成key，
    // 不再手写猜顺序——2026-08-16修复前HE_LIU曾直接手写'子丑'/'寅亥'等书写顺序key，
    // 与.sort()实际输出不一致导致这两对六合永远无法命中；同日修复CHONG_MEANING同样的坑
    // （子午→'午子'、辰戌→'戌辰'、巳亥→'亥巳'，三对按书写顺序手写的key与.sort()实际
    // 输出不一致，永远miss回退到'变动较大'兜底文案），详见已知问题记录。
    const pairKey = (a,b) => [a,b].sort().join('');
    const buildPairTable = (entries) => {
      const t = {};
      for (const [a,b,meaning] of entries) t[pairKey(a,b)] = meaning;
      return t;
    };
    const CHONG_MEANING = buildPairTable([
      ['子','午','情绪起伏·感情不稳'], ['丑','未','事业变动·财务波折'],
      ['寅','申','驿马奔波·意外多'], ['卯','酉','是非口舌·婚姻摩擦'],
      ['辰','戌','刑伤官非·需注意健康'], ['巳','亥','精神压力·漂泊感'],
    ]);
    // 六合（化五行）：entries的a,b书写顺序沿用命理习惯，key一律由pairKey()生成，
    // 与下方pairwise循环里 key=[a,b].sort().join('') 保持完全一致的排序算法
    const HE_LIU = buildPairTable([
      ['子','丑','土'], ['寅','亥','木'], ['卯','戌','火'], ['辰','酉','金'], ['巳','申','水'], ['午','未','火土'],
    ]);
    const XING_LIU_KEY = pairKey('子','卯'); // 无礼之刑，走pairwise排序key查表
    // 六害
    const HAI = buildPairTable([
      ['子','未','破财耗神·六亲缘薄'], ['丑','午','怨恨嫉妒·争执不断'], ['寅','巳','计较猜忌·招是惹非'],
      ['卯','辰','不合难容·暗中妨碍'], ['申','亥','无恩带累·反目成仇'], ['酉','戌','争斗嫉妒·怨怼纠缠'],
    ]);
    // 六破（注意：寅亥、巳申与六合表重叠，"既合又破"是真实存在的双重关系，两个判断各自独立成if，不互相跳过）
    const PO = buildPairTable([
      ['子','酉','破财损物·计划受阻'], ['丑','辰','根基动摇·反复破败'], ['寅','亥','合中带破·外和内耗'],
      ['卯','午','虚耗破损·难成之事'], ['巳','申','合中带破·外和内耗'], ['未','戌','破财耗损·根基不稳'],
    ]);

    for (let i=0; i<4; i++) {
      for (let j=i+1; j<4; j++) {
        const a=zhis[i], b=zhis[j];
        const key=[a,b].sort().join('');
        // 冲
        if (CHONG[a]===b) {
          results.push({type:'冲', desc:`${labels[i]}${a} 冲 ${labels[j]}${b}（${CHONG_MEANING[key]||'变动较大'}）`});
        }
        // 六合
        if (HE_LIU[key]) results.push({type:'合',desc:`${labels[i]}${a} 合 ${labels[j]}${b}（化${HE_LIU[key]}）`});
        // 三刑·子卯（无礼之刑，仅需两支同现）
        if (key===XING_LIU_KEY) results.push({type:'三刑',desc:`${labels[i]}${a} 刑 ${labels[j]}${b}（无礼之刑，${XING_LIU_MEANING}）`});
        // 六害
        if (HAI[key]) results.push({type:'害',desc:`${labels[i]}${a} 害 ${labels[j]}${b}（${HAI[key]}）`});
        // 六破
        if (PO[key]) results.push({type:'破',desc:`${labels[i]}${a} 破 ${labels[j]}${b}（${PO[key]}）`});
      }
    }
    // 三合
    for (const [a,b,c,name] of HE_SAN) {
      if ([a,b,c].every(z=>zhis.includes(z)))
        results.push({type:'三合',desc:`三合${name}`});
    }
    // 三会
    for (const [a,b,c,name] of HE_HUI) {
      if ([a,b,c].every(z=>zhis.includes(z)))
        results.push({type:'三会',desc:`三会${name}局（气最纯，比三合更集中）`});
    }
    // 三刑·寅巳申/丑戌未（三支皆现）
    for (const [a,b,c,name,meaning] of XING_SAN) {
      if ([a,b,c].every(z=>zhis.includes(z)))
        results.push({type:'三刑',desc:`三刑${name}（${meaning}）`});
    }
    // 自刑：统计同一地支在四柱中出现次数
    const count = {};
    for (const z of zhis) count[z] = (count[z]||0) + 1;
    for (const z of ['辰','午','酉','亥']) {
      if (count[z] >= 2)
        results.push({type:'自刑',desc:`${z}${z} 自刑（${ZI_XING_MEANING[z]}）`});
    }
    return results;
  }

  /* ══════════════════════════════════════════════════════════
   * 大运
   * ══════════════════════════════════════════════════════════ */

  static _extractDayuns(dm, yun) {
    const dayuns = [];
    try {
      const raw = yun.getDaYun();
      const today = new Date().getFullYear();
      for (let i=1; i<raw.length && i<10; i++) {
        const dy = raw[i];
        const gz = dy.getGanZhi ? dy.getGanZhi() : '';
        const gan = typeof gz==='string' ? gz[0] : (gz[0]||'');
        const zhi = typeof gz==='string' ? gz[1] : (gz[1]||'');
        const wx  = BaziEngine.STEM_WX[gan] || '木';
        const entry = {
          index: i,
          gan, zhi,
          wx, yang: BaziEngine.STEM_YANG[gan]??1,
          shishen: BaziEngine._shishen(dm, gan),
          startAge:  dy.getStartAge?.()  || 0,
          endAge:    dy.getEndAge?.()    || 0,
          startYear: dy.getStartYear?.() || 0,
          endYear:   dy.getEndYear?.()   || 0,
          favorable: false, // 由喜用神逻辑后置赋值
        };
        dayuns.push(entry);
      }
    } catch(e) { console.warn('[BaziEngine] 大运解析失败', e); }
    return dayuns;
  }

  /* ══════════════════════════════════════════════════════════
   * 流年 / 流月
   * ══════════════════════════════════════════════════════════ */

  static _liunianByYear(year) {
    try {
      const solar = Solar.fromYmd(year, 6, 1);
      const lunar = solar.getLunar();
      const gan = lunar.getYearGan();
      const zhi = lunar.getYearZhi();
      return { year, gan, zhi, wx: BaziEngine.STEM_WX[gan], yang: BaziEngine.STEM_YANG[gan]??1 };
    } catch(e) {
      const si=((year-4)%10+10)%10, bi=((year-4)%12+12)%12;
      const gan=BaziEngine.S[si], zhi=BaziEngine.B[bi];
      return { year, gan, zhi, wx: BaziEngine.STEM_WX[gan], yang: BaziEngine.STEM_YANG[gan]??1 };
    }
  }

  static _liuyue(year, month) {
    // 流月：以月份干支推算（五虎遁年起寅月）
    try {
      const solar = Solar.fromYmd(year, month, 15);
      const lunar  = solar.getLunar();
      const bazi   = lunar.getEightChar();
      return { year, month, gan: bazi.getMonthGan(), zhi: bazi.getMonthZhi(),
               wx: BaziEngine.STEM_WX[bazi.getMonthGan()] };
    } catch(e) { return { year, month, gan:'甲', zhi:'子', wx:'木' }; }
  }

  /* ══════════════════════════════════════════════════════════
   * 五行生克关系（供 _strength/_favorable 共享的唯一权威定义，避免同一
   * 逻辑在两处各自定义副本导致不同步——历史上曾出现过"我克"表被误抄成
   * "克我"表导致 _strength 计算污染的bug，修复时改为共享常量）
   * ══════════════════════════════════════════════════════════ */
  static WX_SHENG_BY = {木:'水',火:'木',土:'火',金:'土',水:'金'}; // 生我（印枭）
  static WX_SHENG    = {木:'火',火:'土',土:'金',金:'水',水:'木'}; // 我生（食伤）
  static WX_KE       = {木:'土',火:'金',土:'水',金:'木',水:'火'}; // 我克（财星）
  static WX_KE_BY    = {木:'金',火:'水',土:'木',金:'火',水:'土'}; // 克我（官杀）

  /* ══════════════════════════════════════════════════════════
   * 身强弱 + 喜用神
   * ══════════════════════════════════════════════════════════ */

  static _strength(dm, pillars, wuxingRaw) {
    // 生助日主的五行（印枭 + 比劫）
    const WX = BaziEngine.STEM_WX;
    const dmWx = WX[dm];
    const assist = wuxingRaw[dmWx]||0; // 比劫
    const print  = wuxingRaw[BaziEngine.WX_SHENG_BY[dmWx]]||0; // 印枭（生我）
    const consume = (wuxingRaw[BaziEngine.WX_SHENG[dmWx]]||0)      // 食伤（我生）
                   + (wuxingRaw[BaziEngine.WX_KE[dmWx]]||0)         // 财星（我克）
                   + (wuxingRaw[BaziEngine.WX_KE_BY[dmWx]]||0);     // 官杀（克我）
    const score = assist + print - consume;

    // 月令是否得令
    const monthBranch = pillars.month.branch;
    const monthWx = BaziEngine.BRANCH_WX[monthBranch];
    const delingOk = monthWx===dmWx || monthWx===BaziEngine.WX_SHENG_BY[dmWx];

    let category;
    if (score > 0.5 || (score > -0.5 && delingOk)) category = '身强';
    else if (score < -0.5) category = '身弱';
    else category = '中和';

    // ── 数值刻度（供仪表盘等UI用，不影响上面的三分类逻辑/阈值）──────────
    // assist+print+consume 恒等于全部五行权重之和（_calcWuxing 里 4 个天干各记1、
    // 4 个地支各记1且月支×1.5、每个地支的藏干权重固定合计1.0再乘0.5×月支系数），
    // 这是由权重方案本身决定的结构性常量，与具体八字数据无关，实测恒为10.75，
    // 因此可以放心用作线性映射的分母，不是拍脑袋估的经验范围。
    // 映射：score=0（中和轴心）→50分；score=±total（assist+print吃满/consume吃满
    // 五行权重的两个理论边界，真实命盘几乎不会触达，但作为分母在数学上精确恒定）
    // →0/100分。0.5这个阈值本身很窄（相对total=10.75），映射后中和区间只有约
    // 47.7~52.3分——这与三分类阈值±0.5本身就很窄是一致的，不是映射函数引入的失真。
    const total = assist + print + consume;
    const score100 = total > 0
      ? Math.max(0, Math.min(100, Math.round(50 + (score / total) * 50)))
      : 50;

    return { category, score: score100 };
  }

  static _favorable(strength, dm, wuxingRaw) {
    const WX = BaziEngine.STEM_WX;
    const dmWx = WX[dm];
    const SHENG_BY = BaziEngine.WX_SHENG_BY; // 生我
    const KE_BY    = BaziEngine.WX_KE_BY;    // 克我
    const SHENG    = BaziEngine.WX_SHENG;    // 我生
    const KE       = BaziEngine.WX_KE;       // 我克

    let favorable='', unfavorable='', favorable2='';
    if (strength==='身强') {
      // 身强：喜官杀、财，忌印、比劫
      favorable  = KE_BY[dmWx];
      favorable2 = KE[dmWx];
      unfavorable= dmWx;
    } else if (strength==='身弱') {
      // 身弱：喜印、比劫，忌官杀、财
      favorable  = SHENG_BY[dmWx];
      favorable2 = dmWx;
      unfavorable= KE_BY[dmWx];
    } else {
      // 中和：找最弱的五行补充
      const sorted = Object.entries(wuxingRaw).sort((a,b)=>a[1]-b[1]);
      favorable  = sorted[0][0];
      unfavorable= sorted[4][0];
    }
    return { favorable, unfavorable, favorable2 };
  }
}
