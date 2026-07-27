/**
 * 司马八字 · AI分析缓存模块 BaziAnalysis
 *
 * 缓存层：localStorage（本地，即时）→ 后端 /analyze-bazi（后端文件缓存 + Gemini）
 * 相同八字命盘只生成一次 AI 分析，永久复用。
 *
 * 公开 API：
 *   BaziAnalysis.getAnalysis(baziData, gender) → Promise<analysis | null>
 *   BaziAnalysis.clearCache(baziData, gender)  → 清除本地缓存（调试用）
 */

const BaziAnalysis = (() => {
  const BACKEND_URL = 'https://simabazi-island.onrender.com';
  const LS_PREFIX   = 'bazi_ai_v1_';

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
  async function _fetchBackend(baziData, gender) {
    const resp = await fetch(`${BACKEND_URL}/analyze-bazi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bazi_data: baziData,
        gender: gender || '男',
      }),
    });
    if (!resp.ok) throw new Error(`backend ${resp.status}`);
    const data = await resp.json();
    return data.analysis || null;
  }

  // ── 主接口 ────────────────────────────────────────────
  /**
   * 获取 AI 分析。优先读本地缓存，miss 则调后端（后端有文件缓存 + Gemini）。
   * @param {object} baziData - BaziEngine.calculate() 的结果
   * @param {string} gender   - '男' | '女'
   * @returns {Promise<object|null>}
   */
  async function getAnalysis(baziData, gender) {
    if (!baziData || !baziData.pillars) return null;

    const hash = _hash(baziData, gender);

    // 1. localStorage 命中
    const cached = _lsGet(hash);
    if (cached) {
      console.log('[BaziAnalysis] cache hit (localStorage)');
      return cached;
    }

    // 2. 后端（含文件缓存）
    try {
      console.log('[BaziAnalysis] fetching from backend...');
      const analysis = await _fetchBackend(baziData, gender);
      if (analysis) {
        _lsSet(hash, analysis);
        console.log('[BaziAnalysis] backend OK, wrote to localStorage');
      }
      return analysis;
    } catch (e) {
      console.warn('[BaziAnalysis] backend failed:', e.message);
      return null;
    }
  }

  function clearCache(baziData, gender) {
    if (!baziData) return;
    const hash = _hash(baziData, gender);
    localStorage.removeItem(LS_PREFIX + hash);
    console.log('[BaziAnalysis] cache cleared for hash:', hash);
  }

  return { getAnalysis, clearCache };
})();
