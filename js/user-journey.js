/**
 * user-journey.js · 用户旅程控制器 v3.0
 * 五步流程 + 八字表 + 区域点击分析 + 完整报告
 */

class UserJourney {
  constructor(sceneBuilder, annotationSystem) {
    this.sb   = sceneBuilder;
    this.anno = annotationSystem;
    this.step = 0;
    this.baziData = null;
    this._baziTableOpen = false;

    // 注册 3D 区域点击回调
    this.sb.onZoneClick = (zoneKey) => this.showZonePanel(zoneKey);
  }

  async start() { this._goTo(1); }

  _goTo(step) {
    this.step = step;
    ({ 1:()=>this._step1(), 2:()=>this._step2(),
       3:()=>this._step3(), 4:()=>this._step4() }[step]||(() =>{}))();
  }

  /* ══════════════════════════════════════════════════════
   * Step 1: 生辰输入表单
   * ══════════════════════════════════════════════════════ */
  _step1() {
    const ls = document.getElementById('loading-screen');
    ls.style.display = 'flex';
    ls.innerHTML = `
      <div style="
        width:100%;max-width:380px;padding:36px 28px;
        background:rgba(10,10,18,.98);
        border:1px solid rgba(201,169,110,.2);
        border-radius:20px;
        box-shadow:0 0 80px rgba(201,169,110,.06);
      ">
        <div style="text-align:center;margin-bottom:28px">
          <h1 style="color:#c9a96e;font-size:22px;letter-spacing:6px;font-weight:300;margin-bottom:6px">司马八字</h1>
          <p style="color:rgba(232,224,208,.3);font-size:11px;letter-spacing:3px">天机已动 · 为你推演命格</p>
        </div>

        <div style="margin-bottom:14px">
          <label style="${_lbl()}">公历出生日期</label>
          <div style="display:flex;gap:8px">
            <input id="b-year"  type="number" placeholder="年" min="1900" max="2030" style="${_inp()};flex:2">
            <input id="b-month" type="number" placeholder="月" min="1"    max="12"   style="${_inp()};flex:1">
            <input id="b-day"   type="number" placeholder="日" min="1"    max="31"   style="${_inp()};flex:1">
          </div>
        </div>

        <div style="margin-bottom:14px">
          <label style="${_lbl()}">出生时辰</label>
          <select id="b-hour" style="${_sel()}">
            <option value="">请选择时辰</option>
            <option value="23">子时（23–01时）</option>
            <option value="1">丑时（01–03时）</option>
            <option value="3">寅时（03–05时）</option>
            <option value="5">卯时（05–07时）</option>
            <option value="7">辰时（07–09时）</option>
            <option value="9">巳时（09–11时）</option>
            <option value="11">午时（11–13时）</option>
            <option value="13">未时（13–15时）</option>
            <option value="15">申时（15–17时）</option>
            <option value="17">酉时（17–19时）</option>
            <option value="19">戌时（19–21时）</option>
            <option value="21">亥时（21–23时）</option>
          </select>
        </div>

        <div style="margin-bottom:24px">
          <label style="${_lbl()}">性别（影响大运方向）</label>
          <div style="display:flex;gap:10px" id="gender-toggle">
            <button onclick="window._journey._setGender('男',this)" id="btn-m" style="${_gbtn(true)}">乾 · 男</button>
            <button onclick="window._journey._setGender('女',this)" id="btn-f" style="${_gbtn(false)}">坤 · 女</button>
          </div>
        </div>

        <button onclick="window._journey.submitBirth()" style="
          width:100%;padding:14px;
          background:linear-gradient(135deg,#c9a96e,#a07840);
          border:none;border-radius:12px;
          color:#0a0a12;font-size:15px;font-weight:700;letter-spacing:4px;cursor:pointer">
          推演命格
        </button>
        <p id="birth-err" style="text-align:center;margin-top:12px;font-size:12px;color:#eb5757;min-height:16px"></p>
      </div>`;
    this._gender = '男';
  }

  _setGender(g, btn) {
    this._gender = g;
    document.getElementById('btn-m').style.cssText = _gbtn(g==='男');
    document.getElementById('btn-f').style.cssText = _gbtn(g==='女');
  }

