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
  //
  // 第三阶段"五行维护系统"：本函数不再调用 IslandAnnotate.attachTraits()
  // 挂载✅/⚠️浮动图标标签（该套TRAIT_LAYOUT/attachTraits()代码保留在
  // island-annotate.js里但不再从这个调用点触发，见该文件顶部停用说明），
  // 改为把 WuxingIssues.deriveIssues() 算出的确定性五行判定（wx/direction/
  // severity）与 analysis.step_wuxing_maintenance 里AI生成的具象化叙事
  // （title/narrative/action_hint）按 wx+direction 合并成完整issue，交给
  // WuxingScene.attach() 在岛屿地形上挂真实3D装饰（占位几何体）。
  function _applyAiAnalysis(analysis, expectedGeneration) {
    if (typeof expectedGeneration === 'number' && expectedGeneration !== _islandGeneration) return; // 会话已切换，静默丢弃

    // 2026-08-13 qa-reviewer第二轮CONFIRMED（对上一轮"换岛屿热点残留"修复的
    // 回归）：这里曾经在 `if (!analysis) return;` 之前无条件调用过一次
    // WuxingScene.detach()，本意是覆盖"AI深析失败"这条不会走到下方attach()
    // 的路径——但qa-reviewer浏览器实跑验证发现这个前提是错的：
    //   1) "换岛屿"场景下，_onIslandReady() 已经在AI深析请求发出之前就
    //      同步调用过 WuxingScene.detach()（见该函数内联注释），本函数收到
    //      结果时（不论成功/失败）旧热点早就清空过了，这里再detach一次清的
    //      永远是空集，纯属多余。
    //   2) 真正会被这次detach误伤的是"同一岛屿轻量刷新AI深析"场景
    //      （settings.js::refreshAiOnly()）——此时当前岛屿的热点是有效内容，
    //      AI深析失败（js/bazi-analysis.js: "恒不reject，失败一律
    //      resolve(null)"）只是意味着"这次没有更新的数据"，不代表"当前
    //      内容已经过期该清空"。无条件detach会把用户正常在用的热点/3D装饰
    //      全部误删，且此后没有任何路径会重新挂上（restoreAll()只管商品
    //      装饰、不管wxmaint_；_onIslandReady()不会再触发），只能整页刷新
    //      才能恢复。
    // 修复：不再在这里做任何清理，`if (!analysis) return;` 直接提前返回、
    // 保留当前已挂载的有效内容原样不动；AI深析成功时下方 WuxingScene.attach()
    // 内部本身第一行就会自己先 detach() 再挂载新热点（见 js/wuxing-scene.js），
    // "换岛屿"这条路径的清理完全由 _onIslandReady() 一处覆盖，不需要在这里
    // 重复兜底。
    if (!analysis) return;

    if (typeof WuxingIssues !== 'undefined' && typeof WuxingIssues.deriveIssues === 'function'
      && typeof WuxingScene !== 'undefined' && typeof WuxingScene.attach === 'function') {
      const baseIssues = WuxingIssues.deriveIssues(_baziData) || [];
      // step_wuxing_maintenance 本身就是裸数组（island_service/gemini_analysis.py::
      // _sanitize_wuxing_maintenance() 返回 list，analyze_bazi() 直接原样写入该
      // 字段），不是 {maintenance_items:[...]} 包一层——2026-08-13总agent交叉核对
      // 发现的CONFIRMED bug，此前误加的 `.maintenance_items` 导致 narrItems 永远
      // 是空数组，AI叙事从未真正传到WuxingScene。
      const narrItems  = analysis.step_wuxing_maintenance || [];
      // 2026-08-15第四阶段集成缺口修复（frontend-3d浏览器端到端验证时发现，
      // 见 claude-docs/已知问题与修复记录.md 对应日期条目）：WuxingScene.attach()
      // 按冻结契约读 issue.tier 决定初始展示哪一档3D装饰，但这里此前只拼了
      // WuxingIssues.deriveIssues() 的静态字段（wx/direction/severity）和AI叙事
      // （title/narrative/action_hint），从未查过 WuxingMaintenance.getState()——
      // 导致每次挂载都默认走tier1"安泰"展示，不反映真实维护进度，要等用户
      // 主动触发一次 reflectTier()（拖拽维护/瞬间调理/开面板刷新）才会纠正。
      // 补一次 getState() 查询，把 tier/ownershipTier 合并进issue对象——跟
      // _wxmaintRedeemBlockHtml() 里已经在用的同一个调用方式，只是这里是在
      // "初始挂载"这个时机调用，不是在"面板渲染"时机。
      const issues = baseIssues.map(issue => {
        const narr = narrItems.find(n => n.wx === issue.wx && n.direction === issue.direction) || {};
        let tier = 1, ownershipTier = 'none';
        if (typeof WuxingMaintenance !== 'undefined' && typeof WuxingMaintenance.getState === 'function') {
          const state = WuxingMaintenance.getState(_baziData, issue.wx, issue.direction, issue.severity);
          tier          = state.tier || 1;
          ownershipTier = state.ownershipTier || 'none';
        }
        return {
          wx:            issue.wx,
          direction:     issue.direction,
          severity:      issue.severity,
          title:         narr.title,
          narrative:     narr.narrative,
          action_hint:   narr.action_hint,
          tier:          tier,
          ownershipTier: ownershipTier,
        };
      });
      // WuxingScene.attach() 内部第一行会自己先 detach() 清掉上一次（本函数
      // 上一次AI深析成功时）挂载的热点，再挂载这一批新的——同一岛屿"轻量
      // 刷新AI深析"成功场景下天然是"清旧挂新"，不需要本函数额外调用detach()。
      WuxingScene.attach(IslandLoader.getScene(), _baziData, issues);
    }
  }

  // ── 岛屿就绪后 ───────────────────────────────────────────
  function _onIslandReady() {
    const scene = IslandLoader.getScene();

    // 标注系统（含诊断徽标）
    IslandAnnotate.attach(scene, _baziData);

    // 2026-08-13 qa-reviewer CONFIRMED：换岛屿场景下，上一张命盘挂载的
    // wxmaint_五行热点（CSS2D DOM，跟随同一个THREE.Scene常驻，不会随
    // "加载新岛屿"自动消失——island-loader.js::initScene()整个会话复用
    // 同一个Scene对象）必须在这里立即清一次，不能指望"这张新岛屿的AI深析
    // 成功后WuxingScene.attach()会自己先detach()"这个隐含前提——AI深析
    // 可能失败/超时（_applyAiAnalysis()此时会直接return，见该函数定义处
    // 新增的注释），届时上一张命盘的热点会永久残留在这张新岛屿上；用户点击
    // 这些孤儿热点会把"点击时闭包携带的旧命盘baziData"跟"此刻已经切换到
    // 的新岛屿App.getCurrentIslandId()"混在同一次兑换请求里，造成跨命盘
    // 数据污染（真实可复现路径见 claude-docs/已知问题与修复记录.md 对应
    // 日期条目）。这里清理跟 island-annotate.js::attach() 里对四柱/神煞/
    // 旧trait标签的防御性清理是同一模式，仅仅是WuxingScene是本轮新增模块、
    // 迁移时漏掉了对应这一句。
    if (typeof WuxingScene !== 'undefined' && typeof WuxingScene.detach === 'function') {
      WuxingScene.detach(scene);
    }

    // 2026-08-16 qa-reviewer CONFIRMED修复：五行维护状态多设备合并（第四阶段）
    // 此前只在 js/auth.js::AuthUI._mergeWuxingMaintenanceState()（登录事件那
    // 一刻）尝试触发过一次，但那个时机 App._getBaziData() 通常还是null（用户
    // 大概率还停在生辰输入页，登录事件先于岛屿加载发生），函数内部
    // `if (!bd) return;` 直接短路——注释虽然写了"_onIslandReady()会在岛屿
    // 真正加载完成时自己再调一次"，但这句调用从未真正被写进代码，导致换
    // 设备/清缓存的老用户永远拉不回云端记录（含花1000灵气买的
    // ownershipTier:'shrine'）。这里补上这个此前只存在于注释里、从未真正
    // 执行过的调用——_baziData 在本函数被调用时必然已经赋值（_onIslandReady()
    // 只在岛屿生成/加载成功后触发），是"岛屿加载完成"这个时机的正确落点。
    // fire-and-forget：不阻塞岛屿渲染主流程，失败只影响"这次没能合并到最新
    // 云端记录"，本地数据原样可用（WuxingMaintenance.syncFromCloud() 内部
    // 已经对未登录/网络失败做了静默短路，这里不需要重复判断登录态）。
    //
    // 2026-08-16 qa-reviewer第二轮CONFIRMED：上面这句fire-and-forget调用本身
    // 是对的（localStorage确实被合并了），但合并完成时3D场景往往早就已经用
    // "合并前"的本地空状态attach()完毕——BaziAnalysis.getAnalysis() 因为
    // loadSavedIsland() 已经 seedCache() 过，走的是本地缓存命中，一个微任务
    // 就resolve；而 syncFromCloud() 要走一次真实Supabase网络请求（数百ms），
    // 必然更晚完成。结果是"换设备刚打开就看到3D画面（问题态）跟面板
    // （已巩固✅）自相矛盾"，且没有任何路径在合并完成后回头刷新3D视觉，只有
    // 整页刷新才会一致。
    //
    // 修复：合并完成后，对当前已经挂载的每个五行标注按最新（合并后）状态
    // 重新调用 reflectTier()/markShrined() 刷新3D视觉——不用整批重新
    // detach()+attach()（成本更高、会有不必要的装饰移除/重建动画），只对
    // "真的可能因为这次合并而变化"的每个marker做定点刷新。若此时AI深析还没
    // 跑完（WuxingScene 尚未 attach() 过任何marker），getActiveMarkers() 会
    // 是空数组，这里天然是no-op——不需要额外处理，因为AI深析稍后第一次调用
    // _applyAiAnalysis() 时，WuxingMaintenance.getState() 读到的就已经是
    // 合并后的最新值，首次attach()一步到位就是对的，不会重蹈同样的race。
    if (typeof WuxingMaintenance !== 'undefined' && typeof WuxingMaintenance.syncFromCloud === 'function') {
      const _genAtSync = _islandGeneration;
      WuxingMaintenance.syncFromCloud(_baziData).then(() => {
        if (_genAtSync !== _islandGeneration) return; // 会话已切换，静默丢弃
        if (typeof WuxingScene === 'undefined' || typeof WuxingScene.getActiveMarkers !== 'function') return;
        let markers = [];
        try { markers = WuxingScene.getActiveMarkers() || []; } catch (e) { return; }
        markers.forEach(m => {
          if (!m || !m.wx || !m.direction) return;
          // severity 只在record不存在时才会被用到——这些marker此时必然已经
          // 在首次attach()时创建过record，这里传0只是占位，不会影响读到的
          // 真实值（见 js/wuxing-maintenance.js::getState() 的既有行为）。
          const state = WuxingMaintenance.getState(_baziData, m.wx, m.direction, 0);
          if (state.ownershipTier === 'shrine') {
            if (typeof WuxingScene.markShrined === 'function') WuxingScene.markShrined(m.wx, m.direction);
          } else if (typeof WuxingScene.reflectTier === 'function') {
            WuxingScene.reflectTier(m.wx, m.direction, state.tier);
          }
        });
      }).catch(() => {});
    }

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

  // ── 五行维护"灵气兑换"区块（接线方实现，见 js/analysis.js::
  //    buildMaintenancePanel() 上方注释里约定的 #wxmaint-redeem-slot
  //    低耦合contract）────────────────────────────────────────────
  // 2026-08-13总agent交叉核对发现：本区块此前完全未实现，面板里的
  // #wxmaint-redeem-slot占位容器一直是空的，用户看不到任何兑换入口。
  // 补齐后走"预渲染HTML字符串 + Analysis.buildMaintenancePanel()第4参数
  // 直接嵌入"这条协作路径（另一条是DOM插入后querySelector定位，这里选前者
  // 因为跟 _renderZonePanelHtml() 已有的"整段HTML一次性塞进innerHTML"风格
  // 一致，不需要额外一次DOM查询+事件绑定）。
  //
  // 复用 js/analysis.js::_traitRedeemBlock()（1400-1451行，第二阶段已跑通、
  // qa-reviewer验收过）同款结构（商品卡片列表/灵气不足禁用态/已改善徽标），
  // 但该函数是analysis.js模块私有、未导出，且改造对象从trait的{kind,idx}
  // 换成五行问题的{wx,direction}——按CLAUDE.md"不改bazi-pipeline领域文件"
  // 的边界，这里在本文件内重新实现一份等价版本，不去改analysis.js。
  // badge()/section() 同理是analysis.js模块私有辅助函数，未导出，这里用
  // 同款CSS class（.zone-badge/.zone-section等，index.html里定义，不是
  // trait专属样式）手写等价的一行HTML，不新造样式体系。
  //
  // 竞态防护：_lastWxmaintCtx 记录"最近一次渲染五行维护面板时"的
  // {baziData, issue, token}，token 就是当次 _openZonePanel() 用的
  // _zonePanelToken 快照值（wxmaint_面板只会被 _openZonePanel() 同步渲染
  // 一次，不像pillar_/shensha_那样还有一次异步AI详解到达后的二次渲染，
  // 因此直接读取"此刻"的 _zonePanelToken 即为本次渲染对应的令牌，不需要
  // 额外再引入一个新计数器）。兑换网络请求resolve后用这个快照值跟"此刻"的
  // _zonePanelToken 比对——不一致说明用户在await期间已经切换/关闭了面板，
  // 静默丢弃不覆盖，与 analysis.js::_refreshTraitPanel() 的 _zonePanelGen
  // 比对是同一套防御模式（该文件历史上真实出过"await期间用户切走导致内容
  // 被错误覆盖"的bug，这里不能省略这层防护）。
  let _lastWxmaintCtx = null;

  function _wxBadge(text, type) {
    return `<span class="zone-badge badge-${type}">${text}</span>`;
  }
  function _wxSection(title, body) {
    return `<div class="zone-section"><div class="zone-section-title">${title}</div><div class="zone-section-body">${body}</div></div>`;
  }
  // i18n查表辅助——跟 js/products.js::_t() 同款写法（Lang.t()本身不支持
  // 占位符插值，这里补一层简单 {n} 替换）。2026-08-13 qa-reviewer PLAUSIBLE
  // 发现补齐：本文件里五行维护面板的UI文案此前全是硬编码中文，未经i18n查表，
  // 英文用户看不到翻译，违反CLAUDE.md"i18n完整性"强制规则。
  function _wxT(key, vars) {
    let s = (typeof Lang !== 'undefined') ? Lang.t(key) : key;
    if (vars) {
      Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    }
    return s;
  }
  // ── 健康度进度条（2026-08-15新增，与 frontend-3d 领域的3D热点环形指示器
  //    并行开发，两边独立消费同一份 WuxingMaintenance.getState() 返回值，
  //    互不依赖对方实现）─────────────────────────────────────────────
  // 消费 state.healthPercent/state.daysUntilDecay（见 js/wuxing-maintenance.js
  // ::getState() 头部注释里对这两个字段的定义）。ownershipTier==='shrine'时
  // 不展示进度条，只显示"已永久巩固"文案——那两个字段此时分别固定
  // 100/null，没有"还剩多久会恶化"这个概念。
  //
  // 2026-08-16 qa-reviewer第三轮CONFIRMED配套修复：
  //   1) 颜色阈值原本是"50%作为分界"，改成跟 js/wuxing-maintenance.js::
  //      getState() 里新的tier区间对齐的60%——healthPercent 现在按tier分区间
  //      （tier1:[61,100]/tier2:[31,60]/tier3:[0,30]，与3D环
  //      wuxing-scene.js::_updateHealthRing() 的60/30配色阈值精确对齐），
  //      沿用50%分界会让tier2区间的上半段（50-60）在面板上显示绿色，但3D环
  //      在同一数值下已经显示黄色——面板和3D环各说各话，还是同一类"颜色跟
  //      真实状态对不上"的问题。改成60%分界后，面板绿色⟺3D环绿色⟺tier1，
  //      两处视觉判断永远一致。
  //   2) tier===3 时不再复用"约N天后进一步恶化"这句话——tier已经封顶，不会
  //      再恶化，这句话对tier3不成立（`_computeTier()`的`if(tier<3)tier+=1`
  //      保证tier不会超过3），改用专属的"已达最重档"文案，不提示一个不会
  //      发生的未来事件。
  function _wxHealthBarHtml(state) {
    if (!state || state.ownershipTier === 'shrine') {
      return `<div class="wxmaint-health-caption">${_wxT('wxmaint.health_secured')}</div>`;
    }
    const pct = Math.max(0, Math.min(100, Math.round(Number(state.healthPercent) || 0)));
    // 2026-08-16 qa-reviewer第四轮PLAUSIBLE修复：原来只有good/warn两档，
    // pct落在31-60这段tier2区间时会显示纯红——跟3D环（wuxing-scene.js::
    // _updateHealthRing()）在同一数值下显示的琥珀黄不一致。补上跟3D环三档
    // 完全对齐的mid档，确保面板颜色⟺3D环颜色在tier2区间也一致，不只是
    // tier1/tier3两端才对齐。
    const tone = pct > 60 ? 'good' : (pct > 30 ? 'mid' : 'warn');
    const caption = (Number(state.tier) === 3)
      ? _wxT('wxmaint.health_status_worst', { pct: pct })
      : _wxT('wxmaint.health_status', { pct: pct, days: (() => {
          const daysRaw = Number(state.daysUntilDecay);
          return (isFinite(daysRaw) ? Math.max(0, daysRaw) : 0).toFixed(1);
        })() });
    return `
      <div class="wxmaint-health-bar"><div class="wxmaint-health-fill wxmaint-health-${tone}" style="width:${pct}%"></div></div>
      <div class="wxmaint-health-caption">${caption}</div>`;
  }

  function _wxProductIcon(product) {
    const key = ((product && (product.decorId || product.id)) || '').toLowerCase();
    if (key.includes('amethyst')) return '🔮';
    if (key.includes('rose'))     return '💗';
    if (key.includes('obsidian')) return '⚫';
    if (key.includes('water') || key.includes('basin') || key.includes('clear')) return '💧';
    return '💎';
  }

  // 构建 #wxmaint-redeem-slot 内嵌HTML；issue 形状同 extra：
  // {wx, direction, severity, title, narrative, action_hint}。
  // 副作用：记下 _lastWxmaintCtx 供 App.redeemWuxingProduct()/
  // App.instantFixWuxingIssue() 操作成功后的原地刷新使用——跟
  // analysis.js::buildTraitPanel() 内部记 _lastTraitCtx 同一惯例（该函数本身
  // 在文档里也标注了"纯函数"但内部一样有这层缓存副作用，是这套zone-panel
  // 渲染管线里的既有模式，不是本次新引入的例外）。
  //
  // 第四阶段"五行经营机制"改造：状态判断从读 UserState.isWuxingIssueResolved()
  // （第三阶段"兑换=永久resolve"二元语义）改成读
  // WuxingMaintenance.getState(...).tier/.ownershipTier（3档tier+可持续衰减）。
  // 四种状态分支：
  //   ownershipTier==='shrine' → "已巩固"静态徽标，不展示任何操作按钮（彻底
  //     退出维护循环，唯一的终态）；
  //   tier===1 且非crystal态 → 只展示"状态良好"提示，没有任何维护紧迫感；
  //   其余情况（tier>1，或ownershipTier==='crystal'即便当前tier恰好是1）→
  //     展示②瞬间调理（仅tier>1时）+③④商品卡（已是crystal态时不再重复展示
  //     水晶选项，只保留可以"更进一步"升级的神龛）。
  function _wxmaintRedeemBlockHtml(baziData, issue) {
    issue = issue || {};
    const wx = issue.wx, direction = issue.direction;
    if (!wx || (direction !== 'nourish' && direction !== 'restrain')) return '';

    _lastWxmaintCtx = { baziData, issue, token: _zonePanelToken };

    if (typeof Products === 'undefined' || typeof Products.getProducts !== 'function') return '';
    if (typeof WuxingMaintenance === 'undefined' || typeof WuxingMaintenance.getState !== 'function') return '';
    if (typeof UserState === 'undefined') return '';

    const state         = WuxingMaintenance.getState(baziData, wx, direction, issue.severity);
    const tier           = state.tier || 1;
    const ownershipTier  = state.ownershipTier || 'none';

    // ④ 已巩固：彻底退出维护循环，唯一的静态终态，不再展示任何操作按钮
    if (ownershipTier === 'shrine') {
      return _wxSection(_wxT('wxmaint.progress_label'), _wxBadge(_wxT('wxmaint.shrined_badge') + ' ✅', 'good') + _wxHealthBarHtml(state));
    }

    // tier===1 且非水晶态：没有维护紧迫感，不展示任何兑换/调理入口——避免
    // 在用户命盘状态本就良好时还硬塞商品卡片制造不必要的消费引导。仍然展示
    // 健康度进度条（此时应接近满格），让用户能提前感知"还有多久会开始恶化"，
    // 不用等真的跳档才知道——这正是本轮迭代要解决的"离散跳变缺乏互动感"问题。
    if (tier === 1 && ownershipTier !== 'crystal') {
      return _wxSection(_wxT('wxmaint.progress_label'), _wxBadge(_wxT('wxmaint.good_status'), 'good') + _wxHealthBarHtml(state));
    }

    const sections = [];

    // 水晶庇护中提示——③已购但问题仍会衰减，只是周期拉长到6天、维护动作
    // 换皮成"消磁"（拖拽UI本身由 js/wuxing-drag.js 负责，不在本面板内）。
    if (ownershipTier === 'crystal') {
      sections.push(_wxSection(_wxT('wxmaint.progress_label'), _wxBadge('💎 ' + _wxT('wxmaint.crystal_note'), 'good') + _wxHealthBarHtml(state)));
    } else {
      // tier>1 且非crystal态：此前完全没有"改善进度"区块，用户只能看到瞬间
      // 调理/兑换商品卡，看不到量化的健康度/倒计时——这正是本轮迭代要补的
      // 缺口，单独补一个进度区块（不依赖上面crystal分支复用同一个_wxSection
      // 调用，因为badge文案不同，没有第三种"状态徽标"适合套在这里，直接
      // 展示进度条本身）。
      sections.push(_wxSection(_wxT('wxmaint.progress_label'), _wxHealthBarHtml(state)));
    }

    // ② 瞬间调理：仅 tier>1 时显示，价格用 WuxingMaintenance.instantFixCost()
    // 预览（跟 instantFix() 内部实际扣费公式是同一个函数，不会出现"面板显示
    // 的价格"和"实际扣的钱"不一致）。
    if (tier > 1) {
      const spirit = UserState.getSpirit() || 0;
      const cost   = (typeof WuxingMaintenance.instantFixCost === 'function')
        ? WuxingMaintenance.instantFixCost(tier, issue.severity) : 0;
      const enough = spirit >= cost;
      const sevArg = Number(issue.severity) || 0;
      const btnHtml = enough
        ? `<button class="trait-redeem-btn" onclick="App.instantFixWuxingIssue('${wx}','${direction}',${sevArg}, this)">${_wxT('wxmaint.instant_fix_btn', { n: cost })}</button>`
        : `<button class="trait-redeem-btn disabled" disabled>${_wxT('wxmaint.insufficient_btn', { n: Math.max(cost - spirit, 0) })}</button>`;
      sections.push(_wxSection(_wxT('wxmaint.instant_fix_title'), btnHtml));
    }

    // ③④ 商品卡：已经是crystal态时不再重复展示水晶选项（避免同一issue买了
    // 第二次水晶除了多花灵气没有任何额外效果），只保留神龛（可以从crystal
    // 态"更进一步"升级到永久巩固）；shrine分支在上面已经提前return，走不到
    // 这里，不需要再过滤。
    let products = [];
    try { products = Products.getProducts() || []; } catch (e) { products = []; }
    const visibleProducts = products.filter(p => p && !(p.kind === 'crystal' && ownershipTier === 'crystal'));

    if (visibleProducts.length) {
      const lang        = (typeof Lang !== 'undefined' && typeof Lang.getLang === 'function') ? Lang.getLang() : 'zh';
      const spirit2      = UserState.getSpirit() || 0;
      const spiritLabel  = _wxT('products.spirit_label');
      const redeemLabel  = _wxT('products.redeem_btn');

      const cardsHtml = visibleProducts.map(p => {
        const name = (p.name && (p.name[lang] || p.name.zh)) || p.id || '';
        const cost = Number(p.spiritCost) || 0;
        const enough2 = spirit2 >= cost;
        const icon = _wxProductIcon(p);
        const btnHtml = enough2
          ? `<button class="trait-redeem-btn" onclick="App.redeemWuxingProduct('${String(p.id).replace(/'/g, "\\'")}', this)">${redeemLabel}</button>`
          : `<button class="trait-redeem-btn disabled" disabled>${_wxT('wxmaint.insufficient_btn', { n: Math.max(cost - spirit2, 0) })}</button>`;
        return `
          <div class="trait-product-card">
            <div class="trait-product-icon">${icon}</div>
            <div class="trait-product-info">
              <div class="trait-product-name">${name}</div>
              <div class="trait-product-price">${cost} ${spiritLabel}</div>
            </div>
            ${btnHtml}
          </div>`;
      }).join('');

      sections.push(_wxSection(_wxT('wxmaint.redeem_now'), `<div class="trait-product-list">${cardsHtml}</div>`));
    }

    return sections.join('');
  }

  // ── 兑换按钮 onclick 调用：编排一次五行维护商品兑换，成功后原地刷新当前
  //    已打开的wxmaint面板（复用 _lastWxmaintCtx，见其声明处的竞态防护说明）。
  async function _redeemWuxingProduct(productId, btnEl) {
    if (typeof Products === 'undefined' || typeof Products.redeem !== 'function') return;
    if (!_lastWxmaintCtx) return;

    const ctxAtClick = _lastWxmaintCtx;
    const { baziData, issue } = ctxAtClick;
    const originalText = btnEl ? btnEl.textContent : '';
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = _wxT('wxmaint.redeeming');
    }

    let ok = false;
    try {
      ok = await Products.redeem(productId, {
        wx:        issue.wx,
        direction: issue.direction,
        summary:   issue.title,
        baziData,
      });
    } catch (e) {
      ok = false;
    }

    if (ok) {
      _refreshWxmaintPanel(ctxAtClick);
    } else if (btnEl) {
      // 兑换失败（灵气不足/未登录被引导中止/网络错误等，具体原因与提示由
      // Products.redeem() 内部负责）：还原按钮，不清空/替换面板其余内容——
      // 与 analysis.js::redeemTraitProduct() 失败分支同一原则。
      btnEl.disabled = false;
      btnEl.textContent = originalText || _wxT('products.redeem_btn');
    }
  }

  // ── ②"瞬间调理"按钮 onclick：花灵气跳过拖拽直接把该五行问题调回档位1。
  //    参照 _redeemWuxingProduct() 同款写法风格（快照 _lastWxmaintCtx、按钮
  //    loading态、成功后走同一个 _refreshWxmaintPanel() 竞态守卫原地刷新）。
  function _instantFixWuxingIssue(wx, direction, severity, btnEl) {
    if (typeof WuxingMaintenance === 'undefined' || typeof WuxingMaintenance.instantFix !== 'function') return;
    if (!_lastWxmaintCtx) return;

    const ctxAtClick = _lastWxmaintCtx;
    const { baziData } = ctxAtClick;
    const originalText = btnEl ? btnEl.textContent : '';
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = _wxT('wxmaint.redeeming');
    }

    let result = null;
    try {
      result = WuxingMaintenance.instantFix(baziData, wx, direction, severity);
    } catch (e) {
      result = null;
    }

    if (result && result.ok) {
      // 3D视觉立即切到档位1（跟 Products.redeem() 水晶分支同款调用），不等
      // 用户下次重开面板才看到变化。
      if (typeof WuxingScene !== 'undefined' && typeof WuxingScene.reflectTier === 'function') {
        WuxingScene.reflectTier(wx, direction, 1);
      }
      _refreshWxmaintPanel(ctxAtClick);
    } else if (btnEl) {
      // 灵气不足：instantFix() 内部走 UserState.useSpirit() 失败时不会扣款
      // 也不会改任何状态（见 js/wuxing-maintenance.js::instantFix() 注释），
      // 这里只需要还原按钮——正常情况下按钮本就应该已经是disabled态（面板
      // 渲染时已经按余量算过），这个分支主要覆盖"面板开着挂机很久、期间
      // 灵气被其它标签页/操作消耗掉"这类极端时序。
      btnEl.disabled = false;
      btnEl.textContent = originalText || _wxT('wxmaint.instant_fix_btn', { n: 0 });
    }
  }

  // 内部：用点击那一刻快照下来的 ctxAtClick 重新调用 _renderZonePanelHtml()
  // 并原地替换 zone-panel-content 的内容——兑换/瞬间调理成功后
  // WuxingMaintenance.getState(...) 的 tier/ownershipTier 会变化，重渲染即可
  // 自然切换到对应的状态展示。竞态守卫见 _lastWxmaintCtx 声明处注释。
  function _refreshWxmaintPanel(ctxAtClick) {
    if (!ctxAtClick || ctxAtClick.token !== _zonePanelToken) return;
    const panel = document.getElementById('zone-panel');
    if (!panel || !panel.classList.contains('open')) return;
    const content = document.getElementById('zone-panel-content');
    if (!content) return;
    const { baziData, issue } = ctxAtClick;
    const zoneKey = `wxmaint_${issue.wx}_${issue.direction}`;
    content.innerHTML = _renderZonePanelHtml(zoneKey, baziData, null, issue);
  }

  // 根据 zoneKey 渲染面板 HTML（纯函数，无副作用）。analysis 为 null/undefined
  // 时走静态兜底，拿到 AI 深析结果后传入 analysis 走完整详解。extra 是
  // island-annotate.js::attachTraits() 的trait标签点击时闭包携带的
  // {kind, idx, summary, detail} 数据，只有 'trait_' 开头的 zoneKey 会用到
  // （该套trait标注本身已停用，见 _applyAiAnalysis() 注释，但代码保留）；
  // wxmaint_ 开头的 zoneKey 同理复用这第四参数，携带 WuxingScene 创建装饰时
  // 闭包携带的 {wx, direction, severity, title, narrative, action_hint}。
  // 两者数据都在标签/装饰创建时就已经完整拿到手，不像 pillar_/shensha_ 那样
  // 需要在这里异步等 AI 深析结果到达才能渲染完整版。
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
    // 第三阶段"五行维护系统"：wxmaint_{wx}_{direction} 由 WuxingScene 挂载的
    // 3D装饰点击时触发，extra 是创建装饰时闭包直接携带的完整issue
    // {wx, direction, severity, title, narrative, action_hint}——跟trait_同款
    // 模式，数据在点击那一刻已经齐全，不需要在这里再异步等AI深析结果。
    if (zoneKey.startsWith('wxmaint_')) {
      const redeemHtml = _wxmaintRedeemBlockHtml(baziData, extra);
      return Analysis.buildMaintenancePanel(zoneKey, baziData, extra, redeemHtml);
    }
    return Analysis.buildZonePanel(zoneKey, baziData);
  }

  // ── 区域点击回调（供 island-annotate.js 调用）─────────────
  // force=true：绕开"引导激活期间禁止打开"的 guard——目前唯一调用方是
  // Tutorial 的"查看完整详解"按钮（见 viewTutorialDetail()），点击前已经
  // 调用过 Tutorial.pause() 把引导自身的 Modal/overlay 隐藏掉，两者不会
  // 同时抢视觉焦点。
  // extra：可选第四参数，island-annotate.js::attachTraits()（已停用trait标注，
  // 代码保留）传入 {kind, idx, summary, detail}，或 WuxingScene（本轮新增的
  // 五行维护3D装饰）传入 {wx, direction, severity, title, narrative,
  // action_hint}——分别供 zoneKey 以 'trait_'/'wxmaint_' 开头的分支透传给
  // Analysis.buildTraitPanel()/buildMaintenancePanel()（见上方
  // _renderZonePanelHtml）。放在第四位而不是复用第三位的 force，是因为两者
  // 语义完全独立、调用方不同（Tutorial 传布尔 force，标签/装饰点击传对象
  // extra），合并进同一个位置容易在未来被误传/误判类型。pillar_/shensha_/
  // 其余分支忽略该参数，不传时（现有调用点）行为与改动前完全一致。
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
    redeemWuxingProduct: _redeemWuxingProduct, // wxmaint面板"兑换"按钮 onclick 用
    instantFixWuxingIssue: _instantFixWuxingIssue, // wxmaint面板"②瞬间调理"按钮 onclick 用
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
