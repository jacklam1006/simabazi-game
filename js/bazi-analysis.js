/**
 * 司马八字 · AI分析缓存模块 BaziAnalysis
 *
 * 缓存层：localStorage（本地，即时）→ 后端 /analyze-bazi（后端文件缓存 + Gemini）
 * 相同八字命盘只生成一次 AI 分析，永久复用。
 *
 * 公开 API：
 *   BaziAnalysis.getAnalysis(baziData, gender) → Promise<analysis | null>
 *   BaziAnalysis.clearCache(baziData, gender)  → 清除本地缓存（调试用）
 *   BaziAnalysis.getLastError(baziData, gender) → { isTimeout, message } | null
 *     - 上一次该八字请求失败时的错误信息（getAnalysis 本身对外恒不reject，
 *       resolve(null)时想区分"超时"和"其它网络/服务端错误"就靠这个查）
 */

const BaziAnalysis = (() => {
  const BACKEND_URL = 'https://simabazi-island.onrender.com';
  // v1→v2：后端AI深析改为六步命理框架JSON结构（2026-07-29），老v1缓存结构不兼容，换key前缀避免读到旧结构导致渲染报错
  // v2→v3：2026-08-03内容深度扩充（六步narrative目标字数大致翻倍 + 新增Step2b「十神详解」
  // 步骤 + Step1新增strengths/cautions两个数组字段），输出JSON结构又一次整体扩充，老v2
  // 缓存虽然结构"能兼容"（字段名没变，只是内容更薄+缺step2b_shishen），但直接展示会让
  // 用户看到旧版"薄"内容，且前端渲染step2b_shishen相关模块时找不到字段——同样换key前缀
  // 避免命中旧版本内容（后端 _cache_read() 同步做了 step2b_shishen 字段校验，双重保证）
  // v3→v4：2026-08-04再次加长Step1/Step2 narrative + 新增六维打分字段（Step2的
  // pattern_score、Step3的career_score/wealth_score、Step4的relationship_score、
  // Step5的health_score、Step6的fortune_score，供总览Tab渲染"六维雷达图"）。
  // 与v2→v3同一道理：老v3缓存字段名不冲突、结构"能兼容"，但渲染六维雷达图时会
  // 发现6个打分字段全部缺失，走入"评分数据暂不完整"的兜底态而不是正常显示——
  // 沿用同一套"新增结构标志字段校验+换key前缀"模式，同样双重保证（后端
  // gemini_analysis.py::_cache_read() 同步新增了fortune_score字段校验）。
  // v4→v5：2026-08-04新增「四柱详解」step_pillars_detail（{year,month,day,hour}
  // 各自{plain_meaning,hidden_stems,role_in_this_chart}）+「神煞详解」
  // step_shensha_detail（{shensha_items:[{name,nature,concept,personal_impact,
  // advice}]}）两个新步骤，供 js/analysis.js::buildPillarPanel()/
  // buildShenshaPanel() 渲染点击命柱/神煞标签弹出的详情面板（此前是几十字的静态
  // 短句，改为AI动态生成）。同一道理：老v4缓存这两个字段整体缺失，点开命柱/神煞
  // 面板只能看到静态兜底内容（这本身不会报错——buildPillarPanel/buildShenshaPanel
  // 设计上第三参数undefined时就是走静态路径——但换key前缀能让老用户尽快用上新内容，
  // 不用一直等到手动"轻量刷新"）。沿用同一套模式（后端gemini_analysis.py::
  // _cache_read()同步新增了这两个字段的存在性校验，见_lsGet()/seedCache()新增的
  // _pillarsDetailValid()/_shenshaDetailValid()）——**2026-08-04同日qa-reviewer
  // 复查后返工**：两个校验函数的判定粒度改为"非空即有效"（不要求四柱/全部神煞
  // 齐全），完整推导见两个函数定义处注释，与后端同一次返工保持一致，不再赘述。
  // v5→v6：2026-08-11新增「命盘特点详解」step_traits_detail（{strengths_detail:
  // [3条], cautions_detail:[3条]}，对应Step1已有的strengths/cautions短句逐条
  // 展开），供 js/island-annotate.js 新增的✅/⚠️锚点点击后、js/analysis.js::
  // buildTraitPanel() 渲染详情。老v5缓存整体缺这个字段——不会报错（前端优雅
  // 降级回退展示summary短句本身），但用户会一直看不到展开说明，直到手动"轻量
  // 刷新"。沿用同一套模式换key前缀+新增字段校验（见下方_traitsDetailValid()）。
  // 2026-08-11 qa-reviewer复查PLAUSIBLE后同日修订：_traitsDetailValid()判定
  // 粒度已从"strengths_detail/cautions_detail都恰好3条"放宽为"key存在即可"——
  // 理由见后端gemini_analysis.py::_traits_detail_valid()上方注释与本文件同名
  // 函数定义处注释：内容层面"3+3全齐或整体为空"这条不变量已经由后端
  // _sanitize_traits_detail()落盘前把关死，这里重复验证条数等价于验证"是否
  // 非空"，只会让Step1输出形状偶发漂移（跟GeminiCallError那种瞬时失败不同，
  // 见后端对应注释）拖累整份含其它7个步骤正常数据的分析结果被判定未命中，
  // 前后端这道校验口径必须完全一致。
  // v6→v7：2026-08-13新增「五行维护叙事」step_wuxing_maintenance（第三阶段
  // "五行维护系统"，取代第一阶段✅/⚠️浮动图标标注，供 js/wuxing-scene.js
  // 3D场景挂载 + js/analysis.js::buildMaintenancePanel() 渲染消费）。
  // 2026-08-13 qa-reviewer复查CONFIRMED后同日修复：`_wuxingMaintenanceValid()`
  // 首版判定粒度是"条目数与 js/wuxing-issues.js::WuxingIssues.deriveIssues()
  // 当次算出的条目数完全一致"——理由是该函数纯规则引擎、期望条目数不依赖AI
  // 输出，但这个设计复现了`_traits_detail_valid()`第一版"恰好3+3"被打回的
  // 同一个坑：只回答了当年两个理由之一，漏看了"不该让点开才看得到的补充字段
  // 拖累整份含其它8步正常数据的分析结果被判定未命中"这一条，而且影响面更大——
  // 只要AI偶发漏1条issue对应的输出（或该步骤单独触发429/5xx被安全降级为空），
  // `step_wuxing_maintenance`就会永久无法通过精确匹配，之后每次点开命柱/神煞
  // 面板（`_openZonePanel()`都会调`getAnalysis()`）都可能触发后端重跑整条9步
  // 流水线。修复：判定粒度改为与`_pillarsDetailValid()`/`_shenshaDetailValid()`
  // 同一套"非空即有效"（不再需要`baziData`参数重算期望条目数），允许"部分
  // 完整"（AI漏1条issue的叙事）长期缓存——详见下方`_wuxingMaintenanceValid()`
  // 与后端`gemini_analysis.py::_wuxing_maintenance_valid()`两处同一套判定
  // 逻辑（历史教训：`_computeHash`两处独立实现同一算法不同步的坑，这次两端
  // 在同一次改动里一起改，不分两轮）。
  const LS_PREFIX   = 'bazi_ai_v7_';

  // 后端七步RAG流水线（gemini_analysis.py::analyze_bazi()，Step1→Step2严格串行，
  // Step2b+Step3-6并行）真实耗时预算：
  // 2026-08-03 内容深度扩充重新推导（六步narrative字数翻倍 + 新增Step2b后单次调用
  // 耗时明显变长，_call_gemini_once 的 timeout 从50s同步上调到90s，此推导必须跟着改，
  // 不能只改后端一侧——否则前端超时值仍按旧的50s假设推导，会明显偏小）：
  //   - 单次Gemini调用 timeout=90s（gemini_analysis.py::_call_gemini_once，2026-08-03从50s上调）
  //   - _call_gemini() 每个模型最多尝试2次（原预算1次 + MAX_TOKENS加倍预算重试1次）
  //   - ANALYSIS_MODEL_CHAIN 当前实际长度为2（gemini_analysis.py 硬编码
  //     ['gemini-flash-latest','gemini-3.6-flash']）→ 单步最坏情况 2模型×2次×90s=360s。
  //     注意：GEMINI_ANALYSIS_MODEL 环境变量会在链最前面插入一个override模型，
  //     若该变量被设置，链长变为3，单步最坏情况变为 3模型×2次×90s=540s，
  //     全流程绝对最坏上限也会从下面的1125s变为约1665s——下面所有数字均按
  //     "未设置该环境变量、链长=2"的当前默认状态推导，设置该变量后本超时值
  //     不再按比例覆盖，需要重新核算（目前项目未使用该override）。
  //   - 每步前还有 rag_service.query() timeout=15s（rag_service.py，本次未改动）
  //   - Step1→Step2 严格串行，Step2b+Step3-6 用 asyncio.gather 并行发起（新增的
  //     Step2b加入同一批次，不新增串行阶段）→ 相当于3个串行阶段：Step1、Step2、
  //     max(Step2b..Step6)，每阶段 rag(15s)+gemini(最坏360s)=375s
  //   - 零重试零冷启动下限：3 × (15+90) = 315s；全部重试+换模型的绝对最坏上限：
  //     3 × 375 = 1125s（约18.75分钟，这种量级只会发生在模型链整体故障的灾难场景，
  //     不是正常慢请求，不需要前端超时覆盖到这个量级）
  // 改为550秒（约9.2分钟）：高于315秒下限，留出约235秒余量。这235秒余量具体能
  // 覆盖到什么程度需要精确说明，不要夸大——单个阶段命中一次MAX_TOKENS重试的真实
  // 代价是 rag(15s)+第一次gemini(90s)+重试gemini(90s)=195s，比零重试时该阶段的
  // 105s(=15+90)多花90s。235s余量只够覆盖"3个串行阶段中最多2个阶段各命中一次
  // 重试"（额外开销2×90=180s ≤ 235s余量）；如果3个阶段全部命中一次重试，额外开销
  // 3×90=270s，超过235s余量，会触发超时。这不代表550s选错了——550000 仍明显大于
  // 315000这个"不误杀正常无重试请求"的下限，只是这里如实说明它不覆盖"三阶段全部
  // 重试"这种更极端的场景，避免后续会话照抄这段注释时误以为余量覆盖范围比实际更大。
  // 同时550秒仍低于10分钟（3D生成轮询沿用的惯例值，见已知问题记录2026-07-26条），
  // 只有整条模型链持续挂起的灾难场景才会真正触发这个上限——那种场景下更早反馈
  // 失败反而是合理的。
  //
  // 2026-08-04评估未改动，2026-08-04 qa-reviewer复查修复（PLAUSIBLE P2）订正
  // 推导过程：_call_gemini_once 的 timeout=90s 是 requests.post 的硬性物理超时——
  // 到90s直接abort抛异常，不存在"单次调用部分按比例放大到约130s"这种说法（旧版
  // 本注释这么写是错的，90s本身这次没有改动，物理上不可能超过90s还没被abort）。
  // 正确的推导逻辑是"硬上限不变、期望耗时上升"：本轮只加长了Step1/Step2两步
  // narrative（各约+30~45%，不是2026-08-03那轮"六步全部翻倍"），是7步流水线里
  // 唯二会被串行等待的两步（Step1→Step2严格串行，是上面"3个串行阶段"里的前两个
  // 阶段），Step3-6只新增一两个数字打分字段、narrative字数不变，生成耗时基本
  // 不受影响。字数增长会让Step1/Step2的真实生成耗时的期望值上升，但每次单独调用
  // 无论期望耗时多长，物理上都不可能超过90s这个硬性超时——因此零重试物理下限
  // 仍然是3×(15+90)=315s，跟改动前完全一样，没有变化。550s这个前端超时值本身
  // 也不需要因为这次内容加长而调整：它设置的初衷是覆盖"零重试到少量重试"之间
  // 的真实耗时区间，硬上限没变意味着这个区间的覆盖范围没变；真正会变化的是
  // Step1/Step2触发MAX_TOKENS重试的概率（内容更长，更接近max_tokens预算上限，
  // 见gemini_analysis.py对应位置注释的字数增幅推导），但重试本身的物理耗时代价
  // （见上方"235秒余量"那段推导）并未随本轮改动而改变。因此本轮不上调90s单次
  // 调用超时，也不上调这里的550000ms前端超时。
  //
  // 2026-08-04（新增「四柱详解」「神煞详解」两步后再次评估，仍未改动）：
  // gemini_analysis.py::analyze_bazi() 的并行批次从"Step2b+Step3-6"共5个并发任务
  // 扩到"Step2b+Step3-6+四柱详解+神煞详解"共7个。上面的耗时模型只看"3个串行
  // 阶段各自最坏耗时375s"——用的是 asyncio.gather 里最慢那一个任务的耗时，不是
  // 任务数量，所以批次从5个任务扩到7个本身不会拖长第三阶段的墙钟时间，前提是
  // 新增的两个任务各自的最坏耗时不超过既有375s假设。逐一核对：①四柱详解
  // max_tokens=7168，与Step2同量级，重试机制与其它步骤完全一致（2模型×2次×
  // 90s=360s，仍在375s假设内）；②神煞详解max_tokens=16384——这个值本身超过了
  // `_call_gemini()`内部MAX_TOKENS加倍重试的封顶值8192（`budget=min(budget*2,
  // 8192)`），意味着首次budget(16384)已经大于8192，触发MAX_TOKENS后
  // `budget<8192`判断为False，不会走"同模型加倍预算重试"分支，直接换下一个候选
  // 模型——即神煞详解的最坏重试路径实际是"2模型×1次×90s=180s"，比其它步骤的
  // 360s更短，同样落在375s假设内（具体推导见 gemini_analysis.py::
  // _step_shensha_detail_sync() 上方大段注释）。因此两个新任务都不需要延伸单步
  // 最坏耗时假设，"3个串行阶段375s/阶段"这个耗时模型本身不变，550s前端超时值
  // 无需因为本轮新增两步而调整。另外这两步各自内部已用 `_step_pillars_detail_
  // safe()`/`_step_shensha_detail_safe()` 做了独立失败隔离（GeminiCallError被
  // 捕获返回空dict，不会向上抛出中断 asyncio.gather），所以即便真的触发上述最坏
  // 路径全部失败，也不会让整条 analyze_bazi() 请求进入"7步集体等失败"的更长
  // 等待路径——最终耗时上限仍由其余5个既有步骤的既有"任一失败即整体失败"路径
  // 决定，与本轮改动前完全一致。
  const AI_ANALYSIS_TIMEOUT_MS = 550000;

  // ── 进行中请求去重（in-flight dedup）─────────────────
  // 六步流水线+RAG检索耗时明显变长后，预热请求（main-new.js 生成开始时发起）与
  // 用户点开报告弹窗时的请求很可能在预热还没跑完时就重叠——若不去重会对同一个
  // 八字哈希并发发出两份完整的六步流水线请求（12次Gemini调用，配额直接翻倍）。
  // 同一个 hash 的并发调用复用同一个 in-flight Promise，请求完成（无论成功/失败）
  // 后从 Map 里清掉，不影响下一次真正的新请求。
  const _inflight = new Map(); // hash -> Promise<analysis|null>

  // 每个 hash 最近一次失败的错误信息（供 getLastError 查询，超时 vs 其它错误
  // 需要区分展示给用户不同的兜底文案）。成功时会被清掉。
  const _lastErrors = new Map(); // hash -> { isTimeout, message }

  function _pendingFor(hash) {
    return _inflight.get(hash) || null;
  }

  // ── 哈希（与后端逻辑对齐：四柱干支 + 性别）──────────
  function _hash(baziData, gender) {
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

  // ── 六维打分字段校验 ──────────────────────────────────
  // 2026-08-04 qa三轮复查发现：此前 _lsGet/seedCache 只用单个 fortune_score
  // 字段的 typeof 做canary，口径比 gemini_analysis.py::_is_valid_score()（类型+
  // 范围+有限值三重校验）和 js/analysis.js::_isValidScore()（同样的范围校验）
  // 都要弱——如果后端这层校验又出现回归（比如漏了某个字段/范围校验被绕过），
  // 越界/NaN/Infinity这类"类型合法但数值非法"的坏数据会被当作完整缓存永久
  // 写进 localStorage 并复用，六维雷达图永久卡在"评分数据暂不完整"。这里补成
  // 六个打分字段全部类型+范围合法才算数据完整，作为独立于后端的第二道防线。
  //
  // isValidScore() 对外暴露，供 js/analysis.js 的同名校验直接复用（而不是像
  // js/bazi-analysis.js 与 js/tutorial.js 的 _computeHash 那样各自维护一份独立
  // 实现——那是本项目里明确记录过的反面教训，这次不重蹈覆辙）。口径必须与
  // gemini_analysis.py::_is_valid_score() 完全对齐：数字类型 + 有限值 + [0,100]。
  const SCORE_FIELD_PATHS = [
    ['step2_pattern_yongshen', 'pattern_score'],
    ['step3_career_wealth',    'career_score'],
    ['step3_career_wealth',    'wealth_score'],
    ['step4_relationship',     'relationship_score'],
    ['step5_health',           'health_score'],
    ['step6_dayun_liunian',    'fortune_score'],
  ];

  function isValidScore(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100;
  }

  function _allScoreFieldsValid(analysis) {
    if (!analysis) return false;
    return SCORE_FIELD_PATHS.every(([stepKey, field]) => {
      const step = analysis[stepKey];
      return step && isValidScore(step[field]);
    });
  }

  // ── 四柱详解/神煞详解 结构校验（2026-08-04新增，同日qa-reviewer复查后返工）──
  // 与后端 gemini_analysis.py::_pillars_detail_valid()/_shensha_detail_valid()
  // 必须是同一套判定逻辑（历史教训：`_computeHash` 两处独立实现同一算法就因为
  // 没同步改过一次），这里的返工与后端同一次改动、同一批理由，完整推导见后端
  // 两个同名函数上方大段注释，摘要：
  //   - 第一版（校验"容器类型是否正确"）在两个方向各出一个CONFIRMED：pillars
  //     要求4个柱子键全部存在，与后端`_sanitize_pillars_detail()`允许跳过式
  //     丢弃不完整柱子的设计粒度没对齐，缺一根柱子就永远无法命中，每次都要
  //     重新触发后端整条流水线；shensha_items只要求"是数组"，无法区分"合法的
  //     空结果"与"整个步骤彻底失败"，后者被永久当作有效缓存卡住。
  //   - 返工后：`_pillarsDetailValid()`只要求非空对象（至少1根柱子），不要求
  //     四键全部存在；`_shenshaDetailValid()`要求`shensha_items`是**非空**
  //     数组，空数组一律判定无效（允许下次自然请求重新触发生成）。
  //
  // 2026-08-11 qa-reviewer第三轮复查CONFIRMED修复：上面这版"空数组一律判定
  // 无效"的设计基于"真实的零神煞场景经验概率为0"这个假设，被qa证伪——qa用
  // js/bazi-engine.js 真实的 _shensha() 函数逐条模拟，穷举了全部518,400组
  // 合法四柱组合，找到了具体存在的1组零神煞命盘：四柱己巳己巳己巳己巳
  // （对应真实公历生日1989年5月9日巳时，另有1929年同月日同时段）。这张命盘
  // 会永久卡在"每次打开报告都判定本地缓存无效→重新请求后端→后端同样判定
  // 无效重新生成→这张命盘本来就没有神煞，生成结果仍是空数组→继续miss"的
  // 死循环里，没有自愈路径。修复：后端 `_sanitize_shensha_detail()` 以
  // `ctx['shensha']`（规则引擎真实数据）为权威依据，`ctx['shensha']`为空时
  // 在落盘/返回结果里加`no_shensha: true`标记；这里同步放宽为"非空数组 或
  // `no_shensha`显式为true"两者之一满足即有效——与后端 gemini_analysis.py::
  // `_shensha_detail_valid()`必须是同一套判定逻辑（历史教训：`_computeHash`
  // 两处独立实现同一算法就因为没同步改过一次，这次两边在同一次改动里一起改）。
  function _pillarsDetailValid(analysis) {
    const pd = analysis && analysis.step_pillars_detail;
    return !!(pd && typeof pd === 'object' && Object.keys(pd).length > 0);
  }

  function _shenshaDetailValid(analysis) {
    const sd = analysis && analysis.step_shensha_detail;
    if (!sd || typeof sd !== 'object') return false;
    if (sd.no_shensha === true) return true; // 真零神煞命盘，见上方2026-08-11修复注释
    return Array.isArray(sd.shensha_items) && sd.shensha_items.length > 0;
  }

  // ── 命盘特点详解 结构校验（2026-08-11新增，同日qa-reviewer复查PLAUSIBLE后
  // 修订）────────────────────────────────────────────────
  // 必须与后端 gemini_analysis.py::_traits_detail_valid() 保持同一套判定逻辑
  // （历史教训见 _computeHash 两处独立实现同一算法的反面案例）。
  // 第一版：要求 strengths_detail/cautions_detail 都恰好3条才算有效（跟
  // _pillarsDetailValid()/_shenshaDetailValid() 的"非空即有效"判定粒度刻意
  // 不同）——理由是 step_traits_detail 固定3条优势+3条注意事项按index跟
  // Step1原句严格一一对应展开，没有"部分可用"的中间态，"非空数组"这种宽松
  // 校验会放过按index错位配对的残缺结果。这条理由本身没错，但校验对象选错了
  // 层级：后端 _sanitize_traits_detail() 落盘前已经把"3+3全合法或整体为空"
  // 这条不变量彻底把关死（写入的值只可能是{}或恰好3+3的合法数据），这里再验
  // 一遍条数完全等价于验证"是否非空"，唯一效果是把Step1的strengths/cautions
  // prompt没有强制"必须恰好3条"（不像本步骤自己的prompt有这条约束）导致的
  // 偶发2/4条短路结果，跟真正需要重试的失败一视同仁，代价是拖累整份含其它7个
  // 步骤正常数据的分析结果被 _lsGet()/seedCache() 判定整体未命中/拒绝写入。
  // 修订：改为只检查 step_traits_detail 这个key是否存在，不再检查内部条数——
  // 内容层面的合法性完全交给已经证明正确、且保持不变的后端 sanitize 逻辑。
  // 刻意的取舍：这意味着 step_traits_detail 一旦落盘为{}，前端也不会再有
  // 途径触发重试（跟命柱/神煞详解不同），换来的是不会因为这一个补充细节字段
  // 就拖累其它7步正常数据的缓存读写——前端 buildTraitPanel() 拿到{}/空数组时
  // 本就优雅降级回退展示 trait.summary（Step1原句）本身，不留空白不报错。
  function _traitsDetailValid(analysis) {
    return !!(analysis && Object.prototype.hasOwnProperty.call(analysis, 'step_traits_detail'));
  }

  // ── 五行维护叙事 结构校验（2026-08-13新增，第三阶段"五行维护系统"，同日
  // qa-reviewer复查CONFIRMED后返工）──────────────────────────
  // 必须与后端 gemini_analysis.py::_wuxing_maintenance_valid() 保持同一套
  // 判定逻辑（历史教训见 _computeHash 两处独立实现同一算法的反面案例）。
  //
  // **首版设计（已废弃，教训记录在此）**：判定粒度是"条目数与
  // js/wuxing-issues.js::WuxingIssues.deriveIssues(baziData) 当次算出的
  // 条目数完全一致"——理由是 deriveIssues() 纯规则引擎、期望条目数不依赖AI
  // 输出、不存在"合法结果被误判"。这个理由本身没错，但只回答了
  // _traitsDetailValid() 第一版"恰好3+3"被打回的两个理由之一，漏看了另一个
  // 同样成立、这次影响更大的理由：不该让"点开才看得到的补充字段"的部分失败
  // 拖累整份含其它8步正常数据的分析结果被判定整体未命中。qa-reviewer实测
  // 了真实故障链路：只要AI偶发漏1条issue对应的输出（或这一步单独触发429/5xx
  // 被安全降级为空），`step_wuxing_maintenance`就会永久无法通过精确匹配——
  // 而触发点不止"点开这个字段自己对应的3D装饰物"，`_openZonePanel()`里点开
  // 任意`pillar_`/`shensha_`面板都会调 getAnalysis()，等于用户每点一次命柱/
  // 神煞面板就可能触发后端重跑整条9步流水线。
  //
  // **返工后**：彻底放弃"条目数精确匹配"，改为与 _pillarsDetailValid()/
  // _shenshaDetailValid() 完全同一套"非空数组即有效"判定粒度（允许"部分
  // 完整"长期缓存，不再要求`baziData`参数重算期望条目数）。代价（接受）：
  // AI偶发漏1条时，这一条issue在维护面板里可能永久没有AI叙事，
  // js/analysis.js::buildMaintenancePanel() 本就有narrative缺失时的通用
  // 兜底文案、不留空白，与pillars/shensha详解允许部分缺失的既有取舍完全
  // 对齐，不再是例外。完整故障链路与返工理由见后端同名函数上方大段注释，
  // 两处判定粒度必须逐字对齐。
  function _wuxingMaintenanceValid(analysis) {
    return !!(analysis && Array.isArray(analysis.step_wuxing_maintenance)
      && analysis.step_wuxing_maintenance.length > 0);
  }

  // ── localStorage ──────────────────────────────────────
  // v2→v3结构校验：即便某条记录意外地被写进了 LS_PREFIX（v3）前缀的 key 下，
  // 读取时仍二次确认它具备 v3 结构标志字段 step2b_shishen——没有就当作未命中，
  // 而不是把老结构（缺十神详解/strengths/cautions）当新内容展示给用户。
  // 与 seedCache() 的写入校验是同一道防线的两端，双保险（见2026-08-03 qa复查记录）。
  // v3→v4：新增第三道校验——不再只查单个 fortune_score 字段的 typeof，改为
  // _allScoreFieldsValid() 六个打分字段全部类型+范围合法才算完整（理由见上方
  // SCORE_FIELD_PATHS 定义处注释，详见已知问题记录2026-08-04条目）。
  // v4→v5：新增第四、第五道校验——_pillarsDetailValid()/_shenshaDetailValid()，
  // 两个新字段都单独查（不是只查其中一个当canary代表整体，同六维打分字段那次
  // CONFIRMED 2 教训），理由见上方两个函数定义处注释（含2026-08-04同日qa-reviewer
  // 复查后返工的判定粒度调整）。
  // v5→v6：新增第六道校验——_traitsDetailValid()，判定粒度2026-08-11同日
  // qa-reviewer复查后已从"3+3全齐"放宽为"key存在即可"，理由见该函数定义处注释。
  // v6→v7：新增第七道校验——_wuxingMaintenanceValid()（2026-08-13
  // qa-reviewer复查CONFIRMED后已改为"非空即有效"，不再需要baziData重算期望
  // 条目数，理由见该函数定义处注释）。
  function _lsGet(hash) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + hash);
      if (!raw) return null;
      const analysis = JSON.parse(raw).analysis || null;
      if (!analysis) return null;
      if (!analysis.step2b_shishen) return null;
      if (!_allScoreFieldsValid(analysis)) return null;
      if (!_pillarsDetailValid(analysis)) return null;
      if (!_shenshaDetailValid(analysis)) return null;
      if (!_traitsDetailValid(analysis)) return null;
      if (!_wuxingMaintenanceValid(analysis)) return null;
      return analysis;
    } catch { return null; }
  }

  function _lsSet(hash, analysis) {
    try {
      localStorage.setItem(LS_PREFIX + hash, JSON.stringify({
        analysis,
        ts: Date.now(),
      }));
    } catch (e) {
      // localStorage 满了 → 静默忽略
      console.warn('[BaziAnalysis] localStorage write failed:', e);
    }
  }

  // ── 后端 API ─────────────────────────────────────────
  // AbortController + 超时：六步RAG流水线理论最坏情况可能长时间挂起（多次
  // Gemini调用重试+RAG检索延迟叠加），没有上限会让前端AI深析Tab无限期转圈。
  // 超时抛出的错误带 isTimeout:true 标记，供上层区分"超时"与其它网络/服务端错误，
  // 展示更明确的提示而不是笼统的失败文案。超时时长见 AI_ANALYSIS_TIMEOUT_MS 定义处
  // 的详细耗时预算推导。
  async function _fetchBackend(baziData, gender, forceRefresh = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_ANALYSIS_TIMEOUT_MS);
    try {
      const resp = await fetch(`${BACKEND_URL}/analyze-bazi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bazi_data: baziData,
          gender: gender || '男',
          force_refresh: !!forceRefresh,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`backend ${resp.status}`);
      const data = await resp.json();
      if (!data.analysis) {
        // HTTP 200 但 analysis 字段为 null——这是后端六步流水线内部失败的主要
        // 返回形态（gemini_analysis.py::analyze_bazi() 里 GeminiCallError 从任一
        // 步骤传播出来、或 no_api_key，都是 200+{analysis:null, error:'...'}，不是
        // HTTP 层错误，不会走上面的 resp.ok 判断）。必须在这里也当作失败抛出，
        // 否则 getAnalysis() 会把这次结果当成"成功但空"直接返回，既不更新也不清除
        // _lastErrors 里上一次可能残留的 isTimeout:true 标记，导致下次查询到的错误
        // 原因是错的（详见已知问题记录2026-08-01订正条目）。
        const err = new Error(
          data.error ? `AI深析生成失败：${data.error}` : 'AI深析返回空结果（后端未说明原因）'
        );
        err.isTimeout = false;
        throw err;
      }
      return data.analysis;
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const timeoutErr = new Error(
          `AI深析请求超时（超过${Math.round(AI_ANALYSIS_TIMEOUT_MS / 1000)}秒未响应）`
        );
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── 主接口 ────────────────────────────────────────────
  /**
   * 获取 AI 分析。优先读本地缓存，miss 则调后端（后端有文件缓存 + Gemini）。
   * @param {object} baziData - BaziEngine.calculate() 的结果
   * @param {string} gender   - '男' | '女'
   * @param {object} [opts]
   * @param {boolean} [opts.forceRefresh=false] - true 时跳过 localStorage 命中判断
   *   和 in-flight 复用判断，强制发起一次新的后端请求（用于"设置面板→轻量刷新AI
   *   深析"场景，绕过缓存验证后端/知识库更新效果）。请求体透传 force_refresh 给
   *   后端，后端 gemini_analysis.py::analyze_bazi() 同步跳过 _cache_read()。
   *   不传时（或显式 {forceRefresh:false}）行为与改动前完全一致——向后兼容现有
   *   两参数调用点（main-new.js/analysis.js 里已有的 getAnalysis(d, gender) 调用）。
   * @returns {Promise<object|null>}
   */
  async function getAnalysis(baziData, gender, { forceRefresh = false } = {}) {
    if (!baziData || !baziData.pillars) return null;

    const hash = _hash(baziData, gender);

    if (!forceRefresh) {
      // 1. localStorage 命中
      const cached = _lsGet(hash);
      if (cached) {
        console.log('[BaziAnalysis] cache hit (localStorage)');
        return cached;
      }

      // 2. 同一 hash 已有请求在途 → 复用同一个 Promise，不再发起第二次后端请求
      const pending = _pendingFor(hash);
      if (pending) {
        console.log('[BaziAnalysis] in-flight request reused for hash:', hash);
        return pending;
      }
    }

    // 3. 后端（含文件缓存，forceRefresh 时后端也会跳过文件缓存读取）
    const promise = (async () => {
      try {
        console.log('[BaziAnalysis] fetching from backend...' + (forceRefresh ? ' (forceRefresh)' : ''));
        const analysis = await _fetchBackend(baziData, gender, forceRefresh);
        if (analysis) {
          _lsSet(hash, analysis);
          _lastErrors.delete(hash);
          console.log('[BaziAnalysis] backend OK, wrote to localStorage');
        }
        return analysis;
      } catch (e) {
        const isTimeout = !!(e && e.isTimeout);
        console.warn(`[BaziAnalysis] backend failed${isTimeout ? ' (timeout)' : ''}:`, e.message);
        _lastErrors.set(hash, { isTimeout, message: e && e.message });
        return null;
      } finally {
        // 无论成功/失败/超时都要清理 in-flight，否则超时的请求会残留在这里，
        // 导致后续同一八字的新请求被误判为"仍在进行中"而拿不到新结果。
        _inflight.delete(hash);
      }
    })();
    _inflight.set(hash, promise);
    return promise;
  }

  function clearCache(baziData, gender) {
    if (!baziData) return;
    const hash = _hash(baziData, gender);
    localStorage.removeItem(LS_PREFIX + hash);
    console.log('[BaziAnalysis] cache cleared for hash:', hash);
  }

  // ── 查询上一次失败的错误信息（供 getAnalysis resolve(null) 后区分展示）──
  // getAnalysis 本身对外恒不 reject（避免破坏现有 .then-only 调用点，
  // 也避免未捕获 rejection），失败一律 resolve(null)；调用方若想在展示
  // 兜底文案时区分"请求超时"和"其它错误"，用这个查最近一次的失败原因。
  function getLastError(baziData, gender) {
    if (!baziData) return null;
    const hash = _hash(baziData, gender);
    return _lastErrors.get(hash) || null;
  }

  // ── 直接写入缓存（供"加载已保存岛屿"复用存档里的AI深析内容）──
  // 用途：用户存档（islands.ai_analysis）里已经保存过一份AI深析结果时，
  // 加载存档直接把它种进本地缓存，之后 getAnalysis() 会像本地命中一样
  // 直接返回，不会再对同一份八字重新发起一次完整六步流水线请求
  // （避免重复消耗 Gemini token）。
  //
  // 2026-08-03 qa复查发现并修复：登录后 auth.js → main-new.js 会用
  // islands.ai_analysis（Supabase存档列）调用这里种缓存，但老用户的存档是
  // v2时代写入的旧结构（没有 step2b_shishen，Step1也没有 strengths/cautions）。
  // 这里如果照单全收，会把老结构原样种进新的 v3 前缀 key 下，导致 getAnalysis()
  // 命中本地缓存直接返回旧内容、请求根本不会打到后端，v2→v3 缓存版本升级
  // （见上方 LS_PREFIX 定义处注释）设计的"老缓存自动失效"在这条路径上完全失效，
  // 老用户会永久卡在升级前的薄内容上。这里补一道结构校验：老结构一律拒绝写入，
  // 交给 getAnalysis() 走后端重新生成完整的 v3 内容。
  //
  // 2026-08-04 v3→v4：结构又扩充了（Step2~6新增六维打分字段），必须同步更新这道
  // 校验，不能只保留上一轮的 step2b_shishen 检查就当作已经做完——这正是"每次扩充
  // JSON结构都要重复做一遍"的场景（详见已知问题记录2026-08-04条目）。改用
  // _allScoreFieldsValid()（与 _lsGet() 共用同一份判断逻辑，两处不会再各自维护
  // 一份容易漏改的独立实现）：六个打分字段任何一个类型/范围不合法（含越界值/
  // NaN/Infinity），整份 analysis 一律拒绝写入本地缓存。
  //
  // 2026-08-04 v4→v5：结构又扩充了（新增step_pillars_detail/step_shensha_detail
  // 四柱详解/神煞详解），同上一轮教训，这次在同一次改动里一并补上（不留给下一轮
  // qa发现）：_pillarsDetailValid()/_shenshaDetailValid() 与 _lsGet() 共用同一份
  // 判断逻辑。
  // 2026-08-11 v5→v6：新增step_traits_detail（命盘特点详解），同上一轮教训，
  // _traitsDetailValid() 与 _lsGet() 共用同一份判断逻辑，不要两处各写一份。
  // 2026-08-13 v6→v7：新增step_wuxing_maintenance（五行维护叙事），同上一轮
  // 教训，_wuxingMaintenanceValid() 与 _lsGet() 共用同一份判断逻辑（2026-08-13
  // qa-reviewer复查CONFIRMED后已改为"非空即有效"，不再需要baziData参数）。
  function seedCache(baziData, gender, analysis) {
    if (!baziData || !analysis) return;
    if (!analysis.step2b_shishen) return; // 老结构（v2及更早）存档：不种缓存
    if (!_allScoreFieldsValid(analysis)) return; // 老结构（v3及更早）/坏数据存档：不种缓存
    if (!_pillarsDetailValid(analysis)) return; // 老结构（v4及更早）存档：不种缓存
    if (!_shenshaDetailValid(analysis)) return; // 老结构（v4及更早）存档：不种缓存
    if (!_traitsDetailValid(analysis)) return; // 老结构（v5及更早）存档：不种缓存
    if (!_wuxingMaintenanceValid(analysis)) return; // 老结构（v6及更早）存档：不种缓存
    const hash = _hash(baziData, gender);
    _lsSet(hash, analysis);
  }

  return { getAnalysis, clearCache, seedCache, getLastError, isValidScore };
})();
