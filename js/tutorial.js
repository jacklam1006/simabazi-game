/**
 * 司马八字 · 新手引导系统 tutorial.js
 *
 * 流程：
 *   Tutorial.start(baziData, gender)
 *     → 锁定 OrbitControls
 *     → 相机飞到每个步骤位置
 *     → 高亮对应标签
 *     → 底部提示条「👆 点击高亮标识」
 *     → 用户主动点击标签 → 居中大卡片 Modal 弹出
 *     → 点「下一个 →」继续 / 「跳过引导」退出
 *     → 最后一步：粒子爆炸庆祝动画
 *
 * localStorage 标记：tutorial_done_[hash] = '1'
 *
 * 公开 API：
 *   Tutorial.start(baziData, gender)
 *   Tutorial.next()
 *   Tutorial.skip()
 *   Tutorial.reset()
 *   Tutorial.isActive() → boolean
 *   Tutorial.isDone(baziData, gender) → boolean
 *   Tutorial.updateAiContent(analysis)
 *   Tutorial.pause()   （2026-08-11新增，"查看完整详解"打通用）
 *     暂停期间 _active 保持 true（引导仍处于进行中的状态，isDone()/isActive()
 *     语义不受影响），仅隐藏 #tutorial-overlay（含居中Modal、提示条、进度点、
 *     右上角跳过按钮）；供 main-new.js 打开 #zone-panel 展示完整AI详情前调用，
 *     让两个互斥的全屏级UI不同时抢占视觉焦点。
 *   Tutorial.resume()  （2026-08-11新增）
 *     恢复 pause() 前的展示（重新填充Modal内容——若AI内容在暂停期间才到达，
 *     顺带一并刷新——并重新显示 overlay）。非 pause 状态下调用是安全的空操作。
 *   Tutorial.getCurrentZoneKey() → string|null （2026-08-11新增）
 *     返回当前步骤对应的 zoneKey（'pillar_day'/'shensha_将星'等），格式与
 *     main-new.js::_openZonePanel() 期望的 zoneKey 完全一致，供"查看完整详解"
 *     按钮直接转发调用。引导未激活或已经是最后一步之后时返回 null。
 */

