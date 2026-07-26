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
  let _baziTableOpen = false;
  let _taskPanelOpen = false;

  // ── Stage → UI 映射 ────────────────────────────────────
  const STAGE_MAP = {
    queued            : { step:1, pct:5,  text:'提交生成任务...',      sub:'天机运转，请稍候' },
    generating_prompt : { step:2, pct:10, text:'生成命盘提示词...',    sub:'解析八字元素与神煞' },
    prompt_ready      : { step:2, pct:15, text:'提示词已就绪',         sub:'即将调用AI绘图' },
    generating_image  : { step:3, pct:20, text:'AI绘制命盘岛屿...',   sub:'Gemini 创作中（约30秒）' },
    image_ready       : { step:3, pct:40, text:'命盘图像已生成',       sub:'即将转化为3D模型' },
    converting_to_3d  : { step:4, pct:45, text:'提交3D生成任务...',   sub:'TripoAI 接收图像' },
    tripo_processing  : { step:4, pct:null,text:'3D模型生成中...',    sub:'TripoAI 转化中（约60-120秒）' },
    image_failed_fallback  : { step:3, pct:38, text:'切换至文字生成模式...',  sub:'AI绘图暂时繁忙，自动切换' },
    tripo_fallback         : { step:4, pct:50, text:'3D转换中（备用通道）...', sub:'正在使用备用生成方式' },
    tripo_text_processing  : { step:4, pct:null,text:'3D模型生成中...',        sub:'TripoAI 转化中（约60-120秒）' },
    completed         : { step:5, pct:95, text:'命盘已成型，加载中...', sub:'即将进入你的命盘世界' },
    error             : { step:null,pct:null,text:'生成失败',sub:'' },
  };

  // ── 屏幕切换 ─────────────────────────────────────────────
  function _showScreen(id) {
    ['screen-form','screen-loading','screen-island'].forEach(s => {
      document.getElementById(s)?.classList.toggle('hidden', s !== id);
    });
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
    const info = STAGE_MAP[stage] || STAGE_MAP.queued;
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
    _setStageText('生成失败', '请稍后重试');
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

    if (!year || year < 1900 || year > 2010) {
      if (errEl) errEl.textContent = '请输入有效的出生年份（1900-2010）'; return;
    }
    if (!month || month < 1 || month > 12) {
      if (errEl) errEl.textContent = '请输入有效的月份（1-12）'; return;
    }
    if (!day || day < 1 || day > 31) {
      if (errEl) errEl.textContent = '请输入有效的日期（1-31）'; return;
    }
    if (errEl) errEl.textContent = '';

    _birthInfo = { year, month, day, hour, gender: _gender };

    // 本地计算八字（BaziEngine是静态类）
    try {
      _baziData = BaziEngine.calculate(year, month, day, hour, 0, _gender);
    } catch (e) {
      if (errEl) errEl.textContent = '八字计算失败：' + e.message; return;
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
    document.getElementById('hud-spirit').textContent = '✦ ' + UserState.getSpirit() + ' 灵气';

    // 开始生成
    _startGenerate();
  }

  function _resetLoadingUI() {
    _setProgress(5);
    _setStageText('正在推算命盘...', '天机运转，请稍候');
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById('step-' + i);
      if (!el) continue;
      el.classList.remove('active','done');
      if (i === 1) el.classList.add('active');
    }
    document.getElementById('loading-error-text')?.classList.add('hidden');
    const btn = document.getElementById('loading-retry-btn');
    if (btn) btn.style.display = 'none';
  }

  function _startGenerate() {
    IslandLoader.generateIsland(_baziData, {
      onProgress(stage, pct) { _applyStage(stage, pct); },
      onComplete(modelUrl) {
        _setLoadingStep(5);
        _setProgress(100);
        _setStageText('命盘世界已就绪', '欢迎踏入你的命格宇宙');

        AudioManager.playSfx('island_ready');
        AudioManager.setScene('screen-island');

        setTimeout(() => {
          _showScreen('screen-island');
          _onIslandReady();
        }, 800);
      },
      onError(err) {
        AudioManager.playSfx('error');
        _showLoadingError('生成失败：' + (err || '请检查网络后重试'));
      }
    });
  }

  function retryGenerate() {
    AudioManager.playSfx('submit');
    if (!_baziData) { _showScreen('screen-form'); return; }
    _resetLoadingUI();
    _startGenerate();
  }

  // ── 岛屿就绪后 ───────────────────────────────────────────
  function _onIslandReady() {
    const scene = IslandLoader.getScene();

    // 标注系统
    IslandAnnotate.attach(scene, _baziData);

    // 恢复已解锁装饰
    IslandDecorations.restoreAll(_baziData);

    // 填充报告
    Analysis.buildReport(_baziData, document.getElementById('report-body'));

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
  }

  function _refreshSpirit() {
    const el = document.getElementById('hud-spirit');
    if (el) el.textContent = '✦ ' + UserState.getSpirit() + ' 灵气';
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

    const cols   = ['year','month','day','hour'];
    const labels = { year:'年柱', month:'月柱', day:'日柱', hour:'时柱' };
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
        <div class="bazi-cell shishen${dc}">${isDay ? '日主' : (ss[col]||'—')}</div>
        <div class="bazi-cell nayin${dc}">${(data.nayin||{})[col]||''}</div>
      </div>`;
    });
    gridHtml += '</div>';

    let metaHtml = '<div class="bazi-meta">';
    if (data.kongwang?.length) {
      metaHtml += `<span class="meta-tag warn">空亡：${data.kongwang.join('、')}</span>`;
    }
    if (data.wuxing) {
      const top = Object.entries(data.wuxing).sort((a,b)=>b[1]-a[1])[0];
      if (top) metaHtml += `<span class="meta-tag gold">旺：${top[0]}</span>`;
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
    if (btn) btn.textContent = _baziTableOpen ? '八字命盘 ∨' : '八字命盘 ∧';
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
    AudioManager.playSfx('report_open');
    // 完成"研读命理"任务
    Tasks.complete('daily_read_analysis', _baziData);
    _refreshTaskUI();
    _refreshSpirit();
  }

  function closeReport() {
    document.getElementById('report-modal')?.classList.remove('open');
    AudioManager.playSfx('panel_close');
  }

  // ── 区域点击回调（供 island-annotate.js 调用）─────────────
  function _openZonePanel(zoneKey, baziData) {
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
  });

  // ── 公开接口 ──────────────────────────────────────────────
  return {
    setGender, submit, retryGenerate,
    toggleBaziTable, toggleTaskPanel,
    closeZonePanel, showReport, closeReport,
    toggleBgm, toggleSfx,
  };
})();
