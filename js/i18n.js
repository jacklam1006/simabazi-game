/**
 * 司马八字 · 国际化模块 i18n.js
 *
 * 用法：
 *   Lang.t('key')          — 获取当前语言翻译文字
 *   Lang.getLang()         — 返回 'zh' 或 'en'
 *   Lang.toggle()          — 切换语言并刷新 DOM
 *   Lang.apply()           — 将翻译应用到所有 [data-i18n] 元素
 *
 * HTML 标注方式：
 *   <span data-i18n="form.title">司马八字</span>
 *   <input data-i18n-ph="ph.year" placeholder="年">
 */

const I18N = {

  /* ════════════════════════════════════════════
     中文（主语言）
  ════════════════════════════════════════════ */
  zh: {
    // ── 主表单 ────────────────────────────────
    'form.title':         '司马八字',
    'form.subtitle':      '天机已动 · 为你推演命格',
    'form.birth_date':    '出生日期',
    'form.birth_hour':    '出生时辰',
    'form.gender':        '性别',
    'form.gender_male':   '♂ 男',
    'form.gender_female': '♀ 女',
    'form.opt_divider':   '· 可选 · 注册账户保存记录',
    'form.nickname':      '昵称',
    'form.email':         '邮箱',
    'form.submit':        '推演我的命盘',
    'form.have_account':  '已有账户？',
    'form.login_link':    '直接登录',
    'form.note':          '· 所有计算在本地完成，不上传个人信息 ·',

    // Placeholder
    'ph.year':            '年',
    'ph.month':           '月',
    'ph.day':             '日',
    'ph.nickname':        '你的名字或昵称（选填）',
    'ph.email':           'your@email.com（选填）',

    // 时辰下拉框
    'hours': [
      {v:23, t:'子时 23:00–01:00'},
      {v:1,  t:'丑时 01:00–03:00'},
      {v:3,  t:'寅时 03:00–05:00'},
      {v:5,  t:'卯时 05:00–07:00'},
      {v:7,  t:'辰时 07:00–09:00'},
      {v:9,  t:'巳时 09:00–11:00'},
      {v:11, t:'午时 11:00–13:00'},
      {v:13, t:'未时 13:00–15:00'},
      {v:15, t:'申时 15:00–17:00'},
      {v:17, t:'酉时 17:00–19:00'},
      {v:19, t:'戌时 19:00–21:00'},
      {v:21, t:'亥时 21:00–23:00'},
    ],

    // ── 加载屏 ────────────────────────────────
    'loading.title':       '正在推算命盘...',
    'loading.sub':         '天机运转，请稍候',
    'loading.step1':       '推算四柱八字',
    'loading.step2':       '生成命盘提示词',
    'loading.step3':       'AI绘制命盘岛屿',
    'loading.step4':       '转化为3D模型',
    'loading.step5':       '加载你的命盘世界',
    'loading.retry_btn':   '重新生成',
    'loading.fail_title':  '生成失败',
    'loading.fail_sub':    '请稍后重试',

    // Stage map 阶段文字
    'stage.queued.t':          '提交生成任务...',
    'stage.queued.s':          '天机运转，请稍候',
    'stage.gen_prompt.t':      '解析命盘元素...',
    'stage.gen_prompt.s':      '识别日主·五行·神煞·空亡',
    'stage.prompt_ready.t':    '命盘解析完成',
    'stage.prompt_ready.s':    '正在启动AI深度分析',
    'stage.enhance.t':         'Gemini 3.5 精准分析中...',
    'stage.enhance.s':         '八字命局深度运算，提炼视觉意境',
    'stage.enhanced.t':        '命局意境已提炼',
    'stage.enhanced.s':        '即将调用 Nano Banana Pro 绘图',
    'stage.gen_image.t':       'Nano Banana Pro 绘制中...',
    'stage.gen_image.s':       '高保真命盘图像生成（约30秒）',
    'stage.image_ready.t':     '命盘图像已生成',
    'stage.image_ready.s':     '即将转化为3D模型',
    'stage.to_3d.t':           '提交3D生成任务...',
    'stage.to_3d.s':           'TripoAI 接收图像',
    'stage.tripo.t':           '3D模型生成中...',
    'stage.tripo.s':           'TripoAI 转化中（约60-120秒）',
    'stage.img_fallback.t':    '切换至文字生成模式...',
    'stage.img_fallback.s':    'AI绘图暂时繁忙，自动切换',
    'stage.tripo_fb.t':        '3D转换中（备用通道）...',
    'stage.tripo_fb.s':        '正在使用备用生成方式',
    'stage.tripo_text.t':      '3D模型生成中...',
    'stage.tripo_text.s':      'TripoAI 转化中（约60-120秒）',
    'stage.completed.t':       '命盘已成型，加载中...',
    'stage.completed.s':       '即将进入你的命盘世界',
    'stage.error.t':           '生成失败',
    'stage.error.s':           '',
    'stage.done.t':            '命盘世界已就绪',
    'stage.done.s':            '欢迎踏入你的命格宇宙',

    // ── HUD ───────────────────────────────────
    'hud.title':           '命盘沙盒',
    'hud.tasks':           '任务',
    'hud.spirit':          '灵气',

    // ── 顶部栏 ────────────────────────────────
    'bar.my_islands':      '我的岛屿',
    'bar.login':           '登录 / 注册',
    'bar.logout':          '退出',

    // ── 登录弹窗 ──────────────────────────────
    'login.title':         '欢迎回来',
    'login.email_ph':      '邮箱地址',
    'login.pass_ph':       '密码',
    'login.submit':        '登 录',
    'login.cancel':        '取 消',
    'login.forgot':        '忘记密码？',
    'login.loading':       '登录中...',

    // ── 忘记密码弹窗 ──────────────────────────
    'forgot.title':        '重置密码',
    'forgot.desc':         '重置链接将发送到你注册时使用的邮箱',
    'forgot.email_ph':     '注册时使用的邮箱',
    'forgot.submit':       '发送重置链接',
    'forgot.sending':      '发送中...',
    'forgot.success':      '✓ 重置链接已发送，请查收邮件',
    'forgot.back':         '← 返回登录',

    // ── 注册弹窗 ──────────────────────────────
    'reg.title':           '命盘岛屿已生成',
    'reg.desc':            '注册账户，永久保存你的3D命盘\n并在任何设备上访问',
    'reg.name_ph':         '昵称 *',
    'reg.email_ph':        '邮箱地址 *',
    'reg.phone_ph':        '手机号码（选填）',
    'reg.pass_ph':         '设置密码（至少6位）*',
    'reg.submit':          '创建账户 · 永久保存',
    'reg.creating':        '创建中...',
    'reg.skip':            '稍后再说',
    'reg.have_account':    '已有账户？',
    'reg.login_link':      '直接登录',

    // ── 我的岛屿 ──────────────────────────────
    'islands.title':       '我的岛屿',
    'islands.loading':     '加载中...',
    'islands.empty':       '暂无保存的岛屿',
    'islands.close':       '关 闭',

    // ── 八字表 ────────────────────────────────
    'bazi.year':           '年柱',
    'bazi.month':          '月柱',
    'bazi.day':            '日柱',
    'bazi.hour':           '时柱',
    'bazi.day_master':     '日主',
    'bazi.kongwang':       '空亡',
    'bazi.dominant':       '旺',
    'bazi.toggle_open':    '八字命盘 ∨',
    'bazi.toggle_shut':    '八字命盘 ∧',

    // ── 报告 ──────────────────────────────────
    'report.btn':          '查看完整报告',
    'report.title':        '完整命盘报告',

    // ── 表单验证 ──────────────────────────────
    'err.year':            '请输入有效的出生年份（1900-2010）',
    'err.month':           '请输入有效的月份（1-12）',
    'err.day':             '请输入有效的日期（1-31）',
    'err.calc_fail':       '八字计算失败：',

    // ── 邮箱检测 ──────────────────────────────
    'email.checking':      '检查中...',
    'email.exists_pre':    '该邮箱已注册 → ',
    'email.login_here':    '点此登录',
    'email.available':     '✓ 可以注册',

    // ── Auth 错误 ─────────────────────────────
    'auth_err.invalid':    '邮箱或密码错误',
    'auth_err.unconfirm':  '请先验证邮箱再登录',
    'auth_err.exists':     '该邮箱已注册，请直接登录',
    'auth_err.weak_pass':  '密码至少需要6位',
    'auth_err.bad_email':  '邮箱格式不正确',
    'auth_err.rate':       '请求过于频繁，请稍后再试',
    'auth_err.fill':       '请填写邮箱和密码',
    'auth_err.fill_email': '请填写邮箱',
    'auth_err.nickname':   '请填写昵称',
    'auth_err.valid_email':'请填写有效邮箱',
    'auth_err.short_pass': '密码至少6位',
  },

  /* ════════════════════════════════════════════
     English
  ════════════════════════════════════════════ */
  en: {
    // ── Main Form ─────────────────────────────
    'form.title':         'BaZi Destiny',
    'form.subtitle':      'The Stars Move · Your Destiny Awaits',
    'form.birth_date':    'Date of Birth',
    'form.birth_hour':    'Birth Hour',
    'form.gender':        'Gender',
    'form.gender_male':   '♂ Male',
    'form.gender_female': '♀ Female',
    'form.opt_divider':   '· Optional · Create account to save ·',
    'form.nickname':      'Nickname',
    'form.email':         'Email',
    'form.submit':        'Read My Destiny',
    'form.have_account':  'Have an account?',
    'form.login_link':    'Sign in',
    'form.note':          '· All calculations done locally. No data uploaded. ·',

    // Placeholder
    'ph.year':            'Year',
    'ph.month':           'Month',
    'ph.day':             'Day',
    'ph.nickname':        'Your nickname (optional)',
    'ph.email':           'your@email.com (optional)',

    // Hour options
    'hours': [
      {v:23, t:'Zi Hour  23:00–01:00'},
      {v:1,  t:'Chou Hour 01:00–03:00'},
      {v:3,  t:'Yin Hour  03:00–05:00'},
      {v:5,  t:'Mao Hour  05:00–07:00'},
      {v:7,  t:'Chen Hour 07:00–09:00'},
      {v:9,  t:'Si Hour   09:00–11:00'},
      {v:11, t:'Wu Hour   11:00–13:00'},
      {v:13, t:'Wei Hour  13:00–15:00'},
      {v:15, t:'Shen Hour 15:00–17:00'},
      {v:17, t:'You Hour  17:00–19:00'},
      {v:19, t:'Xu Hour   19:00–21:00'},
      {v:21, t:'Hai Hour  21:00–23:00'},
    ],

    // ── Loading ───────────────────────────────
    'loading.title':       'Calculating your chart...',
    'loading.sub':         'The cosmos turns, please wait...',
    'loading.step1':       'Calculating Four Pillars',
    'loading.step2':       'Generating island description',
    'loading.step3':       'AI drawing your island',
    'loading.step4':       'Converting to 3D',
    'loading.step5':       'Loading your destiny world',
    'loading.retry_btn':   'Retry',
    'loading.fail_title':  'Generation failed',
    'loading.fail_sub':    'Please try again',

    // Stage map
    'stage.queued.t':          'Submitting task...',
    'stage.queued.s':          'The cosmos turns, please wait...',
    'stage.gen_prompt.t':      'Parsing chart elements...',
    'stage.gen_prompt.s':      'Day Master · Five Elements · Shensha · Void',
    'stage.prompt_ready.t':    'Chart analysis complete',
    'stage.prompt_ready.s':    'Starting AI deep analysis',
    'stage.enhance.t':         'Gemini 3.5 analyzing...',
    'stage.enhance.s':         'Deep BaZi computation, extracting visual essence',
    'stage.enhanced.t':        'Chart essence extracted',
    'stage.enhanced.s':        'Launching Nano Banana Pro',
    'stage.gen_image.t':       'Nano Banana Pro drawing...',
    'stage.gen_image.s':       'High-fidelity image generation (≈30s)',
    'stage.image_ready.t':     'Destiny image generated',
    'stage.image_ready.s':     'Converting to 3D model',
    'stage.to_3d.t':           'Submitting 3D task...',
    'stage.to_3d.s':           'TripoAI receiving image',
    'stage.tripo.t':           '3D model generating...',
    'stage.tripo.s':           'TripoAI processing (≈60–120s)',
    'stage.img_fallback.t':    'Switching to text mode...',
    'stage.img_fallback.s':    'AI image busy, auto-switching',
    'stage.tripo_fb.t':        '3D converting (fallback)...',
    'stage.tripo_fb.s':        'Using backup generation method',
    'stage.tripo_text.t':      '3D model generating...',
    'stage.tripo_text.s':      'TripoAI processing (≈60–120s)',
    'stage.completed.t':       'Island ready, loading...',
    'stage.completed.s':       'Entering your destiny universe',
    'stage.error.t':           'Generation failed',
    'stage.error.s':           '',
    'stage.done.t':            'Your destiny world is ready',
    'stage.done.s':            'Welcome to your BaZi universe',

    // ── HUD ───────────────────────────────────
    'hud.title':           'Destiny Sandbox',
    'hud.tasks':           'Tasks',
    'hud.spirit':          'Spirit',

    // ── Auth Bar ──────────────────────────────
    'bar.my_islands':      'My Islands',
    'bar.login':           'Sign In',
    'bar.logout':          'Sign Out',

    // ── Login Modal ───────────────────────────
    'login.title':         'Welcome Back',
    'login.email_ph':      'Email address',
    'login.pass_ph':       'Password',
    'login.submit':        'Sign In',
    'login.cancel':        'Cancel',
    'login.forgot':        'Forgot password?',
    'login.loading':       'Signing in...',

    // ── Forgot Password ───────────────────────
    'forgot.title':        'Reset Password',
    'forgot.desc':         'A reset link will be sent to your registered email',
    'forgot.email_ph':     'Your registered email',
    'forgot.submit':       'Send Reset Link',
    'forgot.sending':      'Sending...',
    'forgot.success':      '✓ Reset link sent! Please check your email.',
    'forgot.back':         '← Back to Sign In',

    // ── Register Modal ────────────────────────
    'reg.title':           'Your Destiny Island is Ready',
    'reg.desc':            'Create an account to permanently save your\n3D destiny island on any device',
    'reg.name_ph':         'Nickname *',
    'reg.email_ph':        'Email address *',
    'reg.phone_ph':        'Phone number (optional)',
    'reg.pass_ph':         'Set password (min 6 chars) *',
    'reg.submit':          'Create Account · Save Forever',
    'reg.creating':        'Creating...',
    'reg.skip':            'Skip for now',
    'reg.have_account':    'Have an account?',
    'reg.login_link':      'Sign in',

    // ── My Islands ────────────────────────────
    'islands.title':       'My Islands',
    'islands.loading':     'Loading...',
    'islands.empty':       'No saved islands yet',
    'islands.close':       'Close',

    // ── BaZi Table ────────────────────────────
    'bazi.year':           'Year',
    'bazi.month':          'Month',
    'bazi.day':            'Day',
    'bazi.hour':           'Hour',
    'bazi.day_master':     'Day Master',
    'bazi.kongwang':       'Void',
    'bazi.dominant':       'Strong',
    'bazi.toggle_open':    'BaZi Chart ∨',
    'bazi.toggle_shut':    'BaZi Chart ∧',

    // ── Report ────────────────────────────────
    'report.btn':          'View Full Report',
    'report.title':        'Full Destiny Report',

    // ── Form Validation ───────────────────────
    'err.year':            'Please enter a valid birth year (1900–2010)',
    'err.month':           'Please enter a valid month (1–12)',
    'err.day':             'Please enter a valid day (1–31)',
    'err.calc_fail':       'Chart calculation failed: ',

    // ── Email Check ───────────────────────────
    'email.checking':      'Checking...',
    'email.exists_pre':    'Email already registered → ',
    'email.login_here':    'Sign in here',
    'email.available':     '✓ Available',

    // ── Auth Errors ───────────────────────────
    'auth_err.invalid':    'Incorrect email or password',
    'auth_err.unconfirm':  'Please verify your email before signing in',
    'auth_err.exists':     'Email already registered, please sign in',
    'auth_err.weak_pass':  'Password must be at least 6 characters',
    'auth_err.bad_email':  'Please enter a valid email address',
    'auth_err.rate':       'Too many requests, please try again later',
    'auth_err.fill':       'Please enter your email and password',
    'auth_err.fill_email': 'Please enter your email',
    'auth_err.nickname':   'Please enter a nickname',
    'auth_err.valid_email':'Please enter a valid email',
    'auth_err.short_pass': 'Password must be at least 6 characters',
  },
};


