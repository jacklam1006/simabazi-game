/**
 * 司马八字 · 音频系统 audio.js
 *
 * BGM（Web Audio API 合成）：
 *   screen-form    → "天命序章"  — 神秘宁静，五行低鸣
 *   screen-loading → "天机运转"  — 宇宙脉冲，层层上升
 *   screen-island  → "命格世界"  — 东方五声琶音 + 高音灵铃
 *
 * SFX（Web Audio API 合成）：
 *   ui_click / submit / zone_click /
 *   panel_open / panel_close / report_open /
 *   task_complete / spirit_gain / decoration_unlock /
 *   checkin / island_ready / error
 *
 * 后续升级：将 MP3 文件放入 assets/bgm/，音频系统会自动优先使用文件
 */

const AudioManager = (() => {

  // ── 状态 ─────────────────────────────────────────────────
  let _ctx         = null;
  let _master      = null;   // 总音量 GainNode
  let _bgmBus      = null;   // BGM 总线
  let _sfxBus      = null;   // SFX 总线
  let _bgmNodes    = [];     // 当前BGM所有振荡器引用，用于停止
  let _bgmTimers   = [];     // 所有 setTimeout 引用
  let _bgmEnabled  = true;
  let _sfxEnabled  = true;
  let _inited      = false;
  let _curScene    = null;
  let _firstTouch  = false;

  // 五声音阶频率表（C 调）
  const F = {
    C1:32.7,  G1:49.0,
    C2:65.4,  G2:98.0,
    C3:130.8, D3:146.8, E3:164.8, G3:196.0, A3:220.0,
    C4:261.6, D4:293.7, E4:329.6, G4:392.0, A4:440.0,
    C5:523.3, D5:587.3, E5:659.3, G5:784.0, A5:880.0,
    C6:1046.5,
  };

  // ── 初始化 ───────────────────────────────────────────────
  function _init() {
    if (_inited) return true;
    try {
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('[Audio] Web Audio API 不可用');
      return false;
    }
    _master = _ctx.createGain();
    _master.gain.value = 0.65;
    _master.connect(_ctx.destination);

    _bgmBus = _ctx.createGain();
    _bgmBus.gain.value = 0;
    _bgmBus.connect(_master);

    _sfxBus = _ctx.createGain();
    _sfxBus.gain.value = 1.0;
    _sfxBus.connect(_master);

    _inited = true;
    return true;
  }

  function _resume() {
    if (_ctx && _ctx.state === 'suspended') _ctx.resume();
  }

  // ── 工具：音量渐变 ──────────────────────────────────────
  function _ramp(param, to, dur) {
    const t = _ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(to, t + dur);
  }

  // 创建并注册 BGM 振荡器
  function _bgmOsc(type, freq, detune = 0) {
    const osc = _ctx.createOscillator();
    const g   = _ctx.createGain();
    osc.type           = type;
    osc.frequency.value = freq;
    osc.detune.value   = detune;
    g.gain.value       = 0;
    osc.connect(g);
    g.connect(_bgmBus);
    osc.start();
    _bgmNodes.push({ osc, g });
    return { osc, g };
  }

  // 创建并注册 LFO（连接到 AudioParam）
  function _lfo(rate, depth, target) {
    const lfo  = _ctx.createOscillator();
    const lfoG = _ctx.createGain();
    lfo.frequency.value = rate;
    lfoG.gain.value     = depth;
    lfo.connect(lfoG);
    lfoG.connect(target);
    lfo.start();
    _bgmNodes.push({ osc: lfo, g: lfoG });
  }

  // 停止所有 BGM
  function _stopBgm() {
    _bgmTimers.forEach(t => clearTimeout(t));
    _bgmTimers = [];
    _bgmNodes.forEach(n => { try { n.osc.stop(0); } catch (_) {} });
    _bgmNodes = [];
  }

  // ── 定时器工具（自动注册到 _bgmTimers） ────────────────
  function _later(fn, ms) {
    _bgmTimers.push(setTimeout(fn, ms));
  }

  // ── 单次旋律音（不注册到 _bgmNodes，自然消亡） ─────────
  function _note(freq, vol, attack, decay, type = 'triangle') {
    const osc = _ctx.createOscillator();
    const g   = _ctx.createGain();
    osc.type           = type;
    osc.frequency.value = freq;
    const t = _ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g);
    g.connect(_bgmBus);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  // ════════════════════════════════════════════════════════
  // ── 简易混响（延迟叠加模拟空间感） ──────────────────────
  function _reverb(src, wet = 0.35) {
    if (!_ctx) return src;
    const delay1 = _ctx.createDelay(0.5);
    const delay2 = _ctx.createDelay(0.5);
    const fb1    = _ctx.createGain();
    const fb2    = _ctx.createGain();
    const mix    = _ctx.createGain();
    delay1.delayTime.value = 0.13;
    delay2.delayTime.value = 0.23;
    fb1.gain.value = 0.28;
    fb2.gain.value = 0.20;
    mix.gain.value = wet;
    src.connect(delay1); delay1.connect(fb1); fb1.connect(delay1);
    src.connect(delay2); delay2.connect(fb2); fb2.connect(delay2);
    delay1.connect(mix); delay2.connect(mix);
    mix.connect(_bgmBus);
  }

  // ── BGM 场景1：心净如水（表单页）─────────────────────
  //    治愈风：颂钵低鸣 + 极慢五声旋律 + 混响空间
  // ════════════════════════════════════════════════════════
  function _bgmForm() {
    // 颂钵风 drone：极软正弦叠层，带微颤
    const bed = [
      { freq: F.C2, type: 'sine', vol: 0.10, detune:  0,  vib: 0.04, vd: F.C2*0.003 },
      { freq: F.G2, type: 'sine', vol: 0.07, detune:  3,  vib: 0.03, vd: F.G2*0.003 },
      { freq: F.C3, type: 'sine', vol: 0.05, detune: -2,  vib: 0.05, vd: F.C3*0.002 },
      { freq: F.E3, type: 'sine', vol: 0.03, detune:  5,  vib: 0.04, vd: F.E3*0.002 },
    ];
    bed.forEach(n => {
      const node = _bgmOsc(n.type, n.freq, n.detune);
      _ramp(node.g.gain, n.vol, 5.0);   // 极慢淡入
      _lfo(n.vib, n.vd, node.osc.frequency);
      _reverb(node.g, 0.4);
    });

    // 极慢五声旋律：每 12~18 秒出现一个长音
    const melSeq = [F.G4, F.E4, F.C4, F.A3, F.G3, F.A3, F.C4, F.E4, F.G4, F.A4];
    let mIdx = 0;
    function _sched() {
      _note(melSeq[mIdx % melSeq.length], 0.055, 1.2, 6.0, 'sine');
      mIdx++;
      _later(_sched, 12000 + Math.random() * 6000);
    }
    _later(_sched, 6000);

    // 轻柔泛音点缀：随机高泛音，极轻
    const overtones = [F.C5, F.E5, F.G5, F.A5];
    function _overtone() {
      _note(overtones[Math.floor(Math.random() * overtones.length)], 0.025, 0.8, 5.0, 'sine');
      _later(_overtone, 16000 + Math.random() * 10000);
    }
    _later(_overtone, 10000);
  }

  // ════════════════════════════════════════════════════════
  // ── BGM 场景2：气息流转（Loading 页）──────────────────
  //    温柔期待：柔和上升 + 呼吸感脉冲，不紧张
  // ════════════════════════════════════════════════════════
  function _bgmLoading() {
    // 柔和底音
    const r1 = _bgmOsc('sine', F.C2, 0);
    const r2 = _bgmOsc('sine', F.G2, -4);
    _ramp(r1.g.gain, 0.12, 3.0);
    _ramp(r2.g.gain, 0.07, 4.0);
    _lfo(0.07, F.C2 * 0.004, r1.osc.frequency);
    _reverb(r1.g, 0.35);

    // 呼吸感：音量缓慢起伏
    const breathGain = _ctx.createGain();
    breathGain.gain.value = 0.8;
    _lfo(0.12, 0.15, breathGain.gain);

    // 柔和上升序列：每隔 3s 一个长音，温柔不急迫
    const riseSeq = [F.C3, F.E3, F.G3, F.A3, F.C4, F.E4, F.G4];
    let pIdx = 0;
    function _pulse() {
      const freq = riseSeq[Math.min(pIdx, riseSeq.length - 1)];
      pIdx++;
      _note(freq, 0.10, 0.8, 3.5, 'sine');
      if (pIdx < riseSeq.length) {
        _later(_pulse, 3200);
      } else {
        // 到顶后循环轻音
        _later(function _top() {
          _note(riseSeq[Math.floor(Math.random() * 3) + 4], 0.06, 1.0, 4.0, 'sine');
          _later(_top, 5000 + Math.random() * 3000);
        }, 3000);
      }
    }
    _later(_pulse, 1500);
  }

  // ════════════════════════════════════════════════════════
  // ── BGM 场景3：灵境（岛屿页）──────────────────────────
  //    治愈自然：暖音 drone + 慢速琶音 + 水晶灵铃
  // ════════════════════════════════════════════════════════
  function _bgmIsland() {
    // 温暖 drone 层
    const drones = [
      { freq: F.C2, type: 'sine', vol: 0.09, detune:  0, vib: 0.04, vd: F.C2*0.003 },
      { freq: F.G2, type: 'sine', vol: 0.06, detune:  3, vib: 0.03, vd: F.G2*0.003 },
      { freq: F.C3, type: 'sine', vol: 0.04, detune: -2, vib: 0.05, vd: F.C3*0.002 },
    ];
    drones.forEach(n => {
      const node = _bgmOsc(n.type, n.freq, n.detune);
      _ramp(node.g.gain, n.vol, 4.0);
      _lfo(n.vib, n.vd, node.osc.frequency);
      _reverb(node.g, 0.45);
    });

    // 慢速五声琶音：每 2s 一音，极柔
    const arpSeq = [F.C4, F.E4, F.G4, F.A4, F.C5, F.A4, F.G4, F.E4];
    let aIdx = 0;
    function _arp() {
      const osc = _ctx.createOscillator();
      const g   = _ctx.createGain();
      osc.type            = 'sine';
      osc.frequency.value = arpSeq[aIdx % arpSeq.length];
      osc.detune.value    = (Math.random() - 0.5) * 4;
      aIdx++;
      const t = _ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
      osc.connect(g); g.connect(_bgmBus);
      osc.start(t); osc.stop(t + 4.0);
      _reverb(g, 0.3);
      _later(_arp, 2000 + Math.random() * 400);
    }
    _later(_arp, 2000);

    // 水晶灵铃：每 7~14s 随机出现，极长衰减
    const chimeSeq = [F.C5, F.E5, F.G5, F.A5, F.C6];
    let cIdx = 0;
    function _chime() {
      _note(chimeSeq[cIdx % chimeSeq.length], 0.045, 0.03, 5.5, 'sine');
      cIdx++;
      _later(_chime, 7000 + Math.random() * 7000);
    }
    _later(_chime, 4000);
  }

  // ════════════════════════════════════════════════════════
  // ── SFX 合成库 ───────────────────────────────────────
  // ════════════════════════════════════════════════════════
  function _sfxNote(freq, vol, attack, decay, type = 'sine', bus = _sfxBus) {
    const osc = _ctx.createOscillator();
    const g   = _ctx.createGain();
    osc.type           = type;
    osc.frequency.value = freq;
    const t = _ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g); g.connect(bus);
    osc.start(t); osc.stop(t + attack + decay + 0.05);
  }

  const SFX = {
    // ── 轻触点击
    ui_click() {
      _sfxNote(900, 0.14, 0.005, 0.055, 'sine');
    },

    // ── 提交表单（C-E-G 上行和弦）
    submit() {
      [F.C4, F.E4, F.G4].forEach((f, i) => {
        setTimeout(() => _sfxNote(f, 0.14, 0.01, 0.45, 'sine'), i * 110);
      });
    },

    // ── 区域点击（软锣声）
    zone_click() {
      _sfxNote(F.A3, 0.18, 0.008, 1.2, 'sine');
      setTimeout(() => _sfxNote(F.A3 * 2.756, 0.05, 0.008, 0.8, 'sine'), 0);
    },

    // ── 面板开启（下行滑音）
    panel_open() {
      const osc = _ctx.createOscillator();
      const g   = _ctx.createGain();
      osc.type = 'sine';
      const t = _ctx.currentTime;
      osc.frequency.setValueAtTime(680, t);
      osc.frequency.exponentialRampToValueAtTime(200, t + 0.28);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.10, t + 0.04);
      g.gain.linearRampToValueAtTime(0, t + 0.28);
      osc.connect(g); g.connect(_sfxBus);
      osc.start(t); osc.stop(t + 0.32);
    },

    // ── 面板关闭（上行滑音）
    panel_close() {
      const osc = _ctx.createOscillator();
      const g   = _ctx.createGain();
      osc.type = 'sine';
      const t = _ctx.currentTime;
      osc.frequency.setValueAtTime(200, t);
      osc.frequency.exponentialRampToValueAtTime(620, t + 0.22);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.04);
      g.gain.linearRampToValueAtTime(0, t + 0.22);
      osc.connect(g); g.connect(_sfxBus);
      osc.start(t); osc.stop(t + 0.26);
    },

    // ── 报告开启（低沉钟鸣）
    report_open() {
      [[F.C3, 0.18], [F.G3, 0.08], [F.C3 * 2.756, 0.04]].forEach(([f, v]) => {
        _sfxNote(f, v, 0.008, 2.2, 'triangle');
      });
    },

    // ── 任务完成（水晶上升琶音 C5-E5-G5-C6）
    task_complete() {
      [F.C5, F.E5, F.G5, F.C6].forEach((f, i) => {
        setTimeout(() => _sfxNote(f, 0.18, 0.015, 0.55, 'triangle'), i * 100);
      });
    },

    // ── 灵气增加（快速上扬音）
    spirit_gain() {
      const osc = _ctx.createOscillator();
      const g   = _ctx.createGain();
      osc.type = 'sine';
      const t = _ctx.currentTime;
      osc.frequency.setValueAtTime(F.C5, t);
      osc.frequency.linearRampToValueAtTime(F.G5, t + 0.22);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(g); g.connect(_sfxBus);
      osc.start(t); osc.stop(t + 0.32);
    },

    // ── 装饰解锁（魔法闪光，五声上扫）
    decoration_unlock() {
      [F.C5, F.E5, F.G5, F.A5, F.C6].forEach((f, i) => {
        setTimeout(() => _sfxNote(f, 0.15, 0.008, 0.3, 'triangle'), i * 60);
      });
    },

    // ── 每日签到（温暖钟声，含泛音）
    checkin() {
      [[F.A4, 0.22], [F.A4 * 2.756, 0.08], [F.A4 * 5.404, 0.04]].forEach(([f, v]) => {
        _sfxNote(f, v, 0.005, 1.8, 'sine');
      });
    },

    // ── 岛屿就绪（宏大揭幕：C 大和弦错落入场 + 高音光芒）
    island_ready() {
      [F.C3, F.E3, F.G3, F.C4, F.E4, F.G4, F.C5].forEach((f, i) => {
        const vol = 0.16 - i * 0.016;
        const type = i < 3 ? 'triangle' : 'sine';
        setTimeout(() => {
          const osc = _ctx.createOscillator();
          const g   = _ctx.createGain();
          osc.type           = type;
          osc.frequency.value = f;
          const t = _ctx.currentTime;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(vol, t + 0.12);
          g.gain.linearRampToValueAtTime(vol * 0.55, t + 2.0);
          g.gain.linearRampToValueAtTime(0, t + 4.2);
          osc.connect(g); g.connect(_sfxBus);
          osc.start(t); osc.stop(t + 4.5);
        }, i * 80);
      });
      // 高音光芒（延迟400ms出现）
      setTimeout(() => {
        [F.C6, F.G5].forEach((f, i) => {
          setTimeout(() => _sfxNote(f, 0.09, 0.01, 1.2, 'sine'), i * 120);
        });
      }, 400);
    },

    // ── 错误提示（低沉双脉冲）
    error() {
      [0, 220].forEach(delay => {
        setTimeout(() => _sfxNote(120, 0.12, 0.008, 0.12, 'sawtooth'), delay);
      });
    },
  };

  // ── 公开：播放音效 ───────────────────────────────────────
  function playSfx(name) {
    if (!_sfxEnabled) return;
    if (!_init()) return;
    _resume();
    const fn = SFX[name];
    if (fn) try { fn(); } catch (e) { console.warn('[Audio SFX]', name, e); }
  }

  // ── 公开：切换场景BGM ────────────────────────────────────
  function setScene(scene) {
    if (!_init()) return;
    _resume();
    if (_curScene === scene) return;
    _curScene = scene;

    // 淡出旧BGM
    _ramp(_bgmBus.gain, 0, 1.4);

    setTimeout(() => {
      _stopBgm();
      if (!_bgmEnabled) return;
      _ramp(_bgmBus.gain, 0.36, 0.6);
      if (scene === 'screen-form')    _bgmForm();
      else if (scene === 'screen-loading') _bgmLoading();
      else if (scene === 'screen-island')  _bgmIsland();
    }, 1500);
  }

  // ── 公开：开关BGM ────────────────────────────────────────
  function toggleBgm() {
    _bgmEnabled = !_bgmEnabled;
    if (!_inited) { _savePrefs(); return _bgmEnabled; }
    if (_bgmEnabled) {
      const sc = _curScene;
      _curScene = null;         // 强制重启
      setScene(sc || 'screen-form');
    } else {
      _ramp(_bgmBus.gain, 0, 0.5);
      setTimeout(_stopBgm, 600);
    }
    _savePrefs();
    return _bgmEnabled;
  }

  // ── 公开：开关SFX ────────────────────────────────────────
  function toggleSfx() {
    _sfxEnabled = !_sfxEnabled;
    _savePrefs();
    return _sfxEnabled;
  }

  // ── 偏好持久化 ───────────────────────────────────────────
  function _savePrefs() {
    try { localStorage.setItem('smb_audio', JSON.stringify({ bgm: _bgmEnabled, sfx: _sfxEnabled })); } catch (_) {}
  }
  function _loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('smb_audio') || '{}');
      if (p.bgm === false) _bgmEnabled = false;
      if (p.sfx === false) _sfxEnabled = false;
    } catch (_) {}
  }
  _loadPrefs();

  // ── 首次用户交互后自动启动表单页BGM ─────────────────────
  function _onFirst() {
    if (_firstTouch) return;
    _firstTouch = true;
    if (_bgmEnabled && !_curScene) setScene('screen-form');
  }
  document.addEventListener('click',      _onFirst, { once: true });
  document.addEventListener('touchstart', _onFirst, { once: true });

  // ── 公开接口 ─────────────────────────────────────────────
  return {
    playSfx,
    setScene,
    toggleBgm,
    toggleSfx,
    get bgmOn()  { return _bgmEnabled; },
    get sfxOn()  { return _sfxEnabled; },
  };

})();
