/**
 * 司马八字 · 命理装饰判定层 DecorationResolver
 *
 * 职责：把 BaziEngine.calculate() 产出的完整命盘数据，映射成"这份命盘实际
 * 命中了哪些3D装饰、命中的是哪几根柱子"的确定性列表，供 frontend-3d 领域
 * （island-decorations.js 等）消费去做3D摆放和点击交互。
 *
 * 本文件只做"判定"，不做任何摆放位置计算/Three.js场景操作——那是
 * frontend-3d 的职责，双方通过 DecorationResolver.resolve(baziData) 的
 * 返回值对接，不需要互相等待、互相不依赖对方实现细节。
 *
 * 依赖：js/decoration-catalog.js 必须先于本文件加载（提供 TEN_GOD_DECOR /
 * SHENSHA_DECOR / CHONG_DECOR / HE_DECOR / SANHE_DECOR / GANHE_DECOR 这几张
 * 静态对照表，均为该文件顶层 const，与本文件同属浏览器全局脚本作用域，
 * 不需要显式 import）。
 *
 * 数据契约（均已对照 js/bazi-engine.js::calculate()/_interactions()/_ganHe()
 * 的真实实现逐条核对，不是猜测）：
 *   - baziData.tenGods：{year,month,day,hour} → 十神中文名字符串，day柱固定
 *     是'日主'（calculate() 第124-128行）。
 *   - baziData.shensha：{year,month,day,hour} → 神煞中文名字符串数组，同一
 *     神煞可能在多个柱位各自命中一次（_shensha() 逐柱独立调用，calculate()
 *     第150-157行）。
 *   - baziData.interactions：Array<{type, desc, pillars}>，type 取值精确为
 *     '冲'/'合'/'三合'/'三会'/'三刑'/'害'/'破'/'自刑'（_interactions()，来自
 *     地支关系）以及'天干合'（_ganHe()，2026-08-18新增）——这几个字符串在
 *     bazi-engine.js 里逐字确认过，均为半角中文，无空格/全角符号变体。
 *     pillars 是字符串数组，值域固定是 'year'/'month'/'day'/'hour'
 *     （_interactions()/_ganHe() 里的 labelsEN 数组），二元关系（冲/合/
 *     天干合）pillars长度为2，三元关系（三合/三会/三刑寅巳申丑戌未）视命例
 *     实际命中数量可能≥3（triadPillars() 逐柱比对真实值，同一地支重复出现
 *     时命中位置会多于3个）。
 *   - baziData.pillars：{year,month,day,hour} → {stem, branch, ...}（对象，
 *     不是数组），即 baziData.pillars['year'].branch 这种路径，col 是key不是
 *     index（calculate() 第99-104行）。
 *
 * 三合结果地支组合 → 五行 的对照表直接抄自 bazi-engine.js::_interactions()
 * 内部权威的 HE_SAN 表（第458行），保持判定口径完全一致，不自行另定义一套。
 */

