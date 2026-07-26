/**
 * 司马八字 · 分析模块 analysis.js
 *
 * 提供两类输出：
 *   Analysis.buildZonePanel(zoneKey, baziData) → HTML字符串（右侧滑出面板）
 *   Analysis.buildReport(baziData, container)  → 填充完整报告Modal
 */

const Analysis = (() => {

  // ── 五行色彩 ──────────────────────────────────────────
  const WX_COLOR = {
    '木':'#6FCF97','火':'#EB5757','土':'#c9a96e','金':'#A0AEC0','水':'#63B3ED'
  };
  const STEM_WX = {
    '甲':'木','乙':'木','丙':'火','丁':'火',
    '戊':'土','己':'土','庚':'金','辛':'金','壬':'水','癸':'水'
  };
  const BRANCH_WX = {
    '子':'水','丑':'土','寅':'木','卯':'木','辰':'土','巳':'火',
    '午':'火','未':'土','申':'金','酉':'金','戌':'土','亥':'水'
  };

  // 神煞吉凶
  const SHENSHA_GOOD = new Set(['将星','禄神','红鸾','天乙','文昌','天德','月德','天厨']);
  const SHENSHA_WARN = new Set(['亡神','劫煞','白虎','羊刃','七杀','官符','丧门']);

  // ── 工具函数 ────────────────────────────────────────
  function badge(text, type) {
    return `<span class="zone-badge badge-${type}">${text}</span>`;
  }

  function insight(text, type = 'neutral') {
    const icon = type === 'good' ? '✦' : type === 'warn' ? '⚠' : '◈';
    const cls  = type === 'good' ? 'insight-good' : type === 'warn' ? 'insight-warn' : '';
    return `<div class="insight-item ${cls}"><span class="insight-icon">${icon}</span><span>${text}</span></div>`;
  }

  function section(title, body) {
    return `<div class="zone-section"><div class="zone-section-title">${title}</div><div class="zone-section-body">${body}</div></div>`;
  }

  // ── 五行强弱文字 ──────────────────────────────────
  function wxStrength(score) {
    if (score >= 40) return '极旺';
    if (score >= 25) return '旺';
    if (score >= 15) return '中';
    if (score >= 5)  return '弱';
    return '极弱';
  }

  // ── 获取日主信息 ─────────────────────────────────
  function getDayMaster(baziData) {
    return (baziData.pillars && baziData.pillars.day) ? baziData.pillars.day.stem : '—';
  }

  // ── Zone面板内容定义 ─────────────────────────────
  const ZONES = {
    core: (d) => {
      const dm     = getDayMaster(d);
      const wx     = STEM_WX[dm] || '土';
      const color  = WX_COLOR[wx] || '#c9a96e';
      const scores = d.wuxing || {};
      const score  = scores[wx] || 0;
      const level  = wxStrength(score);
      return `
        <div>${badge(wx + '日主', 'neutral')}</div>
        <div class="zone-title" style="color:${color}">${dm}</div>
        <div class="zone-subtitle">日主 · ${wx}行 · ${level}</div>
        ${section('日主解析', `
          ${dm}属${wx}，${getDmDesc(dm)}
          ${insight('日主得令：' + level, score >= 20 ? 'good' : score < 10 ? 'warn' : 'neutral')}
        `)}
        ${section('与命盘互动', getDmInteraction(dm, d))}
      `;
    },
    shensha: (d) => {
      const ss = d.shenshe || [];
      if (!ss.length) return '<div class="zone-title">无主要神煞</div>';
      const goodSS = ss.filter(s => SHENSHA_GOOD.has(s));
      const warnSS = ss.filter(s => SHENSHA_WARN.has(s));
      let body = `<div>${badge('共 ' + ss.length + ' 神煞', 'neutral')}</div><div class="zone-title">神煞分布</div><div class="zone-subtitle">吉${goodSS.length}个 · 凶${warnSS.length}个</div>`;
      body += section('吉神', goodSS.length ? goodSS.map(s => insight(s + '：' + ssDesc(s), 'good')).join('') : '无主要吉神');
      body += section('凶煞', warnSS.length ? warnSS.map(s => insight(s + '：' + ssDesc(s), 'warn')).join('') : '无主要凶煞');
      return body;
    },
    kongwang: (d) => {
      const kw = d.kongwang || [];
      let body = `<div>${badge('空亡', 'warn')}</div><div class="zone-title">空亡之地</div><div class="zone-subtitle">${kw.length ? kw.join('、') : '无空亡'}</div>`;
      body += section('含义', kw.length
        ? insight('空亡之地代表虚空与缺失，' + kw.join('、') + '所代表的事物在此命盘中容易落空，需特别留意', 'warn')
        : insight('命盘中无空亡，命格较为完整', 'good'));
      return body;
    },
    dayun: (d) => {
      const dy = d.dayuns || [];
      let body = `<div>${badge('大运', 'neutral')}</div><div class="zone-title">大运行程</div><div class="zone-subtitle">十年一运</div>`;
      if (dy.length) {
        const runHtml = dy.slice(0, 6).map((r, i) => {
          const age = (r.startAge || 0) + '岁起';
          return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(201,169,110,.08);font-size:12px">
            <span style="color:#c9a96e">${r.gan || ''}${r.zhi || ''}</span>
            <span style="color:rgba(232,224,208,.5)">${age}</span>
          </div>`;
        }).join('');
        body += section('运程表', runHtml);
      } else {
        body += section('运程', '<span style="color:rgba(232,224,208,.4)">大运数据计算中</span>');
      }
      return body;
    },
    nayin: (d) => {
      const nayin   = (d.nayin || {}).day || '—';
      let body = `<div>${badge('纳音', 'neutral')}</div><div class="zone-title">${nayin}</div><div class="zone-subtitle">日柱纳音</div>`;
      body += section('纳音解析', insight(nayin + '：' + nayinDesc(nayin), 'neutral'));
      return body;
    },
  };

  // ── 公开：构建Zone面板 ───────────────────────────
  function buildZonePanel(zoneKey, baziData) {
    // 柱位路由
    if (zoneKey.startsWith('pillar_')) {
      return buildPillarPanel(zoneKey.replace('pillar_', ''), baziData);
    }
    const fn = ZONES[zoneKey];
    if (!fn) return `<div class="zone-title">区域：${zoneKey}</div>`;
    return fn(baziData);
  }

  // ── 公开：构建完整报告 ───────────────────────────
  function buildReport(baziData, container) {
    if (!container || !baziData) return;

    const d  = baziData;
    const dm = getDayMaster(d);
    const p  = d.pillars || {};
    const wx = d.wuxing || {};

    // 四柱HTML
    const cols   = ['year','month','day','hour'];
    const labels = { year:'年柱',month:'月柱',day:'日柱',hour:'时柱' };
    let pillarHtml = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid rgba(201,169,110,.2);border-radius:8px;overflow:hidden;margin:12px 0">';
    cols.forEach(col => {
      const pl = p[col] || {};
      pillarHtml += `<div style="display:flex;flex-direction:column;text-align:center;${col!=='hour'?'border-right:1px solid rgba(201,169,110,.1)':''}">
        <div style="padding:5px;font-size:10px;color:rgba(232,224,208,.4);background:rgba(201,169,110,.05);border-bottom:1px solid rgba(201,169,110,.1)">${labels[col]}</div>
        <div style="padding:8px 4px;font-size:22px;font-weight:700">${pl.stem||'—'}</div>
        <div style="padding:4px;font-size:17px">${pl.branch||'—'}</div>
        <div style="padding:4px;font-size:10px;color:#c9a96e">${(d.nayin||{})[col]||''}</div>
      </div>`;
    });
    pillarHtml += '</div>';

    // 五行分析HTML
    const totalWx = Object.values(wx).reduce((a,b)=>a+b,0) || 1;
    let wxHtml = '<div style="display:flex;flex-direction:column;gap:10px">';
    Object.entries(wx).sort((a,b)=>b[1]-a[1]).forEach(([el, sc]) => {
      const pct = Math.round(sc / totalWx * 100);
      wxHtml += `<div style="display:flex;align-items:center;gap:10px">
        <span style="width:14px;font-size:12px;color:${WX_COLOR[el]||'#e8e0d0'}">${el}</span>
        <div style="flex:1;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${WX_COLOR[el]||'#c9a96e'};border-radius:3px"></div>
        </div>
        <span style="font-size:11px;color:rgba(232,224,208,.5);width:28px">${pct}%</span>
        <span style="font-size:10px;color:rgba(232,224,208,.3)">${wxStrength(sc)}</span>
      </div>`;
    });
    wxHtml += '</div>';

    // 神煞HTML
    const ss = d.shenshe || [];
    const ssHtml = ss.length
      ? ss.map(s => {
          const isGood = SHENSHA_GOOD.has(s);
          const isWarn = SHENSHA_WARN.has(s);
          const cls = isGood ? '#6FCF97' : isWarn ? '#EB5757' : '#c9a96e';
          return `<span style="display:inline-block;margin:3px;padding:3px 10px;border-radius:12px;font-size:11px;border:1px solid ${cls}44;color:${cls};background:${cls}11">${s}</span>`;
        }).join('')
      : '<span style="color:rgba(232,224,208,.3)">无主要神煞</span>';

    // 空亡
    const kw     = d.kongwang || [];
    const kwHtml = kw.length
      ? kw.map(k => `<span style="color:#EB5757;font-weight:600">${k}</span>`).join('、')
      : '<span style="color:rgba(232,224,208,.3)">无空亡</span>';

    // 大运
    const dy = d.dayuns || [];
    const dyHtml = dy.length
      ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
        dy.slice(0, 6).map(r => `<div style="text-align:center;padding:8px;border:1px solid rgba(201,169,110,.15);border-radius:8px">
          <div style="font-size:16px;font-weight:600;color:#c9a96e">${r.gan||''}${r.zhi||''}</div>
          <div style="font-size:10px;color:rgba(232,224,208,.4);margin-top:4px">${r.startAge||''}岁起</div>
        </div>`).join('') + '</div>'
      : '<span style="color:rgba(232,224,208,.3)">大运数据计算中</span>';

    container.innerHTML = `
      <div class="report-section">
        <div class="report-section-head">四柱八字</div>
        <div class="report-section-body">${pillarHtml}</div>
      </div>
      <div class="report-section">
        <div class="report-section-head">日主分析</div>
        <div class="report-section-body">
          <p style="margin-bottom:12px"><strong style="color:#c9a96e;font-size:18px">${dm}</strong> · ${STEM_WX[dm]||''}行</p>
          <p>${getDmDesc(dm)}</p>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-head">五行强弱</div>
        <div class="report-section-body">${wxHtml}</div>
      </div>
      <div class="report-section">
        <div class="report-section-head">神煞</div>
        <div class="report-section-body">${ssHtml}</div>
      </div>
      <div class="report-section">
        <div class="report-section-head">空亡</div>
        <div class="report-section-body">${kwHtml}</div>
      </div>
      <div class="report-section">
        <div class="report-section-head">大运行程</div>
        <div class="report-section-body">${dyHtml}</div>
      </div>
    `;
  }

  // ── 描述文本库 ─────────────────────────────────
  function getDmDesc(stem) {
    const desc = {
      '甲':'甲木如参天大树，阳刚正直，具有强大生命力，主领导力与开创精神，性格直率，志向高远。',
      '乙':'乙木如翠竹柔藤，柔中带韧，适应力强，善于借力而为，人际关系和谐，审美敏锐。',
      '丙':'丙火如骄阳烈焰，热情豪爽，光明磊落，感染力强，富贵显赫之象，但需防燥烈过急。',
      '丁':'丁火如灯烛温光，内敛细腻，智慧深邃，感情丰富，具有艺术天赋，情感细腻入微。',
      '戊':'戊土如巍峨山岳，厚重稳健，信用可靠，有担当，适合担任重要职责，处事沉稳大气。',
      '己':'己土如沃野良田，包容万物，服务意识强，踏实勤勉，适合从事培育与辅助性工作。',
      '庚':'庚金如坚锋利刃，正义果断，行动力强，具有开拓精神，个性鲜明，不惧挑战。',
      '辛':'辛金如珍珠宝石，精致细腻，品味高雅，追求完美，审美力强，才智出众。',
      '壬':'壬水如浩瀚江海，包容万象，智慧深远，思维敏捷，善于谋划布局，格局宏大。',
      '癸':'癸水如霏霏细雨，温柔细腻，直觉敏锐，内心丰富，具有艺术与哲学天赋。',
    };
    return desc[stem] || stem + '日主，命格独特。';
  }

  function getDmInteraction(stem, d) {
    const wx     = STEM_WX[stem] || '土';
    const scores = d.wuxing || {};
    const score  = scores[wx] || 0;
    const level  = wxStrength(score);

    const tips = [];
    if (score >= 30) tips.push(insight('日主之气极旺，宜用官杀或财星来疏导', 'warn'));
    else if (score < 10) tips.push(insight('日主力量偏弱，需要印星或比劫来扶助', 'warn'));
    else tips.push(insight('日主得中，命盘均衡，各方面发展较为顺遂', 'good'));

    const ss = d.shenshe || [];
    if (ss.includes('将星')) tips.push(insight('将星临命，具有领导气质与权威格局', 'good'));
    if (ss.includes('文昌')) tips.push(insight('文昌入命，学业出色，考运亨通', 'good'));
    if (ss.includes('红鸾')) tips.push(insight('红鸾现身，桃花运旺，感情生活活跃', 'good'));
    if (ss.includes('亡神')) tips.push(insight('亡神入局，需防意外与人际纷争', 'warn'));

    return tips.join('') || insight('命盘运行正常，持续积累正向能量', 'neutral');
  }

  function ssDesc(ss) {
    const map = {
      '将星':'权威领导之星，主官贵与权力',
      '禄神':'衣食禄气，主事业财运亨通',
      '红鸾':'桃花情缘之星，主感情与婚姻',
      '天乙':'贵人之星，逢凶化吉，遇难呈祥',
      '文昌':'学业文书之星，主智慧与功名',
      '天德':'天赐吉神，逢凶化吉之力',
      '月德':'月令德星，主平安顺遂',
      '亡神':'主损耗、意外与人际是非',
      '劫煞':'主破财、竞争与冲突',
      '白虎':'主伤病、破财与血光之灾',
      '羊刃':'主刑克、意外，但也主意志力强',
    };
    return map[ss] || ss + '神煞，影响命运走向';
  }

  function nayinDesc(nayin) {
    const map = {
      '海中金':'内敛深沉，潜力巨大，需时间磨炼方能显露锋芒',
      '炉中火':'热情积极，内力充足，光明前途，但需防急躁',
      '大林木':'根基深厚，茁壮成长，利于长期耕耘',
      '路旁土':'平稳务实，踏实勤勉，适合积累稳定资产',
      '剑锋金':'锋芒毕露，行动果断，适合开拓性事业',
      '涧下水':'柔韧流动，适应力强，善于寻找机会',
      '城头土':'坚固稳健，守成有力，利于守业',
      '白蜡金':'精致细腻，品质优良，适合精密行业',
      '杨柳木':'随风而动，灵活多变，人际关系佳',
      '泉中水':'源远流长，内涵丰富，潜力深厚',
      '屋上土':'安居乐业，家庭稳定，利于置产',
      '霹雳火':'雷霆之势，爆发力强，适合突破性事业',
      '松柏木':'四季常青，志向坚定，长寿健康',
      '长流水':'生生不息，广纳百川，事业广泛',
      '砂中金':'含而不露，内力深厚，需历练方显',
      '山头火':'高处明亮，志向高远，利于名誉地位',
      '涧下水':'柔韧流动，适应力强，善于寻找机会',
      '平地木':'平稳扎实，利于耕耘，根基牢固',
      '壁上土':'刚直方正，守规蹈矩，利于法律行政',
      '金箔金':'薄而精华，品质出众，适合精英领域',
      '覆灯火':'温暖照人，慈悲为怀，适合服务行业',
      '天河水':'广博深远，格局宏大，利于开创大业',
      '大驿土':'四通八达，人脉广博，适合商贸往来',
      '钗钏金':'精美华贵，品位高雅，利于艺术文化',
      '桑柘木':'用途广泛，实用性强，适合多元发展',
      '大溪水':'汇聚众流，包容万象，利于团队管理',
      '砂中土':'沉稳踏实，内蕴丰富，厚积薄发',
      '天上火':'光芒四射，热情奔放，利于展示与表演',
      '石榴木':'鲜艳夺目，果实丰盛，利于创新创业',
      '大海水':'博大精深，海纳百川，志向远大',
    };
    return map[nayin] || nayin + '：纳音五行，影响人生格局与气质';
  }

  // ── 四柱柱位面板 ──────────────────────────────────────
  const PILLAR_LABEL = { year:'年柱', month:'月柱', day:'日柱', hour:'时柱' };
  const PILLAR_ROLE  = {
    year :'祖上根基·早年运势',
    month:'父母事业·青年运势',
    day  :'日主本体·配偶宫位',
    hour :'子女晚年·内心志向',
  };

  function buildPillarPanel(col, baziData) {
    const p      = baziData.pillars || {};
    const pillar = p[col] || {};
    const stem   = pillar.stem   || '—';
    const branch = pillar.branch || '—';
    const nayin  = (baziData.nayin||{})[col]||'';
    const wx     = STEM_WX[stem] || '';
    const color  = WX_COLOR[wx]  || '#c9a96e';
    const isDay  = col === 'day';

    let body = `
      <div>${badge(PILLAR_LABEL[col], 'neutral')}</div>
      <div class="zone-title" style="color:${color}">${stem}${branch}</div>
      <div class="zone-subtitle">${PILLAR_ROLE[col]}</div>
    `;
    if (nayin) body += section('纳音', insight(nayin + '：' + nayinDesc(nayin), 'neutral'));
    if (isDay) body += section('日主含义', insight(getDmDesc(stem), 'neutral'));

    // 藏干
    const branchInfo = CONFIG?.BRANCHES_INFO?.[branch];
    if (branchInfo?.hidden?.length) {
      const hiddenText = branchInfo.hidden.map(h => h.s).join('、');
      body += section('藏干', insight('地支' + branch + '藏干：' + hiddenText, 'neutral'));
    }

    return body;
  }

  // ── 单个神煞面板 ─────────────────────────────────────
  function buildShenshaPanel(name, baziData) {
    const isGood = SHENSHA_GOOD.has(name);
    const isWarn = SHENSHA_WARN.has(name);
    const type   = isGood ? 'good' : isWarn ? 'warn' : 'neutral';
    const icon   = isGood ? '✦ 吉神' : isWarn ? '⚠ 凶煞' : '◈ 中性';

    return `
      <div>${badge(icon, type)}</div>
      <div class="zone-title">${name}</div>
      <div class="zone-subtitle">神煞 · 命盘标记</div>
      ${section('含义', insight(ssDesc(name), type))}
      ${section('对你的影响', insight(_ssPersonalImpact(name, baziData), type))}
    `;
  }

  function _ssPersonalImpact(name, baziData) {
    const dm = getDayMaster(baziData);
    const wx = STEM_WX[dm] || '土';
    const impacts = {
      '将星': `${dm}日主遇将星，领导气质天生，适合统筹管理，宜从事有权责的职业`,
      '禄神': `禄神护命，${wx}行之禄，衣食无忧，事业财运有稳定根基`,
      '红鸾': `红鸾入命，感情运势活跃，${dm}日主易遇有缘之人，桃花可期`,
      '天乙': `天乙贵人相伴，${dm}日主逢难必有贵人相助，人生少走弯路`,
      '文昌': `文昌星高照，${dm}日主文思敏锐，学业考试有利，适合知识创作`,
      '亡神': `亡神入局，需防暗中损耗，${dm}日主宜多储备资源，谨慎决策`,
      '劫煞': `劫煞临命，${dm}日主需防竞争与争夺，宜低调行事，避免树敌`,
      '白虎': `白虎现身，宜注意身体健康与外伤，${dm}日主出行需谨慎`,
      '驿马': `驿马星动，${dm}日主奔波迁移在即，变动中孕育机遇`,
    };
    return impacts[name] || `${name}入命，对${dm}日主的${wx}行格局产生深远影响，宜把握其吉意，化解其凶性`;
  }

  return { buildZonePanel, buildPillarPanel, buildShenshaPanel, buildReport };
})();
