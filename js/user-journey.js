/**
 * user-journey.js · 用户旅程控制器
 *
 * 五步流程：
 *  Step 1: 填写生辰信息
 *  Step 2: 推演动画
 *  Step 3: 3D 沙盒揭晓
 *  Step 4: 展示命盘标注
 *  Step 5: 补运任务（产品/咨询）
 */

class UserJourney {
  constructor(sceneBuilder, annotationSystem) {
    this.sb   = sceneBuilder;
    this.anno = annotationSystem;
    this.step = 0;
    this.baziData = null;
  }

  async start() {
    /**
     * 演示命盘：癸未年·戊午月·甲寅日·壬申时
     * 日主 甲木（阳木·参天大树·临官极旺）
     *
     * 五行得分（含藏干×0.5权重，午月火令×1.5）：
     *   木23%  火23%  土24%  金12%  水18%
     *
     * 各五行阴阳比例 yangRatio（0=全阴 → 1=全阳）：
     *   木0.90  火0.62  土0.39  金1.00  水0.57
     *   →  木区：甲木参天大树  土区：己土圆润丘陵
     *      金区：庚金刀锋晶柱  火区：丙午熔岩+灯笼混合
     *
     * 大运 壬子（水生木·喜用神）→ 蓝色大运光环
     * 流年 丙午（食神年·创意输出）→ 红色流年粒子雨
     */
    this.baziData = {
      wuxing:      { 木:23, 火:23, 土:24, 金:12, 水:18 },
      dayMaster:   '甲',
      dayMasterWx: '木',
      pillars: {
        year:  { stem:'癸', branch:'未' },
        month: { stem:'戊', branch:'午' },
        day:   { stem:'甲', branch:'寅' },
        hour:  { stem:'壬', branch:'申' },
      },
      yangRatio: { 木:.90, 火:.62, 土:.39, 金:1.00, 水:.57 },
      shenshe: ['驿马','红鸾','太极贵人','国印贵人','禄神','天喜',
                '福星贵人','将星','红艳','德秀贵人','天乙贵人'],
      favorable:   '金',
      unfavorable: '水',
      strength:    '身强',
      lifePhase:   '临官',
      dayun: {
        stem:'壬', branch:'子', wx:'水', yang:true,
        favorable:true, label:'壬子大运',
        desc:'水旺生木·贵人相助·智慧扩展期',
      },
      liunian: {
        stem:'丙', branch:'午', wx:'火', yang:true,
        label:'丙午流年',
        desc:'食神旺·创意输出·事业表达力强',
      },
    };
    this._goTo(2);
    setTimeout(() => this._goTo(3), 1800);
  }

  _goTo(step) {
    this.step = step;
    ({ 1:()=>this._step1(), 2:()=>this._step2(),
       3:()=>this._step3(), 4:()=>this._step4(),
       5:()=>this._step5() }[step] || (()=>{}))();
  }

  /* Step 1: 生辰填写（阶段3实现精美版） */
  _step1() {
    document.getElementById('loading-screen').innerHTML = `
      <div style="text-align:center;padding:40px;max-width:380px">
        <h1 style="color:#c9a96e;font-size:22px;letter-spacing:5px;margin-bottom:8px">司马八字</h1>
        <p style="color:rgba(232,224,208,.45);font-size:12px;letter-spacing:2px;margin-bottom:36px">
          天机已动 · 等待排演</p>
        <input id="birth-input" type="text"
          placeholder="出生日期，例：1998年5月3日 午时"
          style="width:100%;padding:14px 18px;background:rgba(255,255,255,.06);
          border:1px solid rgba(201,169,110,.3);border-radius:12px;
          color:#e8e0d0;font-size:14px;outline:none;letter-spacing:1px;margin-bottom:16px">
        <button onclick="window._journey.submitBirth()"
          style="width:100%;padding:14px;
          background:linear-gradient(135deg,#c9a96e,#a07840);
          border:none;border-radius:12px;color:#0a0a12;
          font-size:15px;font-weight:700;letter-spacing:3px;cursor:pointer">
          推演命格
        </button>
      </div>`;
  }

  async submitBirth() {
    const v = document.getElementById('birth-input').value;
    if (!v.trim()) return;
    this._goTo(2);
    setTimeout(() => this._goTo(3), 2200);
  }