const DecorationResolver = (() => {

  // 与 js/bazi-engine.js::_interactions() 内 HE_SAN 表逐字抄一致
  // （['申','子','辰','水局'] 等，这里只取前三个地支+去掉"局"字的五行单字）：
  const SANHE_TRIADS = [
    { branches: ['申', '子', '辰'], wx: '水' },
    { branches: ['寅', '午', '戌'], wx: '火' },
    { branches: ['巳', '酉', '丑'], wx: '金' },
    { branches: ['亥', '卯', '未'], wx: '木' },
  ];

  // 与 js/bazi-engine.js::_pairKey() 完全一致的确定性key构造方式，
  // decoration-catalog.js 里所有 pairKey 表的key均以此算法的真实输出核对过。
  function _pairKey(a, b) {
    return [a, b].sort().join('');
  }

  // 从三合关系实际命中的地支集合，反查属于哪个三合局的结果五行。
  // 用"triad的3支是否都在实际命中地支集合里"判断，而不是假设branches长度
  // 恰好等于3（同一地支重复出现时命中柱位会多于3个，但triad本身只有3支）。
  function _sanheResultWx(branches) {
    const set = new Set(branches);
    for (const { branches: triad, wx } of SANHE_TRIADS) {
      if (triad.every(b => set.has(b))) return wx;
    }
    return null;
  }

  /**
   * @param {object} baziData - BaziEngine.calculate() 的完整输出
   * @returns {Array<{decorId:string, pillars:string[], name:string, meaning:string}>}
   */
  function resolve(baziData) {
    const out = [];
    // 去重策略故意分两套，不能用同一个"同decorId只留第一条"的Set笼统处理：
    //
    // 1) 十神/神煞：同一个中文名（→同一个decorId）完全可能出现在两个不同柱位
    //    （比如"天乙贵人"同时命中年柱和时柱），这在需求里被明确要求按柱位分别
    //    各输出一条独立记录（每条 pillars 只含1个柱位）——因为这是两个独立的
    //    视觉锚点，不是"一条关系由两柱共同触发"。所以这里去重键是
    //    `decorId + 该柱位`，只防"同一柱位同一名字被重复处理两次"这种真正的
    //    程序性重复，不会误伤"同名神煞落在不同柱位"的合法多条输出。
    // 2) 地支冲/合/三合/天干合：一条关系本身就是由两（或三）根柱子共同触发的
    //    单一视觉概念（pillars数组里已经包含了全部参与柱位）。但同一个decorId
    //    完全可能被两组不同的柱位组合各自独立触发——只要某个地支/天干在命盘里
    //    重复出现（这是真实存在的常见情况，不是边界case），比如子午冲可能
    //    同时出现在[month,day]和[day,hour]两组柱位组合。这种情况下两组都是
    //    命盘里真实存在、需要各自独立呈现的关系，不能因为decorId相同就丢弃
    //    其中一组。所以去重键必须是`decorId + 参与柱位组合`，跟下游
    //    island-decorations.js 的 placementKey（decorId + '@' + pillars.join('_')）
    //    同一粒度，只防"同一组柱位组合被重复处理两次"这种真正的程序性重复
    //    （理论上 bazi-engine.js 里 pairwise 双循环不会对同一对下标重复计算，
    //    这道去重仍作为保险保留，但不会误伤"同decorId不同柱位组合"的合法多条
    //    输出）。
    const seenAnchorKeys = new Set();   // 十神/神煞：decorId + '@' + 柱位
    const seenRelationKeys = new Set(); // 地支关系/天干合：decorId + '@' + 柱位组合

    function emitAnchor(entry, pillars, name) {
      if (!entry || !entry.decorId) return;
      const key = entry.decorId + '@' + pillars[0];
      if (seenAnchorKeys.has(key)) return;
      seenAnchorKeys.add(key);
      out.push({ decorId: entry.decorId, pillars, name, meaning: entry.meaning });
    }

    function emitRelation(entry, pillars, name) {
      if (!entry || !entry.decorId) return;
      const key = entry.decorId + '@' + pillars.join('_');
      if (seenRelationKeys.has(key)) return;
      seenRelationKeys.add(key);
      out.push({ decorId: entry.decorId, pillars, name, meaning: entry.meaning });
    }

    if (!baziData || typeof baziData !== 'object') return out;

    // ── 十神：year/month/hour三柱，day柱固定'日主'不产生装饰 ──────────
    const tenGods = baziData.tenGods || {};
    for (const col of ['year', 'month', 'hour']) {
      const name = tenGods[col];
      if (!name) continue;
      const entry = TEN_GOD_DECOR[name];
      if (entry) emitAnchor(entry, [col], name);
    }

    // ── 神煞：四柱各自独立判定，同一神煞出现在多个柱位各自输出一条 ────
    const shensha = baziData.shensha || {};
    for (const col of ['year', 'month', 'day', 'hour']) {
      const list = Array.isArray(shensha[col]) ? shensha[col] : [];
      for (const name of list) {
        const entry = SHENSHA_DECOR[name];
        if (entry) emitAnchor(entry, [col], name);
      }
    }

    // ── 地支冲/合、三合、天干合（其余类型资产未生成，静默跳过）────────
    const interactions = Array.isArray(baziData.interactions) ? baziData.interactions : [];
    const pillars = baziData.pillars || {};

    for (const it of interactions) {
      if (!it || !Array.isArray(it.pillars) || it.pillars.length < 2) continue;

      switch (it.type) {
        case '冲': {
          const [p1, p2] = it.pillars;
          const b1 = pillars[p1] && pillars[p1].branch;
          const b2 = pillars[p2] && pillars[p2].branch;
          if (!b1 || !b2) break;
          const entry = CHONG_DECOR[_pairKey(b1, b2)];
          // 用catalog里的规范name（按命理惯用顺序），不用b1/b2遇到顺序动态
          // 拼接——同一冲可能因地支重复同时命中两组柱位，遇到顺序不固定，
          // 动态拼接会让用户同时看到"子午冲"和"午子冲"两种写法
          if (entry) emitRelation(entry, it.pillars, entry.name);
          break;
        }
        case '合': {
          const [p1, p2] = it.pillars;
          const b1 = pillars[p1] && pillars[p1].branch;
          const b2 = pillars[p2] && pillars[p2].branch;
          if (!b1 || !b2) break;
          const entry = HE_DECOR[_pairKey(b1, b2)];
          if (entry) emitRelation(entry, it.pillars, entry.name);
          break;
        }
        case '三合': {
          const branches = it.pillars
            .map(p => pillars[p] && pillars[p].branch)
            .filter(Boolean);
          const wx = _sanheResultWx(branches);
          const entry = wx && SANHE_DECOR[wx];
          if (entry) emitRelation(entry, it.pillars, `三合${wx}局`);
          break;
        }
        case '天干合': {
          const [p1, p2] = it.pillars;
          const s1 = pillars[p1] && pillars[p1].stem;
          const s2 = pillars[p2] && pillars[p2].stem;
          if (!s1 || !s2) break;
          const entry = GANHE_DECOR[_pairKey(s1, s2)];
          if (entry) emitRelation(entry, it.pillars, entry.name);
          break;
        }
        default:
          // 三会/三刑/自刑/害/破：对应资产尚未生成（见 decoration-catalog.js
          // 文件末尾注释），静默跳过，不报错、不产生装饰记录。
          break;
      }
    }

    return out;
  }

  return { resolve };
})();