  async submitBirth() {
    const y=parseInt(document.getElementById('b-year').value||0);
    const m=parseInt(document.getElementById('b-month').value||0);
    const d=parseInt(document.getElementById('b-day').value||0);
    const h=document.getElementById('b-hour').value;
    const err=document.getElementById('birth-err');
    if (!y||y<1900||y>2030){ err.textContent='请输入正确年份（1900–2030）'; return; }
    if (!m||m<1||m>12)     { err.textContent='请选择正确月份（1–12）';      return; }
    if (!d||d<1||d>31)     { err.textContent='请输入正确日期（1–31）';      return; }
    if (h==='')            { err.textContent='请选择出生时辰';              return; }
    err.textContent='';
    this._goTo(2);
    try {
      this.baziData = BaziEngine.calculate(y, m, d, parseInt(h), 0, this._gender||'男');
      setTimeout(()=>this._goTo(3), 1600);
    } catch(e) {
      console.error(e);
      this._goTo(1);
      document.getElementById('birth-err').textContent='排盘失败：'+e.message;
    }
  }

  /* ══════════════════════════════════════════════════════
   * Step 2: 推演动画
   * ══════════════════════════════════════════════════════ */
  _step2() {
    const ls=document.getElementById('loading-screen');
    ls.style.display='flex';
    ls.innerHTML=`
      <div style="text-align:center">
        <h1 style="color:#c9a96e;font-size:22px;letter-spacing:8px;font-weight:300;margin-bottom:20px">推演中…</h1>
        <div style="display:flex;gap:12px;justify-content:center">
          ${['年','月','日','时'].map((l,i)=>`
            <div style="width:48px;height:68px;
                        background:rgba(201,169,110,.06);
                        border:1px solid rgba(201,169,110,.2);
                        border-radius:10px;
                        display:flex;align-items:center;justify-content:center;
                        font-size:20px;color:#c9a96e;
                        animation:bzp .9s ease-in-out ${i*.18}s infinite alternate">
              ${l}
            </div>`).join('')}
        </div>
        <p style="margin-top:18px;color:rgba(232,224,208,.3);font-size:11px;letter-spacing:2px">
          天干地支排列成型
        </p>
      </div>
      <style>@keyframes bzp{from{opacity:.2;transform:translateY(4px)}to{opacity:1;transform:translateY(-4px)}}</style>`;
  }

  /* ══════════════════════════════════════════════════════
   * Step 3: 揭晓 3D 场景 + 八字表
   * ══════════════════════════════════════════════════════ */
  _step3() {
    document.getElementById('loading-screen').style.display='none';
    document.getElementById('hud').style.display='flex';
    document.getElementById('bazi-table-wrap').style.display='flex';
    document.getElementById('report-btn').style.display='block';

    const d=this.baziData;
    const {year:yr,month:mo,day:dy,hour:hr}=d.pillars;
    const yangStr=BaziEngine.STEM_YANG[d.dayMaster]?'阳':'阴';
    document.getElementById('hud-user').textContent=
      `${d.dayMaster}日主（${yangStr}${d.dayMasterWx}·${d.lifePhase||''}）`+
      ` · ${yr.stem}${yr.branch} ${mo.stem}${mo.branch} ${dy.stem}${dy.branch} ${hr.stem}${hr.branch}`;

    this.sb.buildFromBazi(d);
    this._renderBaziTable(d);
    setTimeout(()=>this._goTo(4), 1000);
  }

  /* ══════════════════════════════════════════════════════
   * Step 4: 引导点击提示
   * ══════════════════════════════════════════════════════ */
  _step4() {
    // 简单提示浮层
    const tip=document.createElement('div');
    tip.id='click-tip';
    tip.style.cssText=`
      position:fixed;bottom:140px;left:50%;transform:translateX(-50%);
      background:rgba(201,169,110,.12);border:1px solid rgba(201,169,110,.3);
      border-radius:20px;padding:7px 20px;font-size:11px;
      color:rgba(201,169,110,.8);letter-spacing:2px;pointer-events:none;
      z-index:60;transition:opacity .5s;`;
    tip.textContent='点击3D场景中的任意区域 · 查看命盘解读';
    document.body.appendChild(tip);
    setTimeout(()=>{ tip.style.opacity='0'; setTimeout(()=>tip.remove(),500); },3500);
  }

