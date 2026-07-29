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

  // ── 新用户引导流程状态 ────────────────────────────────────
  let _isNewUser     = false;  // 当前用户是否为新用户（无 tutorial_done 标记）

  // ── 调试面板（测试版专用）────────────────────────────────
  const DEBUG_MODE = true;  // 发布时设为 false
  const Debug = {
    _log: [],
    log(msg, type) {
      const ts = new Date().toTimeString().slice(0,8);
      const entry = `[${ts}] ${msg}`;
      this._log.push(entry);
      if (this._log.length > 80) this._log.shift();
      this._render();
      if (type === 'error') console.error('[App]', msg);
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
    const _origError = console.error.bind(console);
    console.error = (...args) => {
      _origError(...args);
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

  function _startGenerate() {
    // 重置当前岛屿记录id：本次是一次全新的生成（区别于 loadSavedIsland 加载已有存档），
    // 避免残留上一个岛屿的id导致后面AI深析"补写"写错记录（例如同一会话内未刷新页面
    // 连续生成了两个不同命盘，第二个生成完成前若AI深析先跑完，不应该补写回第一个岛屿）。
    // onComplete 里若本次生成成功保存，会重新赋值为本次真实的岛屿id。
    _currentIslandId = null;

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

  // ── 岛屿就绪后 ───────────────────────────────────────────
  function _onIslandReady() {
    const scene = IslandLoader.getScene();

    // 标注系统（含诊断徽标）
    IslandAnnotate.attach(scene, _baziData);

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
    IslandLoader.startAutoRotate();
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

  // ── 区域点击回调（供 island-annotate.js 调用）─────────────
  function _openZonePanel(zoneKey, baziData) {
    // 引导激活期间，标签点击由 Tutorial 接管，此处直接返回
    if (typeof Tutorial !== 'undefined' && Tutorial.isActive()) return;

    const panel   = document.getElementById('zone-panel');
    const content = document.getElementById('zone-panel-content');
    if (!panel || !content) return;

    // 解析 zoneKey: 'pillar_day', 'shensha_将星', 等
    let html = '';
    if (zoneKey.startsWith('pillar_')) {
      const col = zoneKey.replace('pillar_', '');
      html = Analysis.buildZonePanel('pillar_' + col, baziData);
      // 阅读大运触发任务
      if (col === 'year' || col === 'month') Tasks.complete('read_dayun', baziData);
    } else if (zoneKey.startsWith('shensha_')) {
      const name = zoneKey.replace('shensha_', '');
      html = Analysis.buildShenshaPanel(name, baziData);
      Tasks.complete('read_shensha', baziData);
    } else {
      html = Analysis.buildZonePanel(zoneKey, baziData);
    }

    content.innerHTML = html;
    panel.classList.add('open');
    AudioManager.playSfx('zone_click');
    IslandLoader.stopAutoRotate();
    _refreshTaskUI();
    _refreshSpirit();
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
    setGender, submit, retryGenerate, loadSavedIsland,
    toggleBaziTable, toggleTaskPanel,
    closeZonePanel, showReport, closeReport,
    toggleBgm, toggleSfx,
    restartTutorial,   // 测试模式 HUD 用
    // AuthUI 内部调用（勿删）
    _getBaziData:  () => _baziData,
    _getBirthInfo: () => _birthInfo,
    _getLastUrl:   () => _lastModelUrl,
    _debug:        () => Debug,
    // analysis.js 用于AI深析生成完成后"补写"回对应的已保存岛屿记录
    // （islands.ai_analysis）。未登录/本次会话未保存过岛屿时为 null。
    getCurrentIslandId: () => _currentIslandId,
    // auth.js::logout() 退出登录时调用，清除本次会话记录的岛屿id（防御性清理——
    // RLS+user_id过滤已经能防止跨账号误写，且报告只能从会设置这个id的入口打开，
    // 但退出登录后不应再残留上一个账号的岛屿id）
    _resetCurrentIslandId: () => { _currentIslandId = null; },
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
