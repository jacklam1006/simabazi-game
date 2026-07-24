/**
 * user-journey.js · 用户旅程控制器 v2.0
 *
 * 五步流程：
 *  Step 1: 填写生辰信息（真实表单）
 *  Step 2: 推演动画
 *  Step 3: 3D 沙盒揭晓
 *  Step 4: 命盘标注卡
 *  Step 5: 补运任务（产品/咨询）
 *
 * 动态引擎：BaziEngine.calculate(year, month, day, hour, minute, gender)
 */

class UserJourney {
  constructor(sceneBuilder, annotationSystem) {
    this.sb   = sceneBuilder;
    this.anno = annotationSystem;
    this.step = 0;
    this.baziData = null;
  }

  async start() {
    this._goTo(1);
  }

  _goTo(step) {
    this.step = step;
    ({ 1:()=>this._step1(), 2:()=>this._step2(),
       3:()=>this._step3(), 4:()=>this._step4(),
       5:()=>this._step5() }[step] || (()=>{}))();
  }

  /* ── Step 1: 生辰信息输入表单 ── */
  _step1() {
    const ls = document.getElementById('loading-screen');
    ls.style.display = 'flex';
    ls.innerHTML = `
      <div style="
        width:100%; max-width:380px; padding:40px 32px;
        background:rgba(10,10,18,0.95);
        border:1px solid rgba(201,169,110,0.2);
        border-radius:20px;
        box-shadow:0 0 60px rgba(201,169,110,0.08);
      ">
        <!-- 品牌标题 -->
        <div style="text-align:center;margin-bottom:32px">
          <h1 style="color:#c9a96e;font-size:22px;letter-spacing:6px;font-weight:300;margin-bottom:6px">
            司马八字
          </h1>
          <p style="color:rgba(232,224,208,0.35);font-size:11px;letter-spacing:3px">
            天机已动 · 为你推演命格
          </p>
        </div>

        <!-- 公历出生日期 -->
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:11px;color:rgba(232,224,208,.5);
                        letter-spacing:2px;margin-bottom:8px">公历出生日期</label>
          <div style="display:flex;gap:8px">
            <input id="b-year"  type="number" placeholder="年" min="1900" max="2030"
              style="${_inputStyle()};flex:2">
            <input id="b-month" type="number" placeholder="月" min="1" max="12"
              style="${_inputStyle()};flex:1">
            <input id="b-day"   type="number" placeholder="日" min="1" max="31"
              style="${_inputStyle()};flex:1">
          </div>
        </div>

        <!-- 出生时辰 -->
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:11px;color:rgba(232,224,208,.5);
                        letter-spacing:2px;margin-bottom:8px">出生时辰（时）</label>
          <select id="b-hour" style="${_selectStyle()}">
            <option value="">请选择时辰</option>
            <option value="23">子时（23:00–01:00）</option>
            <option value="1">丑时（01:00–03:00）</option>
            <option value="3">寅时（03:00–05:00）</option>
            <option value="5">卯时（05:00–07:00）</option>
            <option value="7">辰时（07:00–09:00）</option>
            <option value="9">巳时（09:00–11:00）</option>
            <option value="11">午时（11:00–13:00）</option>
            <option value="13">未时（13:00–15:00）</option>
            <option value="15">申时（15:00–17:00）</option>
            <option value="17">酉时（17:00–19:00）</option>
            <option value="19">戌时（19:00–21:00）</option>
            <option value="21">亥时（21:00–23:00）</option>
          </select>
        </div>

        <!-- 性别 -->
        <div style="margin-bottom:28px">
          <label style="display:block;font-size:11px;color:rgba(232,224,208,.5);
                        letter-spacing:2px;margin-bottom:10px">性别（影响大运排布）</label>
          <div style="display:flex;gap:12px" id="gender-toggle">
            <button onclick="window._journey._setGender('男',this)"
              id="btn-male"
              style="${_genderBtnStyle(true)}">
              乾（男）
            </button>
            <button onclick="window._journey._setGender('女',this)"
              id="btn-female"
              style="${_genderBtnStyle(false)}">
              坤（女）
            </button>
          </div>
        </div>

        <!-- 推演按钮 -->
        <button onclick="window._journey.submitBirth()"
          style="width:100%;padding:15px;
          background:linear-gradient(135deg,#c9a96e 0%,#a07840 100%);
          border:none;border-radius:12px;
          color:#0a0a12;font-size:15px;font-weight:700;letter-spacing:4px;
          cursor:pointer;transition:opacity .2s"
          onmouseover="this.style.opacity='.85'"
          onmouseout="this.style.opacity='1'">
          推演命格
        </button>

        <!-- 错误提示 -->
        <p id="birth-error" style="
          text-align:center;margin-top:14px;font-size:12px;
          color:#eb5757;letter-spacing:1px;min-height:18px"></p>
      </div>
    `;
    // 默认性别：男
    this._gender = '男';
  }

  _setGender(g, btn) {
    this._gender = g;
    document.getElementById('btn-male').style.cssText   = _genderBtnStyle(g==='男');
    document.getElementById('btn-female').style.cssText = _genderBtnStyle(g==='女');
  }