  /* Step 2: 推演动画 */
  _step2() {
    document.getElementById('loading-screen').innerHTML = `
      <div style="text-align:center">
        <h1 style="color:#c9a96e;font-size:22px;letter-spacing:6px;margin-bottom:16px">
          推演中…</h1>
        <p style="color:rgba(232,224,208,.4);font-size:12px;letter-spacing:2px">
          天干地支排列成型</p>
      </div>`;
  }

  /* Step 3: 揭晓 3D 沙盒 */
  _step3() {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';

    // 更新 HUD
    const d = this.baziData;
    const yr = d.pillars.year;
    const mo = d.pillars.month;
    const dy = d.pillars.day;
    const hr = d.pillars.hour;
    document.getElementById('hud-user').textContent =
      `${d.dayMaster}日主（阳木·${d.lifePhase}）· ${yr.stem}${yr.branch} ${mo.stem}${mo.branch} ${dy.stem}${dy.branch} ${hr.stem}${hr.branch}`;

    this.sb.buildFromBazi(d);
    setTimeout(() => this._goTo(4), 1200);
  }

  /* Step 4: 展示命盘标注 */
  _step4() {
    if (!this.baziData) return;
    const d = this.baziData;

    // 根据实际命盘生成精准标注
    const annotations = [
      {
        position: [-1, 3.8, 0],
        type: 'fortune',
        title: `日主·${d.dayMaster}（阳木·${d.lifePhase}）`,
        content: `你的日主为${d.dayMaster}，属阳木，在日支寅木处于「临官」之位，是八字最旺的状态之一。\n甲木象征参天大树：主进取、领导力强、思想正直、不屈不挠。\n先天优势：逻辑清晰、敢于担当、适合开拓型事业。`,
      },
      {
        position: [0.5, 2, 5.5],
        type: 'neutral',
        title: `火行中等（${d.wuxing['火']}%）· 月令午火`,
        content: `火行为甲木的食神/伤官（我生之物），代表才华、创意与表达力。\n月支午火是月令，为本月旺气所在，赋予你较强的表达欲与事业冲劲。\n流年丙午更强化此气，${d.liunian?.desc || ''}。`,
      },
      {
        position: [5.5, 2, -1],
        type: 'danger',
        title: `金行偏弱（${d.wuxing['金']}%）· 时支申金`,
        content: `金行为甲木的七杀/正官（克我之物）。金行偏弱，对强木的约束不足，导致日主过旺难以收敛。\n喜用神正是金行（庚申）：金能制木，给你方向感与纪律性。\n建议佩戴金属类或白色/银色水晶（如白水晶、黄铁矿）补充金气。`,
      },
      {
        position: [-5.5, 2, 2],
        type: 'fortune',
        title: `土行最旺（${d.wuxing['土']}%）· 偏财格`,
        content: `土行为甲木的偏财/正财，命盘中土行最旺（24%），财星有力。\n月干戊土（阳土）为偏财，时支申藏戊土，财气多点分布。\n偏财有力代表：理财能力强、善于把握财富机遇、可能有多渠道收入。`,
      },
      {
        position: [-3.5, 2, -4.5],
        type: 'neutral',
        title: `水行（${d.wuxing['水']}%）· 壬癸双透`,
        content: `水行为甲木的正印/偏印，代表智慧、学识与贵人扶持。\n命盘中壬（阳水）与癸（阴水）均透出天干，正偏印双现，智识资源丰富。\n大运壬子更强化水气：${d.dayun?.desc || ''}。\n注意：水已充足，切勿再补水，否则水泛木漂，反伤格局。`,
      },
      {
        position: [0.5, 2.5, -5],
        type: 'fortune',
        title: '天乙贵人 · 年柱入命',
        content: `天乙贵人坐年柱（癸未），为命盘中最有力的吉星，主逢凶化吉、贵人相助。\n年柱天乙贵人说明：年少时家庭背景有贵助，祖运有力。\n成年后仍能在关键时刻遇见改变命运的贵人，宜多经营人脉与口碑。`,
      },
    ];

    this.anno.buildFromAnalysis(annotations);
  }

  /* Step 5: 补运任务（阶段3实现） */
  _step5() {
    console.log('[Journey] Step 5 · 补运任务（阶段3实现）');
  }
}
