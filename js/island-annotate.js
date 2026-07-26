/**
 * 司马八字 · 岛屿标注系统 island-annotate.js
 *
 * 功能：
 *   在 Three.js 场景上叠加 CSS2DLabel 标注：
 *   - 四柱石碑标签（年/月/日/时）
 *   - 神煞标记（点击 → 分析面板）
 *   - 空亡区域提示
 *
 * 依赖：CSS2DRenderer（随 Three.js r128 examples 加载）
 */

const IslandAnnotate = (() => {

  // 四柱在岛屿上的相对世界坐标（岛屿缩放到10单位）
  const PILLAR_POSITIONS = {
    year : new THREE.Vector3(-3.5, 1.5, -3.0),
    month: new THREE.Vector3( 3.5, 1.5, -3.0),
    day  : new THREE.Vector3( 0.0, 3.5,  0.0),   // 日主 = 中心最高点
    hour : new THREE.Vector3( 0.0, 1.5,  3.8),
  };

  const PILLAR_LABELS = { year:'年柱', month:'月柱', day:'日柱', hour:'时柱' };

  // 神煞在岛屿边缘的相对位置（按时钟方向分布）
  const SHENSHA_POSITIONS = [
    new THREE.Vector3(-4.5, 0.5,  0.0),
    new THREE.Vector3(-3.2, 0.5,  3.2),
    new THREE.Vector3( 0.0, 0.5,  4.5),
    new THREE.Vector3( 3.2, 0.5,  3.2),
    new THREE.Vector3( 4.5, 0.5,  0.0),
    new THREE.Vector3( 3.2, 0.5, -3.2),
  ];

  let _labels = [];    // 所有CSS2DObject引用

  // ── 主入口：创建所有标注 ─────────────────────────────────
  function attach(scene, baziData) {
    if (typeof THREE.CSS2DObject === 'undefined') {
      _fallbackHtmlOverlay(baziData);
      return;
    }
    _clearLabels(scene);

    const p  = baziData.pillars  || {};
    const ss = baziData.shenshe  || [];
    const kw = baziData.kongwang || [];

    // 四柱标签
    Object.entries(PILLAR_POSITIONS).forEach(([col, pos]) => {
      const pillar = p[col] || {};
      const label  = _makePillarLabel(
        PILLAR_LABELS[col],
        pillar.stem   || '—',
        pillar.branch || '—',
        (baziData.nayin||{})[col] || '',
        col === 'day',
        col,
        baziData
      );
      label.position.copy(pos);
      scene.add(label);
      _labels.push(label);
    });

    // 神煞标记（最多6个）
    ss.slice(0, 6).forEach((name, i) => {
      const pos   = SHENSHA_POSITIONS[i];
      const label = _makeShenshaLabel(name, baziData);
      label.position.copy(pos);
      scene.add(label);
      _labels.push(label);
    });

    // 空亡虚空提示
    if (kw.length) {
      const label = _makeKongwangLabel(kw);
      label.position.set(-4.0, 2.5, -4.0);
      scene.add(label);
      _labels.push(label);
    }
  }

  // ── 四柱标签 DOM ─────────────────────────────────────────
  function _makePillarLabel(title, stem, branch, nayin, isDay, col, baziData) {
    const div = document.createElement('div');
    div.className = 'island-label pillar-label' + (isDay ? ' day-label' : '');
    div.innerHTML = `
      <div class="label-title">${title}</div>
      <div class="label-stem" style="color:${_stemColor(stem)}">${stem}</div>
      <div class="label-branch">${branch}</div>
      ${nayin ? `<div class="label-nayin">${nayin}</div>` : ''}
    `;
    div.addEventListener('click', () => {
      UIEffects.labelPulse(div);
      if (window.onIslandZoneClick) window.onIslandZoneClick('pillar_' + col, baziData);
    });

    const obj = new THREE.CSS2DObject(div);
    return obj;
  }

  // ── 神煞标记 DOM ─────────────────────────────────────────
  function _makeShenshaLabel(name, baziData) {
    const isGood = ['将星','禄神','红鸾','天乙','文昌','天德','月德','天厨','福星贵人'].includes(name);
    const isWarn = ['亡神','劫煞','白虎','羊刃','孤辰'].includes(name);
    const cls    = isGood ? 'ss-good' : isWarn ? 'ss-warn' : 'ss-neutral';

    const div = document.createElement('div');
    div.className = `island-label shensha-label ${cls}`;
    div.innerHTML = `<span class="ss-icon">${_ssIcon(name)}</span><span class="ss-name">${name}</span>`;
    div.addEventListener('click', () => {
      UIEffects.labelPulse(div);
      if (window.onIslandZoneClick) window.onIslandZoneClick('shensha_' + name, baziData);
    });

    return new THREE.CSS2DObject(div);
  }

  // ── 空亡标记 DOM ─────────────────────────────────────────
  function _makeKongwangLabel(kw) {
    const div = document.createElement('div');
    div.className = 'island-label kongwang-label';
    div.innerHTML = `<span>空亡</span><span style="color:#EB5757;margin-left:4px">${kw.join('、')}</span>`;
    return new THREE.CSS2DObject(div);
  }

  // ── fallback：无 CSS2DRenderer 时用 HTML overlay ─────────
  function _fallbackHtmlOverlay(baziData) {
    const existing = document.getElementById('island-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'island-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:20';

    const p = baziData.pillars || {};
    // 简单文字提示放在角落
    const info = document.createElement('div');
    info.style.cssText = 'position:absolute;top:60px;left:16px;display:flex;flex-direction:column;gap:6px';
    const cols = ['year','month','day','hour'];
    const labels = { year:'年',month:'月',day:'日',hour:'时' };
    cols.forEach(col => {
      const pl = p[col] || {};
      const tag = document.createElement('div');
      tag.style.cssText = `
        background:rgba(8,8,20,.85);border:1px solid rgba(201,169,110,.3);
        border-radius:6px;padding:4px 10px;font-size:11px;
        color:${_stemColor(pl.stem)};letter-spacing:1px;
        pointer-events:auto;cursor:pointer;
      `;
      tag.textContent = `${labels[col]}｜${pl.stem||'—'}${pl.branch||'—'}`;
      tag.addEventListener('click', () => {
        if (window.onIslandZoneClick) window.onIslandZoneClick('pillar_' + col, baziData);
      });
      info.appendChild(tag);
    });
    overlay.appendChild(info);
    document.getElementById('screen-island')?.appendChild(overlay);
  }

  // ── 清理 ─────────────────────────────────────────────────
  function _clearLabels(scene) {
    _labels.forEach(l => scene.remove(l));
    _labels = [];
    const existing = document.getElementById('island-overlay');
    if (existing) existing.remove();
  }

  function detach(scene) { _clearLabels(scene); }

  // ── 工具 ─────────────────────────────────────────────────
  function _stemColor(stem) {
    const map = {
      '甲':'#6FCF97','乙':'#6FCF97',
      '丙':'#EB5757','丁':'#EB5757',
      '戊':'#F2C94C','己':'#F2C94C',
      '庚':'#C8C8D8','辛':'#C8C8D8',
      '壬':'#6EB5FF','癸':'#6EB5FF',
    };
    return map[stem] || '#e8e0d0';
  }

  function _ssIcon(name) {
    const icons = {
      '将星':'⚔','禄神':'💰','红鸾':'🌸','天乙':'🌟','文昌':'📚',
      '驿马':'🐎','亡神':'💀','劫煞':'⚡','白虎':'🐯','羊刃':'🗡',
      '孤辰':'🌙','天德':'☀','月德':'🌕','红艳':'🌹','天喜':'🎉',
    };
    return icons[name] || '✦';
  }

  return { attach, detach };
})();
