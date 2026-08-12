/**
 * 司马八字 · 主控制器 main-new.js
 *
 * 串联：输入表单 → Loading → IslandLoader → IslandAnnotate
 *       → IslandDecorations → Tasks → Analysis
 */

const App = (() => {

  let _gender        = '男';
  let _baziData      = null;
  let _birthInfo     = null;
  let _lastModelUrl  = null;
  let _baziTableOpen = false;
  let _taskPanelOpen = false;

  // 当前会话对应的已保存岛屿记录id（islands表主键）。生成完成保存成功后，
  // 或加载已有存档时被赋值；供 analysis.js 在AI深析完成后做"补写"
  // （islands.ai_analysis）时定位要更新的那条记录。未登录/未保存时始终为null。
  let _currentIslandId = null;

  // "岛屿会话"世代计数器：每次开始一次全新生成（_startGenerate）或加载一个已有
  // 存档（loadSavedIsland）时自增。AI深析六步流水线耗时可达数分钟到十分钟以上，
  // _currentIslandId 存在从 null（生成刚开始/保存请求未落地）过渡到真实id（保存
  // 成功）的正常情况，不能单纯靠"补写时 _currentIslandId 是否非空"判断补写是否
  // 安全——若在流水线跑完前用户已切换去加载了另一个存档，_currentIslandId会被
  // 重新赋值为新存档的id，此时补写就会写错记录。analysis.js 在发起AI深析请求的
  // 那一刻记录当时的世代值，补写前与当前世代值比对，不一致则说明会话已切换，
  // 静默跳过补写（见 claude-docs/已知问题与修复记录.md 对应条目）。
  let _islandGeneration = 0;

  // ── 新用户引导流程状态 ────────────────────────────────────
  let _isNewUser     = false;  // 当前用户是否为新用户（无 tutorial_done 标记）

  // ── 调试面板（测试版专用）────────────────────────────────
  const DEBUG_MODE = true;  // 发布时设为 false
  // 在 console.error 可能被劫持之前，先保存原始引用。Debug.log 内部报错时
  // 必须调用这个原始引用，而不是（可能已被劫持的）全局 console.error，
  // 否则会形成 Debug.log → console.error(劫持后) → Debug.log → ... 的无限递归。
  const _origConsoleError = console.error.bind(console);
  const Debug = {
    _log: [],
    log(msg, type) {
      const ts = new Date().toTimeString().slice(0,8);
      const entry = `[${ts}] ${msg}`;
      this._log.push(entry);
      if (this._log.length > 80) this._log.shift();
      this._render();
      if (type === 'error') _origConsoleError('[App]', msg);
    },
    _render() {
      const el = document.getElementById('debug-log');
      if (!el) return;
      el.innerHTML = [...this._log].reverse().map(l =>
        `<div style="margin-bottom:2px;opacity:.75">${l}</div>`
      ).join('');
    },
    toggle() {
      const content = document.getElementById('debug-content');
      if (content) content.classList.toggle('hidden');
    },
  };

  // 劫持 console.error 写入调试面板
  if (DEBUG_MODE) {
    console.error = (...args) => {
      _origConsoleError(...args);
      Debug.log('❌ ' + args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '), 'error');
    };
  }

  // ── Stage → UI 映射（动态，支持 i18n）──────────────────
  function _getStageMap() {
    const _t = (k) => (typeof Lang !== 'undefined') ? Lang.t(k) : k;
    return {
      queued                : { step:1, pct:5,    text:_t('stage.queued.t'),       sub:_t('stage.queued.s') },
      generating_prompt     : { step:2, pct:8,    text:_t('stage.gen_prompt.t'),   sub:_t('stage.gen_prompt.s') },
      prompt_ready          : { step:2, pct:10,   text:_t('stage.prompt_ready.t'), sub:_t('stage.prompt_ready.s') },
      enhancing_prompt      : { step:2, pct:12,   text:_t('stage.enhance.t'),      sub:_t('stage.enhance.s') },
      prompt_enhanced       : { step:2, pct:15,   text:_t('stage.enhanced.t'),     sub:_t('stage.enhanced.s') },
      generating_image      : { step:3, pct:20,   text:_t('stage.gen_image.t'),    sub:_t('stage.gen_image.s') },
      image_ready           : { step:3, pct:40,   text:_t('stage.image_ready.t'),  sub:_t('stage.image_ready.s') },
      converting_to_3d      : { step:4, pct:45,   text:_t('stage.to_3d.t'),        sub:_t('stage.to_3d.s') },
      tripo_processing      : { step:4, pct:null, text:_t('stage.tripo.t'),         sub:_t('stage.tripo.s') },
      image_failed_fallback : { step:3, pct:38,   text:_t('stage.img_fallback.t'), sub:_t('stage.img_fallback.s') },
      tripo_fallback        : { step:4, pct:50,   text:_t('stage.tripo_fb.t'),     sub:_t('stage.tripo_fb.s') },
      tripo_text_processing : { step:4, pct:null, text:_t('stage.tripo_text.t'),   sub:_t('stage.tripo_text.s') },
      completed             : { step:5, pct:95,   text:_t('stage.completed.t'),    sub:_t('stage.completed.s') },
      error                 : { step:null, pct:null, text:_t('stage.error.t'),      sub:_t('stage.error.s') },
    };
  }

  // ── 屏幕切换 ─────────────────────────────────────────────
  function _showScreen(id) {
    ['screen-form','screen-loading','screen-island'].forEach(s => {
      document.getElementById(s)?.classList.toggle('hidden', s !== id);
    });
    if (id !== 'screen-island') {
      ['task-panel','zone-panel','report-modal'].forEach(p => {
        document.getElementById(p)?.classList.remove('open');
      });
    }
  }

  function _setProgress(pct) {
    const el = document.getElementById('progress-fill');
    if (el) el.style.width = pct + '%';
  }

  function _setStageText(text, sub) {
    const t = document.getElementById('loading-stage-text');
    const s = document.getElementById('loading-stage-sub');
    if (t) t.textContent = text;
    if (s) s.textContent = sub || '';
  }

  function _setLoadingStep(active) {
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById('step-' + i);
      if (!el) continue;
      el.classList.remove('active','done');
      if (i < active) el.classList.add('done');
      else if (i === active) el.classList.add('active');
    }
  }

  function _applyStage(stage, progress) {
    const map  = _getStageMap();
    const info = map[stage] || map.queued;
    _setStageText(info.text, info.sub);
    if (info.step) _setLoadingStep(info.step);
    const pct = info.pct !== null ? info.pct : progress;
    if (pct != null) _setProgress(pct);
  }

  function _showLoadingError(msg) {
    const errEl = document.getElementById('loading-error-text');
    const btnEl = document.getElementById('loading-retry-btn');
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    if (btnEl) btnEl.style.display = 'block';
    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    _setStageText(_t('loading.fail_title'), _t('loading.fail_sub'));
  }

  // ── 性别选择 ─────────────────────────────────────────────
  function setGender(g) {
    _gender = g;
    document.getElementById('btn-male')?.classList.toggle('active', g === '男');
    document.getElementById('btn-female')?.classList.toggle('active', g === '女');
    AudioManager.playSfx('ui_click');
  }

  // ── 表单提交 ─────────────────────────────────────────────
  function submit() {
    const year  = parseInt(document.getElementById('inp-year').value);
    const month = parseInt(document.getElementById('inp-month').value);
    const day   = parseInt(document.getElementById('inp-day').value);
    const hour  = parseInt(document.getElementById('inp-hour').value);
    const errEl = document.getElementById('form-error');

    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    if (!year || year < 1900 || year > 2024) {
      if (errEl) errEl.textContent = _t('err.year'); return;
    }
    if (!month || month < 1 || month > 12) {
      if (errEl) errEl.textContent = _t('err.month'); return;
    }
    if (!day || day < 1 || day > 31) {
      if (errEl) errEl.textContent = _t('err.day'); return;
    }
    if (errEl) errEl.textContent = '';

    _birthInfo = { year, month, day, hour, gender: _gender };

    // 本地计算八字（BaziEngine是静态类）
    try {
      _baziData = BaziEngine.calculate(year, month, day, hour, 0, _gender);
    } catch (e) {
      if (errEl) errEl.textContent = _t('err.calc_fail') + e.message; return;
    }

    // 保存档案
    UserState.saveProfile(_birthInfo, _baziData);

    AudioManager.playSfx('submit');
    AudioManager.setScene('screen-loading');
    UIEffects.submitBurst(document.querySelector('.form-submit'));

    _showScreen('screen-loading');
    _resetLoadingUI();

    // 初始化Three.js
    IslandLoader.initScene(document.getElementById('canvas-container'));

    // 初始化装饰系统
    IslandDecorations.init(IslandLoader.getScene());

    // 渲染八字表
    _renderBaziTable(_baziData);

    // 更新HUD
    const dayMaster = _baziData.pillars?.day?.stem || '';
    _refreshSpirit();

    // 开始生成
    _startGenerate();
  }

  function _resetLoadingUI() {
    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    _setProgress(5);
    _setStageText(_t('loading.title'), _t('loading.sub'));
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById('step-' + i);
      if (!el) continue;
      el.classList.remove('active','done');
      if (i === 1) el.classList.add('active');
    }
    document.getElementById('loading-error-text')?.classList.add('hidden');
    const btn = document.getElementById('loading-retry-btn');
    if (btn) btn.style.display = 'none';
    // 先隐藏卡片区（生成开始后才显示）
    document.getElementById('insight-carousel')?.classList.add('hidden');
    document.getElementById('loading-eta')?.classList.add('hidden');
    document.getElementById('loading-hint')?.classList.add('hidden');
  }

  // forceRegen: true 时透传给 IslandLoader.generateIsland()，跳过前端本地缓存
  // （UserState.getIslandUrl）直接重新走完整 /generate 流程。不传时（默认 false）
  // 行为与改动前完全一致——向后兼容 retryGenerate()/submit() 里已有的无参调用。
  function _startGenerate({ forceRegen = false } = {}) {
    // 重置当前岛屿记录id：本次是一次全新的生成（区别于 loadSavedIsland 加载已有存档），
    // 避免残留上一个岛屿的id导致后面AI深析"补写"写错记录（例如同一会话内未刷新页面
    // 连续生成了两个不同命盘，第二个生成完成前若AI深析先跑完，不应该补写回第一个岛屿）。
    // onComplete 里若本次生成成功保存，会重新赋值为本次真实的岛屿id。
    _currentIslandId = null;
    _islandGeneration++; // 新会话开始，令此前请求快照的世代值失效

    // 启动八字洞察卡片（2s后出现，避免与初始UI冲突）
    setTimeout(() => { InsightCards.start(_baziData); }, 2000);

    // AI深析预热：与3D岛屿生成请求并行发起，不等待/不处理返回值。
    // 目的是让六步AI深析流水线尽早开始跑并写入localStorage（BaziAnalysis内部对同一
    // 八字哈希做了in-flight请求去重，若报告弹窗在预热请求完成前打开，第二次调用会
    // 复用同一个进行中的Promise而不是再发一次完整六步请求；命中localStorage缓存的
    // 情况则直接瞬间返回），而不是等到用户点开报告弹窗那一刻才开始等，因为六步+RAG
    // 检索耗时比旧版单次调用明显更长。
    if (typeof BaziAnalysis !== 'undefined') {
      BaziAnalysis.getAnalysis(_baziData, _gender).catch(() => {});
    }

    IslandLoader.generateIsland(_baziData, {
      forceRegen,
      onProgress(stage, pct) { _applyStage(stage, pct); },
      onComplete(modelUrl) {
        _lastModelUrl = modelUrl;
        _setLoadingStep(5);
        _setProgress(100);
        InsightCards.stop(); // 停止卡片轮播
        const _t2 = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
        _setStageText(_t2('stage.done.t'), _t2('stage.done.s'));

        AudioManager.playSfx('island_ready');
        AudioManager.setScene('screen-island');

        // 已登录用户：立刻保存岛屿记录（3D模型是真金白银花Gemini图片额度+TripoAI
        // 额度生成出来的，绝不能因为等一个更便宜、可随时重新生成的AI文字分析而
        // 白白丢失）。aiAnalysis 先传 null 占位——AI深析六步流水线最坏情况可能跑到
        // 10分钟以上（甚至挂起，_fetchBackend 用裸 fetch 没有 AbortController），
        // 若在此处 await 它再insert，用户中途关闭页面会导致整条岛屿记录（连同已经
        // 生成好的3D模型）都不会被创建。AI深析结果由 analysis.js::buildReport() 里
        // 已实现好的"补写"机制（AuthManager.updateIslandAnalysis）异步补上，不在
        // 这里等待，详见 claude-docs/已知问题与修复记录.md 对应日期条目。
        if (typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn()) {
          AuthManager.getProfile().then(async profile => {
            const displayName = profile?.display_name || AuthManager.currentUser()?.email || '我';
            try {
              const saved = await AuthManager.saveIsland({
                baziData:   _baziData,
                modelUrl:   modelUrl,
                baziHash:   null,
                birthInfo:  _birthInfo,
                name:       displayName + ' 的命盘',
                aiAnalysis: null, // 占位，AI深析完成后由补写机制自动填上
              });
              if (saved && saved.id) _currentIslandId = saved.id;
            } catch (e) {}
          }).catch(() => {});
        }

        setTimeout(() => {
          _showScreen('screen-island');
          _onIslandReady();

          // 未登录用户：延迟2秒弹出注册提示
          if (typeof AuthManager !== 'undefined' && !AuthManager.isLoggedIn()) {
            setTimeout(() => {
              AuthUI.showRegister({
                name:  document.getElementById('inp-name')?.value?.trim()  || '',
                email: document.getElementById('inp-email')?.value?.trim() || '',
              });
            }, 2000);
          }
        }, 800);
      },
      onError(err) {
        InsightCards.stop();
        AudioManager.playSfx('error');
        const _t3 = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
        _showLoadingError(_t3('loading.fail_title') + '：' + (err || _t3('loading.fail_sub')));
      }
    });
  }

  function retryGenerate() {
    AudioManager.playSfx('submit');
    if (!_baziData) { _showScreen('screen-form'); return; }
    _resetLoadingUI();
    _startGenerate();
  }

  // ── 设置面板"修改出生信息"入口的返回/取消 ────────────────
  // #screen-form 原本是全新用户专属首屏，没有"返回"出口；settings.js::editBirthInfo()
  // 会把已有岛屿的用户带到这个屏幕，中途改主意时需要能安全返回岛屿画面。
  // 防御性检查：_baziData 不存在（真正的新用户首次填表流程）时没有岛屿可返回，
  // 静默不做任何事——对应 index.html 里 #form-cancel-btn 默认隐藏、只有
  // editBirthInfo() 才会显式显示的机制。
  function cancelEditBirthInfo() {
    if (!_baziData) return;
    document.getElementById('form-cancel-btn')?.classList.add('hidden');
    _showScreen('screen-island');
  }

  // ── 设置面板"完全重新生成"入口 ──────────────────────────
  // 防御性检查：理论上设置面板只会在已经生成过岛屿的场景下才会显示这个按钮，
  // _baziData 不存在时静默返回，不做任何事。跳过前端+后端两层缓存，真实重新走
  // 图像+3D生成完整流程（forceRegen:true）。生成完成后走现有 onComplete 回调，
  // AuthManager.saveIsland() 保持 insert 语义不变——新增一条岛屿存档，不覆盖
  // 当前记录（见 iterative-dreaming-starlight.md 方案）。
  function regenerateCurrentIsland() {
    if (!_baziData) return;
    _showScreen('screen-loading');
    _resetLoadingUI();
    _startGenerate({ forceRegen: true });
  }

  // ── 免费本地重算八字数据（不触发任何生成流程/API费用）─────
  // 用途：旧存档 bazi_data 里缺失后续新增字段（如 strengthScore，2026-08-04加入）时，
  // 供设置面板"轻量刷新AI深析"顺带调用，用当前 BaziEngine 重新计算一份完整数据。
  // 只做本地计算+四柱表格DOM同步，不发起网络请求、不落库（落库由调用方决定）。
  function recalcBaziData() {
    if (!_baziData || !_birthInfo) return null;
    try {
      _baziData = BaziEngine.calculate(
        _birthInfo.year, _birthInfo.month, _birthInfo.day,
        _birthInfo.hour, 0, _gender
      );
    } catch (e) {
      console.warn('[App] recalcBaziData 失败:', e);
      return null;
    }
    _renderBaziTable(_baziData); // 顺带保持四柱表格显示同步
    return _baziData;
  }

  // ── 加载已存档的岛屿（登录后直接进入命盘）────────────────
  async function loadSavedIsland(isl) {
    if (!isl || !isl.model_url) return;

    // 关闭"我的岛屿"面板
    document.getElementById('my-islands-panel')?.classList.add('hidden');

    // 从存档还原数据
    _birthInfo  = {
      year:   isl.birth_year,
      month:  isl.birth_month,
      day:    isl.birth_day,
      hour:   isl.birth_hour || 0,
      gender: isl.gender,
    };
    _gender       = isl.gender || '男';
    _lastModelUrl = isl.model_url;

    // bazi_data 可能为 null（旧存档未保存此字段），则从生辰重算
    if (isl.bazi_data && typeof isl.bazi_data === 'object' && isl.bazi_data.pillars) {
      _baziData = isl.bazi_data;
    } else {
      try {
        _baziData = BaziEngine.calculate(
          _birthInfo.year, _birthInfo.month, _birthInfo.day,
          _birthInfo.hour, 0, _gender
        );
      } catch(e) {
        console.warn('[App] BaziEngine recalc failed:', e);
        _baziData = null;
      }
    }

    // 记录当前加载的存档id，供AI深析补写逻辑使用（见 analysis.js buildReport）
    _currentIslandId = isl.id || null;
    _islandGeneration++; // 新会话开始，令此前请求快照的世代值失效

    // 存档里已经保存过AI深析结果 → 直接种进本地缓存，之后报告弹窗调用
    // BaziAnalysis.getAnalysis() 会直接命中缓存，不会重新触发一次完整的
    // 六步流水线请求（不浪费token）。存档当时若AI深析还没生成完（ai_analysis
    // 为null），则不种缓存，等用户本次真实触发生成后，由 analysis.js 补写回这条记录。
    if (_baziData && isl.ai_analysis && typeof BaziAnalysis !== 'undefined') {
      BaziAnalysis.seedCache(_baziData, _gender, isl.ai_analysis);
    }

    // 确保 Three.js 场景已初始化（initScene 内部有守卫，重复调用安全）
    const container = document.getElementById('canvas-container');
    IslandLoader.initScene(container);
    IslandDecorations.init(IslandLoader.getScene());

    // 切换到3D场景
    AudioManager.setScene('screen-island');
    _showScreen('screen-island');

    // 渲染八字表
    if (_baziData) _renderBaziTable(_baziData);

    // 显示加载提示（直接挂在 screen-island）
    const loadingTip = document.createElement('div');
    loadingTip.id = 'island-load-tip';
    loadingTip.style.cssText = [
      'position:absolute', 'bottom:80px', 'left:50%', 'transform:translateX(-50%)',
      'color:rgba(201,169,110,.55)', 'font-size:11px', 'letter-spacing:2px',
      'pointer-events:none', 'z-index:9999',
    ].join(';');
    loadingTip.textContent = '命盘加载中...';
    document.getElementById('screen-island')?.appendChild(loadingTip);

    try {
      await IslandLoader.loadFromUrl(isl.model_url);
      // GLB 加载完毕 — 重置可能残留的引导状态，再执行就绪流程
      if (typeof Tutorial !== 'undefined') Tutorial.reset();
      _onIslandReady();
    } catch (e) {
      console.warn('[App] loadSavedIsland 失败:', e);
    } finally {
      document.getElementById('island-load-tip')?.remove();
    }
  }

  // ── AI深析结果套用到3D特点标注(✅/⚠️) ──────────────────────
  // 抽出为独立函数：_onIslandReady()（首次生成/加载完成）与
  // settings.js::refreshAiOnly()（轻量刷新AI深析成功后）都需要把同一份
  // AI深析结果挂载到3D岛屿上——此前只有 _onIslandReady() 一处会做这件事，
  // 导致轻量刷新成功后3D岛屿上的✅/⚠️标注依然停留在刷新前的旧内容（首次
  // 生成时若AI深析超时失败，甚至是零个标注），必须手动刷新整个页面才会
  // 更新，见 claude-docs/已知问题与修复记录.md 对应日期条目。两处调用点
  // 各自写一份重复逻辑是这个代码库反复出问题的模式（哈希算法双实现同理），
  // 因此收敛成这一处唯一实现。
  // 注：四柱/神煞详情面板不依赖本函数——`_openZonePanel()`每次打开都会
  // 直接调用`BaziAnalysis.getAnalysis()`按需取最新AI详解（该函数自身有
  // localStorage/in-flight缓存，不会重复触发网络请求），天然与轻量刷新
  // 后的最新内容保持同步，不需要这里额外缓存/传递。
  //
  // expectedGeneration：可选。调用方若已经在发起AI深析请求的那一刻快照过
  // _islandGeneration（见上方声明处注释），传进来后本函数会再校验一次——
  // 若此时 _islandGeneration 已变化（说明请求进行期间用户切换/加载了另一个
  // 岛屿），静默丢弃，不挂载标注，避免把A岛屿的AI详解/标注污染到当前画面。
  // 不传（undefined）则跳过这层校验，由调用方自行保证结果时效性。
  // 注：settings.js::refreshAiOnly() 在调用本函数前，已经用同一个
  // App.getIslandGeneration() 自行比对过一次世代值——这里再传入同一个快照值
  // 只是"双保险"，两处比对的是同一个 _islandGeneration 计数器、同一套语义
  // （都是"请求发起时的世代 !== 当前世代则丢弃"），不会互相冲突或重复判断出错，
  // 中间也没有额外的 await 会让世代值在两次比对之间发生变化。
  function _applyAiAnalysis(analysis, expectedGeneration) {
    if (!analysis) return;
    if (typeof expectedGeneration === 'number' && expectedGeneration !== _islandGeneration) return; // 会话已切换，静默丢弃

    if (typeof IslandAnnotate !== 'undefined' && IslandAnnotate.attachTraits) {
      const td = analysis.step_traits_detail || {};
      const s1 = analysis.step1_foundation || {};
      const strengths = (s1.strengths || []).map((summary, i) => ({
        summary, detail: (td.strengths_detail || [])[i]
      }));
      const cautions = (s1.cautions || []).map((summary, i) => ({
        summary, detail: (td.cautions_detail || [])[i]
      }));
      IslandAnnotate.attachTraits(IslandLoader.getScene(), _baziData, { strengths, cautions });
    }
  }

  // ── 岛屿就绪后 ───────────────────────────────────────────
  function _onIslandReady() {
    const scene = IslandLoader.getScene();

    // 标注系统（含诊断徽标）
    IslandAnnotate.attach(scene, _baziData);

    // 异步获取AI深析数据，挂载3D特点标注（见 _applyAiAnalysis()定义处
    // 注释）。静默失败——岛屿本身已经渲染完成，这里只是锦上添花的
    // 标注层，不影响主流程。
    // 世代守卫：请求发起那一刻快照当前"岛屿会话世代"（见上方 _islandGeneration
    // 声明处注释，与 analysis.js::_loadAndRenderAi 同一模式），传给
    // _applyAiAnalysis() 在结果到达时校验。
    if (typeof BaziAnalysis !== 'undefined') {
      const _genAtRequest = _islandGeneration;
      BaziAnalysis.getAnalysis(_baziData, _gender).then(analysis => {
        _applyAiAnalysis(analysis, _genAtRequest);
      }).catch(() => {});
    }

    // 恢复已解锁装饰
    IslandDecorations.restoreAll(_baziData);

    // 判断新老用户（Tutorial 状态检测）
    _isNewUser = (typeof Tutorial !== 'undefined')
      ? !Tutorial.isDone(_baziData, _gender)
      : false;
    Debug.log(`用户状态：${_isNewUser ? '新用户' : '旧用户'}`);

    // 填充报告（根据新老用户决定是否附加"探索"按钮）
    const reportOpts = _isNewUser ? {
      isNewUser:      true,
      onStartExplore: _startTutorial,
      onSkip:         _skipToFreeMode,
    } : null;
    Analysis.buildReport(_baziData, document.getElementById('report-body'), reportOpts);

    // 更新任务UI
    _refreshTaskUI();

    // 完成"首次登岛"任务
    Tasks.complete('first_island', _baziData);

    // 完成"每日签到"
    const checkin = UserState.doCheckin();
    if (!checkin.alreadyDone) {
      Tasks.complete('daily_checkin', _baziData);
    }

    // 连续天数成就
    const streak = UserState.getCheckinInfo().streak;
    if (streak >= 3)  Tasks.complete('streak_3', _baziData);
    if (streak >= 7)  Tasks.complete('streak_7', _baziData);
    if (streak >= 30) Tasks.complete('streak_30', _baziData);

    // 更新灵气显示
    _refreshSpirit();

    // 监听灵气变化
    UserState.on('spiritChanged', _refreshSpirit);
    UserState.on('taskCompleted', () => {
      AudioManager.playSfx('task_complete');
      UIEffects.confetti(18);
      UIEffects.badgePop();
    });
    let _prevSpirit = UserState.getSpirit();
    UserState.on('spiritChanged', newVal => {
      const delta = newVal - _prevSpirit;
      _prevSpirit = newVal;
      if (delta > 0) UIEffects.floatText('+' + delta + ' 灵气');
    });
    UserState.on('decorationUnlocked', () => {
      AudioManager.playSfx('decoration_unlock');
      UIEffects.confetti(10);
      _refreshTaskUI();
    });

    // 新用户：1s 后自动弹出报告（带探索按钮）
    if (_isNewUser) {
      Debug.log('新用户流程：1s 后自动开启报告');
      setTimeout(() => {
        showReport();
      }, 1000);
    }

    // 调试面板显示（若开启）
    if (DEBUG_MODE) {
      const dbPanel = document.getElementById('debug-panel');
      if (dbPanel) dbPanel.classList.remove('hidden');
      Debug.log('岛屿就绪，场景初始化完毕');
    }
  }

  // ── 新用户：开始引导 ─────────────────────────────────────
  function _startTutorial() {
    closeReport();
    if (typeof Tutorial !== 'undefined') {
      Debug.log('Tutorial.start()');
      Tutorial.start(_baziData, _gender);

      // 异步加载 AI 内容，后到时推送给 Tutorial
      if (typeof BaziAnalysis !== 'undefined') {
        BaziAnalysis.getAnalysis(_baziData, _gender).then(analysis => {
          if (analysis && typeof Tutorial !== 'undefined') {
            Tutorial.updateAiContent(analysis);
            Debug.log('AI内容已推送到 Tutorial');
          }
        });
      }
    }
  }

  // ── 新用户：跳过引导（直接进入自由模式）────────────────
  function _skipToFreeMode() {
    closeReport();
    // 标记为已完成（下次作为旧用户处理）
    if (typeof Tutorial !== 'undefined') {
      Tutorial.skip();
    }
    Debug.log('用户跳过引导，进入自由模式');
  }

  // ── 公开：重置并重玩引导（测试模式 HUD 按钮）────────────
  function restartTutorial() {
    if (!_baziData) return;
    // 清除 localStorage 引导完成标记（让 isDone() 返回 false）
    try {
      const p = _baziData.pillars || {};
      const parts = ['year','month','day','hour'].map(col => {
        const pl = p[col] || {};
        return (pl.stem || '') + (pl.branch || '');
      });
      parts.push(_gender || '');
      let h = 0;
      const str = parts.join('|');
      for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
      const hash = Math.abs(h).toString(16).padStart(8, '0');
      localStorage.removeItem('tutorial_done_' + hash);
    } catch(e) {}
    if (typeof Tutorial !== 'undefined') {
      Tutorial.reset();
    }
    // 强制重建报告（带探索按钮）
    const reportOpts = {
      isNewUser:      true,
      onStartExplore: _startTutorial,
      onSkip:         _skipToFreeMode,
    };
    Analysis.buildReport(_baziData, document.getElementById('report-body'), reportOpts);
    showReport();
    Debug.log('引导重置，报告重新展示');
  }

  function _refreshSpirit() {
    const el = document.getElementById('hud-spirit');
    const spiritWord = (typeof Lang !== 'undefined') ? Lang.t('hud.spirit') : '灵气';
    if (el) el.textContent = '✦ ' + UserState.getSpirit() + ' ' + spiritWord;
  }

  function _refreshTaskUI() {
    // 任务面板内容
    Tasks.renderPanel(document.getElementById('task-panel-body'), _baziData);

    // 徽标：未完成的每日任务数
    const pending = Tasks.getDailyTasks().filter(t => !t.done).length;
    const badge   = document.getElementById('task-badge');
    if (badge) {
      badge.textContent = pending;
      badge.classList.toggle('hidden', pending === 0);
    }
  }

  // ── 八字表渲染 ────────────────────────────────────────────
  function _renderBaziTable(data) {
    const container = document.getElementById('bazi-table-inner');
    if (!container || !data) return;

    const _t = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    const cols   = ['year','month','day','hour'];
    const labels = {
      year:  _t('bazi.year'),
      month: _t('bazi.month'),
      day:   _t('bazi.day'),
      hour:  _t('bazi.hour'),
    };
    const p  = data.pillars  || {};
    const ss = data.tenGods  || {};

    const stemColors = {
      '甲':'#6FCF97','乙':'#6FCF97','丙':'#EB5757','丁':'#EB5757',
      '戊':'#F2C94C','己':'#F2C94C','庚':'#C8C8D8','辛':'#C8C8D8',
      '壬':'#6EB5FF','癸':'#6EB5FF',
    };

    let gridHtml = '<div class="bazi-grid">';
    cols.forEach(col => {
      const pillar = p[col] || {};
      const isDay  = col === 'day';
      const dc     = isDay ? ' day-col' : '';
      const color  = stemColors[pillar.stem] || '#e8e0d0';
      gridHtml += `<div class="bazi-col">
        <div class="bazi-cell head${dc}">${labels[col]}</div>
        <div class="bazi-cell stem${dc}" style="color:${color}">${pillar.stem||'—'}</div>
        <div class="bazi-cell branch${dc}">${pillar.branch||'—'}</div>
        <div class="bazi-cell shishen${dc}">${isDay ? _t('bazi.day_master') : (ss[col]||'—')}</div>
        <div class="bazi-cell nayin${dc}">${(data.nayin||{})[col]||''}</div>
      </div>`;
    });
    gridHtml += '</div>';

    let metaHtml = '<div class="bazi-meta">';
    if (data.kongwang?.length) {
      metaHtml += `<span class="meta-tag warn">${_t('bazi.kongwang')}：${data.kongwang.join('、')}</span>`;
    }
    if (data.wuxing) {
      const top = Object.entries(data.wuxing).sort((a,b)=>b[1]-a[1])[0];
      if (top) metaHtml += `<span class="meta-tag gold">${_t('bazi.dominant')}：${top[0]}</span>`;
    }
    (data.shenshe||[]).slice(0,4).forEach(s => {
      const good = ['将星','禄神','红鸾','天乙','文昌'].includes(s);
      const warn = ['亡神','劫煞','白虎'].includes(s);
      metaHtml += `<span class="meta-tag ${good?'good':warn?'warn':''}">${s}</span>`;
    });
    metaHtml += '</div>';

    container.innerHTML = gridHtml + metaHtml;
  }

  // ── 面板控制 ──────────────────────────────────────────────
  function toggleBaziTable() {
    _baziTableOpen = !_baziTableOpen;
    document.getElementById('bazi-table-panel')?.classList.toggle('open', _baziTableOpen);
    const btn = document.getElementById('bazi-table-toggle');
    if (btn) {
      const _t4 = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
      btn.textContent = _baziTableOpen ? _t4('bazi.toggle_open') : _t4('bazi.toggle_shut');
    }
    AudioManager.playSfx(_baziTableOpen ? 'panel_open' : 'panel_close');
  }

  function toggleTaskPanel() {
    _taskPanelOpen = !_taskPanelOpen;
    document.getElementById('task-panel')?.classList.toggle('open', _taskPanelOpen);
    AudioManager.playSfx(_taskPanelOpen ? 'panel_open' : 'panel_close');
    if (_taskPanelOpen) _refreshTaskUI();
  }

  function closeZonePanel() {
    document.getElementById('zone-panel')?.classList.remove('open');
    AudioManager.playSfx('panel_close');
    const tutorialActive = (typeof Tutorial !== 'undefined' && Tutorial.isActive());
    if (tutorialActive) {
      // 面板是引导流程里"查看完整详解"打开的（唯一能在 Tutorial.isActive()
      // 为 true 时打开 #zone-panel 的路径），关闭后把引导 Modal/提示条/进度点
      // 恢复出来，让"下一个"/"跳过引导"继续可点。resume() 在非暂停状态下
      // 调用是安全空操作，这里不需要额外判断是否真的处于暂停。
      Tutorial.resume();
    } else {
      // 引导未激活时才允许恢复自动旋转——若在引导暂停期间也无条件调用，
      // OrbitControls.autoRotate 在 update() 里不受 controls.enabled=false
      // 影响依然会转动镜头，会把 Tutorial.flyTo() 摆好的机位带偏。
      IslandLoader.startAutoRotate();
    }
  }

  function showReport() {
    document.getElementById('report-modal')?.classList.add('open');
    document.getElementById('auth-bar')?.classList.add('hidden');
    AudioManager.playSfx('report_open');
    // 完成"研读命理"任务
    Tasks.complete('daily_read_analysis', _baziData);
    _refreshTaskUI();
    _refreshSpirit();
  }

  function closeReport() {
    document.getElementById('report-modal')?.classList.remove('open');
    document.getElementById('auth-bar')?.classList.remove('hidden');
    AudioManager.playSfx('panel_close');
  }

  // "zone-panel 会话"令牌：每次 _openZonePanel() 打开一个新面板时自增。
  // BaziAnalysis.getAnalysis() 异步到达时携带的是它发起请求那一刻的令牌值，
  // 与"此刻"的 _zonePanelToken 比对——不一致说明用户已经切走到另一个命柱/
  // 神煞（或关闭又重新打开了同一个），旧结果必须静默丢弃，不能覆盖新内容。
  // 与本文件里 _islandGeneration 世代计数器是同一套防御模式。
  let _zonePanelToken = 0;

  // 根据 zoneKey 渲染面板 HTML（纯函数，无副作用）。analysis 为 null/undefined
  // 时走静态兜底，拿到 AI 深析结果后传入 analysis 走完整详解。extra 是
  // island-annotate.js::attachTraits() 的trait标签点击时闭包携带的
  // {kind, idx, summary, detail} 数据，只有 'trait_' 开头的 zoneKey 会用到——
  // trait 数据本身在标签创建时就已经完整拿到手（见该文件内的说明），不像
  // pillar_/shensha_ 那样需要在这里异步等 AI 深析结果到达才能渲染完整版。
  function _renderZonePanelHtml(zoneKey, baziData, analysis, extra) {
    if (zoneKey.startsWith('pillar_')) {
      const col    = zoneKey.replace('pillar_', '');
      const detail = analysis ? (analysis.step_pillars_detail || {})[col] : undefined;
      return Analysis.buildZonePanel('pillar_' + col, baziData, detail);
    }
    if (zoneKey.startsWith('shensha_')) {
      const name   = zoneKey.replace('shensha_', '');
      const items  = analysis ? ((analysis.step_shensha_detail || {}).shensha_items || []) : [];
      const detail = analysis ? items.find(s => s.name === name) : undefined;
      return Analysis.buildShenshaPanel(name, baziData, detail);
    }
    if (zoneKey.startsWith('trait_')) {
      return Analysis.buildTraitPanel(zoneKey, baziData, extra);
    }
    return Analysis.buildZonePanel(zoneKey, baziData);
  }

  // ── 区域点击回调（供 island-annotate.js 调用）─────────────
  // force=true：绕开"引导激活期间禁止打开"的 guard——目前唯一调用方是
  // Tutorial 的"查看完整详解"按钮（见 viewTutorialDetail()），点击前已经
  // 调用过 Tutorial.pause() 把引导自身的 Modal/overlay 隐藏掉，两者不会
  // 同时抢视觉焦点。
  // extra：可选第四参数，island-annotate.js::attachTraits() 的trait标签点击时
  // 传入 {kind, idx, summary, detail} 形状，供 zoneKey 以 'trait_' 开头的分支
  // 透传给 Analysis.buildTraitPanel()（见上方 _renderZonePanelHtml）。放在第四
  // 位而不是复用第三位的 force，是因为两者语义完全独立、调用方不同（Tutorial
  // 传布尔 force，island-annotate.js 传对象 extra），合并进同一个位置容易在
  // 未来被误传/误判类型。pillar_/shensha_/其余分支忽略该参数，不传时（现有
  // 调用点）行为与改动前完全一致。
  function _openZonePanel(zoneKey, baziData, force, extra) {
    // 引导激活期间，标签点击由 Tutorial 接管，此处直接返回（"查看完整详解"
    // 走 force=true 绕开这道 guard）
    if (!force && typeof Tutorial !== 'undefined' && Tutorial.isActive()) return;

    const panel   = document.getElementById('zone-panel');
    const content = document.getElementById('zone-panel-content');
    if (!panel || !content) return;

    const myToken = ++_zonePanelToken;

    // 1) 立即同步渲染打开面板——不等待任何网络请求，点击到看见内容零延迟；
    //    pillar_/shensha_ 用静态兜底（AI内容到达前用户看到的就是可用的最终
    //    态之一），trait_ 用闭包已携带的完整数据直接渲染完整版，不需要等待。
    content.innerHTML = _renderZonePanelHtml(zoneKey, baziData, null, extra);
    panel.classList.add('open');
    AudioManager.playSfx('zone_click');
    IslandLoader.stopAutoRotate();

    // 任务触发（与原逻辑一致）
    if (zoneKey.startsWith('pillar_')) {
      const col = zoneKey.replace('pillar_', '');
      if (col === 'year' || col === 'month') Tasks.complete('read_dayun', baziData);
    } else if (zoneKey.startsWith('shensha_')) {
      Tasks.complete('read_shensha', baziData);
    }
    _refreshTaskUI();
    _refreshSpirit();

    // 2) 异步尝试拿AI深析结果，到达后若面板仍展示同一个zoneKey则原地刷新。
    //    getAnalysis() 命中缓存/已有 in-flight 请求时几乎瞬时resolve，没缓存
    //    时可能要几十秒到几分钟——期间用户可能已经切换到别的命柱/神煞面板，
    //    或者干脆关闭了面板，靠 myToken 与 panel.open 双重校验避免误写。
    if (typeof BaziAnalysis !== 'undefined' && (zoneKey.startsWith('pillar_') || zoneKey.startsWith('shensha_'))) {
      BaziAnalysis.getAnalysis(baziData, _gender).then(analysis => {
        if (myToken !== _zonePanelToken) return;       // 面板已切换到别的zoneKey
        if (!panel.classList.contains('open')) return; // 面板已被用户关闭
        if (!analysis) return;                          // AI深析失败/未配置，保留静态兜底
        content.innerHTML = _renderZonePanelHtml(zoneKey, baziData, analysis);
      }).catch(() => { /* 静默失败，保留静态兜底 */ });
    }
  }

  // ── 引导中"查看完整详解"按钮回调（供 tutorial-modal 调用）───
  function viewTutorialDetail() {
    if (typeof Tutorial === 'undefined' || !Tutorial.isActive()) return;
    const zoneKey = Tutorial.getCurrentZoneKey();
    if (!zoneKey || !_baziData) return;
    Tutorial.pause();
    _openZonePanel(zoneKey, _baziData, /* force */ true);
  }

  // 注册全局回调
  window.onIslandZoneClick = _openZonePanel;

  // ── 音频开关（HUD 按钮调用） ──────────────────────────────
  function toggleBgm(btn) {
    const on = AudioManager.toggleBgm();
    if (btn) {
      btn.classList.toggle('off', !on);
      UIEffects.audioSpin(btn);
    }
  }
  function toggleSfx(btn) {
    const on = AudioManager.toggleSfx();
    if (btn) {
      btn.classList.toggle('off', !on);
      UIEffects.audioSpin(btn);
    }
  }

  // ── 后端保活：页面加载时ping，之后每14分钟一次防止Render冷启动 ──
  function _keepAlive() {
    const base = (window.ISLAND_API_BASE || CONFIG.ISLAND_API_BASE || 'https://simabazi-island.onrender.com');
    fetch(base + '/ping').catch(() => {});   // 静默失败，不影响用户
  }

  // 页面加载时同步按钮状态到已保存偏好，并启动保活
  document.addEventListener('DOMContentLoaded', () => {
    const bgmBtn = document.getElementById('btn-bgm');
    const sfxBtn = document.getElementById('btn-sfx');
    if (bgmBtn) bgmBtn.classList.toggle('off', !AudioManager.bgmOn);
    if (sfxBtn) sfxBtn.classList.toggle('off', !AudioManager.sfxOn);

    // 立即唤醒后端，然后每14分钟保活一次
    _keepAlive();
    setInterval(_keepAlive, 14 * 60 * 1000);

    // ── 初始化用户认证系统 ────────────────────────────
    if (typeof AuthManager !== 'undefined') {
      AuthManager.init();
    }

    // ── 顶部栏按钮（逻辑已移至 AuthUI）──────────────
    document.getElementById('auth-login-btn')?.addEventListener('click', () => AuthUI.showLogin());
    document.getElementById('auth-logout-btn')?.addEventListener('click', () => AuthManager.logout());
    document.getElementById('auth-my-islands-btn')?.addEventListener('click', () => AuthUI.showMyIslands());

    // ── 语言切换：刷新动态内容 ────────────────────
    window.addEventListener('langChanged', () => {
      // 八字表（已渲染时重绘）
      if (_baziData) _renderBaziTable(_baziData);
      // 八字表切换按钮
      const toggleBtn = document.getElementById('bazi-table-toggle');
      if (toggleBtn) {
        toggleBtn.textContent = _baziTableOpen
          ? Lang.t('bazi.toggle_open')
          : Lang.t('bazi.toggle_shut');
      }
      // 灵气文字
      _refreshSpirit();
    });
  });

  // ── 公开接口 ──────────────────────────────────────────────
  return {
    setGender, submit, retryGenerate, loadSavedIsland, regenerateCurrentIsland,
    recalcBaziData,
    cancelEditBirthInfo,
    toggleBaziTable, toggleTaskPanel,
    closeZonePanel, showReport, closeReport,
    toggleBgm, toggleSfx,
    restartTutorial,   // 测试模式 HUD 用
    viewTutorialDetail, // 引导Modal"查看完整详解"按钮用
    // AuthUI 内部调用（勿删）
    _getBaziData:  () => _baziData,
    _getBirthInfo: () => _birthInfo,
    _getLastUrl:   () => _lastModelUrl,
    _debug:        () => Debug,
    // analysis.js 用于AI深析生成完成后"补写"回对应的已保存岛屿记录
    // （islands.ai_analysis）。未登录/本次会话未保存过岛屿时为 null。
    getCurrentIslandId: () => _currentIslandId,
    // analysis.js 在发起AI深析请求的那一刻读取并快照当前世代值，补写前与届时的
    // 世代值比对，用于识破"请求发起后用户已切换到另一个岛屿会话"的竞态（见上方
    // _islandGeneration 声明处注释）。
    getIslandGeneration: () => _islandGeneration,
    // settings.js::refreshAiOnly() 轻量刷新AI深析成功后调用，把新结果挂载到
    // 3D标注（trait✅/⚠️标签），与首次生成/加载岛屿时 _onIslandReady() 内部
    // 调用的是同一份实现（见 _applyAiAnalysis() 定义处注释）。四柱/神煞详情
    // 面板不依赖本函数，见 _openZonePanel() 注释。expectedGeneration 建议
    // 传入调用方发起请求时快照的世代值。
    _applyAiAnalysis: (analysis, expectedGeneration) => _applyAiAnalysis(analysis, expectedGeneration),
    // settings.js::editBirthInfo() 用于关闭设置面板后切回表单屏幕，让用户修改
    // 出生信息后自己点提交（走完全原生的 submit()→_startGenerate() 流程）。
    // 直接导出既有的内部屏幕切换函数，不新增逻辑。
    _showScreen: (id) => _showScreen(id),
    // auth.js::logout() 退出登录时调用，清除本次会话记录的岛屿id（防御性清理——
    // RLS+user_id过滤已经能防止跨账号误写，且报告只能从会设置这个id的入口打开，
    // 但退出登录后不应再残留上一个账号的岛屿id）
    _resetCurrentIslandId: () => { _currentIslandId = null; _islandGeneration++; },
  };
})();

