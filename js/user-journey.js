/**
 * user-journey.js · 用户旅程控制器
 *
 * 管理五步用户流程：
 *  Step 1: 填写生辰信息（趣味引导）
 *  Step 2: 推演动画（悬念感加载）
 *  Step 3: 3D 沙盒揭晓
 *  Step 4: 探索命盘标注
 *  Step 5: 补运任务（产品/咨询推荐）
 *
 * TODO 阶段3：实现完整的趣味引导 UI
 */

class UserJourney {
  constructor(sceneBuilder, annotationSystem) {
    this.sb = sceneBuilder;
    this.anno = annotationSystem;
    this.currentStep = 0;
    this.baziData = null;
  }

  /** 启动旅程：先检查是否有已保存的命盘 */
  async start() {
    // TODO 阶段3：检查登录状态，有命盘则直接进入Step3，否则Step1
    this._goToStep(1);
  }

  _goToStep(step) {
    this.currentStep = step;
    console.log(`[UserJourney] → Step ${step}`);
    ({
      1: () => this._renderStep1(),
      2: () => this._renderStep2(),
      3: () => this._renderStep3(),
      4: () => this._renderStep4(),
      5: () => this._renderStep5(),
    }[step] || (() => {}))();
  }

  /** Step 1: 生辰信息填写 */
  _renderStep1() {
    // TODO 阶段3：精美引导式表单，带动画节气背景
    document.getElementById('loading-screen').innerHTML = `
      <div style="text-align:center; padding:40px; max-width:400px">
        <h1 style="color:#c9a96e; font-size:22px; letter-spacing:4px; margin-bottom:8px">司马八字</h1>
        <p style="color:rgba(232,224,208,0.5); font-size:12px; letter-spacing:2px; margin-bottom:40px">天机已动 · 等待排演</p>
        <input id="birth-input" type="text" placeholder="请输入出生日期，例：1998年5月3日 午时"
          style="width:100%; padding:14px 18px; background:rgba(255,255,255,0.06);
          border:1px solid rgba(201,169,110,0.3); border-radius:12px;
          color:#e8e0d0; font-size:14px; outline:none; letter-spacing:1px; margin-bottom:16px">
        <button onclick="window._journey.submitBirth()" 
          style="width:100%; padding:14px; background:linear-gradient(135deg,#c9a96e,#a07840);
          border:none; border-radius:12px; color:#0a0a12; font-size:15px;
          font-weight:700; letter-spacing:3px; cursor:pointer">
          推演命格
        </button>
      </div>`;
  }

  /** 用户提交生辰（临时方法，阶段3替换为真实 API） */
  async submitBirth() {
    const input = document.getElementById('birth-input').value;
    if (!input.trim()) return;
    this._goToStep(2);
    // 模拟 API 延迟
    setTimeout(() => {
      this.baziData = { wuxing: { 木:20, 火:30, 土:15, 金:20, 水:15 } }; // 占位数据
      this._goToStep(3);
    }, 2500);
  }

  /** Step 2: 推演动画 */
  _renderStep2() {
    document.getElementById('loading-screen').innerHTML = `
      <div style="text-align:center">
        <h1 style="color:#c9a96e; font-size:22px; letter-spacing:6px; margin-bottom:16px">推演中…</h1>
        <p style="color:rgba(232,224,208,0.4); font-size:12px; letter-spacing:2px">天干地支排列成型</p>
      </div>`;
  }

  /** Step 3: 揭晓 3D 沙盒 */
  _renderStep3() {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';
    this.sb.buildFromBazi(this.baziData);
    setTimeout(() => this._goToStep(4), 1000);
  }

  /** Step 4: 展示标注 */
  _renderStep4() {
    // 占位标注数据，阶段2接入真实 AI 分析
    this.anno.buildFromAnalysis([
      { position: [-4,2,-2], type:'fortune', title:'文昌入命', content:'学习与表达能力强，适合知识创业或内容领域。' },
      { position: [4,2,-2],  type:'danger',  title:'羊刃煞重', content:'意志力强但易有冲动，建议佩戴黑曜石化煞。' },
      { position: [0,2,2],   type:'neutral', title:'桃花旺', content:'人际吸引力佳，社交场合容易受欢迎。' },
    ]);
  }

  /** Step 5: 补运任务（阶段3实现） */
  _renderStep5() {
    // TODO 阶段3：推荐产品卡片 + 咨询入口
    console.log('[UserJourney] Step 5: 补运任务（待实现）');
  }
}
