/**
 * 司马八字 · 新手引导系统 tutorial.js
 *
 * 流程：
 *   Tutorial.start(baziData, gender)
 *     → 锁定 OrbitControls
 *     → 相机飞到每个步骤位置
 *     → 高亮对应标签
 *     → 显示引导弹窗（底部滑出）
 *     → 用户点"下一个 →" 或 "跳过引导 ×"
 *
 * localStorage 标记：tutorial_done_[hash] = '1'
 * 新老用户判断：main-new.js 读取此标记
 *
 * 公开 API：
 *   Tutorial.start(baziData, gender)
 *   Tutorial.next()
 *   Tutorial.skip()
 *   Tutorial.reset()
 *   Tutorial.isActive() → boolean
 *   Tutorial.updateAiContent(analysis) → 用于 AI 内容后到时刷新
 *   Tutorial.isDone(baziData, gender) → boolean（供 main-new.js 判断新老用户）
 */

const Tutorial = (() => {

  // ── 相机飞行配置（每个步骤的 camPos + lookAt）────────────
  const STEP_CAM = {
    pillar_day   : { cam: [0, 9, 11],   look: [0, 3.5, 0] },
    pillar_year  : { cam: [-1, 7, 6],   look: [-3.5, 1.5, -3] },
    pillar_month : { cam: [1, 7, 6],    look: [3.5, 1.5, -3] },
    pillar_hour  : { cam: [0, 6, 13],   look: [0, 1.5, 3.8] },
    shensha      : { cam: [0, 12, 18],  look: [0, 0, 0] },   // 神煞 overview
  };

  // ── 天干短描述（fallback 用）──────────────────────────────
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
  let _active      = false;
  let _steps       = [];
  let _idx         = 0;
  let _baziData    = null;
  let _gender      = '男';
  let _aiAnalysis  = null;
  let _baziHash    = '';
  let _nextBtnTimer= null;

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

  // ── 构建步骤列表 ─────────────────────────────────────────
  function _buildSteps(baziData) {
    const ss = baziData.shenshe || baziData.shensha || [];
    const steps = [
      { type: 'pillar', col: 'day' },
      { type: 'pillar', col: 'year' },
      { type: 'pillar', col: 'month' },
      { type: 'pillar', col: 'hour' },
    ];
    if (ss.length > 0) {
      steps.push({ type: 'shensha', name: ss[0] });
    }
    return steps;
  }

  function _stepKey(step) {
    if (step.type === 'pillar') return 'pillar_' + step.col;
    if (step.type === 'shensha') return 'shensha';
    return 'unknown';
  }

  // ── 公开：启动引导 ───────────────────────────────────────
  function start(baziData, gender) {
    if (!baziData) return;
    _active     = true;
    _baziData   = baziData;
    _gender     = gender || '男';
    _steps      = _buildSteps(baziData);
    _idx        = 0;
    _baziHash   = _computeHash(baziData, gender);
    _aiAnalysis = null;  // 等待 AI 后到

    // 显示引导覆盖层
    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) overlay.classList.remove('hidden');

    // 锁定 OrbitControls，停止自转
    if (typeof IslandLoader !== 'undefined') {
      IslandLoader.setControlsEnabled(false);
      IslandLoader.stopAutoRotate();
    }

    _showStep(0);
  }

  // ── 公开：下一步 ─────────────────────────────────────────
  function next() {
    if (!_active) return;
    _idx++;
    if (_idx >= _steps.length) {
      _complete();
    } else {
      _showStep(_idx);
    }
  }

  // ── 公开：跳过 ───────────────────────────────────────────
  function skip() {
    if (!_active) return;
    _markDone();
    _cleanup();
  }

  // ── 内部：完成引导 ───────────────────────────────────────
  function _complete() {
    _markDone();
    _cleanup();
    _showToast('✦ 引导完成！点击岛屿标记开始探索 ✦');
  }

  function _markDone() {
    if (_baziHash) {
      try {
        localStorage.setItem('tutorial_done_' + _baziHash, '1');
      } catch(e) {}
    }
  }

  function _cleanup() {
    _active = false;
    clearTimeout(_nextBtnTimer);
    _nextBtnTimer = null;

    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) overlay.classList.add('hidden');

    if (typeof IslandAnnotate !== 'undefined') IslandAnnotate.clearHighlight();

    if (typeof IslandLoader !== 'undefined') {
      IslandLoader.setControlsEnabled(true);
      IslandLoader.startAutoRotate();
    }
  }

  // ── 显示某个步骤 ─────────────────────────────────────────
  function _showStep(idx) {
    const step  = _steps[idx];
    const total = _steps.length;

    // 更新进度点
    _renderDots(idx, total);

    // 隐藏"下一个"按钮，等相机到位后再显示
    const nextBtn = document.getElementById('tutorial-next-btn');
    if (nextBtn) {
      nextBtn.classList.add('hidden');
      nextBtn.classList.remove('tut-next-bounce');
    }
    clearTimeout(_nextBtnTimer);

    // 飞行相机
    const camCfg = STEP_CAM[_stepKey(step)] || STEP_CAM.shensha;
    if (typeof IslandLoader !== 'undefined' && typeof THREE !== 'undefined') {
      const camPos  = new THREE.Vector3(...camCfg.cam);
      const lookAt  = new THREE.Vector3(...camCfg.look);
      IslandLoader.flyTo(camPos, lookAt, 1200, () => {
        // 相机到位后，1.5s 后弹出"下一个"按钮
        _nextBtnTimer = setTimeout(() => {
          const btn = document.getElementById('tutorial-next-btn');
          if (btn && _active) {
            btn.classList.remove('hidden');
            btn.classList.add('tut-next-bounce');
            setTimeout(() => btn.classList.remove('tut-next-bounce'), 800);
          }
        }, 1500);
      });
    } else {
      // 降级：没有飞行，直接显示按钮
      _nextBtnTimer = setTimeout(() => {
        const btn = document.getElementById('tutorial-next-btn');
        if (btn && _active) btn.classList.remove('hidden');
      }, 1000);
    }

    // 高亮当前标签
    if (typeof IslandAnnotate !== 'undefined') {
      IslandAnnotate.clearHighlight();
      if (step.type === 'pillar') IslandAnnotate.highlightLabel('pillar_' + step.col);
      if (step.type === 'shensha') IslandAnnotate.highlightLabel('shensha_' + step.name);
    }

    // 渲染弹窗内容
    _renderModal(step, idx, total);
  }

  // ── 渲染进度点 ───────────────────────────────────────────
  function _renderDots(idx, total) {
    const el = document.getElementById('tutorial-dots');
    if (!el) return;
    el.innerHTML = Array.from({ length: total }, (_, i) => {
      const cls = i === idx ? 'active' : i < idx ? 'done' : '';
      return `<span class="tut-dot ${cls}"></span>`;
    }).join('');
  }

  // ── 渲染弹窗内容 ─────────────────────────────────────────
  function _renderModal(step, idx, total) {
    const content = document.getElementById('tutorial-modal-content');
    if (!content) return;

    const c = _getStepContent(step);

    content.innerHTML = `
      <div class="tut-step-num">${idx + 1} / ${total}</div>
      <div class="tut-step-title">${c.title}</div>
      <div class="tut-step-sub">${c.subtitle}</div>
      <div class="tut-step-body">${c.body}</div>
    `;

    // 更新按钮文字
    const nextBtn = document.getElementById('tutorial-next-btn');
    if (nextBtn) {
      nextBtn.textContent = (idx === total - 1) ? '开始探索 →' : '下一个 →';
    }
  }

  // ── 步骤内容生成 ─────────────────────────────────────────
  function _getStepContent(step) {
    if (step.type === 'pillar') return _pillarContent(step.col);
    if (step.type === 'shensha') return _shenshaContent(step.name);
    return { title: '命盘', subtitle: '', body: '' };
  }

  function _pillarContent(col) {
    const LABELS = { year:'年柱', month:'月柱', day:'日柱', hour:'时柱' };
    const p      = (_baziData?.pillars || {})[col] || {};
    const stem   = p.stem   || '—';
    const branch = p.branch || '—';

    let body = '';

    // 优先 AI 内容
    if (_aiAnalysis?.four_pillars?.[col]) {
      body = `<p class="tut-text">${_aiAnalysis.four_pillars[col]}</p>`;
      if (col === 'day' && _aiAnalysis.day_master_reading) {
        const preview = _aiAnalysis.day_master_reading.slice(0, 100);
        body += `<p class="tut-text tut-ai-preview">${preview}…</p>`;
      }
    } else {
      // 规则引擎 fallback
      const role = PILLAR_ROLE[col] || '';
      const stemDesc = col === 'day' ? (STEM_SHORT[stem] || '') : '';
      body = `<p class="tut-text">${role}。${stemDesc}</p>
              <p class="tut-hint">💡 点击完整报告获取 AI 深度解读</p>`;
    }

    return {
      title:    `${stem}${branch}`,
      subtitle: LABELS[col],
      body,
    };
  }

  function _shenshaContent(name) {
    const isGood = ['将星','禄神','红鸾','天乙','文昌','天德','月德','天厨'].includes(name);
    const isWarn = ['亡神','劫煞','白虎','羊刃','孤辰'].includes(name);
    const tag    = isGood ? '✦ 吉神' : isWarn ? '⚠ 凶煞' : '◈ 中性';
    const desc   = SS_DESC[name] || name + '神煞，影响命运走向';

    const tagStyle = isGood
      ? 'color:#6FCF97;background:rgba(111,207,151,.1);border-color:rgba(111,207,151,.3)'
      : isWarn
        ? 'color:#EB5757;background:rgba(235,87,87,.1);border-color:rgba(235,87,87,.3)'
        : 'color:#c9a96e;background:rgba(201,169,110,.08);border-color:rgba(201,169,110,.2)';

    return {
      title:    name,
      subtitle: `<span style="font-size:10px;padding:2px 10px;border-radius:12px;border:1px solid;${tagStyle}">${tag}</span>`,
      body:     `<p class="tut-text">${desc}</p>
                 <p class="tut-hint">${isWarn ? '💡 点击神煞标记可查看更多' : '💡 点击各标记深入了解'}</p>`,
    };
  }

  // ── Toast 提示 ───────────────────────────────────────────
  function _showToast(msg) {
    const el = document.createElement('div');
    el.className = 'tut-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('tut-toast-show'));
    setTimeout(() => {
      el.classList.remove('tut-toast-show');
      setTimeout(() => el.remove(), 500);
    }, 3000);
  }

  // ── 公开：AI 内容后到，刷新当前步骤 ─────────────────────
  function updateAiContent(analysis) {
    _aiAnalysis = analysis;
    if (_active && _idx < _steps.length) {
      _renderModal(_steps[_idx], _idx, _steps.length);
    }
  }

  // ── 公开：判断此命盘是否已完成引导（供 main-new.js 调用）─
  function isDone(baziData, gender) {
    if (!baziData) return false;
    const hash = _computeHash(baziData, gender);
    try {
      return !!localStorage.getItem('tutorial_done_' + hash);
    } catch(e) { return false; }
  }

  // ── 公开：重置（切换岛屿时清理状态）─────────────────────
  function reset() {
    if (_active) _cleanup();
  }

  function isActive() { return _active; }

  return { start, next, skip, reset, isActive, isDone, updateAiContent };
})();