  /* ══════════════════════════════════════════════════════
   * 八字表渲染
   * ══════════════════════════════════════════════════════ */
  _renderBaziTable(d) {
    const WX_COLOR={木:'#3a7a3a',火:'#cc3300',土:'#b07840',金:'#8898b0',水:'#2277cc'};
    const cols=['year','month','day','hour'];
    const heads=['年柱','月柱','日柱','时柱'];
    const p=d.pillars;
    const nayin=d.nayin||{};
    const tg=d.tenGods||{};

    const colsHtml=cols.map((k,i)=>{
      const isDay=k==='day';
      const stemColor=WX_COLOR[p[k].stemWx]||'#e8e0d0';
      const branchColor=WX_COLOR[p[k].branchWx]||'#e8e0d0';
      const dayClass=isDay?' day-col':'';
      return `<div class="bazi-col">
        <div class="bazi-cell head${dayClass}">${heads[i]}</div>
        <div class="bazi-cell stem${dayClass}" style="color:${stemColor}">${p[k].stem}</div>
        <div class="bazi-cell branch${dayClass}" style="color:${branchColor}">${p[k].branch}</div>
        <div class="bazi-cell shishen${dayClass}">${tg[k]||'-'}</div>
        <div class="bazi-cell nayin${dayClass}">${nayin[k]||'-'}</div>
      </div>`;
    }).join('');

    // 五行强弱
    const WX=['木','火','土','金','水'];
    const wxBarsHtml=WX.map(wx=>{
      const pct=d.wuxing[wx]||0;
      const c=WX_COLOR[wx];
      const isFav=wx===d.favorable, isUnf=wx===d.unfavorable;
      const tag=isFav?`<span class="meta-tag good" style="font-size:9px">喜</span>`:
                 isUnf?`<span class="meta-tag warn" style="font-size:9px">忌</span>`:'';
      return `<div class="wx-bar-wrap">
        <span class="wx-label" style="color:${c}">${wx}</span>
        <div class="wx-track"><div class="wx-fill" style="width:${pct}%;background:${c}"></div></div>
        <span class="wx-pct">${pct}%</span>
        ${tag}
      </div>`;
    }).join('');

    // 空亡
    const kw=(d.kongwang||[]).join('') || '无';
    // 大运
    const dy2=d.dayun;
    const dyStr=dy2?`${dy2.gan}${dy2.zhi}（${dy2.wx}·${dy2.shishen}）`:'待起运';
    // 流年
    const ly=d.liunian;
    const lyStr=ly?`${ly.year}年 ${ly.gan}${ly.zhi}（${ly.wx}）`:'—';

    document.getElementById('bazi-table-inner').innerHTML=`
      <div class="bazi-grid">${colsHtml}</div>
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <div style="font-size:9px;color:rgba(232,224,208,.35);letter-spacing:2px;margin-bottom:6px">五行强弱</div>
          <div class="wx-mini">${wxBarsHtml}</div>
        </div>
        <div class="bazi-meta" style="flex:1">
          <span class="meta-tag gold">日主·${d.dayMaster} ${d.dayMasterWx}</span>
          <span class="meta-tag ${d.strength==='身强'?'warn':'good'}">${d.strength}</span>
          <span class="meta-tag good">喜·${d.favorable}行</span>
          <span class="meta-tag warn">忌·${d.unfavorable}行</span>
          <span class="meta-tag">空亡·${kw}</span>
          <span class="meta-tag gold">大运·${dyStr}</span>
          <span class="meta-tag">流年·${lyStr}</span>
        </div>
      </div>`;
  }

  toggleBaziTable() {
    this._baziTableOpen=!this._baziTableOpen;
    document.getElementById('bazi-table-panel').classList.toggle('open',this._baziTableOpen);
    document.getElementById('bazi-table-toggle').textContent=
      this._baziTableOpen?'八字命盘 ∨':'八字命盘 ∧';
  }