const Tutorial = (() => {

  // ── 相机飞行配置 ──────────────────────────────────────────
  // 2026-08-01 曾把 cam 也改成"相对岛屿包围盒比例"，被 qa-reviewer 打回：
  // island-loader.js._loadGLB()（约第250-255行）在每个GLB模型加载完成后
  // 都会做归一化——scale = 10 / max(size.x, size.y, size.z)，再把模型居中
  // （position.sub(center*scale)）。这意味着运行时 IslandAnnotate.getIslandBox()
  // 拿到的包围盒永远是"以原点对称、最大边=10"（min = -max），写死的绝对
  // 相机坐标本来就是相对这个固定尺度调校出来的，尺度上是安全的，不需要
  // 相对化。改成"x/y/z三轴各自按包围盒对应维度独立缩放"反而是错的——它
  // 破坏了相机与模型的统一距离比例，导致扁平岛屿（如10×1.5×10）算出的
  // 相机仰角低到10°（近乎贴地平视），瘦高岛屿（如2.5×10×2.5）又飙到80°
  // （近乎正俯视），比原来的写死坐标还差。真正会因模型形状不同而跑偏的
  // 只有"看向的点"（look target）——四柱/神煞标签是在模型表面用射线投射
  // 出来的真实坐标，不同形状的岛屿这个点必然不同，这部分才需要动态化。
  //
  // 修复：cam 恢复为写死的绝对坐标（与本次改动前、也是本次改动最初的
  // 版本完全一致，经过生产验证）；look 保留"优先复用 IslandAnnotate.
  // getLabelPositions() 的真实标签世界坐标"这个有效修复，取不到时才退化
  // 为写死坐标（同样是原始生产验证过的数值，不再依赖包围盒换算）。
  const STEP_CAM = {
    pillar_day   : { cam: {x: 0,  y: 9,  z: 11}, look: {x: 0,    y: 3.5, z: 0}    },
    pillar_year  : { cam: {x:-1,  y: 7,  z: 6},  look: {x:-3.5,  y: 1.5, z:-3}    },
    pillar_month : { cam: {x: 1,  y: 7,  z: 6},  look: {x: 3.5,  y: 1.5, z:-3}    },
    pillar_hour  : { cam: {x: 0,  y: 6,  z: 13}, look: {x: 0,    y: 1.5, z: 3.8}  },
    shensha      : { cam: {x: 0,  y: 12, z: 18}, look: {x: 0,    y: 0,   z: 0}    },
  };

  /**
   * 计算某一步的注视目标（相机看向的点）。优先直接复用 IslandAnnotate 已经
   * 算好的真实标签世界坐标（与该步骤高亮的标签位置完全一致，含地形射线
   * 贴合，会随岛屿真实形状变化）；IslandAnnotate 不可用或对应标签尚未生成
   * 时，才退化为写死坐标（与 cam 一样是生产验证过的固定数值）。
   */
  function _lookTargetFor(step, lookFallback) {
    if (typeof IslandAnnotate !== 'undefined' && IslandAnnotate.getLabelPositions) {
      try {
        const positions = IslandAnnotate.getLabelPositions();
        if (step.type === 'pillar' && positions.pillars && positions.pillars[step.col]) {
          return positions.pillars[step.col].clone();
        }
        if (step.type === 'shensha' && positions.shensha && positions.shensha.length) {
          return positions.shensha[0].clone();
        }
      } catch (e) { /* 静默回退到写死坐标 */ }
    }
    return new THREE.Vector3(lookFallback.x, lookFallback.y, lookFallback.z);
  }

  const STEM_SHORT = {
    '甲':'甲木如参天大树，刚直领导，开拓创新',
    '乙':'乙木如柔藤翠竹，灵活适应，善借外力',
    '丙':'丙火如烈阳骄阳，热情豪爽，光明磊落',
    '丁':'丁火如灯烛温光，内敛细腻，智慧深邃',
    '戊':'戊土如巍峨山岳，厚重稳健，承载有力',
    '己':'己土如沃野良田，包容踏实，服务意识强',
    '庚':'庚金如坚锋利刃，果断行动，正义刚强',
    '辛':'辛金如珍珠宝石，精致优雅，追求完美',
    '壬':'壬水如浩瀚江海，智慧深远，格局宏大',
    '癸':'癸水如霏霏细雨，直觉敏锐，内心丰富',
  };

  const PILLAR_ROLE = {
    year : '年柱代表祖先根基与童年环境',
    month: '月柱代表父母影响与青壮年运势',
    day  : '日柱是你的命盘核心，代表内在自我与婚姻宫',
    hour : '时柱代表晚年运势与内心深处的志向',
  };

  const SS_DESC = {
    '将星':'权威领导之星，主官贵与权力，统筹管理天赋卓越',
    '禄神':'衣食禄气之星，事业财运亨通，生活有保障',
    '红鸾':'桃花情缘之星，感情运活跃，异性缘极佳',
    '天乙':'贵人保护之星，逢凶化吉，人生贵人相助',
    '文昌':'学业文书之星，智慧功名出众，适合学术与创作',
    '天德':'天赐吉神，化解灾厄，平安顺遂',
    '月德':'月令德星，主平安，助人和气',
    '驿马':'驿马星动，利于变动、出行与迁移',
    '亡神':'主损耗与意外，需防暗中消耗与人际是非',
    '劫煞':'主破财与竞争，需防争夺冲突，宜低调行事',
    '白虎':'主伤病血光，注意健康与安全，出行谨慎',
    '羊刃':'主刑克意外，但也代表极强意志力与执行力',
    '孤辰':'主孤独内省，独处思考力强，宜培养人脉',
  };

  // ── 模块状态 ─────────────────────────────────────────────
  let _active          = false;
  let _paused          = false; // 2026-08-11新增：查看zone-panel完整详情时暂停
  let _steps           = [];
  let _idx             = 0;
  let _baziData        = null;
  let _gender          = '男';
  let _aiAnalysis      = null;
  let _baziHash        = '';

  let _pendingLabelEl   = null;
  let _pendingClickFn   = null;
  let _hintStrongTimer  = null;
  let _autoAdvanceTimer = null;

  // ── 哈希（与 BaziAnalysis 算法一致）─────────────────────
  function _computeHash(baziData, gender) {
    const p = baziData.pillars || {};
    const parts = ['year','month','day','hour'].map(col => {
      const pl = p[col] || {};
      return (pl.stem || '') + (pl.branch || '');
    });
    parts.push(gender || '');
    let h = 0;
    const str = parts.join('|');
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(16).padStart(8, '0');
  }

  // ── 步骤列表 ─────────────────────────────────────────────
  function _buildSteps(baziData) {
    const ss = baziData.shenshe || baziData.shensha || [];
    const steps = [
      { type: 'pillar', col: 'day' },
      { type: 'pillar', col: 'year' },
      { type: 'pillar', col: 'month' },
      { type: 'pillar', col: 'hour' },
    ];
    if (ss.length > 0) steps.push({ type: 'shensha', name: ss[0] });
    return steps;
  }

  function _stepKey(step) {
    return step.type === 'pillar' ? ('pillar_' + step.col) : 'shensha';
  }

  function _labelKey(step) {
    if (step.type === 'pillar')  return 'pillar_' + step.col;
    if (step.type === 'shensha') return 'shensha_' + step.name;
    return '';
  }

  // ── 公开：启动 ────────────────────────────────────────────
  function start(baziData, gender) {
    if (!baziData) return;
    _active     = true;
    _baziData   = baziData;
    _gender     = gender || '男';
    _steps      = _buildSteps(baziData);
    _idx        = 0;
    _baziHash   = _computeHash(baziData, gender);
    _aiAnalysis = null;

    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) overlay.classList.remove('hidden');

    if (typeof IslandLoader !== 'undefined') {
      IslandLoader.setControlsEnabled(false);
      IslandLoader.stopAutoRotate();
    }

    _showStep(0);
  }

  // ── 公开：下一步 ──────────────────────────────────────────
  function next() {
    if (!_active) return;
    _hideModal();
    _idx++;
    if (_idx >= _steps.length) {
      _complete();
    } else {
      _showStep(_idx);
    }
  }

  // ── 公开：跳过 ────────────────────────────────────────────
  function skip() {
    if (!_active) return;
    _markDone();
    _cleanup();
  }

  // ── 完成 ──────────────────────────────────────────────────
  function _complete() {
    _markDone();
    _hideModal();
    _hideHintBar();
    _showCelebration();
    setTimeout(() => {
      _cleanup();
      _showToast('✦ 命盘探索完成！随时点击标识深入了解 ✦');
    }, 900);
  }

  function _markDone() {
    if (_baziHash) {
      try { localStorage.setItem('tutorial_done_' + _baziHash, '1'); } catch(e) {}
    }
  }

  function _cleanup() {
    _active = false;
    _paused = false;
    _hideHintBar();
    _clearLabelListener();

    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) overlay.classList.add('hidden');
    _hideModal();

    if (typeof IslandAnnotate !== 'undefined') IslandAnnotate.clearHighlight();
    if (typeof IslandLoader !== 'undefined') {
      IslandLoader.setControlsEnabled(true);
      IslandLoader.startAutoRotate();
    }
  }

  // ── 显示步骤 ──────────────────────────────────────────────
  function _showStep(idx) {
    const step  = _steps[idx];
    const total = _steps.length;

    _clearLabelListener();
    _hideHintBar();
    _hideModal();
    _renderDots(idx, total);

    if (typeof IslandAnnotate !== 'undefined') {
      IslandAnnotate.clearHighlight();
      IslandAnnotate.highlightLabel(_labelKey(step));
    }

    const camCfg = STEP_CAM[_stepKey(step)] || STEP_CAM.shensha;
    if (typeof IslandLoader !== 'undefined' && typeof THREE !== 'undefined') {
      const camPos = new THREE.Vector3(camCfg.cam.x, camCfg.cam.y, camCfg.cam.z);
      const lookAt = _lookTargetFor(step, camCfg.look);
      IslandLoader.flyTo(camPos, lookAt, 1200, () => {
        if (_active) _showHintBar(step, idx, total);
      });
    } else {
      setTimeout(() => { if (_active) _showHintBar(step, idx, total); }, 600);
    }
  }

  // ── 提示条：显示 ─────────────────────────────────────────
  function _showHintBar(step, idx, total) {
    const bar = document.getElementById('tutorial-hint-bar');
    if (bar) bar.classList.remove('hidden', 'hint-urgent');

    const key     = _labelKey(step);
    const labelEl = (typeof IslandAnnotate !== 'undefined' && IslandAnnotate.getLabelElement)
      ? IslandAnnotate.getLabelElement(key)
      : null;

    if (labelEl) {
      _pendingClickFn = () => _onLabelClick(step, idx, total);
      labelEl.addEventListener('click', _pendingClickFn, { once: true });
      _pendingLabelEl = labelEl;
    }

    // 3s 无操作 → 强调动画
    _hintStrongTimer = setTimeout(() => {
      const b = document.getElementById('tutorial-hint-bar');
      if (b && _active) b.classList.add('hint-urgent');
    }, 3000);

    // 5s 后无论是否点击，自动弹出 Modal（防止点击失效卡死）
    _autoAdvanceTimer = setTimeout(() => {
      if (_active) _onLabelClick(step, idx, total);
    }, 5000);
  }

  // ── 提示条：隐藏 ─────────────────────────────────────────
  function _hideHintBar() {
    clearTimeout(_hintStrongTimer);
    _hintStrongTimer = null;
    clearTimeout(_autoAdvanceTimer);
    _autoAdvanceTimer = null;
    const bar = document.getElementById('tutorial-hint-bar');
    if (bar) bar.classList.add('hidden');
  }

  // ── 清除标签点击监听 ──────────────────────────────────────
  function _clearLabelListener() {
    if (_pendingLabelEl && _pendingClickFn) {
      _pendingLabelEl.removeEventListener('click', _pendingClickFn);
    }
    _pendingLabelEl = null;
    _pendingClickFn = null;
    clearTimeout(_autoAdvanceTimer);
    _autoAdvanceTimer = null;
  }

  // ── 用户点击标签 → Modal ─────────────────────────────────
  function _onLabelClick(step, idx, total) {
    _clearLabelListener();
    _hideHintBar();
    _fillModalContent(step, idx, total);
    _showModalCard();
  }

  // ── Modal：显示（淡入动画，_onLabelClick 与 resume() 共用）─────
  function _showModalCard() {
    const modal = document.getElementById('tutorial-modal');
    if (modal) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => modal.classList.add('tut-modal-show'));
      });
    }
  }

  // ── Modal：隐藏 ───────────────────────────────────────────
  function _hideModal() {
    const modal = document.getElementById('tutorial-modal');
    if (modal) modal.classList.remove('tut-modal-show');
  }

  // ── 进度点 ────────────────────────────────────────────────
  function _renderDots(idx, total) {
    const el = document.getElementById('tutorial-dots');
    if (!el) return;
    el.innerHTML = Array.from({ length: total }, (_, i) => {
      const cls = i === idx ? 'active' : i < idx ? 'done' : '';
      return '<span class="tut-dot ' + cls + '"></span>';
    }).join('');
  }

  // ── 填充 Modal 内容 ───────────────────────────────────────
  function _fillModalContent(step, idx, total) {
    const content = document.getElementById('tutorial-modal-content');
    if (!content) return;

    const c = _getStepContent(step);
    content.innerHTML =
      '<div class="tut-step-num">' + (idx + 1) + ' / ' + total + '</div>' +
      '<div class="tut-step-title">' + c.title + '</div>' +
      '<div class="tut-step-sub">' + c.subtitle + '</div>' +
      '<div class="tut-step-body">' + c.body + '</div>';

    // 2026-08-11修复（qa CONFIRMED 2）：跟同排 tutorial-view-more-btn / 跳过
    // 引导两个按钮统一走 i18n，避免英文模式下三个按钮中英混杂。若 Lang 未加载
    // （理论上不会发生，index.html 里 i18n.js 先于 tutorial.js 加载）兜底回退
    // 中文字面量，保证不会崩。
    const nextBtn = document.getElementById('tutorial-next-btn');
    if (nextBtn) {
      var isLast = (idx === total - 1);
      nextBtn.textContent = (typeof Lang !== 'undefined')
        ? Lang.t(isLast ? 'tutorial.complete' : 'tutorial.next')
        : (isLast ? '✦ 探索完成 ✦' : '下一个 →');
    }
  }

  function _getStepContent(step) {
    if (step.type === 'pillar')  return _pillarContent(step.col);
    if (step.type === 'shensha') return _shenshaContent(step.name);
    return { title: '命盘', subtitle: '', body: '' };
  }

  function _pillarContent(col) {
    const LABELS = { year:'年柱', month:'月柱', day:'日柱', hour:'时柱' };
    const p      = (_baziData && _baziData.pillars ? _baziData.pillars[col] : null) || {};
    const stem   = p.stem   || '—';
    const branch = p.branch || '—';
    var body = '';

    if (col === 'day' && _aiAnalysis && _aiAnalysis.step1_foundation && _aiAnalysis.step1_foundation.narrative) {
      var preview = _aiAnalysis.step1_foundation.narrative.slice(0, 100);
      body = '<p class="tut-text tut-ai-preview">' + preview + '…</p>';
    } else {
      var role     = PILLAR_ROLE[col] || '';
      var stemDesc = col === 'day' ? (STEM_SHORT[stem] || '') : '';
      body = '<p class="tut-text">' + role + '。' + stemDesc + '</p>' +
             '<p class="tut-hint">💡 点击完整报告获取 AI 深度解读</p>';
    }
    return { title: stem + branch, subtitle: LABELS[col], body: body };
  }

  function _shenshaContent(name) {
    // 2026-08-04 qa-reviewer复查修复（PLAUSIBLE P3）：与 js/analysis.js 的
    // SHENSHA_GOOD/SHENSHA_WARN 核对后发现"七杀/官符/丧门"三个神煞只在
    // analysis.js的SHENSHA_WARN里、这里的isWarn缺失（按中性处理），两处判定
    // 不一致。三者传统命理均属明确凶煞（七杀主刑克攻身、官符主官司诉讼、丧门
    // 主丧服哀戚），补入isWarn与analysis.js对齐；"驿马"在analysis.js一侧已
    // 移出SHENSHA_GOOD归为中性（驿马传统上主变动，吉凶随命局搭配而定，不是
    // 单纯吉神），这里本来就不在isGood/isWarn里，无需改动。
    var isGood = ['将星','禄神','红鸾','天乙','文昌','天德','月德','天厨'].indexOf(name) >= 0;
    var isWarn = ['亡神','劫煞','白虎','羊刃','孤辰','七杀','官符','丧门'].indexOf(name) >= 0;
    var tag    = isGood ? '✦ 吉神' : isWarn ? '⚠ 凶煞' : '◈ 中性';
    var desc   = SS_DESC[name] || name + '神煞，影响命运走向';
    var tagStyle = isGood
      ? 'color:#6FCF97;background:rgba(111,207,151,.1);border-color:rgba(111,207,151,.3)'
      : isWarn
        ? 'color:#EB5757;background:rgba(235,87,87,.1);border-color:rgba(235,87,87,.3)'
        : 'color:#c9a96e;background:rgba(201,169,110,.08);border-color:rgba(201,169,110,.2)';
    return {
      title:    name,
      subtitle: '<span style="font-size:10px;padding:2px 10px;border-radius:12px;border:1px solid;' + tagStyle + '">' + tag + '</span>',
      body:     '<p class="tut-text">' + desc + '</p>' +
                '<p class="tut-hint">' + (isWarn ? '💡 点击神煞标记可查看更多' : '💡 点击各标记深入了解') + '</p>',
    };
  }

  // ── 粒子庆祝动画 ─────────────────────────────────────────
  function _showCelebration() {
    var wrap   = document.createElement('div');
    wrap.className = 'tut-celebration';
    var colors = ['#c9a96e','#6FCF97','#63B3ED','#EB5757','#F2C94C','#e8e0d0'];
    for (var i = 0; i < 30; i++) {
      var p     = document.createElement('div');
      p.className = 'tut-particle';
      var angle = Math.random() * Math.PI * 2;
      var dist  = 80 + Math.random() * 160;
      p.style.cssText = [
        '--tx:' + Math.round(Math.cos(angle) * dist) + 'px',
        '--ty:' + Math.round(Math.sin(angle) * dist) + 'px',
        '--pc:' + colors[Math.floor(Math.random() * colors.length)],
        '--delay:' + (Math.random() * 0.18).toFixed(3) + 's',
      ].join(';');
      wrap.appendChild(p);
    }
    var text = document.createElement('div');
    text.className = 'tut-celebration-text';
    text.textContent = '✦ 命盘探索完成 ✦';
    wrap.appendChild(text);
    document.body.appendChild(wrap);
    setTimeout(function() { wrap.remove(); }, 1400);
  }

  // ── Toast ─────────────────────────────────────────────────
  function _showToast(msg) {
    var el = document.createElement('div');
    el.className = 'tut-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function() { el.classList.add('tut-toast-show'); });
    setTimeout(function() {
      el.classList.remove('tut-toast-show');
      setTimeout(function() { el.remove(); }, 500);
    }, 3500);
  }

  // ── 公开：AI 后到 → 刷新 Modal ───────────────────────────
  function updateAiContent(analysis) {
    _aiAnalysis = analysis;
    if (_active && _idx < _steps.length) {
      var modal = document.getElementById('tutorial-modal');
      if (modal && modal.classList.contains('tut-modal-show')) {
        _fillModalContent(_steps[_idx], _idx, _steps.length);
      }
    }
  }

  // ── 公开：判断引导是否已完成 ─────────────────────────────
  function isDone(baziData, gender) {
    if (!baziData) return false;
    var hash = _computeHash(baziData, gender);
    try { return !!localStorage.getItem('tutorial_done_' + hash); }
    catch(e) { return false; }
  }

  // ── 公开：暂停（"查看完整详解"打开 #zone-panel 前调用）──────
  // _active 保持不变，仅隐藏 overlay（Modal/提示条/进度点/右上角跳过按钮），
  // 让 #zone-panel 独占视觉焦点，避免半透明 overlay 背景压暗面板内容。
  function pause() {
    if (!_active || _paused) return;
    _paused = true;
    _hideModal();
    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // ── 公开：恢复（#zone-panel 关闭后调用）──────────────────
  // 非 pause 状态下调用是安全的空操作，不会误触发。重新填充Modal内容——若
  // AI内容在暂停期间才经 updateAiContent() 到达，这里顺带一并体现最新内容。
  function resume() {
    if (!_active || !_paused) return;
    _paused = false;
    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) overlay.classList.remove('hidden');
    if (_idx < _steps.length) {
      _fillModalContent(_steps[_idx], _idx, _steps.length);
      _showModalCard();
    }
  }

  // ── 公开：当前步骤对应的 zoneKey（供"查看完整详解"按钮转发）──
  function getCurrentZoneKey() {
    if (!_active || _idx >= _steps.length) return null;
    return _labelKey(_steps[_idx]);
  }

  // ── 公开：语言切换后刷新非 data-i18n 动态文案（2026-08-11新增，待办23）──
  // #tutorial-next-btn 的文字由 _fillModalContent() 每步动态写入（"下一个"
  // vs "探索完成"取决于当前是否最后一步），不是走静态 data-i18n，Lang.apply()
  // 管不到。引导 Modal 开着时 #tutorial-overlay 是 pointer-events:none，用户
  // 点得到顶栏语言切换按钮，此前需要点"下一个"进入下一步才会自愈显示新语言。
  // Lang.setLang() 已有 langChanged 事件广播（main-new.js 里八字表等模块也是
  // 靠这个事件刷新动态内容，这里沿用同一约定），监听后仅刷新按钮文字——步骤
  // 正文（AI预览+静态字典内容）维持既有"不跟随语言切换"约定不动。
  function refreshLabels() {
    if (!_active || _idx >= _steps.length) return;
    const nextBtn = document.getElementById('tutorial-next-btn');
    if (nextBtn) {
      const isLast = (_idx === _steps.length - 1);
      nextBtn.textContent = (typeof Lang !== 'undefined')
        ? Lang.t(isLast ? 'tutorial.complete' : 'tutorial.next')
        : (isLast ? '✦ 探索完成 ✦' : '下一个 →');
    }
  }
  window.addEventListener('langChanged', refreshLabels);

  function reset() { if (_active) _cleanup(); }
  function isActive() { return _active; }

  return {
    start, next, skip, reset, isActive, isDone, updateAiContent,
    pause, resume, getCurrentZoneKey, refreshLabels,
  };
})();
