/**
 * 司马八字 · 分析模块 analysis.js
 *
 * 公开 API：
 *   Analysis.buildZonePanel(zoneKey, baziData, pillarAiDetail) → HTML 字符串（右侧标注面板）
 *     pillarAiDetail（可选，2026-08-11新增）仅在 zoneKey 是 'pillar_xxx' 时生效，
 *     原样透传给 buildPillarPanel()；其余 zoneKey 忽略该参数。
 *   Analysis.buildReport(baziData, container)  → 填充完整报告 Modal（含 AI 异步加载）
 *   Analysis.buildPillarPanel(col, baziData, pillarAiDetail)   → HTML 字符串
 *     pillarAiDetail（可选，2026-08-04新增）= 后端AI结果的
 *     analysis.step_pillars_detail?.[col] 切片（{plain_meaning, hidden_stems,
 *     role_in_this_chart}），由调用方传入。传了就渲染分类清晰的AI详解，不传/
 *     undefined（老缓存、AI深析还没生成完等场景）则【完全保留】原有静态字典内容，
 *     不报错不空白——本函数自身依然是纯同步函数，不在内部发起任何网络请求。
 *   Analysis.buildShenshaPanel(name, baziData, shenshaAiDetail) → HTML 字符串
 *     shenshaAiDetail（可选，2026-08-04新增）= 后端AI结果的
 *     analysis.step_shensha_detail?.shensha_items?.find(s=>s.name===name) 切片
 *     （{nature, concept, personal_impact, advice}），同上，不传/undefined时
 *     完全保留原有静态字典内容。
 *   Analysis.refreshAiAnalysis(analysis)       → 用调用方已拿到的AI深析结果原地渲染已打开的报告
 *     （供设置面板"轻量刷新"调用；不在内部发起任何网络请求——请求由调用方
 *     BaziAnalysis.getAnalysis()负责，避免同一次刷新触发两次后端调用。
 *     analysis 为空/falsy 时【不会】清空/替换 container 里已有的旧内容——只弹一条
 *     非破坏性的失败提示，报告区保留刷新前最后一次成功渲染的内容。报告从未
 *     打开过时静默返回）
 *   Analysis.showAiRefreshing()                 → 供设置面板"轻量刷新AI深析"在发起
 *     请求【之前】调用：在已打开的报告顶部插入一条不清空下方内容的"更新中"提示条。
 *     refreshAiAnalysis() 被调用时（无论成功失败）会自动清除这条提示。报告从未
 *     打开过时静默返回
 *   Analysis.clearAiRefreshing()                 → （2026-08-11新增，修复已知问题
 *     日志第21条）与 refreshAiAnalysis() 内部清除banner的逻辑相同，单独导出供
 *     调用方在自己的提前 return 分支里也能兜底清除"更新中"提示条——典型场景是
 *     settings.js::refreshAiOnly() 命中世代快照不一致而提前 return 时，不会再
 *     调用到 refreshAiAnalysis()，需要自己先调这个函数清掉banner。
 */