  /* ══════════════════════════════════════════════════════
   * 区域点击：分析面板
   * ══════════════════════════════════════════════════════ */
  showZonePanel(zoneKey) {
    const d=this.baziData; if(!d) return;
    const info=this._zoneInfo(zoneKey, d);
    document.getElementById('zone-panel-content').innerHTML=this._renderZonePanel(info);
    document.getElementById('zone-panel').classList.add('open');
  }

  closeZonePanel() {
    document.getElementById('zone-panel').classList.remove('open');
  }

  _renderZonePanel(info) {
    const badgeCls=info.status==='good'?'badge-good':info.status==='warn'?'badge-warn':'badge-neutral';
    const badgeIcon=info.status==='good'?'✓':info.status==='warn'?'⚠':'◈';
    const badgeText=info.status==='good'?'有利格局':info.status==='warn'?'注意事项':'中性格局';

    const insightsHtml=(info.insights||[]).map(it=>`
      <div class="insight-item ${it.type==='good'?'insight-good':'insight-warn'}">
        <span class="insight-icon">${it.type==='good'?'✓':'⚠'}</span>
        <span>${it.text}</span>
      </div>`).join('');

    const sectionsHtml=(info.sections||[]).map(s=>`
      <div class="zone-section">
        <div class="zone-section-title">${s.title}</div>
        <div class="zone-section-body">${s.body}</div>
      </div>`).join('');

    return `
      <div class="zone-panel-badge ${badgeCls}" style="margin-bottom:2px">${badgeIcon} ${badgeText}</div>
      <div class="zone-panel-title">${info.title}</div>
      <div class="zone-panel-subtitle">${info.subtitle||''}</div>
      <div style="height:1px;background:rgba(201,169,110,.15);margin:12px 0"></div>
      ${sectionsHtml}
      ${insightsHtml.length?`<div class="zone-section"><div class="zone-section-title">关键提示</div>${insightsHtml}</div>`:''}`;
  }

  /* ── 各区域内容生成 ── */
  _zoneInfo(key, d) {
    const dm=d.dayMaster, dmWx=d.dayMasterWx;
    const p=d.pillars, wx=d.wuxing, yr=d.yangRatio||{};
    const WX_NAME={木:'参天树木',火:'炎阳烈火',土:'厚土山岳',金:'精炼金石',水:'江海流水'};

    switch(key) {
      case 'mu': return this._zoneWx('木', d);
      case 'huo': return this._zoneWx('火', d);
      case 'tu':  return this._zoneWx('土', d);
      case 'jin': return this._zoneWx('金', d);
      case 'shui':return this._zoneWx('水', d);
      default:    return { title:'命盘区域', subtitle:'', status:'neutral', sections:[], insights:[] };
    }
  }

