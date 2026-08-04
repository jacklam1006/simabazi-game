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
  const LS_PREFIX   = 'bazi_ai_v4_';

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

  // ── localStorage ──────────────────────────────────────
  // v2→v3结构校验：即便某条记录意外地被写进了 LS_PREFIX（v3）前缀的 key 下，
  // 读取时仍二次确认它具备 v3 结构标志字段 step2b_shishen——没有就当作未命中，
  // 而不是把老结构（缺十神详解/strengths/cautions）当新内容展示给用户。
  // 与 seedCache() 的写入校验是同一道防线的两端，双保险（见2026-08-03 qa复查记录）。
  // v3→v4：新增第三道校验——不再只查单个 fortune_score 字段的 typeof，改为
  // _allScoreFieldsValid() 六个打分字段全部类型+范围合法才算完整（理由见上方
  // SCORE_FIELD_PATHS 定义处注释，详见已知问题记录2026-08-04条目）。
  function _lsGet(hash) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + hash);
      if (!raw) return null;
      const analysis = JSON.parse(raw).analysis || null;
      if (!analysis) return null;
      if (!analysis.step2b_shishen) return null;
      if (!_allScoreFieldsValid(analysis)) return null;
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
  function seedCache(baziData, gender, analysis) {
    if (!baziData || !analysis) return;
    if (!analysis.step2b_shishen) return; // 老结构（v2及更早）存档：不种缓存
    if (!_allScoreFieldsValid(analysis)) return; // 老结构（v3及更早）/坏数据存档：不种缓存
    const hash = _hash(baziData, gender);
    _lsSet(hash, analysis);
  }

  return { getAnalysis, clearCache, seedCache, getLastError, isValidScore };
})();