const Analysis = (() => {

  // ── 模块级：记住最近一次 buildReport() 打开的报告上下文，供 refreshAiAnalysis()
  // 外部触发的刷新复用（不需要调用方重新持有 container/d/gender）。报告从未打开过
  // 时为 null。
  let _lastReportCtx = null; // { container, d, gender } | null

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

  // 2026-08-04 qa-reviewer复查修复（PLAUSIBLE P3）：与 js/tutorial.js 的
  // isGood/isWarn 两个数组核对后发现两处吉凶分类分叉——①"孤辰"此前只在这里的
  // SHENSHA_WARN里缺失（tutorial.js的isWarn一直有），本次改动导致AI正文（nature
  // 字段为'凶'时渲染红色警示块）与徽章（此前判定"中性"）观感矛盾，现补入
  // SHENSHA_WARN，与tutorial.js对齐——传统命理孤辰主孤独，偏中性偏凶，判定为凶
  // 更贴近传统定性；②"驿马"此前只在这里的SHENSHA_GOOD里出现（tutorial.js的
  // isGood/isWarn都没有它，按中性处理），驿马传统上主变动，吉凶要看命局搭配，
  // 不是单纯的吉神，本次改动移出SHENSHA_GOOD、归为中性，与tutorial.js对齐；
  // ③核对全量神煞名单时顺带发现"七杀/官符/丧门"三个只在这里的SHENSHA_WARN，
  // tutorial.js的isWarn/isGood都没有它们（按中性处理）——这三者传统上均属明确的
  // 凶煞（七杀主刑克攻身、官符主官司诉讼、丧门主丧服哀戚），这里的判定本身没错，
  // 反而是tutorial.js缺了这三条，已同步补入tutorial.js的isWarn数组（不改这里）。
  const SHENSHA_GOOD = new Set(['将星','禄神','红鸾','天乙','文昌','天德','月德','天厨']);
  const SHENSHA_WARN = new Set(['亡神','劫煞','白虎','羊刃','七杀','官符','丧门','孤辰']);

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

  // ══════════════════════════════════════════════════════
  //  2026-08-04 新增：总览Tab三个纯SVG可视化图表（不引入任何图表库/CDN依赖，
  //  跟项目本身"无构建工具，直接字符串拼接HTML/内联SVG"的既有写法保持一致）
  // ══════════════════════════════════════════════════════

  // ── 通用雷达图（N边形）：五行强弱雷达图（5轴）与六维运势雷达图（6轴）共用 ──
  // axes: [{ label, value, color? }]，value 统一按 0-100 处理（调用方自行归一化）
  // opts.skeleton=true 时只画网格+轴线+轴标签，不画数据多边形（占位骨架屏用）
  function _radarSvg(axes, opts) {
    opts = opts || {};
    const n = axes.length;
    const size = opts.size || 320;
    const cx = size / 2, cy = size / 2;
    const R = opts.radius != null ? opts.radius : 90;
    const labelR = R + (opts.labelGap != null ? opts.labelGap : 36);
    const angleFor = (i) => -Math.PI / 2 + i * (2 * Math.PI / n);
    const ptAt = (i, r) => {
      const a = angleFor(i);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    let grid = '';
    [0.2, 0.4, 0.6, 0.8, 1.0].forEach((f) => {
      const pts = axes.map((_, i) => ptAt(i, R * f).join(',')).join(' ');
      grid += `<polygon points="${pts}" fill="none" stroke="rgba(232,224,208,.08)" stroke-width="1"/>`;
    });
    let spokes = '';
    axes.forEach((_, i) => {
      const [x, y] = ptAt(i, R);
      spokes += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(232,224,208,.1)" stroke-width="1"/>`;
    });
    let dataLayer = '';
    if (!opts.skeleton) {
      const clampedVals = axes.map((a) => Math.max(0, Math.min(100, Number(a.value) || 0)));
      const dataPts = axes.map((a, i) => ptAt(i, R * (clampedVals[i] / 100)).join(',')).join(' ');
      dataLayer = `<polygon points="${dataPts}" fill="rgba(201,169,110,.22)" stroke="#c9a96e" stroke-width="2"/>`;
      dataLayer += axes.map((a, i) => {
        const [x, y] = ptAt(i, R * (clampedVals[i] / 100));
        return `<circle cx="${x}" cy="${y}" r="3.5" fill="${a.color || '#c9a96e'}"/>`;
      }).join('');
    }
    const labels = axes.map((a, i) => {
      const [x, y] = ptAt(i, labelR);
      const showVal = opts.showValue && !opts.skeleton;
      // labelValue 可选：调用方想让"画多边形用的半径值"和"标签上显示的数字"不是
      // 同一个数（比如五行雷达图按最大值归一化画半径，但标签仍要显示真实百分比）
      // 时传这个字段；不传则退回用 value（六维运势雷达图就是这种情况，未受影响）
      const rawLabelVal = a.labelValue != null ? a.labelValue : a.value;
      const valText = showVal ? ` ${Math.round(Math.max(0, Math.min(100, Number(rawLabelVal) || 0)))}${opts.suffix || ''}` : '';
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="${opts.labelSize || 12}" fill="${a.color || 'rgba(232,224,208,.65)'}" font-weight="600">${a.label}${valText}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${size} ${size}" style="width:100%;max-width:${opts.maxWidth || 320}px;height:auto;display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg">${grid}${spokes}${dataLayer}${labels}</svg>`;
  }

  // ── 5a. 五行强弱雷达图：五个轴 木/火/土/金/水，数据来自 buildReport() 已算好的
  // wx（d.wuxing 五行得分dict，bazi-engine.js 里已经是"占五行总权重的百分比"，
  // 五项相加恒约等于100）。
  // 2026-08-04修复（qa CONFIRMED 3）：此前直接把"占总分的百分比"当半径占比画，
  // 但五项百分比本身合计就约等于100（均值20），现实里单项最大也就40%-45%左右
  // ——于是多边形恒定挤在外圈半径的20%-45%以内，五行强弱差异在视觉上完全看不
  // 出来。现在改为按"这一组五行分数里的最大值"归一化画半径（最旺的那个五行会
  // 顶到雷达图最外圈），轴标签上仍然用 labelValue 单独带真实的百分比数字，不
  // 丢失精确数值信息——雷达图只作为整体视觉呈现的补充，精确条形图（wxHtml）
  // 仍保留在下方
  function _wuxingRadarHtml(wx) {
    const order = ['木', '火', '土', '金', '水'];
    const vals = order.map((k) => wx[k] || 0);
    const maxVal = Math.max(...vals, 1); // 全0兜底，避免除0
    const axes = order.map((k, i) => ({
      label: k,
      value: Math.round((vals[i] / maxVal) * 100), // 画多边形半径：按组内最大值归一化
      labelValue: Math.round(vals[i]), // 标签显示：真实占比百分比，不受归一化影响
      color: WX_COLOR[k] || '#c9a96e',
    }));
    return _radarSvg(axes, { showValue: true, suffix: '%', maxWidth: 300, labelSize: 13 });
  }

  // ── 5b. 身强身弱仪表盘：0-100分三区间。
  // 2026-08-04修复（qa CONFIRMED 1）：此前误以为 bazi-engine.js 的 strength 字段
  // 会有"数字"形态、"字符串类别"形态两种可能，实际上 _strength() 永远只返回字符串
  // 三分类（'身强'/'中和'/'身弱'），全项目没有任何地方产出数字 strength——旧版本
  // 这里的"数字路径"是永远走不到的死代码，导致生产环境仪表盘从未画出过指针。
  // 现在 bazi-engine.js::_strength() 新增了并行的 strengthScore 数值字段（0-100，
  // 不改变 strength 字符串字段本身的语义），本函数改为接收两个参数：
  //   strength      — 字符串类别（'身强'/'中和'/'身弱'），始终用于区间归属/文案
  //   strengthScore — 0-100 数值（可能不存在，比如 Supabase 里改动前存的老记录），
  //                    存在时画真实指针+精确刻度；不存在时保留静态图例+文字兜底
  // 三个区间色块的分界线（约47.67 / 52.33）不是随手定的，而是与
  // bazi-engine.js::_strength() 内部"score>±0.5 判身强/身弱"这个阈值、按同一套
  // 线性映射公式换算到0-100刻度后的边界严格对齐（映射公式见该函数内注释：
  // 0.5/total*50，total=10.75 是 _calcWuxing 权重方案下的结构性常量），确保色块
  // 分界线与文字类别标签、以及指针实际落点在数学上自洽，不会互相矛盾。
  function _strengthGaugeHtml(strength, strengthScore) {
    const isNum = typeof strengthScore === 'number' && isFinite(strengthScore);
    const NEUTRAL_HALF = (0.5 / 10.75) * 50; // ≈2.3256，与 _strength() 映射公式同源
    const weakBoundary = 50 - NEUTRAL_HALF;   // ≈47.67
    const strongBoundary = 50 + NEUTRAL_HALF; // ≈52.33
    const category = strength
      || (isNum ? (strengthScore >= strongBoundary ? '身强' : strengthScore <= weakBoundary ? '身弱' : '中和') : '中和');

    const W = 300, barX = 10, barW = 280, barY = 36, barH = 14, H = 74;
    const zone1W = barW * (weakBoundary / 100);
    const zone2W = barW * ((strongBoundary - weakBoundary) / 100);
    const zone3W = barW * ((100 - strongBoundary) / 100);
    const zones = [
      { x: barX, w: zone1W, fill: 'rgba(235,87,87,.16)', stroke: 'rgba(235,87,87,.4)', label: '身弱' },
      { x: barX + zone1W, w: zone2W, fill: 'rgba(201,169,110,.16)', stroke: 'rgba(201,169,110,.4)', label: '中和' },
      { x: barX + zone1W + zone2W, w: zone3W, fill: 'rgba(160,174,192,.16)', stroke: 'rgba(160,174,192,.4)', label: '身强' },
    ];
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">`;
    zones.forEach((z) => {
      svg += `<rect x="${z.x}" y="${barY}" width="${z.w}" height="${barH}" rx="4" fill="${z.fill}" stroke="${z.stroke}" stroke-width="1"/>`;
      svg += `<text x="${z.x + z.w / 2}" y="${barY + barH + 14}" text-anchor="middle" font-size="10" fill="rgba(232,224,208,.4)" letter-spacing="1">${z.label}</text>`;
    });
    if (isNum) {
      const clamped = Math.max(0, Math.min(100, strengthScore));
      const px = barX + barW * (clamped / 100);
      svg += `<line x1="${px}" y1="${barY - 6}" x2="${px}" y2="${barY + barH + 4}" stroke="#c9a96e" stroke-width="2"/>`;
      svg += `<polygon points="${px - 5},${barY - 6} ${px + 5},${barY - 6} ${px},${barY - 14}" fill="#c9a96e"/>`;
      svg += `<text x="${px}" y="${barY - 18}" text-anchor="middle" font-size="12" fill="#c9a96e" font-weight="600">${Math.round(clamped)}</text>`;
    }
    svg += '</svg>';
    const footer = isNum
      ? `<div style="text-align:center;font-size:12px;color:rgba(232,224,208,.6);margin-top:4px">${category}（${Math.round(strengthScore)}分）</div>`
      : `<div style="text-align:center;font-size:12px;color:rgba(232,224,208,.6);margin-top:4px">${category}<span style="color:rgba(232,224,208,.32);font-size:10px;margin-left:6px">（精确数值不可用）</span></div>`;
    return `<div class="report-strength-gauge">${svg}${footer}</div>`;
  }

  // ── 5c. 六维主题雷达图：格局层次/事业运/财运/婚姻运/健康运/大运运势，数据来自
  // AI异步生成结果（Step2的pattern_score、Step3的career_score/wealth_score、
  // Step4的relationship_score、Step5的health_score、Step6的fortune_score）。
  // 总览Tab在 buildReport() 里同步立即渲染，但这份数据是AI异步到达的——先渲染
  // 占位骨架屏（固定id #r-sixdim-radar），等 _populateAiContent() 拿到AI结果后
  // 原地替换。6个分数任一缺失时不渲染真实雷达图（不编造/不留空占位），展示明确的
  // "评分数据暂不完整"兜底终态，不会卡在骨架屏loading状态出不来
  const SIXDIM_LABELS = ['格局层次', '事业运', '财运', '婚姻运', '健康运', '大运运势'];

  function _sixDimSectionHead() {
    return `<div class="report-section-head"><span class="r-icon">⬡</span>六维运势评分</div>`;
  }

  function _sixDimSkeletonHtml() {
    const axes = SIXDIM_LABELS.map((l) => ({ label: l, value: 0 }));
    return `${_sixDimSectionHead()}
      <div class="report-section-body">
        <div class="ai-loading" style="margin-bottom:0">
          ${_radarSvg(axes, { skeleton: true, maxWidth: 300, labelSize: 11 })}
          <div style="font-size:10px;color:rgba(201,169,110,.35);letter-spacing:2px;margin-top:10px;text-align:center">✦ AI 评分生成中 ✦</div>
        </div>
      </div>`;
  }

  // scores: [{label, value}]（6项）。调用方需先确认全部6项 value 均为合法数字，
  // 本函数本身不做该判断（判断逻辑见 _populateAiContent 调用处，职责分离）
  function _sixDimRadarHtml(scores) {
    return `${_sixDimSectionHead()}
      <div class="report-section-body">
        ${_radarSvg(scores, { showValue: true, maxWidth: 300, labelSize: 11 })}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px">
          ${scores.map((s) => `<div style="text-align:center;font-size:11px;color:rgba(232,224,208,.5)">${s.label}<br><span style="color:#c9a96e;font-weight:600;font-size:14px">${Math.round(s.value)}</span></div>`).join('')}
        </div>
      </div>`;
  }

  function _sixDimFallbackHtml() {
    return `${_sixDimSectionHead()}
      <div class="report-section-body">
        <div style="text-align:center;padding:20px 0;color:rgba(232,224,208,.35);font-size:12px;letter-spacing:.5px">评分数据暂不完整，暂无法生成六维运势图</div>
      </div>`;
  }

  // 从AI结果中提取六维打分（哪一步生成哪个字段，见上方注释）；缺失/非数字时保留
  // 为 undefined，交给调用方判断是否达到"全部6项齐全"的渲染条件
  function _extractSixDimScores(ai) {
    ai = ai || {};
    const s2 = ai.step2_pattern_yongshen || {};
    const s3 = ai.step3_career_wealth || {};
    const s4 = ai.step4_relationship || {};
    const s5 = ai.step5_health || {};
    const s6 = ai.step6_dayun_liunian || {};
    return [
      { label: '格局层次', value: s2.pattern_score },
      { label: '事业运',   value: s3.career_score },
      { label: '财运',     value: s3.wealth_score },
      { label: '婚姻运',   value: s4.relationship_score },
      { label: '健康运',   value: s5.health_score },
      { label: '大运运势', value: s6.fortune_score },
    ];
  }

  // 2026-08-04修复（qa P5）：加上 0-100 范围校验。此前只判断"是数字且有限"，
  // 如果模型返回105或-20这种越界分数，_radarSvg 内部会把半径clamp到0-100画
  // 多边形，但下方数字图例是裸 Math.round(s.value) 直接显示原始越界值——会出现
  // "图例写105，但多边形顶点画在外圈（相当于100）"这种数字和图形对不上的情况。
  // 越界值直接判定无效，走跟"字段缺失"完全一样的兜底逻辑（六维雷达图缺一项就
  // 整体不渲染真实图，见 _sixDimFallbackHtml），保证图例数字与多边形位置任何
  // 时候都一致。
  //
  // 2026-08-04 qa三轮复查：这份校验逻辑与 js/bazi-analysis.js 的本地缓存canary
  // 是同一个口径，直接委托给 BaziAnalysis.isValidScore()（该模块在 index.html
  // 里于本文件之前加载，见 <script> 顺序），避免两处各自维护一份独立实现——
  // 参考本项目已知问题记录里"哈希算法双实现耦合"那条教训，这次改成单一实现
  // 两处共用。
  //
  // 2026-08-04 qa三轮复查发现并修正：最初版本用 `window.BaziAnalysis` 判断委托
  // 是否可用——classic script 顶层的 `const BaziAnalysis = ...`（bazi-analysis.js:15）
  // 进入的是全局*声明式*环境，不会挂到 `window` 对象上，`window.BaziAnalysis`
  // 恒为 undefined，委托分支永远不会触发，一直在悄悄走下面的内联兜底（当前行为
  // 恰好等价所以没有可见故障，但属于死代码+文档失实，且这正是本项目已知问题
  // 记录里"CONFIG 是 const 声明不会自动挂到 window"那条教训的又一次重演）。
  // 改用裸标识符 `typeof BaziAnalysis !== 'undefined'`——同一份 <script> 顶层
  // 作用域下的 const/let 绑定，裸标识符能正常解析到，本文件其它委托逻辑
  // （640/678/707行左右的 `typeof BaziAnalysis !== 'undefined'`）已经是这个写法，
  // 这里改成一致写法即可，不需要新增 `window.BaziAnalysis = BaziAnalysis` 这种
  // 本项目其它模块都没用过的新模式。
  function _isValidScore(v) {
    if (typeof BaziAnalysis !== 'undefined' && typeof BaziAnalysis.isValidScore === 'function') {
      return BaziAnalysis.isValidScore(v);
    }
    return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100;
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

  function buildZonePanel(zoneKey, baziData, pillarAiDetail) {
    if (zoneKey.startsWith('pillar_')) {
      return buildPillarPanel(zoneKey.replace('pillar_', ''), baziData, pillarAiDetail);
    }
    const fn = ZONES[zoneKey];
    if (!fn) return `<div class="zone-title">区域：${zoneKey}</div>`;
    return fn(baziData);
  }

  // ── 命局摘要块（"总览"Tab最上方，含身强身弱仪表盘）共享渲染逻辑 ───────
  // buildReport() 首次渲染报告、refreshStrengthGauge()（供设置面板"轻量刷新
  // AI深析"顺带同步重算后的八字数据）复用同一份"核心内容"计算逻辑，避免像历史上
  // _computeHash 双实现耦合那样，改一处忘改另一处（详见已知问题日志）。
  //
  // 2026-08-11修复（qa-reviewer实测CONFIRMED回归）：这个模块以前是把整个
  // .report-summary 节点 outerHTML 原地替换来实现"刷新"，但 #r-keywords（AI深析
  // 结果里的关键词标签，由 _populateAiContent() 在AI请求成功后异步插入，不在这
  // 里计算）也嵌套在 .report-summary 内部——outerHTML整体替换会把已经AI填充过的
  // #r-keywords 一并清空成初始空白态，即使后续AI刷新请求失败、走"保留刷新前内容"
  // 分支（refreshAiAnalysis() 失败分支/alert文案），关键词其实已经在刷新一开始
  // 就丢了，alert说"已为你保留"是假话。
  // 修复方式：把"日主/五行/身强身弱仪表盘"这块【纯本地计算、无需AI】的内容单独
  // 包进带固定id的 #r-summary-core 容器，AI相关的 #r-keywords 作为该容器的
  // 兄弟节点、完全在计算范围之外。刷新时只替换 #r-summary-core 的 innerHTML，
  // 物理上不可能碰到 #r-keywords。
  //
  // 只算"日主/五行/身强身弱仪表盘"这块的内容，不含 #r-keywords（AI异步填充，
  // 不属于本地免费重算的范围）。
  function _summaryCoreHtml(d) {
    const dm    = getDayMaster(d);
    const dmWx  = d.dayMasterWx || STEM_WX[dm] || '土';
    const dmCol = WX_COLOR[dmWx] || '#c9a96e';

    // ── 命格强弱 ──────────────────────────────────────
    // strength 现在始终是字符串类别（'身强'/'中和'/'身弱'，bazi-engine.js 唯一
    // 产出形态）；strengthScore 是并行的 0-100 数值字段（新数据才有，老存档/老
    // Supabase 记录可能没有，_strengthGaugeHtml() 内部对此做兜底）
    const strength = d.strength || '';
    const strengthScore = typeof d.strengthScore === 'number' && isFinite(d.strengthScore) ? d.strengthScore : undefined;
    const strengthText = strength || '中和';
    const strengthGaugeHtml = _strengthGaugeHtml(strength, strengthScore);

    return `
        <div class="report-summary-dm">
          <div class="report-summary-char" style="color:${dmCol}">${dm}</div>
          <div class="report-summary-meta">
            <div class="report-summary-label">${dmWx}行 · ${strengthText}</div>
            <div class="report-summary-sub">${d.dayMasterNature || getDmDesc(dm).slice(0, 28) + '…'}</div>
          </div>
        </div>
        <div class="report-summary-desc">${getDmDesc(dm)}</div>
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.05)">
          <div style="font-size:10px;color:rgba(201,169,110,.5);letter-spacing:2px;margin-bottom:8px">身强身弱</div>
          ${strengthGaugeHtml}
        </div>`;
  }

  // 首次渲染报告用：返回完整 .report-summary 块的HTML字符串（含空的
  // #r-keywords占位，供AI结果异步填充），由 buildReport() 拼进整体模板。
  function _renderSummaryHtml(d) {
    return `
      <div class="report-summary">
        <div id="r-summary-core">${_summaryCoreHtml(d)}</div>
        <div id="r-keywords" class="r-keywords" style="display:none"></div>
      </div>`;
  }

  // ── 供设置面板"轻量刷新AI深析"调用：用免费本地重算出的最新八字数据（见
  // main-new.js::recalcBaziData）原地刷新已打开报告里的命局摘要+身强身弱仪表盘。
  // 只做DOM渲染，刻意不触发任何网络请求/AI流水线——跟 refreshAiAnalysis()同一约束
  // （2026-08-03 修复"点一次轻量刷新触发两次AI流水线"的教训，这里同理不能引入
  // 新的重复请求）。若报告从未打开过（_lastReportCtx 为空），静默返回。
  // 只替换 #r-summary-core 的 innerHTML，绝不触碰兄弟节点 #r-keywords（见上方
  // 2026-08-11修复说明）——即便调用时机早于AI刷新请求发起/成功，也不会清空已经
  // AI填充过的关键词标签。
  function refreshStrengthGauge(baziData) {
    if (!_lastReportCtx || !baziData) return;
    _lastReportCtx.d = baziData; // 让后续依赖 _lastReportCtx.d 的逻辑（如AI补写）也用上新数据
    const container = _lastReportCtx.container;
    const core = container && container.querySelector ? container.querySelector('#r-summary-core') : null;
    if (core) core.innerHTML = _summaryCoreHtml(baziData);
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
    const p     = d.pillars  || {};
    const wx    = d.wuxing   || {};
    // favorable 从引擎返回是字符串（如"木"），从 Supabase 可能是字符串或数组
    const fav = (() => {
      if (Array.isArray(d.favorable)) return d.favorable;
      const f = d.favorable ? [d.favorable] : [];
      if (d.favorable2 && !f.includes(d.favorable2)) f.push(d.favorable2);
      return f;
    })();

    // ── Tab 1：总览（静态，立即显示）────────────────────
    // 2026-08-04新增：身强身弱仪表盘，放在命局摘要块内部（"最上方"位置，命局摘要
    // 是总览Tab第一个展示的模块）。命局摘要块核心内容（含dm/dmWx/strength等计算）
    // 抽到了共享函数 _summaryCoreHtml 里，refreshStrengthGauge() 复用同一份实现，
    // 详见 _renderSummaryHtml() 上方 2026-08-11 修复说明。
    const summaryHtml = _renderSummaryHtml(d);

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

    // 五行强弱：雷达图（整体视觉呈现）+ 既有横向条形图（保留，精确百分比数值参考）
    const wxRadarHtml = _wuxingRadarHtml(wx);
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
          <div class="report-section-body">${wxRadarHtml}<div style="margin-top:18px">${wxHtml}${wxNote}</div></div>
        </div>
        <div class="report-section">
          <div class="report-section-head"><span class="r-icon">✦</span>喜用神与人生方向</div>
          <div class="report-section-body">${favHtml}</div>
        </div>
        <div class="report-section" id="r-sixdim-radar">
          ${_sixDimSkeletonHtml()}
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
      // 记住最近一次打开的报告上下文，供外部（设置面板"轻量刷新AI深析"）触发的
      // refreshAiAnalysis() 复用，不需要调用方重新持有 container/d/gender。
      _lastReportCtx = { container, d, gender };
      _loadAndRenderAi(container, d, gender, { forceRefresh: false });
    }
  }

  // ── AI 深析拉取 + 渲染（首次打开报告 / 外部强制刷新共用）────────────
  // forceRefresh 透传给 BaziAnalysis.getAnalysis()，跳过前端localStorage+in-flight
  // 判断，强制向后端发起一次新请求（后端同步跳过文件缓存）。不传时（默认 false）
  // 行为与改动前 buildReport() 内联的这段逻辑完全一致。
  function _loadAndRenderAi(container, d, gender, { forceRefresh = false } = {}) {
    // 请求发起那一刻快照当前"岛屿会话世代"（见 main-new.js::_islandGeneration
    // 注释）。六步AI深析流水线耗时可达数分钟以上，若在其运行期间用户切换去
    // 生成/加载了另一个岛屿，_currentIslandId会被重新赋值，此时不应再把这次
    // 请求的结果补写到（此刻已经不对应的）新岛屿记录里。
    const _genAtRequest = (typeof App !== 'undefined' && App.getIslandGeneration) ? App.getIslandGeneration() : null;
    BaziAnalysis.getAnalysis(d, gender, { forceRefresh }).then(analysis => {
      if (analysis) {
        _populateAiContent(container, analysis, d);

        // ── 补写：把AI深析结果同步回用户已保存的岛屿记录 ──
        // 场景：3D模型保存时AI深析尚未生成完（saveIsland的aiAnalysis传了null），
        // 用户这次打开报告触发了真实生成/命中缓存（或强制刷新），借这个时机把
        // 结果补写回那条记录，避免下次登录还要重新花token生成。fire-and-forget，
        // 不阻塞UI，updateIslandAnalysis内部已有错误处理（未登录/无岛屿id/记录
        // 不存在等情况均静默返回，不影响当前浏览体验）。世代值比对：只有当前
        // 世代仍与请求发起时一致（即用户未切换到别的岛屿会话），才执行补写。
        if (typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn() &&
            typeof App !== 'undefined' && App.getCurrentIslandId && App.getCurrentIslandId() &&
            App.getIslandGeneration && App.getIslandGeneration() === _genAtRequest) {
          AuthManager.updateIslandAnalysis(App.getCurrentIslandId(), analysis).catch((e) => {
            console.warn('[Analysis] AI深析补写回岛屿记录失败:', e);
          });
        }
      } else {
        const lastErr = (typeof BaziAnalysis !== 'undefined' && BaziAnalysis.getLastError)
          ? BaziAnalysis.getLastError(d, gender)
          : null;
        _showAiFallback(container, d, lastErr && lastErr.isTimeout);
      }
    });
  }

  // ── 供设置面板"轻量刷新AI深析"调用：用调用方已经拿到的AI深析结果原地渲染
  // 当前已打开的报告。刻意不在这里发起任何网络请求——请求由调用方
  // （SettingsUI.refreshAiOnly() → BaziAnalysis.getAnalysis({forceRefresh:true})）
  // 负责，本函数只管渲染，避免"设置面板自己请求一次 + 这里又内部请求一次"
  // 的双重后端调用（2026-08-03 修复，详见已知问题日志）。
  // 若报告从未打开过（_lastReportCtx 为 null），静默返回，不做任何事——理论上
  // 设置面板只会在已经打开过报告的场景下才会暴露这个入口，这里是防御性兜底。
  //
  // analysis 为空/falsy（调用方请求失败或返回空）时的行为与首次打开报告
  // （_loadAndRenderAi）刻意不同：这里【不会】调用 _showAiFallback()，因为
  // container 里此刻展示的是刷新前最后一次成功渲染的正常内容——把它整个替换
  // 成失败兜底文案，会造成"点了刷新按钮反而把能看的内容弄没了"的体验倒退。
  // 改为只弹一条非破坏性的提示（alert），旧内容原样保留在DOM里不动。
  function refreshAiAnalysis(analysis) {
    if (!_lastReportCtx) return;
    const { container, d, gender } = _lastReportCtx;
    // 无论成功失败，先清掉 showAiRefreshing() 插入的"更新中"提示条。
    _clearAiRefreshingBanner();
    if (analysis) {
      _populateAiContent(container, analysis, d);
    } else {
      const lastErr = (typeof BaziAnalysis !== 'undefined' && BaziAnalysis.getLastError)
        ? BaziAnalysis.getLastError(d, gender)
        : null;
      const isZh = (typeof Lang === 'undefined') || Lang.getLang() === 'zh';
      const msg = lastErr && lastErr.isTimeout
        ? (isZh ? 'AI深析响应超时，已为你保留刷新前的内容' : 'AI insight refresh timed out — your previous content has been kept.')
        : (isZh ? 'AI深析刷新失败，已为你保留刷新前的内容' : 'Failed to refresh AI insight — your previous content has been kept.');
      alert(msg);
      // 刻意不调用 _showAiFallback()：container 里刷新前渲染好的旧内容原样保留，不清空/替换。
    }
  }

  // ── 供设置面板"轻量刷新AI深析"在发起请求【之前】调用：在已打开报告的顶部
  // 插入一条"更新中"提示条，不清空/替换下方已有内容（与 refreshAiAnalysis()
  // 失败分支同一约束：旧内容必须原样保留）。多次调用幂等（复用同一个banner
  // 节点，不会重复插入）。若报告从未打开过，静默返回。
  function showAiRefreshing() {
    if (!_lastReportCtx) return;
    const { container } = _lastReportCtx;
    if (!container) return;
    const isZh = (typeof Lang === 'undefined') || Lang.getLang() === 'zh';
    let bar = container.querySelector('#ai-refresh-banner');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'ai-refresh-banner';
      bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 14px;margin-bottom:10px;'
        + 'background:rgba(201,169,110,.1);border:1px solid rgba(201,169,110,.25);border-radius:8px;'
        + 'font-size:12px;color:rgba(201,169,110,.9);letter-spacing:.5px;opacity:.9';
      container.prepend(bar);
    }
    bar.textContent = isZh ? '⟳ AI 深析更新中…' : '⟳ Updating AI insight…';
    bar.style.display = 'flex';
  }

  // 内部：清除 showAiRefreshing() 插入的提示条（refreshAiAnalysis 无论成功/
  // 失败都会调用，确保"更新中"状态不会卡住残留）。
  function _clearAiRefreshingBanner() {
    if (!_lastReportCtx) return;
    const { container } = _lastReportCtx;
    const bar = container && container.querySelector('#ai-refresh-banner');
    if (bar) bar.remove();
  }

  // ── 公开版 clearAiRefreshing()（2026-08-11 新增，修复已知问题日志第21条）──
  // 与上面的 _clearAiRefreshingBanner() 功能完全相同，唯一区别是导出给外部
  // 调用方（目前是 js/settings.js::refreshAiOnly()）使用。背景：refreshAiAnalysis()
  // 内部虽然无论成功/失败都会清banner，但 refreshAiOnly() 里"世代快照防护"命中
  // 时会在调用 refreshAiAnalysis() 之前就提前 return，导致这次清除被跳过、banner
  // 残留在DOM里。调用方应在那个提前 return 之前调用一次本函数兜底清除。
  function clearAiRefreshing() {
    _clearAiRefreshingBanner();
  }

  // ── AI 内容填充（六步命理框架，2026-08-03内容深度扩充新增Step2b后实为七步）───
  // ai 结构：step1_foundation（新增strengths/cautions两个数组字段）/
  //          step2_pattern_yongshen（新增pattern_score） / step2b_shishen（新增
  //          步骤：十神详解，shishen_items数组） / step3_career_wealth（新增
  //          career_score/wealth_score） / step4_relationship（新增
  //          relationship_score） / step5_health（新增health_score） /
  //          step6_dayun_liunian（新增fortune_score） / keywords
  // 顺序按 step1→step2→step2b→step3→...→step6 依次渲染，分两个Tab承载：
  //   Tab「AI深析」= step1（命局基础扫描，含性格优势/注意事项）+ step2（格局与用神）
  //                  + step2b（十神详解）
  //   Tab「运势详解」= step3（事业财富）→ step4（婚恋）→ step5（健康）→ step6（大运流年）
  // 新增字段一律遵循既有防御写法：字段不存在时不渲染对应模块，不报错不留空白
  // （_showAiFallback() 兜底逻辑本身不涉及这些新字段，未改动）
  //
  // 2026-08-04新增：额外从Step2/3/4/5/6里提取六维打分字段，原地替换总览Tab里
  // buildReport()渲染的占位骨架屏（固定id #r-sixdim-radar，见 _sixDimSkeletonHtml()
  // 注释）。这个元素身处"总览"Tab，但由本函数（渲染"AI深析"/"运势详解"两个Tab
  // 内容）触发更新——报告整体是同一个container里的一整棵DOM树，只是CSS用.active
  // 控制哪个Tab可见，跨Tab更新DOM是允许的。防御性要求：6个分数任一缺失（老缓存/
  // 老版本后端返回值/_showAiFallback()兜底场景，此时ai为{}，6项全部undefined）
  // 都不渲染真实雷达图（不编造/不留一个歪掉的角），改为展示"评分数据暂不完整"的
  // 简单兜底态（明确终态，不是无限转圈的骨架屏）。
  function _populateAiContent(container, ai, d) {
    ai = ai || {};

    const sixDimEl = container.querySelector('#r-sixdim-radar');
    if (sixDimEl) {
      const scores = _extractSixDimScores(ai);
      const allValid = scores.every(s => _isValidScore(s.value));
      sixDimEl.innerHTML = allValid ? _sixDimRadarHtml(scores) : _sixDimFallbackHtml();
    }

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

    // ─ Tab 2：AI 深析 = step1 + step2 + step2b ─
    const s1  = ai.step1_foundation || {};
    const s2  = ai.step2_pattern_yongshen || {};
    const s2b = ai.step2b_shishen || {};

    let deepHtml = '';
    if (s1.narrative || s1.title) {
      const strengths = Array.isArray(s1.strengths) ? s1.strengths : [];
      const cautions  = Array.isArray(s1.cautions)  ? s1.cautions  : [];
      const strengthsHtml = strengths.length
        ? `<div style="margin-top:12px"><div class="ai-sublabel">✦ 性格优势</div>${strengths.map(s => insight(s, 'good')).join('')}</div>`
        : '';
      const cautionsHtml = cautions.length
        ? `<div style="margin-top:12px"><div class="ai-sublabel">⚠ 注意事项</div>${cautions.map(c => insight(c, 'warn')).join('')}</div>`
        : '';
      deepHtml += `<div class="report-section">
        <div class="report-section-head"><span class="r-icon">✦</span>${s1.title || '命局「出厂设置」扫描'}</div>
        <div class="report-section-body">
          ${s1.narrative ? `<p class="ai-narrative">${s1.narrative}</p>` : ''}
          ${s1.wuxing_note ? `<div style="margin-top:10px">${insight(s1.wuxing_note, 'neutral')}</div>` : ''}
          ${strengthsHtml}
          ${cautionsHtml}
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
    if (s2b.narrative || s2b.title) {
      const shishenItems = Array.isArray(s2b.shishen_items) ? s2b.shishen_items : [];
      const shishenHtml = shishenItems.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">${shishenItems.map(it => {
            const name = (it && it.name) || '';
            const meaning = (it && it.meaning) || '';
            if (!name && !meaning) return '';
            return `<div style="flex:1 1 220px;min-width:180px;padding:10px 12px;border-radius:8px;background:rgba(201,169,110,.06);border:1px solid rgba(201,169,110,.18)">
              ${name ? `<div style="font-size:13px;color:#c9a96e;font-weight:600;margin-bottom:4px">${name}</div>` : ''}
              ${meaning ? `<div style="font-size:12px;color:rgba(232,224,208,.7);line-height:1.7">${meaning}</div>` : ''}
            </div>`;
          }).join('')}</div>`
        : '';
      deepHtml += `<div class="report-section">
        <div class="report-section-head"><span class="r-icon">☯</span>${s2b.title || '十神详解'}</div>
        <div class="report-section-body">
          ${s2b.narrative ? `<p class="ai-narrative">${s2b.narrative}</p>` : ''}
          ${shishenHtml}
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
  // isTimeout: true 时说明是 BaziAnalysis 内部 AbortController 超时（见
  // bazi-analysis.js::AI_ANALYSIS_TIMEOUT_MS，2026-08-01订正为400秒），
  // 与其它网络/服务端错误区分展示，避免用户看到语义不明的"无法连接"
  function _showAiFallback(container, d, isTimeout) {
    // 2026-08-04新增：AI深析整体失败/超时（analysis为falsy）时，_populateAiContent()
    // 根本不会被调用，若不在这里也处理#r-sixdim-radar，buildReport()渲染的占位
    // 骨架屏会永远卡在"AI 评分生成中"的loading态出不来——这正是需求方特别点名要
    // 规避的场景。六维打分本来就依赖AI生成，规则引擎无法伪造，因此这里跟其它
    // AI专属模块一样：切换到明确的"评分数据暂不完整"兜底终态。
    const sixDimEl = container.querySelector('#r-sixdim-radar');
    if (sixDimEl) sixDimEl.innerHTML = _sixDimFallbackHtml();

    const dm    = getDayMaster(d);
    const dmWx  = d.dayMasterWx || STEM_WX[dm] || '土';
    const fav   = Array.isArray(d.favorable) ? d.favorable : (d.favorable ? [d.favorable] : []);
    const mainFav = fav[0] || '';
    const scores  = d.wuxing || {};
    const score   = scores[dmWx] || 0;
    const level   = wxStrength(score);
    const adv     = FAV_ADVICE[mainFav] || {};

    const fallbackReason = isTimeout
      ? 'AI深析响应超时，请稍后重试'
      : '深度AI解读暂时无法连接，以下为规则引擎基础解读';
    const reloadHint = `<div style="text-align:center;padding:16px 0 4px;font-size:11px;color:rgba(232,224,208,.25);letter-spacing:1px">
      · ${fallbackReason} ·<br>
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
      // 2026-08-04补：js/tutorial.js::SS_DESC 里一直有"孤辰"这一条专属解读，但
      // 这份字典缺失，命中时会走通用兜底文案——文案与tutorial.js保持一致，避免
      // 教程判断的命盘解读与报告/zone面板判断的命盘解读不一致（同一份内容不同
      // 模块各写一份、其中一份漏了条目，是本项目历史上反复出现的坑）。
      '孤辰':'主孤独内省，独处思考力强，宜培养人脉',
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

  // 2026-08-04新增第三参数 pillarAiDetail（可选）：analysis.step_pillars_detail?.[col]
  // 切片（{plain_meaning, hidden_stems, role_in_this_chart}），由调用方（下一轮
  // user-system领域负责接线，本次只保证这里能正确处理"有/没有"两种输入）传入。
  // 传入时渲染分类更清晰的AI详解，替代下方静态兜底内容；不传/undefined（老缓存、
  // AI深析尚未生成完等场景）时【完全保留】原有静态路径，不报错不空白——这是本次
  // 改动最重要的健壮性要求。纳音小节两条路径都保留（事实性短信息，跟AI三个分类
  // 小节不冲突）。
  function buildPillarPanel(col, baziData, pillarAiDetail) {
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

    // 2026-08-04 qa-reviewer复查修复（PLAUSIBLE P2）：原守卫 `pillarAiDetail &&
    // typeof pillarAiDetail === 'object'` 只判断"容器是否为真值的对象"，不判断
    // "容器里是否真的有内容"——传入 `{}` 这种真值但零内容的对象会导致整个分支
    // 被判定为"AI详解可用"、直接 `return body`，反而比静态兜底内容更空（只剩
    // 徽章+标题）。这个输入按当前后端 `_sanitize_pillars_detail()` 的设计不会
    // 产生（要么整柱丢弃、要么三字段齐全），但守卫本身不应该依赖调用方的内部
    // 实现细节才成立——改为显式检查至少一个内容字段非空，不合规输入会自然落到
    // 下方静态兜底路径，而不是渲染空壳。
    const hasAiPillarContent = pillarAiDetail && typeof pillarAiDetail === 'object' &&
      (pillarAiDetail.plain_meaning || pillarAiDetail.hidden_stems || pillarAiDetail.role_in_this_chart);
    if (hasAiPillarContent) {
      const { plain_meaning, hidden_stems, role_in_this_chart } = pillarAiDetail;
      if (plain_meaning) body += section('这根柱子说的是什么', insight(plain_meaning, 'neutral'));
      if (hidden_stems)  body += section('藏干与深层倾向', insight(hidden_stems, 'neutral'));
      if (role_in_this_chart) {
        body += section(isDay ? '对你的意义（含配偶宫）' : '对你的意义', insight(role_in_this_chart, 'neutral'));
      }
      return body;
    }

    if (isDay) body += section('日主含义', insight(getDmDesc(stem), 'neutral'));

    const branchInfo = (typeof CONFIG !== 'undefined') ? CONFIG?.BRANCHES_INFO?.[branch] : null;
    if (branchInfo?.hidden?.length) {
      const hiddenText = branchInfo.hidden.map(h => h.s).join('、');
      body += section('藏干', insight('地支' + branch + '藏干：' + hiddenText, 'neutral'));
    }
    return body;
  }

  // 2026-08-04新增第三参数 shenshaAiDetail（可选）：
  // analysis.step_shensha_detail?.shensha_items?.find(s=>s.name===name) 切片
  // （{nature, concept, personal_impact, advice}）。传入时渲染分类更清晰的AI详解，
  // 替代下方静态兜底内容；不传/undefined时完全保留原有静态路径。头部吉/凶/中性
  // badge 仍按既有 SHENSHA_GOOD/SHENSHA_WARN 静态分类计算（不随AI的nature字段
  // 变化）——避免同一神煞名下"头部badge判定"与"AI正文nature判断"两套分类来源
  // 不一致时互相矛盾；AI正文小节自己的insight()配色改用AI给出的nature，二者是
  // 两个独立的展示决策，不强行统一。
  function buildShenshaPanel(name, baziData, shenshaAiDetail) {
    const isGood = SHENSHA_GOOD.has(name);
    const isWarn = SHENSHA_WARN.has(name);
    const type   = isGood ? 'good' : isWarn ? 'warn' : 'neutral';
    const icon   = isGood ? '✦ 吉神' : isWarn ? '⚠ 凶煞' : '◈ 中性';

    let body = `
      <div>${badge(icon, type)}</div>
      <div class="zone-title">${name}</div>
      <div class="zone-subtitle">神煞 · 命盘标记</div>
    `;

    // 2026-08-04 qa-reviewer复查修复（PLAUSIBLE P2）：同 buildPillarPanel() 上方
    // 同一批修复，理由一致——守卫加固为"至少一个内容字段非空"，避免 `{}` 这种
    // 零内容输入渲染出比静态兜底更空的空壳面板。
    const hasAiShenshaContent = shenshaAiDetail && typeof shenshaAiDetail === 'object' &&
      (shenshaAiDetail.concept || shenshaAiDetail.personal_impact || shenshaAiDetail.advice);
    if (hasAiShenshaContent) {
      const { nature, concept, personal_impact, advice } = shenshaAiDetail;
      const natureType = nature === '吉' ? 'good' : nature === '凶' ? 'warn' : 'neutral';
      if (concept)         body += section('这颗神煞是什么', insight(concept, natureType));
      if (personal_impact) body += section('对你的具体影响', insight(personal_impact, natureType));
      if (advice)           body += section('化解与运用建议', insight(advice, 'neutral'));
      return body;
    }

    body += section('含义', insight(ssDesc(name), type));
    body += section('对你的影响', insight(_ssPersonalImpact(name, baziData), type));
    return body;
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

  return { buildZonePanel, buildPillarPanel, buildShenshaPanel, buildReport, refreshAiAnalysis, showAiRefreshing, clearAiRefreshing, refreshStrengthGauge };
})();
