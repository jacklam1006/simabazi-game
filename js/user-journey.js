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
    // 演示模式：直接加载示例命盘（火旺·缺水·文昌入命）
    // 阶段3 将替换为真实用户输入 + API
    this.baziData = {
      wuxing: { 木:22, 火:36, 土:12, 金:17, 水:13 },
      dayMaster: '丙',
      dayMasterWx: '火',
      pillars: {
        year:  { stem:'甲', branch:'午' },
        month: { stem:'丙', branch:'子' },
        day:   { stem:'丙', branch:'寅' },
        hour:  { stem:'壬', branch:'申' },
      },
      shenshe: ['文昌星', '桃花', '驿马'],
      favorable: '水',
      unfavorable: '火',
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
    document.getElementById('hud-user').textContent =
      `${d.dayMaster}日主 · ${d.dayMasterWx}行 · ${d.pillars.year.stem}${d.pillars.year.branch}年生`;

    this.sb.buildFromBazi(d);
    setTimeout(() => this._goTo(4), 1200);
  }

  /* Step 4: 展示命盘标注 */
  _step4() {
    if (!this.baziData) return;
    const d = this.baziData;

    // 根据五行强弱和神煞生成标注点
    const annotations = [
      {
        position: [0.5, 2, 5.5],
        type: 'danger',
        title: `火行偏旺（${d.wuxing['火']}%）`,
        content: `你的命盘火行过旺，容易情绪急躁、决策冲动。\n建议：增加水行调候，可佩戴蓝晶石、海蓝宝减少火燥之气。`,
      },
      {
        position: [-3.5, 2, -4.5],
        type: 'neutral',
        title: `水行偏弱（${d.wuxing['水']}%）`,
        content: `水为你的用神（喜用），水行偏弱影响智慧和财运发挥。\n建议：多接近水源环境，以黑曜石、海蓝宝补水气。`,
      },
      {
        position: [0.5, 2.8, -5],
        type: 'fortune',
        title: '文昌星入命',
        content: `命格中文昌星有力，代表学习力强、表达清晰、适合内容创业或知识型事业。\n这是你先天的智识优势，善加利用可事半功倍。`,
      },
      {
        position: [5.5, 2, -1],
        type: 'neutral',
        title: '桃花旺',
        content: `命盘显示人际吸引力佳，社交场合容易受欢迎，异性缘较好。\n注意：桃花旺盛时感情易复杂，以粉晶助力正向桃花。`,
      },
      {
        position: [-1, 3.5, 0],
        type: 'fortune',
        title: `日主·${d.dayMaster}（${d.dayMasterWx}）`,
        content: `你的日主为${d.dayMaster}，属${d.dayMasterWx}行。\n${d.dayMaster}代表：光明、热情、直觉敏锐、领导力强。\n核心性格：积极外向，喜欢被看见，有感召力。`,
      },
    ];

    this.anno.buildFromAnalysis(annotations);
  }

  /* Step 5: 补运任务（阶段3实现） */
  _step5() {
    console.log('[Journey] Step 5 · 补运任务（阶段3实现）');
  }
}
