/**
 * 司马八字 · 视觉特效系统 effects.js
 *
 * 功能：
 *   全局波纹 Ripple   — 所有按钮点击时金色涟漪
 *   粒子爆发 Burst    — 提交表单时金色星粒向外扩散
 *   岛屿脉冲 Pulse    — 点击四柱/神煞标签时发光脉冲环
 *   音频旋转 Spin     — 切换 BGM/SFX 时按钮旋转
 *   徽标弹跳 BadgePop — 任务数量变化时弹跳动画
 *   粒子飘落 Confetti — 任务完成时金色纸屑
 */

const UIEffects = (() => {

  // ════════════════════════════════════════════════════════
  // ── 1. 全局波纹（Ripple）────────────────────────────────
  //    自动挂载到所有 button / .gender-btn / #bazi-table-toggle
  // ════════════════════════════════════════════════════════
  function _addRipple(el, e) {
    const rect = el.getBoundingClientRect();
    const touch = e.touches && e.touches[0];
    const cx = (touch ? touch.clientX : e.clientX) - rect.left;
    const cy = (touch ? touch.clientY : e.clientY) - rect.top;

    const dot = document.createElement('span');
    dot.className = 'fx-ripple';
    dot.style.left = cx + 'px';
    dot.style.top  = cy + 'px';

    // 动态 scale：让波纹能覆盖整个按钮
    const maxR = Math.sqrt(
      Math.max(cx, el.offsetWidth  - cx) ** 2 +
      Math.max(cy, el.offsetHeight - cy) ** 2
    );
    dot.style.setProperty('--r', (maxR * 2) + 'px');

    el.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove(), { once: true });
  }

  // 全局事件委托：匹配所有可点击元素
  const RIPPLE_SELECTOR = 'button, .gender-btn';
  document.addEventListener('pointerdown', e => {
    const target = e.target.closest(RIPPLE_SELECTOR);
    if (target) {
      // 保证 position:relative + overflow:hidden（CSS 已设置，防万一）
      const pos = window.getComputedStyle(target).position;
      if (pos === 'static') target.style.position = 'relative';
      _addRipple(target, e);
    }
  }, true);

  // ════════════════════════════════════════════════════════
  // ── 2. 提交按钮粒子爆发（Burst）────────────────────────
  // ════════════════════════════════════════════════════════
  function submitBurst(btnEl) {
    if (!btnEl) return;
    const rect = btnEl.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;
    const N    = 14;

    for (let i = 0; i < N; i++) {
      const spark = document.createElement('div');
      spark.className = 'fx-spark';
      const angle = (i / N) * Math.PI * 2 + Math.random() * 0.3;
      const dist  = 35 + Math.random() * 50;
      const size  = 3 + Math.random() * 4;
      spark.style.cssText = `
        left:${cx}px; top:${cy}px;
        width:${size}px; height:${size}px;
        --tx:${(Math.cos(angle) * dist).toFixed(1)}px;
        --ty:${(Math.sin(angle) * dist).toFixed(1)}px;
        background:${Math.random() > 0.45 ? '#c9a96e' : 'rgba(255,255,220,.9)'};
        border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
        animation-duration:${0.4 + Math.random() * 0.25}s;
      `;
      document.body.appendChild(spark);
      spark.addEventListener('animationend', () => spark.remove(), { once: true });
    }

    // 按钮本体：短暂缩放闪光
    btnEl.classList.add('fx-btn-burst');
    btnEl.addEventListener('animationend', () => btnEl.classList.remove('fx-btn-burst'), { once: true });
  }

  // ════════════════════════════════════════════════════════
  // ── 3. 岛屿标签点击脉冲环（Pulse）──────────────────────
  // ════════════════════════════════════════════════════════
  function labelPulse(labelEl) {
    if (!labelEl) return;
    labelEl.classList.add('fx-label-pulse');
    labelEl.addEventListener('animationend', () => labelEl.classList.remove('fx-label-pulse'), { once: true });
  }

  // ════════════════════════════════════════════════════════
  // ── 4. 音频按钮旋转（Spin）──────────────────────────────
  // ════════════════════════════════════════════════════════
  function audioSpin(btnEl) {
    if (!btnEl) return;
    btnEl.classList.remove('fx-spin'); // 强制重启动画
    void btnEl.offsetWidth;
    btnEl.classList.add('fx-spin');
    btnEl.addEventListener('animationend', () => btnEl.classList.remove('fx-spin'), { once: true });
  }

  // ════════════════════════════════════════════════════════
  // ── 5. 任务徽标弹跳（BadgePop）──────────────────────────
  // ════════════════════════════════════════════════════════
  function badgePop() {
    const badge = document.getElementById('task-badge');
    if (!badge) return;
    badge.classList.remove('fx-badge-pop');
    void badge.offsetWidth;
    badge.classList.add('fx-badge-pop');
    badge.addEventListener('animationend', () => badge.classList.remove('fx-badge-pop'), { once: true });
  }

  // ════════════════════════════════════════════════════════
  // ── 6. 任务完成金色纸屑（Confetti）─────────────────────
  // ════════════════════════════════════════════════════════
  function confetti(count = 20) {
    const colors = ['#c9a96e','#e8d48c','#f5f0e0','#6fcf97','#63b3ed'];
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      c.className = 'fx-confetti';
      const size  = 4 + Math.random() * 6;
      const startX = 20 + Math.random() * 60; // vw
      const fallY  = 60 + Math.random() * 40; // vh
      const sway   = (Math.random() - 0.5) * 80;
      const dur    = 0.9 + Math.random() * 0.6;
      c.style.cssText = `
        left:${startX}vw; top:-10px;
        width:${size}px; height:${size}px;
        background:${colors[i % colors.length]};
        border-radius:${Math.random() > 0.5 ? '50%' : '1px'};
        transform:rotate(${Math.random()*360}deg);
        --fall:${fallY}vh; --sway:${sway}px;
        animation-duration:${dur}s;
        animation-delay:${Math.random() * 0.3}s;
      `;
      document.body.appendChild(c);
      c.addEventListener('animationend', () => c.remove(), { once: true });
    }
  }

  // ════════════════════════════════════════════════════════
  // ── 7. 按钮按压反馈（全局 active 缩放）─────────────────
  //    通过 CSS :active 实现，无需 JS（见 index.html）
  // ════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════
  // ── 8. 灵气增加浮字（Float Text）────────────────────────
  // ════════════════════════════════════════════════════════
  function floatText(text, color = '#c9a96e') {
    const el = document.getElementById('hud-spirit');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const div = document.createElement('div');
    div.className = 'fx-float-text';
    div.textContent = text;
    div.style.cssText = `
      left:${rect.left + rect.width / 2}px;
      top:${rect.top}px;
      color:${color};
    `;
    document.body.appendChild(div);
    div.addEventListener('animationend', () => div.remove(), { once: true });
  }

  return { submitBurst, labelPulse, audioSpin, badgePop, confetti, floatText };
})();