  _zoneWx(wx, d) {
    const dm=d.dayMaster, dmWx=d.dayMasterWx;
    const pct=d.wuxing[wx]||0;
    const isFav=wx===d.favorable, isUnf=wx===d.unfavorable;
    const isSame=wx===dmWx;
    const yr=d.yangRatio?.[wx]??0.5;

    // 五行关系
    const SHENG={木:'水',火:'木',土:'火',金:'土',水:'金'};
    const KE  ={木:'金',火:'水',土:'木',金:'火',水:'土'};
    const SHI ={木:'火',火:'土',土:'金',金:'水',水:'木'};

    // 十神关系
    const shishen=BaziEngine._shishen(dm, {木:'甲',火:'丙',土:'戊',金:'庚',水:'壬'}[wx]||'甲');

    // 分析文字
    const pctDesc=pct>=25?'最旺':pct>=20?'较旺':pct<=13?'最弱':pct<=17?'偏弱':'适中';
    const yangDesc=yr>0.6?'阳气偏重（'+{木:'甲木',火:'丙火',土:'戊土',金:'庚金',水:'壬水'}[wx]+'主导）':
                   yr<0.4?'阴气偏重（'+{木:'乙木',火:'丁火',土:'己土',金:'辛金',水:'癸水'}[wx]+'主导）':
                   '阴阳均衡';

    const WX_DESC={
      木:{sheng:'水（印枭）生助',shengDesc:'水生木，印枭滋养日主，主智慧学识',
          desc:'木主生发、进取、创意，代表你的开拓力与生命力'},
      火:{sheng:'木（食伤）生助',shengDesc:'木生火，食伤旺盛，主才华表达与创意输出',
          desc:'火主热情、才华、表达，代表你的创意与表现欲'},
      土:{sheng:'火（食伤）生助',shengDesc:'火生土，食伤生财，主财富积累',
          desc:'土主稳定、踏实、财富，代表你的积累力与包容心'},
      金:{sheng:'土（财星）生助',shengDesc:'土生金，财生官，主规则与执行力',
          desc:'金主纪律、决断、执行，代表你的约束力与精准度'},
      水:{sheng:'金（官杀）生助',shengDesc:'金生水，官杀化印，主智谋与学识',
          desc:'水主智慧、流动、直觉，代表你的思维深度与谋略'},
    };

    const status=isFav?'good':isUnf?'warn':'neutral';

    const insights=[];
    if (isFav) insights.push({type:'good', text:`${wx}行是你的喜用神，此区越旺越利。可佩戴${wx==='木'?'绿色植物、木质饰品':wx==='火'?'红色、南向布局':wx==='土'?'黄色、土质陶器':wx==='金'?'金属饰品、白色':wx==='水'?'蓝色、流水摆件':'相关物品'}催旺。`});
    if (isUnf) insights.push({type:'warn', text:`${wx}行是你的忌神，过旺会冲击格局平衡。注意避免在此五行方位大动土木或做重要决策。`});
    if (pct<=13) insights.push({type:'warn', text:`${wx}行占比仅${pct}%，五行偏弱，相关人生课题（${WX_DESC[wx]?.desc||''}）需刻意补强。`});
    if (pct>=26) insights.push({type:isFav?'good':'warn', text:`${wx}行占比${pct}%，五行偏旺，${isFav?'旺而有用，格局强劲':'过旺需泄，注意克制相关特质'}`});
    if (isSame) insights.push({type:'good', text:`${wx}行是你日主的本气，先天根基牢固，自我认同感强。`});

    // 藏干分析
    const hiddenStemsList=['year','month','day','hour']
      .flatMap(k=>(d.hiddenStems?.[k]||[]).filter(h=>h.wx===wx))
      .map(h=>`${h.stem}（${h.shishen}）`);

    // 神煞
    const relatedShensha=(d.shenshe||[]).filter(s=>{
      const cfg=CONFIG?.SHENSHA_3D?.[s];
      return cfg?.wx===wx;
    });

    return {
      title:`${wx}行 · ${WX_NAME[wx]}`,
      subtitle:`${pctDesc}（${pct}%）· ${yangDesc}`,
      status,
      sections:[
        { title:'五行含义', body:`${WX_DESC[wx]?.desc||wx+'行'}。<br>在你的命盘中以「${shishen}」形式出现，${SHISHEN_DESC_SHORT[shishen]||''}。` },
        hiddenStemsList.length?
          { title:'藏干组成', body:`${wx}行的力量来自：${hiddenStemsList.join('、')}` }:null,
        relatedShensha.length?
          { title:'相关神煞', body:relatedShensha.map(s=>`【${s}】${CONFIG?.SHENSHA_3D?.[s]?.desc||''}`).join('<br>') }:null,
        { title:'生活应用', body:_wxLifeAdvice(wx, isFav, isUnf, pct) },
      ].filter(Boolean),
      insights,
    };
  }

  /* ══════════════════════════════════════════════════════
   * 完整报告 Modal
   * ══════════════════════════════════════════════════════ */
  showReport() {
    const d=this.baziData; if(!d) return;
    document.getElementById('report-body').innerHTML=this._renderReport(d);
    document.getElementById('report-modal').classList.add('open');
  }

  closeReport() {
    document.getElementById('report-modal').classList.remove('open');
  }