/* ════════════════════════════════════════════════
   Lang 模块
════════════════════════════════════════════════ */
const Lang = (() => {
  let _lang = localStorage.getItem('smb_lang') || 'zh';

  /** 获取翻译文字；找不到时降级到中文，再找不到返回 key */
  function t(key) {
    return I18N[_lang]?.[key] ?? I18N.zh?.[key] ?? key;
  }

  function getLang() { return _lang; }

  /** 切换语言并刷新页面 */
  function toggle() {
    setLang(_lang === 'zh' ? 'en' : 'zh');
  }

  function setLang(lang) {
    if (lang !== 'zh' && lang !== 'en') return;
    _lang = lang;
    localStorage.setItem('smb_lang', lang);
    apply();
    // 更新切换按钮：显示对方语言名
    const btn = document.getElementById('lang-toggle-btn');
    if (btn) btn.textContent = _lang === 'zh' ? 'EN' : '中';
    // 通知其他模块
    window.dispatchEvent(new CustomEvent('langChanged', { detail: { lang: _lang } }));
  }

  /** 将翻译应用到 DOM — 静态元素 + 时辰下拉框 */
  function apply() {
    // 文字内容
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (val !== undefined) el.textContent = val;
    });
    // placeholder
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const key = el.getAttribute('data-i18n-ph');
      const val = t(key);
      if (val !== undefined) el.placeholder = val;
    });
    // 时辰下拉框重建
    _rebuildHourSelect();
    // html lang 属性
    document.documentElement.lang = _lang === 'zh' ? 'zh-CN' : 'en';
  }

  function _rebuildHourSelect() {
    const sel = document.getElementById('inp-hour');
    if (!sel) return;
    const prevVal = sel.value || '11';
    const hours = I18N[_lang]?.hours || I18N.zh.hours;
    sel.innerHTML = hours.map(h =>
      `<option value="${h.v}"${String(h.v) === String(prevVal) ? ' selected' : ''}>${h.t}</option>`
    ).join('');
    if (!sel.value) sel.value = '11';
  }

  return { t, getLang, toggle, setLang, apply };
})();