  async submitBirth() {
    const year   = parseInt(document.getElementById('b-year').value);
    const month  = parseInt(document.getElementById('b-month').value);
    const day    = parseInt(document.getElementById('b-day').value);
    const hourEl = document.getElementById('b-hour');
    const hour   = hourEl.value !== '' ? parseInt(hourEl.value) : -1;
    const err    = document.getElementById('birth-error');

    // 校验
    if (!year || year<1900 || year>2030) { err.textContent='请输入正确的年份（1900–2030）'; return; }
    if (!month || month<1 || month>12)   { err.textContent='请选择正确的月份（1–12）'; return; }
    if (!day   || day<1   || day>31)     { err.textContent='请输入正确的日期（1–31）'; return; }
    if (hour === -1)                      { err.textContent='请选择出生时辰'; return; }
    err.textContent = '';

    // 实际出生小时：子时跨日，23:00 视为当日 23 时
    const birthHour = hour === 23 ? 23 : hour;

    this._goTo(2);

    try {
      // 动态计算八字
      const data = BaziEngine.calculate(year, month, day, birthHour, 0, this._gender || '男');
      this.baziData = data;
      setTimeout(() => this._goTo(3), 1600);
    } catch(e) {
      console.error('[BaziEngine] 计算失败', e);
      // 回退到步骤1，显示错误
      this._goTo(1);
      document.getElementById('birth-error').textContent = '排盘失败，请确认日期是否正确：' + e.message;
    }
  }

  /* ── Step 2: 推演动画 ── */
  _step2() {
    const ls = document.getElementById('loading-screen');
    ls.style.display = 'flex';
    ls.innerHTML = `
      <div style="text-align:center">
        <h1 style="color:#c9a96e;font-size:24px;letter-spacing:8px;font-weight:300;margin-bottom:20px">
          推演中…
        </h1>
        <div style="display:flex;gap:12px;justify-content:center;margin-bottom:16px">
          ${['年','月','日','时'].map(l=>`
            <div style="width:44px;height:64px;background:rgba(201,169,110,.08);
                        border:1px solid rgba(201,169,110,.25);border-radius:8px;
                        display:flex;align-items:center;justify-content:center;
                        font-size:18px;color:#c9a96e;animation:pulse 1.4s ease-in-out infinite">
              ${l}
            </div>`).join('')}
        </div>
        <p style="color:rgba(232,224,208,.35);font-size:12px;letter-spacing:2px">
          天干地支排列成型 · 五行格局浮现
        </p>
      </div>
      <style>
        @keyframes pulse {
          0%,100%{opacity:.3;transform:translateY(0)}
          50%{opacity:1;transform:translateY(-4px)}
        }
      </style>
    `;
  }

  /* ── Step 3: 揭晓 3D 沙盒 ── */
  _step3() {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';

    const d = this.baziData;
    const { year:yr, month:mo, day:dy, hour:hr } = d.pillars;
    const yang = d.STEM_YANG?.[d.dayMaster] ?? BaziEngine.STEM_YANG[d.dayMaster];
    const yinYang = yang ? '阳' : '阴';
    const wxName  = d.dayMasterWx;

    document.getElementById('hud-user').textContent =
      `${d.dayMaster}日主（${yinYang}${wxName}·${d.lifePhase||''}）` +
      ` · ${yr.stem}${yr.branch} ${mo.stem}${mo.branch} ${dy.stem}${dy.branch} ${hr.stem}${hr.branch}`;

    this.sb.buildFromBazi(d);
    setTimeout(() => this._goTo(4), 1200);
  }