  _renderReport(d) {
    const dm=d.dayMaster, dmWx=d.dayMasterWx;
    const p=d.pillars;
    const WX_COLOR={木:'#3a7a3a',火:'#cc3300',土:'#b07840',金:'#8898b0',水:'#2277cc'};

    // 四柱表
    const fourPillarHtml=`
      <div class="four-pillar-table">
        ${['year','month','day','hour'].map((k,i)=>{
          const isD=k==='day';
          const sc=WX_COLOR[p[k].stemWx]||'#e8e0d0';
          const bc=WX_COLOR[p[k].branchWx]||'#e8e0d0';
          const dc=isD?' day-main':'';
          return `<div class="fp-col">
            <div class="fp-cell hd${dc}">${['年柱','月柱','日柱','时柱'][i]}</div>
            <div class="fp-cell s${dc}" style="color:${sc}">${p[k].stem}</div>
            <div class="fp-cell b${dc}" style="color:${bc}">${p[k].branch}</div>
            <div class="fp-cell${dc}" style="font-size:11px;color:rgba(201,169,110,.7)">${(d.tenGods||{})[k]||'-'}</div>
            <div class="fp-cell${dc}" style="font-size:10px;color:rgba(232,224,208,.4)">${(d.nayin||{})[k]||'-'}</div>
            <div class="fp-cell${dc}" style="font-size:10px;color:rgba(232,224,208,.35)">${(d.lifePhases||{})[k]||'-'}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="font-size:10px;color:rgba(232,224,208,.3);text-align:center;letter-spacing:1px">
        天干 · 地支 · 十神 · 纳音 · 十二长生
      </div>`;

    // 五行饼
    const WX=['木','火','土','金','水'];
    const wxBars=WX.map(wx=>{
      const pct=d.wuxing[wx]||0;
      const c=WX_COLOR[wx];
      const tags=[];
      if(wx===d.favorable) tags.push(`<span style="color:#6FCF97;font-size:9px"> ✓喜</span>`);
      if(wx===d.unfavorable) tags.push(`<span style="color:#EB5757;font-size:9px"> ⚠忌</span>`);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="color:${c};width:14px;font-size:12px">${wx}</span>
        <div style="flex:1;height:8px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${c};border-radius:4px"></div>
        </div>
        <span style="font-size:11px;opacity:.5;width:28px">${pct}%</span>
        ${tags.join('')}
      </div>`;
    }).join('');

    // 大运列表
    const dayunHtml=(d.dayuns||[]).slice(0,8).map(dy=>{
      const c=WX_COLOR[dy.wx]||'#c9a96e';
      const isNow=dy.startYear<=(new Date().getFullYear())&&dy.endYear>=(new Date().getFullYear());
      return `<div style="
        display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;
        background:${isNow?'rgba(201,169,110,.1)':'rgba(255,255,255,.03)'};
        border:1px solid ${isNow?'rgba(201,169,110,.3)':'rgba(255,255,255,.06)'};
        margin-bottom:6px">
        <span style="color:${c};font-size:16px;font-weight:700;width:28px">${dy.gan}${dy.zhi}</span>
        <span style="font-size:10px;color:rgba(232,224,208,.4)">${dy.startYear||'—'}–${dy.endYear||'—'}</span>
        <span style="font-size:11px;color:rgba(201,169,110,.6)">${dy.shishen}</span>
        ${isNow?'<span style="background:rgba(201,169,110,.2);border-radius:4px;padding:1px 6px;font-size:9px;color:#c9a96e">当前</span>':''}
      </div>`;
    }).join('');

    // 神煞
    const GOOD_STARS=['天乙贵人','文昌贵人','太极贵人','禄神','将星','天德贵人','月德贵人',
                      '天喜','红鸾','金舆','学堂','天医','福星贵人','国印贵人','德秀贵人'];
    const goodS=(d.shenshe||[]).filter(s=>GOOD_STARS.includes(s));
    const warnS=(d.shenshe||[]).filter(s=>!GOOD_STARS.includes(s));
    const shenshaHtml=`
      <div style="margin-bottom:8px">
        <div style="font-size:10px;color:#6FCF97;letter-spacing:2px;margin-bottom:6px">✓ 吉星（${goodS.length}颗）</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${goodS.map(s=>`<span style="background:rgba(111,207,151,.08);border:1px solid rgba(111,207,151,.2);border-radius:4px;padding:3px 8px;font-size:11px;color:rgba(111,207,151,.85)">${s}</span>`).join('')||'<span style="opacity:.4">无</span>'}
        </div>
      </div>
      <div>
        <div style="font-size:10px;color:#EB5757;letter-spacing:2px;margin-bottom:6px">⚠ 凶星需注意（${warnS.length}颗）</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${warnS.map(s=>`<span style="background:rgba(235,87,87,.08);border:1px solid rgba(235,87,87,.2);border-radius:4px;padding:3px 8px;font-size:11px;color:rgba(235,87,87,.8)">${s}</span>`).join('')||'<span style="opacity:.4">无</span>'}
        </div>
      </div>`;

    // 刑冲合
    const interHtml=(d.interactions||[]).length?
      d.interactions.map(it=>`
        <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;
                    background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);margin-bottom:5px">
          <span style="font-size:11px;color:${it.type==='冲'?'#EB5757':it.type==='合'?'#6FCF97':'#c9a96e'}">[${it.type}]</span>
          <span style="font-size:12px;color:rgba(232,224,208,.7)">${it.desc}</span>
        </div>`).join('')
      :'<p style="opacity:.4;font-size:12px">无明显刑冲合</p>';

    return `
      <!-- 基本信息 -->
      <div class="report-section">
        <div class="report-section-head">一、四柱命盘</div>
        <div class="report-section-body">
          ${fourPillarHtml}
          <div style="margin-top:12px;padding:10px 14px;background:rgba(201,169,110,.06);border-radius:8px">
            <span style="color:#c9a96e;font-size:14px;font-weight:600">日主 · ${dm}</span>
            <span style="font-size:12px;color:rgba(232,224,208,.6);margin-left:10px">${d.dayMasterNature||''}</span>
          </div>
          <div style="margin-top:8px;font-size:12px;color:rgba(232,224,208,.5)">
            空亡：${(d.kongwang||[]).join('')||'无'} &emsp;
            十二长生：${d.lifePhase||'—'} &emsp;
            起运：${d.qiyun||'—'}
          </div>
        </div>
      </div>

      <!-- 五行 -->
      <div class="report-section">
        <div class="report-section-head">二、五行格局</div>
        <div class="report-section-body">
          <div style="margin-bottom:12px">${wxBars}</div>
          <div style="padding:10px 14px;background:rgba(255,255,255,.03);border-radius:8px;font-size:13px">
            格局判断：<b style="color:#c9a96e">${d.strength}</b>
            &emsp;喜用神：<b style="color:#6FCF97">${d.favorable}行</b>
            &emsp;忌神：<b style="color:#EB5757">${d.unfavorable}行</b>
          </div>
        </div>
      </div>

      <!-- 神煞 -->
      <div class="report-section">
        <div class="report-section-head">三、神煞（共${(d.shenshe||[]).length}颗）</div>
        <div class="report-section-body">${shenshaHtml}</div>
      </div>

      <!-- 刑冲合 -->
      <div class="report-section">
        <div class="report-section-head">四、命局刑冲合害（含天干五合）</div>
        <div class="report-section-body">${interHtml}</div>
      </div>

      <!-- 大运 -->
      <div class="report-section">
        <div class="report-section-head">五、大运排布</div>
        <div class="report-section-body">
          <div style="margin-bottom:8px;font-size:11px;color:rgba(232,224,208,.4)">${d.qiyun||''}</div>
          ${dayunHtml}
        </div>
      </div>

      <!-- 流年 -->
      <div class="report-section">
        <div class="report-section-head">六、近四年流年</div>
        <div class="report-section-body">
          ${(d.futureYrs||[]).map(ly=>`
            <div style="display:flex;gap:10px;align-items:center;padding:6px 10px;border-radius:6px;
                        background:rgba(255,255,255,.03);margin-bottom:5px">
              <span style="font-size:15px;font-weight:700;color:${{木:'#3a7a3a',火:'#cc3300',土:'#b07840',金:'#8898b0',水:'#2277cc'}[ly.wx]||'#c9a96e'}">${ly.gan}${ly.zhi}</span>
              <span style="font-size:11px;color:rgba(232,224,208,.4)">${ly.year}年</span>
              <span style="font-size:11px;color:rgba(201,169,110,.6)">${ly.wx}行年</span>
              <span style="font-size:10px;color:${ly.wx===d.favorable?'#6FCF97':ly.wx===d.unfavorable?'#EB5757':'rgba(232,224,208,.3)'}">${ly.wx===d.favorable?'✓喜':ly.wx===d.unfavorable?'⚠忌':''}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }
}

