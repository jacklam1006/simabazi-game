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
  const LS_PREFIX   = 'bazi_ai_v2_'; // v1→v2：后端AI深析改为六步命理框架JSON结构（2026-07-29），老v1缓存结构不兼容，换key前缀避免读到旧结构导致渲染报错

  // 后端六步RAG流水线（gemini_analysis.py::analyze_bazi()）真实耗时预算（2026-08-01
  // qa-reviewer逐行核对 gemini_analysis.py/rag_service.py 后订正，此前75秒的设定是
  // 错误的方案判断，见 claude-docs/已知问题与修复记录.md 对应订正记录）：
  //   - 单次Gemini调用 timeout=50s（gemini_analysis.py::_call_gemini_once）
  //   - _call_gemini() 每个模型最多重试2次（MAX_TOKENS加倍预算重试），
  //     ANALYSIS_MODEL_CHAIN 至少2个候选模型 → 单步最坏情况 2模型×2次×50s = 200s
  //   - 每步前还有 rag_service.query() timeout=15s（rag_service.py）
  //   - Step1→Step2 严格串行，Step3-6 用 asyncio.gather 并行发起 → 相当于3个
  //     串行阶段：Step1、Step2、max(Step3..6)，每阶段 rag(15s)+gemini(最坏200s)=215s
  //   - 零重试零冷启动下限：3 × (15+50) = 195s；全部重试+换模型的绝对最坏上限：
  //     3 × 215 = 645s（这种量级只会发生在模型链整体故障的灾难场景，不是正常慢请求）
  // 75秒远低于195秒下限，必然误杀所有正常请求（预热必超时→报告弹窗再发一次完整
  // 六步流水线→token双倍消耗，故障链详见已知问题记录）。改为400秒（约6.7分钟）：
  // 高于195秒下限、覆盖"某一步命中一次MAX_TOKENS重试"等真实场景的合理余量，同时
  // 低于10分钟（3D生成轮询沿用的惯例值，见已知问题记录2026-07-26条），只有整条模型
  // 链持续挂起的灾难场景才会真正触发这个上限——那种场景下更早反馈失败反而是合理的。
  const AI_ANALYSIS_TIMEOUT_MS = 400000;

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

  // ── localStorage ──────────────────────────────────────
  function _lsGet(hash) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + hash);
      if (!raw) return null;
      return JSON.parse(raw).analysis || null;
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
  function seedCache(baziData, gender, analysis) {
    if (!baziData || !analysis) return;
    const hash = _hash(baziData, gender);
    _lsSet(hash, analysis);
  }

  return { getAnalysis, clearCache, seedCache, getLastError };
})();
