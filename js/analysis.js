/**
 * 司马八字 · 分析模块 analysis.js
 *
 * 公开 API：
 *   Analysis.buildZonePanel(zoneKey, baziData) → HTML 字符串（右侧标注面板）
 *   Analysis.buildReport(baziData, container)  → 填充完整报告 Modal（含 AI 异步加载）
 *   Analysis.buildPillarPanel(col, baziData)   → HTML 字符串
 *   Analysis.buildShenshaPanel(name, baziData) → HTML 字符串
 */

const Analysis = (() => {

  // ── 五行色彩 ────────────────────────────────────────
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

  const SHENSHA_GOOD = new Set(['将星','禄神','红鸾','天乙','文昌','天德','月德','天厨','驿马']);
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

  function wxStrength(score) {
    if (score >= 40) return '极旺';
    if (score >= 25) return '旺';
    if (score >= 15) return '中';
    if (score >= 5)  return '弱';
    return '极弱';
  }

  function getDayMaster(baziData) {
    return (baziData.pillars && baziData.pillars.day) ? baziData.pillars.day.stem : '—';
  }

  // ── 静态喜用神建议（fallback）────────────────────────
  const FAV_ADVICE = {
    '木': { career:'适合教育、林业、设计、出版、医疗等木行事业', wealth:'财运稳中有升，以技艺换财为宜，长线投资胜于短线', health:'宜养肝胆，多接触自然，保持身心舒展', relationships:'与木行属性之人缘分深，感情细腻温润', development:'培养创造力与长期规划能力', spirit:'以生长与创造为精神内核，追求持续进步', color:'绿色、青色为吉色', dir:'东方为利方' },
    '火': { career:'适合传媒、演艺、科技、能源、餐饮等火行事业', wealth:'财运旺盛时期把握速战速决，注意防止财来财去', health:'宜养心脏与眼睛，保持情绪稳定积极', relationships:'感情热情奔放，与火行之人磁场契合', development:'学习深耕与沉淀，平衡热情与理性', spirit:'以光明与激情为精神追求，活出自我', color:'红色、橙色为吉色', dir:'南方为利方' },
    '土': { career:'适合房地产、农业、建筑、管理、金融等土行事业', wealth:'财运踏实稳健，擅于积累，适合稳健理财', health:'宜养脾胃，饮食规律，避免过劳', relationships:'感情稳重踏实，与土行之人互补默契', development:'提升变通能力，在稳定中寻求突破', spirit:'以厚重与包容为精神底色，承载他人', color:'黄色、棕色为吉色', dir:'中央及西南为利方' },
    '金': { career:'适合金融、法律、军警、五金、珠宝等金行事业', wealth:'财运集中爆发，决断力强，适合抓住关键机遇', health:'宜养肺与大肠，注意呼吸系统健康', relationships:'感情果断专一，与金行之人志同道合', development:'培养柔性沟通，以刚柔并济驾驭人际', spirit:'以正义与秩序为精神支柱，追求极致', color:'白色、金色为吉色', dir:'西方为利方' },
    '水': { career:'适合航运、水利、传媒、哲学、艺术等水行事业', wealth:'财运流动，善于从信息与智慧中获利', health:'宜养肾脏与膀胱，保证充足睡眠', relationships:'感情深邃细腻，与水行之人灵魂相通', development:'增强行动力与落地执行，将智慧转化为成果', spirit:'以智慧与包容为精神本源，探索内在深度', color:'蓝色、黑色为吉色', dir:'北方为利方' },
  };

  // ── Zone 面板定义 ───────────────────────────────────
  const ZONES = {
    core: (d) => {
      const dm    = getDayMaster(d);
      const wx    = STEM_WX[dm] || '土';
      const color = WX_COLOR[wx] || '#c9a96e';
      const scores= d.wuxing || {};
      const score = scores[wx] || 0;
      const level = wxStrength(score);
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
      const ss = d.shenshe || d.shensha || [];
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
        const runHtml = dy.slice(0, 6).map(r => {
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
      const nayin = (d.nayin || {}).day || '—';
      let body = `<div>${badge('纳音', 'neutral')}</div><div class="zone-title">${nayin}</div><div class="zone-subtitle">日柱纳音</div>`;
      body += section('纳音解析', insight(nayin + '：' + nayinDesc(nayin), 'neutral'));
      return body;
    },
  };

  function buildZonePanel(zoneKey, baziData) {
    if (zoneKey.startsWith('pillar_')) {
      return buildPillarPanel(zoneKey.replace('pillar_', ''), baziData);
    }
    const fn = ZONES[zoneKey];
    if (!fn) return `<div class="zone-title">区域：${zoneKey}</div>`;
    return fn(baziData);
  }

  // ══════════════════════════════════════════════════════
  //  完整报告（Tab 布局 + AI 异步加载）
  // ══════════════════════════════════════════════════════

  /**
   * @param {object} baziData
   * @param {Element} container
   * @param {object} [opts]
   * @param {boolean} [opts.isNewUser]        - 是否显示新用户"探索"按钮栏
   * @param {Function} [opts.onStartExplore]  - "开始探索命盘"回调
   * @param {Function} [opts.onSkip]          - "暂时跳过"回调
   */
  function buildReport(baziData, container, opts) {
    if (!container || !baziData) return;
    opts = opts || {};

    const d     = baziData;
    const dm    = getDayMaster(d);
    const dmWx  = d.dayMasterWx || STEM_WX[dm] || '土';
    const dmCol = WX_COLOR[dmWx] || '#c9a96e';
    const p     = d.pillars  || {};
    const wx    = d.wuxing   || {};
    // favorable 从引擎返回是字符串（如"木"），从 Supabase 可能是字符串或数组
    const fav = (() => {
      if (Array.isArray(d.favorable)) return d.favorable;
      const f = d.favorable ? [d.favorable] : [];
      if (d.favorable2 && !f.includes(d.favorable2)) f.push(d.favorable2);
      return f;
    })();

    // ── 命格强弱 ──────────────────────────────────────
    const strength = d.strength || '';
    const strengthText = typeof strength === 'number'
      ? (strength >= 50 ? '身强' : strength >= 30 ? '中和' : '身弱')
      : (strength || '中和');

    // ── Tab 1：总览（静态，立即显示）────────────────────
    const summaryHtml = `
      <div class="report-summary">
        <div class="report-summary-dm">
          <div class="report-summary-char" style="color:${dmCol}">${dm}</div>
          <div class="report-summary-meta">
            <div class="report-summary-label">${dmWx}行 · ${strengthText}</div>
            <div class="report-summary-sub">${d.dayMasterNature || getDmDesc(dm).slice(0, 28) + '…'}</div>
          </div>
        </div>
        <div class="report-summary-desc">${getDmDesc(dm)}</div>
        <div id="r-keywords" class="r-keywords" style="display:none"></div>
      </div>`;

    // 四柱网格
    const cols   = ['year','month','day','hour'];
    const labels = { year:'年柱', month:'月柱', day:'日柱', hour:'时柱' };
    let pillarHtml = '<div class="report-pillar-grid">';
    cols.forEach(col => {
      const pl   = p[col] || {};
      const sWx  = STEM_WX[pl.stem]   || '';
      const bWx  = BRANCH_WX[pl.branch] || '';
      const sc   = WX_COLOR[sWx] || '#e8e0d0';
      const bc   = WX_COLOR[bWx] || 'rgba(232,224,208,.7)';
      const nayin= (d.nayin || {})[col] || '';
      pillarHtml += `
        <div class="report-pillar-col">
          <div class="report-pillar-header">${labels[col]}</div>
          <div class="report-pillar-stem" style="color:${sc}">${pl.stem||'—'}</div>
          <div class="report-pillar-branch" style="color:${bc}">${pl.branch||'—'}</div>
          <div class="report-pillar-nayin">${nayin}</div>
        </div>`;
    });
    pillarHtml += '</div>';

    // 五行强弱
    const totalWx = Object.values(wx).reduce((a,b)=>a+b,0) || 1;
    let wxHtml = '';
    Object.entries(wx).sort((a,b)=>b[1]-a[1]).forEach(([el, sc]) => {
      const pct = Math.round(sc / totalWx * 100);
      wxHtml += `<div class="report-wx-row">
        <span class="report-wx-el" style="color:${WX_COLOR[el]||'#e8e0d0'}">${el}</span>
        <div class="report-wx-bar-wrap">
          <div class="report-wx-bar" style="width:${pct}%;background:${WX_COLOR[el]||'#c9a96e'}"></div>
        </div>
        <span class="report-wx-pct">${pct}%</span>
        <span class="report-wx-level">${wxStrength(sc)}</span>
      </div>`;
    });
    const weakEls   = Object.entries(wx).filter(([,v])=>v<10).map(([k])=>k);
    const strongEls = Object.entries(wx).filter(([,v])=>v>=30).map(([k])=>k);
    let wxNote = '';
    if (weakEls.length)   wxNote += `<div style="font-size:11px;color:rgba(232,224,208,.35);margin-top:10px;letter-spacing:.5px">· ${weakEls.join('、')}行力量偏弱，宜通过喜用神加以补充</div>`;
    if (strongEls.length) wxNote += `<div style="font-size:11px;color:rgba(232,224,208,.35);margin-top:4px;letter-spacing:.5px">· ${strongEls.join('、')}行力量偏旺，宜适当疏导平衡</div>`;

    // 喜用神（静态版）
    let favHtml = '';
    if (fav.length) {
      const favChips = fav.map(el => {
        const col = WX_COLOR[el] || '#c9a96e';
        return `<div class="report-fav-el" style="border-color:${col}33;background:${col}0a">
          <div class="report-fav-char" style="color:${col}">${el}</div>
          <div class="report-fav-name" style="color:${col}">喜用</div>
        </div>`;
      }).join('');
      const mainFav = fav[0];
      const adv     = FAV_ADVICE[mainFav] || {};
      const advItems = [
        { icon:'💼', text: adv.career       || '以喜用神行业为发展重心' },
        { icon:'💰', text: adv.wealth       || '擅用五行属性行业积累财富' },
        { icon:'🤝', text: adv.relationships|| '结交喜用神五行属性的贵人' },
        { icon:'🌿', text: adv.health       || '注意与喜用神五行对应的脏腑养护' },
        { icon:'🎨', text: adv.color + ' · ' + adv.dir || '穿戴喜用颜色，朝利方发展' },
      ].map(a => `<div class="report-advice-item">
        <span class="report-advice-icon">${a.icon}</span>
        <span class="report-advice-text">${a.text}</span>
      </div>`).join('');
      favHtml = `<div class="report-fav-grid">${favChips}</div>
        <div style="border-top:1px solid rgba(255,255,255,.05);padding-top:14px">${advItems}</div>`;
    } else {
      favHtml = '<span style="color:rgba(232,224,208,.3)">喜用神数据计算中</span>';
    }

    // 神煞
    const ss    = Array.isArray(d.shenshe) ? d.shenshe : (Array.isArray(d.shensha) ? d.shensha : []);
    const ssHtml= ss.length
      ? `<div class="report-ss-tags">` + ss.map(s => {
          const isGood = SHENSHA_GOOD.has(s);
          const isWarn = SHENSHA_WARN.has(s);
          const col = isGood ? '#6FCF97' : isWarn ? '#EB5757' : '#c9a96e';
          return `<span class="report-ss-tag" style="border-color:${col}44;color:${col};background:${col}0d">${s}</span>`;
        }).join('') + `</div>`
      : '<span style="color:rgba(232,224,208,.3)">无主要神煞</span>';

    // 空亡
    const kw    = Array.isArray(d.kongwang) ? d.kongwang : [];
    const kwHtml= kw.length
      ? `<div style="margin-bottom:10px">${kw.map(k=>`<span style="font-size:22px;color:#EB5757;letter-spacing:4px;font-weight:300">${k}</span>`).join('<span style="color:rgba(232,224,208,.3);margin:0 8px">·</span>')}</div>
         <div style="font-size:12px;color:rgba(232,224,208,.4);line-height:1.8">${kw.join('、')}所对应的事物在此命盘中容易落空或难以把握，宜顺势而为，避免强求。</div>`
      : '<span style="color:rgba(111,207,151,.6)">无空亡 — 命格较为完整</span>';

    // 大运
    const dy    = Array.isArray(d.dayuns) ? d.dayuns : [];
    const dyHtml= dy.length
      ? `<div class="report-dayun-grid">` +
        dy.slice(0,6).map(r => `
          <div class="report-dayun-cell">
            <div class="report-dayun-ganzhi">${r.gan||''}${r.zhi||''}</div>
            <div class="report-dayun-age">${r.startAge||''}岁起</div>
          </div>`).join('') + `</div>`
      : '<span style="color:rgba(232,224,208,.3)">大运数据计算中</span>';

    // ── AI 占位（shimmer）────────────────────────────
    const aiShimmer = `
      <div class="ai-loading" id="ai-loading-block">
        <div class="ai-shimmer"></div>
        <div class="ai-shimmer medium"></div>
        <div class="ai-shimmer short"></div>
        <div style="margin-top:14px">
          <div class="ai-shimmer"></div>
          <div class="ai-shimmer medium"></div>
          <div class="ai-shimmer"></div>
          <div class="ai-shimmer short"></div>
        </div>
        <div style="font-size:10px;color:rgba(201,169,110,.35);letter-spacing:2px;margin-top:16px;text-align:center">✦ AI 正在深度解读命盘 ✦</div>
      </div>`;

    const dimShimmer = `
      <div class="ai-loading" id="dim-loading-block">
        <div class="ai-shimmer short"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
          ${[1,2,3,4,5,6].map(()=>`<div style="height:90px;background:rgba(201,169,110,.04);border:1px solid rgba(201,169,110,.08);border-radius:10px"></div>`).join('')}
        </div>
        <div style="font-size:10px;color:rgba(201,169,110,.35);letter-spacing:2px;margin-top:16px;text-align:center">✦ AI 正在推演运势详解 ✦</div>
      </div>`;

    // ── 组装 Tab 结构 ────────────────────────────────
    container.innerHTML = `
      <div class="r-tabs">
        <button class="r-tab active" data-tab="overview">总览</button>
        <button class="r-tab"        data-tab="deep">AI深析</button>
        <button class="r-tab"        data-tab="advice">运势详解</button>
        <button class="r-tab"        data-tab="dayun">大运神煞</button>
      </div>

      <!-- Tab 1：总览 -->
      <div class="r-tab-panel active" id="r-panel-overview">
        ${summaryHtml}
        <div class="report-section">
          <div class="report-section-head"><span class="r-icon">⊞</span>四柱八字</div>
          <div class="report-section-body">${pillarHtml}</div>
        </div>
        <div class="report-section">
          <div class="report-section-head"><span class="r-icon">◈</span>五行强弱</div>
          <div class="report-section-body">${wxHtml}${wxNote}</div>
        </div>
        <div class="report-section">
          <div class="report-section-head"><span class="r-icon">✦</span>喜用神与人生方向</div>
          <div class="report-section-body">${favHtml}</div>
        </div>
      </div>

      <!-- Tab 2：AI深析 -->
      <div class="r-tab-panel" id="r-panel-deep">
        ${aiShimmer}
        <div id="ai-deep-content" style="display:none"></div>
      </div>

      <!-- Tab 3：六维建议 -->
      <div class="r-tab-panel" id="r-panel-advice">
        ${dimShimmer}
        <div id="ai-advice-content" style="display:none"></div>
      </div>

      <!-- Tab 4：大运神煞 -->
      <div class="r-tab-panel" id="r-panel-dayun">
        <div class="report-section">
          <div class="report-section-head"><span class="r-icon">⏳</span>大运行程</div>
          <div class="report-section-body">${dyHtml}</div>
        </div>
        <div class="report-section">
          <div class="report-section-head"><span class="r-icon">⋆</span>神煞</div>
          <div class="report-section-body">${ssHtml}</div>
        </div>
        <div class="report-section">
          <div class="report-section-head"><span class="r-icon">◎</span>空亡</div>
          <div class="report-section-body">${kwHtml}</div>
        </div>
      </div>
    `;

    // ── 新用户"探索"按钮栏（仅新用户显示）──────────────
    if (opts.isNewUser) {
      const barEl = document.createElement('div');
      barEl.className = 'report-newuser-bar';
      barEl.innerHTML = `
        <button class="report-skip-btn" id="report-newuser-skip">稍后再说</button>
        <button class="report-explore-btn" id="report-newuser-explore">开始探索我的命盘 →</button>
      `;
      container.appendChild(barEl);
      // 事件绑定（不用 onclick="" 字符串，避免闭包变量引用问题）
      barEl.querySelector('#report-newuser-skip')?.addEventListener('click', () => {
        (opts.onSkip || (() => {}))();
      });
      barEl.querySelector('#report-newuser-explore')?.addEventListener('click', () => {
        (opts.onStartExplore || (() => {}))();
      });
    }

    // ── Tab 切换事件 ──────────────────────────────────
    container.querySelectorAll('.r-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.r-tab').forEach(t => t.classList.remove('active'));
        container.querySelectorAll('.r-tab-panel').forEach(pp => pp.classList.remove('active'));
        tab.classList.add('active');
        container.querySelector('#r-panel-' + tab.dataset.tab)?.classList.add('active');
      });
    });

    // ── 启动 AI 异步加载 ──────────────────────────────
    if (typeof BaziAnalysis !== 'undefined') {
      const gender = d.gender || (typeof _gender !== 'undefined' ? _gender : '男');
      BaziAnalysis.getAnalysis(d, gender).then(analysis => {
        if (analysis) {
          _populateAiContent(container, analysis, d);
        } else {
          _showAiFallback(container, d);
        }
      });
    }
  }

  // ── AI 内容填充（六步命理框架）───────────────────────
  // ai 结构：step1_foundation / step2_pattern_yongshen / step3_career_wealth /
  //          step4_relationship / step5_health / step6_dayun_liunian / keywords
  // 六步顺序按 step1→step6 依次渲染，分两个Tab承载：
  //   Tab「AI深析」= step1（命局基础扫描）+ step2（格局与用神）
  //   Tab「运势详解」= step3（事业财富）→ step4（婚恋）→ step5（健康）→ step6（大运流年）
  function _populateAiContent(container, ai, d) {
    ai = ai || {};

    // 关键词（结构未变，逻辑不动）
    if (ai.keywords && ai.keywords.length) {
      const kwEl = container.querySelector('#r-keywords');
      if (kwEl) {
        kwEl.innerHTML = ai.keywords.map(k =>
          `<span class="r-keyword">${k}</span>`
        ).join('');
        kwEl.style.display = 'flex';
      }
    }

    // ─ Tab 2：AI 深析 = step1 + step2 ─
    const s1 = ai.step1_foundation || {};
    const s2 = ai.step2_pattern_yongshen || {};

    let deepHtml = '';
    if (s1.narrative || s1.title) {
      deepHtml += `<div class="report-section">
        <div class="report-section-head"><span class="r-icon">✦</span>${s1.title || '命局「出厂设置」扫描'}</div>
        <div class="report-section-body">
          ${s1.narrative ? `<p class="ai-narrative">${s1.narrative}</p>` : ''}
          ${s1.wuxing_note ? `<div style="margin-top:10px">${insight(s1.wuxing_note, 'neutral')}</div>` : ''}
        </div>
      </div>`;
    }
    if (s2.narrative || s2.title || s2.pattern) {
      const yongshenArr = Array.isArray(s2.yongshen) ? s2.yongshen : (s2.yongshen ? [s2.yongshen] : []);
      const yongshenChips = yongshenArr.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px">${yongshenArr.map(y => badge(y, 'neutral')).join('')}</div>`
        : '';
      deepHtml += `<div class="report-section">
        <div class="report-section-head"><span class="r-icon">⊞</span>${s2.title || '定格局与找用神'}</div>
        <div class="report-section-body">
          ${s2.pattern ? `<span class="ai-pattern">⊞ ${s2.pattern}</span>` : ''}
          ${yongshenChips}
          ${s2.narrative ? `<p class="ai-narrative" style="margin-top:${(s2.pattern || yongshenChips) ? '12px' : '0'}">${s2.narrative}</p>` : ''}
        </div>
      </div>`;
    }

    const deepEl = container.querySelector('#ai-deep-content');
    const loadEl = container.querySelector('#ai-loading-block');
    if (deepEl) {
      deepEl.innerHTML  = deepHtml || '<div style="color:rgba(232,224,208,.35);padding:20px;text-align:center">AI分析加载完成，暂无详细数据</div>';
      deepEl.style.display = 'block';
    }
    if (loadEl) loadEl.style.display = 'none';

    // ─ Tab 3：运势详解 = step3 → step4 → step5 → step6 ─
    const s3 = ai.step3_career_wealth || {};
    const s4 = ai.step4_relationship  || {};
    const s5 = ai.step5_health        || {};
    const s6 = ai.step6_dayun_liunian || {};

    let adviceHtml = '';

    if (s3.narrative || s3.title) {
      const dirs = Array.isArray(s3.career_directions) ? s3.career_directions : [];
      const dirHtml = dirs.length
        ? `<div style="margin-top:10px">${dirs.map(c => insight(c, 'good')).join('')}</div>`
        : '';
      adviceHtml += `<div class="report-section">
        <div class="report-section-head"><span class="r-icon">💼</span>${s3.title || '事业与财富深度剖析'}</div>
        <div class="report-section-body">
          ${s3.narrative ? `<p class="ai-narrative">${s3.narrative}</p>` : ''}
          ${dirHtml}
        </div>
      </div>`;
    }

    if (s4.narrative || s4.title) {
      const periods = Array.isArray(s4.key_periods) ? s4.key_periods : [];
      const periodsHtml = periods.length
        ? `<div style="margin-top:10px">${periods.map(p => insight(p, 'neutral')).join('')}</div>`
        : '';
      adviceHtml += `<div class="report-section">
        <div class="report-section-head"><span class="r-icon">💞</span>${s4.title || '婚恋与感情世界'}</div>
        <div class="report-section-body">
          ${s4.narrative ? `<p class="ai-narrative">${s4.narrative}</p>` : ''}
          ${s4.partner_traits ? `<div style="margin-top:10px;padding:10px 12px;border-left:2px solid rgba(201,169,110,.3);font-size:12px;color:rgba(232,224,208,.6);line-height:1.8">伴侣特质预测：${s4.partner_traits}</div>` : ''}
          ${periodsHtml}
        </div>
      </div>`;
    }

    if (s5.narrative || s5.title) {
      const watch = Array.isArray(s5.watch_points) ? s5.watch_points : [];
      const watchHtml = watch.length
        ? `<div style="margin-top:10px">${watch.map(w => insight(w, 'warn')).join('')}</div>`
        : '';
      adviceHtml += `<div class="report-section">
        <div class="report-section-head"><span class="r-icon">🌿</span>${s5.title || '健康与潜在风险提示'}</div>
        <div class="report-section-body">
          ${s5.narrative ? `<p class="ai-narrative">${s5.narrative}</p>` : ''}
          ${watchHtml}
        </div>
      </div>`;
    }

    if (s6.narrative || s6.title || s6.current_year_action) {
      adviceHtml += `<div class="report-section">
        <div class="report-section-head"><span class="r-icon">⏳</span>${s6.title || '大运与流年运势推演'}</div>
        <div class="report-section-body">
          ${s6.narrative ? `<p class="ai-narrative">${s6.narrative}</p>` : ''}
        </div>
      </div>`;
      if (s6.current_year_action) {
        adviceHtml += `<div class="r-year-card">
          <div class="r-year-title">▸ 今年行动建议</div>
          <div class="r-year-text">${s6.current_year_action}</div>
        </div>`;
      }
    }

    const adviceEl  = container.querySelector('#ai-advice-content');
    const dimLoadEl = container.querySelector('#dim-loading-block');
    if (adviceEl) {
      adviceEl.innerHTML  = adviceHtml || '<div style="color:rgba(232,224,208,.35);padding:20px;text-align:center">AI分析加载完成，暂无详细数据</div>';
      adviceEl.style.display = 'block';
    }
    if (dimLoadEl) dimLoadEl.style.display = 'none';
  }

  // ── AI 加载失败 → 显示静态 fallback ──────────────────
  // 六步框架依赖AI生成，加载失败时无法伪造六步内容；改用规则引擎能直接算出的
  // 日主/五行/喜用神数据拼一段极简兜底话术，不引用任何旧字段（four_pillars/six_dimensions等）
  function _showAiFallback(container, d) {
    const dm    = getDayMaster(d);
    const dmWx  = d.dayMasterWx || STEM_WX[dm] || '土';
    const fav   = Array.isArray(d.favorable) ? d.favorable : (d.favorable ? [d.favorable] : []);
    const mainFav = fav[0] || '';
    const scores  = d.wuxing || {};
    const score   = scores[dmWx] || 0;
    const level   = wxStrength(score);
    const adv     = FAV_ADVICE[mainFav] || {};

    const reloadHint = `<div style="text-align:center;padding:16px 0 4px;font-size:11px;color:rgba(232,224,208,.25);letter-spacing:1px">
      · 深度AI解读暂时无法连接，以下为规则引擎基础解读 ·<br>
      <span style="cursor:pointer;color:rgba(201,169,110,.4);text-decoration:underline;margin-top:6px;display:inline-block"
            onclick="location.reload()">刷新页面重试</span>
    </div>`;

    // Tab「AI深析」兜底：日主 + 五行基础扫描
    let fallbackDeep = `<div class="report-section">
      <div class="report-section-head"><span class="r-icon">✦</span>命局基础扫描</div>
      <div class="report-section-body">
        <p class="ai-narrative">${getDmDesc(dm)}</p>
        <div style="margin-top:10px">${insight('日主' + dmWx + '行，力量' + level + '（得分约' + score + '）', score >= 20 ? 'good' : score < 10 ? 'warn' : 'neutral')}</div>
      </div>
    </div>`;
    if (fav.length) {
      fallbackDeep += `<div class="report-section">
        <div class="report-section-head"><span class="r-icon">⊞</span>喜用神方向</div>
        <div class="report-section-body">${insight('命局喜用' + fav.join('、') + '，宜顺势而为、趋吉避凶', 'good')}</div>
      </div>`;
    }
    fallbackDeep += reloadHint;

    const deepEl = container.querySelector('#ai-deep-content');
    const loadEl = container.querySelector('#ai-loading-block');
    if (deepEl) { deepEl.innerHTML = fallbackDeep; deepEl.style.display = 'block'; }
    if (loadEl) loadEl.style.display = 'none';

    // Tab「运势详解」兜底：规则引擎喜用神建议（沿用既有 FAV_ADVICE 静态文案）
    const FALLBACK_ITEMS = [
      { icon:'💼', title:'事业财运', text: adv.career        || '以喜用神行业为发展重心' },
      { icon:'💞', title:'感情婚姻', text: adv.relationships || '结交喜用神五行属性的贵人' },
      { icon:'🌿', title:'健康养生', text: adv.health        || '注意与喜用神五行对应的脏腑养护' },
      { icon:'⏳', title:'大运流年', text: '大运流年走势建议以喜用神' + (mainFav || dmWx) + '行为参照，逢喜用之年宜积极进取' },
    ];
    let adviceHtml = '<div class="r-dim-grid">';
    FALLBACK_ITEMS.forEach(({ icon, title, text }) => {
      adviceHtml += `<div class="r-dim-card">
        <div class="r-dim-icon">${icon}</div>
        <div class="r-dim-title">${title}</div>
        <div class="r-dim-text">${text}</div>
      </div>`;
    });
    adviceHtml += '</div>';
    adviceHtml += `<div style="text-align:center;padding:12px 0 4px;font-size:11px;color:rgba(232,224,208,.25);letter-spacing:1px">· 以上为规则引擎基础建议 ·</div>`;

    const adviceEl  = container.querySelector('#ai-advice-content');
    const dimLoadEl = container.querySelector('#dim-loading-block');
    if (adviceEl)  { adviceEl.innerHTML = adviceHtml; adviceEl.style.display = 'block'; }
    if (dimLoadEl) dimLoadEl.style.display = 'none';
  }

  // ── 描述文本库 ─────────────────────────────────────
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
    const tips   = [];
    if (score >= 30) tips.push(insight('日主之气极旺，宜用官杀或财星来疏导', 'warn'));
    else if (score < 10) tips.push(insight('日主力量偏弱，需要印星或比劫来扶助', 'warn'));
    else tips.push(insight('日主得中，命盘均衡，各方面发展较为顺遂', 'good'));
    const ss = d.shenshe || d.shensha || [];
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
      '驿马':'驿马星动，利于变动迁移',
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

  // ── 四柱柱位面板 ────────────────────────────────────
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

    const branchInfo = (typeof CONFIG !== 'undefined') ? CONFIG?.BRANCHES_INFO?.[branch] : null;
    if (branchInfo?.hidden?.length) {
      const hiddenText = branchInfo.hidden.map(h => h.s).join('、');
      body += section('藏干', insight('地支' + branch + '藏干：' + hiddenText, 'neutral'));
    }
    return body;
  }

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
    const dm  = getDayMaster(baziData);
    const wx  = STEM_WX[dm] || '土';
    const map = {
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
    return map[name] || `${name}入命，对${dm}日主的${wx}行格局产生深远影响，宜把握其吉意，化解其凶性`;
  }

  return { buildZonePanel, buildPillarPanel, buildShenshaPanel, buildReport };
})();