/* ── 私有辅助 ── */

const SHISHEN_DESC_SHORT={
  比肩:'独立自主·竞争意识强',
  劫财:'竞争进取·财帛需防耗散',
  食神:'才艺休闲·表达自然流畅',
  伤官:'创意变革·桀骜不驯',
  偏财:'偏财机遇·理财灵活',
  正财:'稳定财富·勤劳务实',
  七杀:'压力权威·有魄力但需导引',
  正官:'规则地位·遵守秩序',
  偏印:'直觉智慧·偏向独立钻研',
  正印:'学识母爱·受保护与培育',
};

function _wxLifeAdvice(wx, isFav, isUnf, pct) {
  const advice={
    木:{fav:'多亲近自然、绿色植物；事业方向适合文教、创业、设计；居所宜偏东或东南方。',
        unf:'木行过旺，需以金收敛：可佩戴金属饰品，避免东方大动土，减少冲动决策。',
        weak:'补木：穿绿色、居室多绿植；事业开拓力需刻意培养；宜多运动激发生命力。'},
    火:{fav:'多社交、演讲、表现自我；事业适合传媒、教育、表演；宜向南发展。',
        unf:'火旺需水制：保持冷静克制，多独处沉淀；减少激动言辞，防口舌是非。',
        weak:'补火：穿红橙色；向南方拓展机遇；多晒太阳，培养表达勇气和热情。'},
    土:{fav:'金融、地产、农业方向有利；做事脚踏实地；宜在中央或西南方位置业。',
        unf:'土旺需木疏：多变动求新，避免固执守旧；需防土旺埋金，影响财运流动。',
        weak:'补土：多食黄色食物，穿土黄色；培养耐心，强化积累意识；宜学理财。'},
    金:{fav:'军警、金融、工程、法律方向有利；执行力强，宜乘大运推进实质目标。',
        unf:'金旺需火制：减少独断，多倾听他人；注意防范意外伤灾，宜体检。',
        weak:'补金：佩戴金属饰品，穿白色或金色；培养纪律感；向西方寻求贵人。'},
    水:{fav:'智识类、哲学、金融、贸易方向有利；多读书进修；流动性事业更利。',
        unf:'水旺需土制：防止思虑过度，保持行动力；警惕感情泛滥，注意肾与泌尿健康。',
        weak:'补水：多喝水，向北方寻机遇；培养内在智慧；宜学冥想、哲学深化直觉。'},
  };
  const a=advice[wx];
  if(!a) return '—';
  return isFav?a.fav:isUnf?a.unf:(pct<=15?a.weak:'此五行在命盘中表现中性，顺应自然格局即可。');
}

function _lbl() {
  return 'display:block;font-size:11px;color:rgba(232,224,208,.45);letter-spacing:2px;margin-bottom:8px';
}
function _inp() {
  return `padding:11px 14px;background:rgba(255,255,255,.05);
          border:1px solid rgba(201,169,110,.2);border-radius:10px;
          color:#e8e0d0;font-size:14px;outline:none;width:100%;
          font-family:'PingFang SC',sans-serif`;
}
function _sel() {
  return `width:100%;padding:11px 14px;background:rgba(255,255,255,.05);
          border:1px solid rgba(201,169,110,.2);border-radius:10px;
          color:#e8e0d0;font-size:14px;outline:none;-webkit-appearance:none;
          font-family:'PingFang SC',sans-serif`;
}
function _gbtn(active) {
  return `flex:1;padding:10px 0;border-radius:10px;font-size:12px;letter-spacing:2px;
          cursor:pointer;font-family:'PingFang SC',sans-serif;
          ${active
            ?"background:rgba(201,169,110,.18);border:1px solid rgba(201,169,110,.6);color:#c9a96e;font-weight:600"
            :"background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:rgba(232,224,208,.4)"}`;
}