  /* ── Step 4: 动态命盘标注卡 ── */
  _step4() {
    if (!this.baziData) return;
    const d = this.baziData;
    const dm = d.dayMaster;
    const dmWx = d.dayMasterWx;

    // ① 日主标注
    const annotations = [];
    annotations.push({
      position: [-1, 3.8, 0],
      type: 'fortune',
      title: `日主·${dm}（${BaziEngine.STEM_YANG[dm]?'阳':'阴'}${dmWx}·${d.lifePhase||''}）`,
      content: `${d.dayMasterNature || dm+'木命'}\n十二长生：${d.lifePhase||'-'}，先天格局${d.strength}。`,
    });

    // ② 最旺五行
    const sorted = Object.entries(d.wuxing).sort((a,b)=>b[1]-a[1]);
    const topWx  = sorted[0];
    const botWx  = sorted[sorted.length-1];
    annotations.push({
      position: [0.5, 2, 5.5],
      type: 'neutral',
      title: `五行最旺：${topWx[0]}行（${topWx[1]}%）`,
      content: _wuxingDesc(topWx[0], topWx[1], dm),
    });

    // ③ 喜用神
    annotations.push({
      position: [5.5, 2, -1],
      type: d.strength==='身弱' ? 'fortune' : 'danger',
      title: `喜用神：${d.favorable}行 · ${d.strength}`,
      content: _favorableDesc(d.strength, dm, d.favorable, d.unfavorable),
    });

    // ④ 大运
    if (d.dayun) {
      const dy = d.dayun;
      annotations.push({
        position: [-5.5, 2, 2],
        type: dy.favorable ? 'fortune' : 'neutral',
        title: `当前大运：${dy.gan}${dy.zhi}（${dy.wx}）`,
        content: `十神：${dy.shishen}。大运五行为${dy.wx}，` +
                 (dy.wx === d.favorable ? `正是喜用神，运势大利！` :
                  dy.wx === d.unfavorable ? `与忌神同行，需谨慎克制。` : `平稳过渡，稳中求进。`),
      });
    }

    // ⑤ 神煞亮点
    const top3stars = (d.shenshe||[]).filter(s=>_GOOD_STARS.includes(s)).slice(0,3);
    if (top3stars.length) {
      annotations.push({
        position: [-3.5, 2, -4.5],
        type: 'fortune',
        title: `吉星入命：${top3stars.join('·')}`,
        content: top3stars.map(s=>
          `【${s}】${CONFIG.SHENSHA_3D?.[s]?.desc||'吉星护佑'}`).join('\n'),
      });
    }

    // ⑥ 流年
    if (d.liunian) {
      const ly = d.liunian;
      annotations.push({
        position: [0.5, 2.5, -5],
        type: 'neutral',
        title: `流年（${ly.year}）：${ly.gan}${ly.zhi}年`,
        content: `流年天干 ${ly.gan}（${BaziEngine.STEM_WX[ly.gan]}）与日主关系：` +
                 `${BaziEngine._shishen(dm, ly.gan)}。\n五行：${ly.wx}行，` +
                 (ly.wx === d.favorable ? '此年行喜用神，利于布局与突破。' :
                  ly.wx === d.unfavorable ? '此年行忌神，宜守成而非冒进。' : '此年平稳，步步为营。'),
      });
    }

    this.anno.buildFromAnalysis(annotations);
  }

  /* ── Step 5: 补运任务（阶段3实现） ── */
  _step5() {
    console.log('[Journey] Step 5 · 补运任务（阶段3实现）');
  }
}

/* ─── 私有辅助 ─── */

function _inputStyle() {
  return `padding:12px 14px;background:rgba(255,255,255,.05);
          border:1px solid rgba(201,169,110,.25);border-radius:10px;
          color:#e8e0d0;font-size:14px;outline:none;letter-spacing:1px;width:100%;
          font-family:'PingFang SC','Microsoft YaHei',sans-serif`;
}
function _selectStyle() {
  return `width:100%;padding:12px 14px;background:rgba(255,255,255,.05);
          border:1px solid rgba(201,169,110,.25);border-radius:10px;
          color:#e8e0d0;font-size:14px;outline:none;letter-spacing:1px;
          font-family:'PingFang SC','Microsoft YaHei',sans-serif;
          -webkit-appearance:none;appearance:none`;
}
function _genderBtnStyle(active) {
  return `flex:1;padding:11px 0;border-radius:10px;font-size:13px;letter-spacing:2px;
          cursor:pointer;font-family:'PingFang SC','Microsoft YaHei',sans-serif;
          ${active
            ? 'background:rgba(201,169,110,.2);border:1px solid rgba(201,169,110,.6);color:#c9a96e;font-weight:600'
            : 'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);color:rgba(232,224,208,.45)'}`;
}

const _GOOD_STARS = [
  '天乙贵人','文昌贵人','太极贵人','福星贵人','国印贵人','德秀贵人',
  '禄神','将星','天德贵人','月德贵人','天喜','红鸾','金舆','学堂','天医',
];

function _wuxingDesc(wx, pct, dm) {
  const M = {
    木:'木行主生机、创意与拓展，代表生长向上的力量。',
    火:'火行主热情、才华与表达，代表光明外放的力量。',
    土:'土行主稳定、踏实与财富积累，代表包容厚实的力量。',
    金:'金行主纪律、决断与执行力，代表收敛精炼的力量。',
    水:'水行主智慧、直觉与流动，代表深沉内蓄的力量。',
  };
  const rel = BaziEngine._shishen(dm, ({木:'甲',火:'丙',土:'戊',金:'庚',水:'壬'}[wx])||'甲');
  return `${M[wx]||''}\n在命盘中占比 ${pct}%（最旺五行），与日主关系：${rel}。`;
}

function _favorableDesc(strength, dm, fav, unf) {
  const M = {
    身强:`日主${dm}势力偏强，五行偏旺，需要${fav}行来克制、疏导或泄耗，以达格局平衡。\n忌：${unf}行（助旺日主，锦上添花反为过）。`,
    身弱:`日主${dm}势力偏弱，五行偏衰，需要${fav}行来滋养、扶持或比助，以达格局平衡。\n忌：${unf}行（克泄日主，雪上加霜）。`,
    中和:`命盘格局中和平衡，喜${fav}行略微调节，忌${unf}行过旺破局。`,
  };
  return M[strength] || `喜用神为${fav}行，忌神为${unf}行。`;
}
