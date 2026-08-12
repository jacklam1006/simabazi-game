/**
 * 司马八字 · 五行维护问题判定 WuxingIssues
 *
 * 第三阶段"五行维护系统"的判定层——把 BaziEngine.calculate() 已经算出的
 * `favorable`/`favorable2`/`unfavorable`（喜用神/忌神，纯命理规则、跟运行时
 * 状态无关）+ `wuxing`（五行占比）转成"这张命盘需要维护哪些五行、往哪个
 * 方向维护"的确定性列表。
 *
 * 职责边界：不改 js/bazi-engine.js 本体——排盘计算是纯函数，不该掺入运行时
 * 状态（劣化/维护/兑换这些之后会加的状态属于产品层，不属于排盘算法本身）。
 *
 * ⚠️ 唯一需要"同一逻辑两处独立实现"的地方：Python侧在
 * island_service/gemini_analysis.py::_derive_wuxing_issues() 有一份等价复刻
 * （供AI叙事prompt和后端缓存校验使用），两边阈值/分档方向/去重规则必须完全
 * 一致——本项目历史上因为"同一算法两处独立实现不同步"吃过好几次亏
 * （js/bazi-analysis.js 与 js/tutorial.js 的 `_computeHash` 双实现、
 * `_favorable()` 当年的bug），这次显式记录：**改这个文件的判定逻辑，必须
 * 同步改 island_service/gemini_analysis.py::_derive_wuxing_issues()**，反之
 * 亦然。
 *
 * 公开 API：
 *   WuxingIssues.deriveIssues(baziData) → Array<{ wx, direction, severity }>
 *     - baziData：BaziEngine.calculate() 的输出
 *     - direction: 'nourish'（favorable/favorable2 对应五行，需要"补/灌溉"）
 *                  | 'restrain'（unfavorable 对应五行，需要"克/除草"）
 *     - severity: 0-2，命理静态属性（不是动态劣化等级）。按 baziData.wuxing[wx]
 *       占比分档，阈值复用 island_service/bazi_prompt.py::wuxing_level() 已验证
 *       过的 0.35/0.20/0.06（strong/medium/weak/absent 四档）：
 *         nourish 方向：该五行占比越低severity越高（absent→2, weak→1, 其余→0）
 *         restrain 方向：该五行占比越高severity越高（strong→2, medium→1, 其余→0）
 *     - 中性五行（不在 favorable/favorable2/unfavorable 里）不产生条目。
 *     - 条目数通常2-3条，不强求固定数量（跟第一阶段trait系统"固定3+3"的思维
 *       彻底区分——命盘不同、命中的喜用神/忌神数量本就不同）。
 */

const WuxingIssues = (() => {

  // 五行占比分档阈值——与 island_service/bazi_prompt.py::wuxing_level() 完全
  // 一致，不是拍脑袋新定的数字。pct 是 0-1 的小数（该五行权重 / 五行权重总和），
  // 与 bazi_prompt.py::generate_island_prompt() 里 `wx_pct = {k: v/total ...}`
  // 同一计算方式——baziData.wuxing[wx] 本身是 js/bazi-engine.js 已经四舍五入过
  // 的 0-100 整数百分比（calculate() 116-119行），重新除以“当前这份wuxing对象
  // 各值之和”而不是假设恒为100，是为了兼容四舍五入误差（多个值各自取整后总和
  // 可能是98/99/101，不是精确100）。
  function _wuxingLevel(pct) {
    if (pct >= 0.35) return 'strong';
    if (pct >= 0.20) return 'medium';
    if (pct >= 0.06) return 'weak';
    return 'absent';
  }

  // direction × level → severity(0-2) 映射表。
  // nourish：占比越低越需要"补"，absent（几乎没有）severity最高=2，
  //          weak（偏弱）=1，medium/strong（本来就够）=0（不产生维护紧迫感）。
  // restrain：占比越高越需要"克/除草"，strong（过旺）severity最高=2，
  //           medium（偏旺）=1，weak/absent（本来就不多）=0。
  const _NOURISH_SEVERITY  = { absent: 2, weak: 1, medium: 0, strong: 0 };
  const _RESTRAIN_SEVERITY = { strong: 2, medium: 1, weak: 0, absent: 0 };

  /**
   * @param {object} baziData - BaziEngine.calculate() 输出
   * @returns {Array<{wx:string, direction:'nourish'|'restrain', severity:number}>}
   */
  function deriveIssues(baziData) {
    if (!baziData || typeof baziData.wuxing !== 'object' || !baziData.wuxing) return [];

    const wuxing = baziData.wuxing;
    // 总和现算，不假设恒为100（理由见 _wuxingLevel 上方注释）。
    let total = 0;
    for (const k in wuxing) total += Number(wuxing[k]) || 0;
    if (!total) total = 1;

    function levelOf(wx) {
      const pct = (Number(wuxing[wx]) || 0) / total;
      return _wuxingLevel(pct);
    }

    const issues = [];
    const seen = new Set(); // 防止 favorable === favorable2（理论上罕见但不假设不会发生）产生重复条目

    function addIssue(wx, direction) {
      if (!wx || typeof wx !== 'string') return; // 中和格局下 favorable2 是空字符串，跳过
      if (!(wx in wuxing)) return; // 防御：不认识的五行字符，不产生条目
      const key = wx + '|' + direction;
      if (seen.has(key)) return;
      seen.add(key);
      const level = levelOf(wx);
      const severity = direction === 'nourish' ? _NOURISH_SEVERITY[level] : _RESTRAIN_SEVERITY[level];
      issues.push({ wx, direction, severity });
    }

    addIssue(baziData.favorable, 'nourish');
    addIssue(baziData.favorable2, 'nourish');
    addIssue(baziData.unfavorable, 'restrain');

    return issues;
  }

  return { deriveIssues };
})();