/* ═══════════════════════════════════════════════════════════
   InsightCards — 生成等待期间的八字洞察卡片轮播
   ═══════════════════════════════════════════════════════════ */
const InsightCards = (() => {
  let _cards = [];
  let _idx   = 0;
  let _timer = null;
  let _etaTimer = null;
  let _startTs  = 0;
  const TOTAL_MS = 150000; // 预计 2.5 分钟

  // 五行色
  const WX_COLOR = { 木:'#7ECB8F', 火:'#E87040', 土:'#C9A96E', 金:'#D4C48A', 水:'#5B9BD5' };

  function _build(bazi) {
    if (!bazi) return [];
    const _t  = (typeof Lang !== 'undefined') ? (k => Lang.t(k)) : (k => k);
    const isZh = (typeof Lang !== 'undefined') ? Lang.getLang() === 'zh' : true;
    const p   = bazi.pillars || {};
    const dm  = bazi.dayMaster || '';
    const dmWx= bazi.dayMasterWx || '';
    const dmNature = bazi.dayMasterNature || '';
    const wx  = bazi.wuxing || {};
    const fav = Array.isArray(bazi.favorable) ? bazi.favorable : (bazi.favorable ? [bazi.favorable] : []);
    const nayin = bazi.nayin || {};

    // Card 0: 日主
    const col = WX_COLOR[dmWx] || '#c9a96e';
    const cards = [];
    cards.push(`
      <div class="insight-tag">${isZh ? '你的日主' : 'DAY MASTER'}</div>
      <div class="insight-main" style="color:${col};font-size:36px">${dm}</div>
      <div class="insight-sub">${dmWx}${isZh?'行':'&nbsp;·&nbsp;'}${dmNature}</div>
    `);

    // Card 1: 四柱
    const pillarLabels = isZh
      ? ['年柱','月柱','日柱','时柱']
      : ['Year','Month','Day','Hour'];
    const pKeys = ['year','month','day','hour'];
    const pillarsHTML = pKeys.map((k,i) => {
      const stem  = p[k]?.stem  || '—';
      const branch= p[k]?.branch|| '—';
      return `<div class="insight-pillar">
        <div class="insight-pillar-label">${pillarLabels[i]}</div>
        <div class="insight-pillar-gan">${stem}</div>
        <div class="insight-pillar-zhi">${branch}</div>
      </div>`;
    }).join('');
    cards.push(`
      <div class="insight-tag">${isZh ? '四柱八字' : 'FOUR PILLARS'}</div>
      <div class="insight-pillars">${pillarsHTML}</div>
    `);

    // Card 2: 五行分布
    const wxEntries = Object.entries(wx).filter(([,v])=>v>0)
      .sort(([,a],[,b])=>b-a);
    const wxBars = wxEntries.map(([el, cnt]) => {
      const pct = Math.min(100, cnt * 20);
      return `<div style="margin:4px 0">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:rgba(232,224,208,.5);margin-bottom:3px">
          <span style="color:${WX_COLOR[el]||'#c9a96e'}">${el}</span><span>${cnt}</span>
        </div>
        <div style="height:3px;background:rgba(255,255,255,.08);border-radius:2px">
          <div style="height:100%;width:${pct}%;background:${WX_COLOR[el]||'#c9a96e'};border-radius:2px;transition:width 1s ease"></div>
        </div>
      </div>`;
    }).join('');
    cards.push(`
      <div class="insight-tag">${isZh ? '五行分布' : 'FIVE ELEMENTS'}</div>
      <div style="width:100%">${wxBars}</div>
    `);

    // Card 3: 喜用神
    if (fav.length) {
      const favHTML = fav.map(f =>
        `<span style="color:${WX_COLOR[f]||'#c9a96e'};font-size:20px;margin:0 6px">${f}</span>`
      ).join('');
      cards.push(`
        <div class="insight-tag">${isZh ? '喜用神' : 'FAVORABLE ELEMENTS'}</div>
        <div class="insight-main" style="font-size:14px;color:rgba(232,224,208,.5);margin-bottom:8px">
          ${isZh ? '有利于你的五行能量' : 'Elements that benefit you'}
        </div>
        <div style="margin-top:4px">${favHTML}</div>
      `);
    }

    // Card 4: 纳音（如有）
    if (nayin.day) {
      cards.push(`
        <div class="insight-tag">${isZh ? '日柱纳音' : 'NAYIN SOUND'}</div>
        <div class="insight-main" style="font-size:22px">${nayin.day}</div>
        <div class="insight-sub">${isZh ? '纳音五行象征你的命运底色' : 'Your destiny\'s elemental resonance'}</div>
      `);
    }

    return cards;
  }

  function _render() {
    const el = document.getElementById('insight-card-content');
    if (!el || !_cards.length) return;
    el.innerHTML = _cards[_idx];
    // 重播动画
    el.parentElement.style.animation = 'none';
    requestAnimationFrame(() => { el.parentElement.style.animation = ''; });
    // dots
    const dots = document.getElementById('insight-dots');
    if (dots) {
      dots.innerHTML = _cards.map((_,i) =>
        `<div class="insight-dot${i===_idx?' active':''}"></div>`
      ).join('');
    }
  }

  function _updateEta() {
    const el = document.getElementById('loading-eta');
    if (!el) return;
    const elapsed = Date.now() - _startTs;
    const remain  = Math.max(0, TOTAL_MS - elapsed);
    const mins    = Math.floor(remain / 60000);
    const secs    = Math.floor((remain % 60000) / 1000);
    const isZh = (typeof Lang !== 'undefined') ? Lang.getLang() === 'zh' : true;
    el.textContent = isZh
      ? `预计还需 ${mins > 0 ? mins+'分' : ''}${secs}秒`
      : `Est. ${mins > 0 ? mins+'m ' : ''}${secs}s remaining`;
  }

  function start(baziData) {
    _cards = _build(baziData);
    _idx   = 0;
    if (!_cards.length) return;

    document.getElementById('insight-carousel')?.classList.remove('hidden');
    document.getElementById('loading-eta')?.classList.remove('hidden');
    document.getElementById('loading-hint')?.classList.remove('hidden');

    _render();

    // 每 30s 自动切换
    clearInterval(_timer);
    _timer = setInterval(() => { _idx = (_idx + 1) % _cards.length; _render(); }, 30000);

    // 倒计时
    _startTs = Date.now();
    _updateEta();
    clearInterval(_etaTimer);
    _etaTimer = setInterval(_updateEta, 1000);
  }

  function stop() {
    clearInterval(_timer);
    clearInterval(_etaTimer);
    document.getElementById('insight-carousel')?.classList.add('hidden');
    document.getElementById('loading-eta')?.classList.add('hidden');
    document.getElementById('loading-hint')?.classList.add('hidden');
  }

  function next() {
    if (!_cards.length) return;
    _idx = (_idx + 1) % _cards.length;
    _render();
    // 重置自动切换计时
    clearInterval(_timer);
    _timer = setInterval(() => { _idx = (_idx + 1) % _cards.length; _render(); }, 30000);
  }

  return { start, stop, next };
})();
