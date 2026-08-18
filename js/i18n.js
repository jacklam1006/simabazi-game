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
    'form.cancel_edit':   '取消，返回我的岛屿',
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
    'nav.brand':           '司 马 八 字',
    'bar.my_islands':      '我的岛屿',
    'bar.settings':        '⚙ 设置',
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
    'reg.success_title':   '注册成功！',
    'reg.success_desc':    '验证邮件已发送至',
    'reg.success_note':    '请点击邮件中的链接完成验证\n未收到可检查垃圾邮件文件夹',
    'reg.success_ok':      '好的，去查收',

    // ── 我的岛屿 ──────────────────────────────
    'islands.title':       '我的岛屿',
    'islands.loading':     '加载中...',
    'islands.empty':       '暂无保存的岛屿',
    'islands.close':       '关 闭',

    // ── 设置面板 ──────────────────────────────
    'settings.title':          '设置',
    'settings.profile_title':  '账户资料',
    'settings.nickname':       '昵称',
    'settings.save':           '保 存',
    'settings.refresh_title':  '刷新测试内容',
    'settings.refresh_ai_desc':'仅重新生成AI深析文字内容，保留3D岛屿模型不变。无付费成本，十几秒完成。',
    'settings.refresh_ai_btn': '轻量刷新 AI 深析',
    'settings.refresh_full_desc':'从八字重新走完整流程（提示词→AI绘图→3D建模→AI深析）。真实调用付费API，预计花费 $0.13–0.24 以上，且需要几分钟时间，生成完成后会新增一条岛屿存档。',
    'settings.refresh_full_btn': '完全重新生成岛屿',
    'settings.edit_birth_btn': '修改出生信息后重新生成',
    'settings.close':          '关 闭',

    // ── 邀请好友（裂变系统）──────────────────
    'settings.referral_title':      '邀请好友',
    'settings.referral_desc':       '把专属邀请链接分享给朋友，朋友注册并生成命盘岛屿后，你们都能获得灵气奖励。',
    'settings.referral_link_label': '你的专属邀请链接',
    'settings.referral_copy_btn':   '复制链接',
    'settings.referral_copied':     '✓ 已复制',
    'settings.referral_copy_fail':  '复制失败，请手动选中链接复制',
    'settings.referral_unavailable':'邀请码生成中，请稍后重新打开设置面板',

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

    // ── 新手引导 ──────────────────────────────
    'tutorial.view_more':  '查看完整详解 →',
    'tutorial.next':       '下一个 →',
    'tutorial.complete':   '✦ 探索完成 ✦',
    'tutorial.skip_top':   '跳过引导 ×',
    'tutorial.skip_modal': '跳过引导，自由探索',
    'tutorial.hint_click': '点击命盘上高亮的标识',

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

    // ── 灵气兑换水晶商品 ────────────────────────
    'products.redeem_btn':      '灵气兑换',
    'products.redeemed':        '已改善',
    'products.need_login':      '兑换需要先登录，方便我们联系你',
    'products.need_island':     '请先保存或加载一个命盘岛屿后再兑换',
    'products.insufficient':    '灵气不足，还需要 {n} 灵气',
    'products.confirm':         '确定用 {cost} 灵气兑换「{name}」吗？',
    'products.success':         '兑换成功！我们会尽快通过 WhatsApp 联系你安排发货',
    'products.fail':            '兑换失败，请稍后重试',
    'products.spirit_label':    '灵气',

    // ── 五行维护系统（第三阶段）─────────────────
    'wxmaint.panel_title':      '命盘五行诊断',
    'wxmaint.direction_nourish':'需要滋养',
    'wxmaint.direction_restrain':'需要克制',
    'wxmaint.severity_label':   '问题程度',
    'wxmaint.action_hint_label':'建议做法',
    'wxmaint.redeem_now':       '用灵气立即改善',
    'wxmaint.resolved_badge':   '已改善',
    'wxmaint.progress_label':   '改善进度',
    'wxmaint.redeeming':        '兑换中…',
    'wxmaint.insufficient_btn': '还需要 {n} 灵气',
    // 2026-08-13 qa-reviewer复查PLAUSIBLE后补齐（js/analysis.js::buildMaintenancePanel()
    // 此前硬编码这几句文案，从未接i18n，见claude-docs/已知问题与修复记录.md对应日期条目）：
    'wxmaint.section_title':          '命理解读',
    'wxmaint.subtitle_ai':            'AI解读',
    'wxmaint.title_fallback_nourish': '{wx}偏弱，需要补充滋养',
    'wxmaint.title_fallback_restrain':'{wx}偏旺，需要适度克制',
    'wxmaint.fallback_nourish':       '命盘中{wx}的力量偏弱，是这张命盘需要补充滋养的方向。',
    'wxmaint.fallback_restrain':      '命盘中{wx}的力量偏旺，是这张命盘需要适度克制的方向。',
    // 2026-08-15第四阶段"拖拽维护"新增（js/wuxing-drag.js，frontend-3d领域
    // 跨域顺手补齐——CLAUDE.md强制规则7要求用户可见文案中英key必须同步）：
    'wxmaint.drag_gained':      '获得 {n} 灵气',
    'wxmaint.drag_daily_limit': '这条今天已经打理过了，明天再来吧',
    'wxmaint.drag_fail':        '维护失败，请稍后再试',
    'wxmaint.drag_not_ready':   '维护系统尚未就绪，请稍后再试',

    // ── 命理装饰面板（十神/神煞/地支关系/天干合，2026-08-18新增）────────
    'decor.badge':         '◈ 命盘要素',
    'decor.subtitle':      '3D装饰 · 命盘要素',
    'decor.section_title': '含义',
    'wxmaint.drag_already_shrined': '这条已经被神仙永久庇护，无需再维护，画面马上刷新',
    // 2026-08-15第四阶段"四层付费结构"新增（js/main-new.js::_wxmaintRedeemBlockHtml()、
    // js/products.js::_redeemShrine() 用到）：
    'wxmaint.shrined_badge':    '已巩固',
    'wxmaint.good_status':      '状态良好，暂无需打理',
    'wxmaint.crystal_note':     '水晶庇护中 · 消磁周期已延长',
    'wxmaint.instant_fix_title':'瞬间调理',
    'wxmaint.instant_fix_btn':  '花 {n} 灵气立即调理',
    // 2026-08-15 新增：健康度进度条文案，见 js/main-new.js::_wxHealthBarHtml()
    'wxmaint.health_status':    '健康度 {pct}% · 约 {days} 天后进一步恶化',
    // 2026-08-16新增：tier===3（已封顶最重档）专属文案，不复用上面那句
    // "约N天后进一步恶化"——tier封顶后不会再恶化，那句话对tier3不成立。
    'wxmaint.health_status_worst': '健康度 {pct}% · 已达最重档，需要调理',
    'wxmaint.health_secured':   '已永久巩固，无需关注',

    // ── 灵气兑换：④请神仙/设炉灶（纯虚拟购买，不走实体履约）─────
    'products.success_shrine':  '兑换成功！该五行问题已永久巩固，不再需要打理',

    // ── 任务面板：五行维护动态卡片（第四阶段）───────────────────
    'tasks.wxmaint_section':        '五行维护',
    'tasks.wxmaint_verb_nourish':   '滋养',
    'tasks.wxmaint_verb_restrain':  '克制',
    'tasks.wxmaint_title':          '今日维护：{action} {target}',
    'tasks.wxmaint_go_hint':        '前往岛屿拖拽维护 →',
    'tasks.wxmaint_crystal_note':   '（水晶庇护中）',
    'tasks.wxmaint_hint_toast':          '已为你定位，请在岛屿上拖拽对应的五行标记进行维护',
    'tasks.wxmaint_hint_toast_fallback': '请前往岛屿上找到对应的五行标记，拖拽维护',

    // ── 邀君同游（裂变系统，任务面板真实进度展示）──────
    'tasks.invite_section':        '邀君同游',
    'tasks.invite_progress':       '已成功邀请 {n} 位朋友 · 岛屿已扩大',
    'tasks.invite_progress_zero':  '前往设置面板复制专属邀请链接，邀请朋友解锁岛屿扩大',
    'tasks.invite_login_hint':     '登录后查看邀请进度',
    'tasks.invite_bonus_toast':    '再次邀请成功！你获得了额外灵气奖励',
    'tasks.invite_first_toast':    '邀请成功！灵气奖励已到账',
    'tasks.referral_welcome_toast':'🎉 邀请码生效！你已获得灵气欢迎奖励',
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
    'form.cancel_edit':   'Cancel, back to my island',
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
    'nav.brand':           'Sima BaZi',
    'bar.my_islands':      'My Islands',
    'bar.settings':        '⚙ Settings',
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
    'reg.success_title':   'Account Created!',
    'reg.success_desc':    'Verification email sent to',
    'reg.success_note':    'Click the link in the email to confirm your account.\nCheck spam if you don\'t see it.',
    'reg.success_ok':      'Got it, check email',

    // ── My Islands ────────────────────────────
    'islands.title':       'My Islands',
    'islands.loading':     'Loading...',
    'islands.empty':       'No saved islands yet',
    'islands.close':       'Close',

    // ── Settings Panel ─────────────────────────
    'settings.title':          'Settings',
    'settings.profile_title':  'Account Profile',
    'settings.nickname':       'Nickname',
    'settings.save':           'Save',
    'settings.refresh_title':  'Refresh Test Content',
    'settings.refresh_ai_desc':'Regenerates only the AI insight text, keeping the 3D island model unchanged. No cost, takes about 10-20 seconds.',
    'settings.refresh_ai_btn': 'Refresh AI Insight',
    'settings.refresh_full_desc':'Re-runs the full pipeline from your BaZi data (prompt → AI image → 3D model → AI insight). This makes real paid API calls, costs an estimated $0.13–0.24+, and takes several minutes. A new island record will be added when done.',
    'settings.refresh_full_btn': 'Fully Regenerate Island',
    'settings.edit_birth_btn': 'Edit Birth Info & Regenerate',
    'settings.close':          'Close',

    // ── Referral (viral invite system) ────────
    'settings.referral_title':      'Invite Friends',
    'settings.referral_desc':       'Share your personal invite link — once a friend registers and generates their island, you both earn spirit rewards.',
    'settings.referral_link_label': 'Your invite link',
    'settings.referral_copy_btn':   'Copy Link',
    'settings.referral_copied':     '✓ Copied',
    'settings.referral_copy_fail':  'Copy failed, please select and copy the link manually',
    'settings.referral_unavailable':'Generating your invite code — reopen Settings shortly',

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

    // ── Tutorial ──────────────────────────────
    'tutorial.view_more':  'Full Details →',
    'tutorial.next':       'Next →',
    'tutorial.complete':   '✦ Explored ✦',
    'tutorial.skip_top':   'Skip ×',
    'tutorial.skip_modal': 'Skip Tutorial',
    'tutorial.hint_click': 'Tap the highlighted marker',

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

    // ── Crystal Product Redemption ────────────
    'products.redeem_btn':      'Redeem with Spirit',
    'products.redeemed':        'Improved',
    'products.need_login':      'Please sign in to redeem, so we can contact you',
    'products.need_island':     'Please save or load an island first before redeeming',
    'products.insufficient':    'Not enough spirit — {n} more needed',
    'products.confirm':         'Redeem "{name}" for {cost} spirit?',
    'products.success':         'Redeemed! We\'ll contact you via WhatsApp soon to arrange shipping',
    'products.fail':            'Redemption failed, please try again later',
    'products.spirit_label':    'Spirit',

    // ── Five-Element Maintenance System (Phase 3) ──
    'wxmaint.panel_title':      'Five-Element Diagnosis',
    'wxmaint.direction_nourish':'Needs Nourishing',
    'wxmaint.direction_restrain':'Needs Restraining',
    'wxmaint.severity_label':   'Severity',
    'wxmaint.action_hint_label':'Suggested Action',
    'wxmaint.redeem_now':       'Improve Now with Spirit',
    'wxmaint.resolved_badge':   'Improved',
    'wxmaint.progress_label':   'Progress',
    'wxmaint.redeeming':        'Redeeming…',
    'wxmaint.insufficient_btn': '{n} more spirit needed',
    // 2026-08-13 qa-reviewer复查PLAUSIBLE后补齐，与上方zh区块同一批新增key对称：
    'wxmaint.section_title':          'Interpretation',
    'wxmaint.subtitle_ai':            'AI Reading',
    'wxmaint.title_fallback_nourish': '{wx} is relatively weak, needs nourishing',
    'wxmaint.title_fallback_restrain':'{wx} is relatively strong, needs restraining',
    'wxmaint.fallback_nourish':       'The {wx} element is relatively weak in this chart — a direction that could use extra nourishment.',
    'wxmaint.fallback_restrain':      'The {wx} element is relatively strong in this chart — a direction that could use some moderation.',
    'wxmaint.drag_gained':      'Gained {n} Spirit',
    'wxmaint.drag_daily_limit': 'Already maintained today — come back tomorrow',
    'wxmaint.drag_fail':        'Maintenance failed, please try again later',
    'wxmaint.drag_not_ready':   'Maintenance system not ready yet, please try again later',
    'wxmaint.drag_already_shrined': 'This one is already permanently protected — no maintenance needed. Refreshing now',
    // 2026-08-15 Phase 4 "four-tier monetization" additions (used by
    // js/main-new.js::_wxmaintRedeemBlockHtml(), js/products.js::_redeemShrine()):
    'wxmaint.shrined_badge':    'Secured',
    'wxmaint.good_status':      'In good standing — no attention needed',
    'wxmaint.crystal_note':     'Crystal-protected · recharge cycle extended',
    'wxmaint.instant_fix_title':'Instant Fix',
    'wxmaint.instant_fix_btn':  'Fix now for {n} Spirit',
    // 2026-08-15 added: health bar copy, see js/main-new.js::_wxHealthBarHtml()
    'wxmaint.health_status':    'Health {pct}% · further decay in about {days} days',
    // 2026-08-16 addition: tier===3 (capped, worst tier) gets its own caption —
    // doesn't reuse the line above, since tier is capped and won't decay further.
    'wxmaint.health_status_worst': 'Health {pct}% · at the worst tier, needs attention',
    'wxmaint.health_secured':   'Permanently secured — no attention needed',

    // ── Chart Element Decorations (Ten Gods / Shensha / Branch Relations / Stem Combos, added 2026-08-18) ──
    'decor.badge':         '◈ Chart Element',
    'decor.subtitle':      '3D Decoration · Chart Element',
    'decor.section_title': 'Meaning',

    // ── Redeem: ④ Enshrine a Guardian Spirit (pure virtual purchase, no physical fulfillment) ──
    'products.success_shrine':  'Redeemed! This issue is now permanently secured and needs no further upkeep',

    // ── Task panel: dynamic Five-Element maintenance cards (Phase 4) ──
    'tasks.wxmaint_section':        'Five-Element Maintenance',
    'tasks.wxmaint_verb_nourish':   'Nourish',
    'tasks.wxmaint_verb_restrain':  'Restrain',
    'tasks.wxmaint_title':          'Today: {action} {target}',
    'tasks.wxmaint_go_hint':        'Head to the island to maintain →',
    'tasks.wxmaint_crystal_note':   '(crystal-protected)',
    'tasks.wxmaint_hint_toast':          'Located it — drag to maintain this element marker on the island',
    'tasks.wxmaint_hint_toast_fallback': 'Head to the island and drag to maintain this element marker',

    // ── Invite Friends (viral system, real-progress task card) ──
    'tasks.invite_section':        'Invite Friends',
    'tasks.invite_progress':       '{n} friend(s) successfully invited · Island expanded',
    'tasks.invite_progress_zero':  'Copy your invite link in Settings to invite friends and unlock island expansion',
    'tasks.invite_login_hint':     'Sign in to see your invite progress',
    'tasks.invite_bonus_toast':    'Another successful invite! You earned a bonus spirit reward',
    'tasks.invite_first_toast':    'Invite successful! Spirit reward received',
    'tasks.referral_welcome_toast':'🎉 Invite code applied! You received a welcome spirit bonus',
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
