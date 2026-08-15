/**
 * 司马八字 · 五行经营机制 · 核心数据模型 wuxing-maintenance.js
 *
 * 第四阶段"五行游戏经营机制"（拖拽维护+时间衰减+四层付费结构）的数据层。
 * 本文件是 js/wuxing-scene.js（3D挂载，frontend-3d领域）、js/wuxing-drag.js
 * （拖拽交互，frontend-3d领域）、js/products.js（灵气兑换，user-system领域）、
 * js/tasks.js（动态任务卡片，user-system领域）四个下游消费者共同依赖的唯一
 * 权威数据源——单向依赖，本文件不反向依赖它们。
 *
 * 职责边界：
 *   - 不改 js/wuxing-issues.js（判定逻辑，bazi-pipeline领域，本轮不动）；
 *     本文件只消费 WuxingIssues.deriveIssues() 算出的 {wx, direction, severity}，
 *     自己不重新判定"命盘有没有这个问题"。
 *   - 不复用 js/user-state.js 内部私有的 get()/set() 辅助（保持模块解耦，
 *     方案文档明确要求），自己管理独立的 localStorage key（见 LS_KEY）。
 *   - 但 baziKey 的计算复用 UserState.baziKey()（该函数本身已注明"只有这一处
 *     实现，不要另外新写一份重复的哈希逻辑"，供外部模块复用），不是"内部私有
 *     get/set"，两者不矛盾。
 *   - 不复用 js/user-state.js::resolveWuxingIssue()/isWuxingIssueResolved()/
 *     smb_wuxing_resolved——那是第三阶段"兑换=永久resolve、热点翻牌消失"的
 *     二元语义，跟本轮"3档tier+可持续衰减"语义完全不同。偷偷改语义会让第三
 *     阶段上线当天已经用旧逻辑兑换过水晶的早期用户被追溯降级。旧函数/旧key
 *     原样保留不删不改，本文件新代码不调用它们。
 *
 * 数据模型：localStorage key `smb_wuxing_maintenance`，单个JSON对象，
 * key = `${baziKey}|${wx}|${direction}`，value = record：
 *   {
 *     baseTier,                 // 1|2|3，命盘固有severity起点，issue创建时算一次不再变
 *     createdAt,                // epoch ms，issue首次被 getState() 命中创建的时间
 *     lastMaintainedAt,         // epoch ms|null，最近一次真实维护（免费拖拽/瞬间调理）的时间
 *     firstCycleConsumed,       // bool，这条issue是否已经历过第一次衰减周期（首次2天/之后3天）
 *     ownershipTier,            // 'none'|'crystal'|'shrine'
 *     ownershipProductId,       // 对应兑换的商品id，未拥有时为null
 *     lastFreeMaintainUTCDate,  // 'YYYY-MM-DD'（UTC），①免费拖拽维护每日一次上限判定用
 *   }
 *
 * tier 本身不存储——每次 getState() 懒计算（见 _computeTier()，与方案文档
 * 309-326行给出的 computeTier 伪代码逐行对应），多设备同步时也不同步这个字段
 * （见文件底部 syncFromCloud() 注释）。
 *
 * 公开 API（前四个函数签名已与 frontend-3d/products.js 冻结，不要擅自修改
 * 参数顺序/返回值形状）：
 *   WuxingMaintenance.getState(baziData, wx, direction, severity)
 *     → { tier, ownershipTier, lastMaintainedAt, createdAt, healthPercent, daysUntilDecay }
 *     （2026-08-15新增 healthPercent/daysUntilDecay 两个纯派生字段——不是新的
 *     冻结契约参数，是对已冻结返回值形状的追加字段，前四个字段行为不变，见
 *     getState() 定义处注释）
 *   WuxingMaintenance.maintain(baziData, wx, direction, severity)
 *     → { ok:true, spiritEarned, newTier:1 }
 *     | { ok:false, reason:'daily_limit'|'invalid_params'|'already_shrined' }
 *   WuxingMaintenance.instantFix(baziData, wx, direction, severity)
 *     → { ok:true, spiritCost, newTier:1 }
 *     | { ok:false, reason:'insufficient_spirit'|'invalid_params'|'already_shrined' }
 *   WuxingMaintenance.setOwnership(baziData, wx, direction, ownershipTier, productId)
 *     → void
 *
 * 另外新增两个纯函数（不在冻结签名之列，供UI提前算价/算奖励用，不产生副作用）：
 *   WuxingMaintenance.instantFixCost(tier, severity) → number
 *   WuxingMaintenance.maintainReward(tier, severity)  → number
 * 以及多设备合并入口：
 *   WuxingMaintenance.syncFromCloud(baziData) → Promise<void>
 */
const WuxingMaintenance = (() => {

  const LS_KEY = 'smb_wuxing_maintenance';

  // ── 底层存储（本模块独立管理，不复用 user-state.js 私有 get/set）─────────
  function _readAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  function _writeAll(all) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch (e) { /* 存储满/隐私模式等，静默失败不阻断内存态操作 */ }
  }
  function _recKey(baziKey, wx, direction) { return baziKey + '|' + wx + '|' + direction; }

  // baziKey 复用 UserState 唯一实现（见文件头注释），typeof 防御同项目既有惯例。
  function _baziKeyOf(baziData) {
    if (typeof UserState !== 'undefined' && typeof UserState.baziKey === 'function') {
      try { return UserState.baziKey(baziData) || null; } catch (e) { return null; }
    }
    return null;
  }

  function _validDirection(direction) { return direction === 'nourish' || direction === 'restrain'; }

  // UTC自然日字符串——①免费维护每日一次上限用UTC而不是本地时区，避免"跨时区
  // 用户在本地日界线附近多打一次卡"这类边缘case，且不复用 user-state.js 私有
  // 的 _todayStr()（那个是本地时区，语义不同，方案文档351-354行明确要求
  // 新写一个 _utcDateStr()，不要混用）。
  function _utcDateStr(ts) {
    const d = (typeof ts === 'number') ? new Date(ts) : new Date();
    return d.toISOString().slice(0, 10);
  }

  // severity(0-2，命理静态属性) → baseTier(1-3档位) 映射：0→1安泰起点/1→2见微
  // 起点/2→3亟待起点，与方案文档"档位表"逐行对应。
  function _baseTierFromSeverity(severity) {
    const s = Number(severity) || 0;
    if (s <= 0) return 1;
    if (s === 1) return 2;
    return 3;
  }

  // 取出（或首次创建并持久化）一条record，返回 {all, key, rec}，all/key供
  // 调用方后续原地改字段再一次性写回，避免同一次操作里多次JSON.stringify。
  function _getOrCreateRecord(baziKey, wx, direction, severity) {
    const all = _readAll();
    const key = _recKey(baziKey, wx, direction);
    let rec = all[key];
    if (!rec) {
      rec = {
        baseTier:               _baseTierFromSeverity(severity),
        createdAt:               Date.now(),
        lastMaintainedAt:        null,
        firstCycleConsumed:      false,
        ownershipTier:           'none',
        ownershipProductId:      null,
        lastFreeMaintainUTCDate: null,
      };
      all[key] = rec;
      _writeAll(all);
    }
    return { all, key, rec };
  }

  // ── tier 懒计算（方案文档309-326行伪代码的逐行实现，2026-08-16
  //    qa-reviewer CONFIRMED修复：不再依赖持久化的 firstCycleConsumed 标记）──
  // 修复前的历史bug：cycleFirst 的初始值曾经读自持久化的 rec.firstCycleConsumed，
  // 且 getState() 会在"这次计算真的跨越过一次"时把它提前写回true。因为
  // computeTier() 本身是"每次都从 anchorTime 重新算起"的纯懒计算（不是增量
  // 累加），一旦 firstCycleConsumed 被提前锁定为true，往后任何一次重新从
  // anchorTime算起的计算，第一段窗口也会被迫使用3天阈值而不是2天——这会让
  // "从未维护过的issue"在特定时间窗口内(约day2~day3之间)算出比"完全没被
  // 观察过"更低的tier，也就是"tier会因为被多看了一眼而倒退"，且要等满一个
  // 完整3天周期才恢复。qa-reviewer用打桩Date.now()实测确认了这个回归。
  //
  // 修复：cycleFirst 改成纯派生量——只要这条issue从未维护过
  // （rec.lastMaintainedAt为null），就永远处于"首次周期"，本次计算的第一段
  // 窗口固定用2天阈值，不管这是第1次还是第100次调用getState()都得到同一个
  // 结果；一旦真的维护过一次（免费拖拽/瞬间调理/买水晶——三者成功时都会显式
  // 设置 lastMaintainedAt），往后全部按3/6天节奏算，同样不依赖任何独立的
  // "是否观察到跨越"标记。rec.firstCycleConsumed 字段本身仍然保留（写入
  // maintain()/instantFix()/setOwnership() crystal分支时机与lastMaintainedAt
  // 同步），但现在纯粹是跟随lastMaintainedAt的冗余信息，供Supabase
  // wuxing_maintenance_state 表的既有列结构/多设备合并逻辑读写，不再被
  // _computeTier() 读取、不再影响tier计算结果。
  // 2026-08-15 新增 windowElapsedMs/windowThresholdMs 派生量（供 getState() 算
  // healthPercent/daysUntilDecay 用，见下方 getState() 注释）：不改变 tier 本身
  // 的计算结果——tier 相关的三行（`tier<3`判断/`remaining-=thresholdMs`/
  // `tier+=1`）与修复前逐字节一致，唯一区别是循环条件从 `while (tier < 3)`
  // 放宽成 `while (true)`，让 tier 封顶到3之后循环依然按同样节奏继续消耗
  // remaining（只是不再递增tier，靠 `if (tier < 3) tier += 1` 这一行保证），
  // 从而在 tier===3 时依然能算出"当前这一段窗口还剩多久"——tier<3时，这个
  // 改动等价于原逻辑（因为原本 break 的条件`remaining < thresholdMs`没变，
  // 只是从"抛弃remaining/thresholdMs"变成"把它们返回给调用方"）。
  function _computeTier(rec) {
    if (rec.ownershipTier === 'shrine') {
      // 已永久巩固：没有"还剩多久会恶化"这回事，windowThresholdMs 留 null，
      // 由 getState() 据此把 daysUntilDecay 置为 null、healthPercent 钉死100。
      return { tier: 1, windowElapsedMs: 0, windowThresholdMs: null };
    }

    let tier = rec.lastMaintainedAt ? 1 : rec.baseTier;
    const anchorTime = rec.lastMaintainedAt || rec.createdAt;
    let remaining = Date.now() - anchorTime;
    let cycleFirst = !rec.lastMaintainedAt; // 纯派生：从未维护过 = 永远的"首次周期"

    while (true) {
      const thresholdDays = (rec.ownershipTier === 'crystal') ? 6 : (cycleFirst ? 2 : 3);
      const thresholdMs = thresholdDays * 86400000;

      // 2026-08-16 qa-reviewer第三轮CONFIRMED修复：循环条件从 `while(tier<3)`
      // 放宽成 `while(true)` 之后，终止性完全依赖 remaining 最终会小于
      // thresholdMs（一个有限数）——`while(tier<3)`本身自带"最多迭代3次"的
      // 结构性终止保证，但`while(true)`没有，只靠数值收敛。remaining 一旦是
      // NaN/Infinity（比如 createdAt 字段缺失、或localStorage被手动改坏存了
      // 非法值），`remaining < thresholdMs` 恒为false，循环永不退出——这不是
      // 能catch住的异常，是真正的浏览器主线程死循环，只能强制关闭标签页。
      // 当前代码库暂时没有会写入非法时间戳的路径（auth.js/
      // _remoteRowToRecordShape()/_mergeRecord()都有防御），但 getState() 现在
      // 是3D环每2秒轮询的高频调用点，删掉这个本来免费的终止保证、换来的后果
      // 是不可恢复的卡死，不应该带着上线——这里补回一道有限性防线：一旦
      // remaining不是有限数，直接安全返回当前已经算出的tier（不再继续这一轮
      // 迭代去猜一个同样可能是错的窗口进度），不让循环有机会走到"永不退出"
      // 的状态。
      if (!isFinite(remaining)) {
        return { tier: Math.min(tier, 3), windowElapsedMs: 0, windowThresholdMs: thresholdMs };
      }

      if (remaining < thresholdMs) {
        // 当前这段窗口还没走完——remaining/thresholdMs 就是"这一档还剩多久"
        // 的现成分子分母，tier此时可能还没封顶（正常break语义，跟修复前一致）
        // 也可能已经封顶在3（本次循环第2轮及以后才会走到这个分支），两种
        // 情形下 windowElapsedMs/windowThresholdMs 语义相同，调用方不需要
        // 关心tier是否封顶。
        //
        // 2026-08-16 qa-reviewer PLAUSIBLE修复（时钟回拨/多设备时钟偏差）：
        // remaining 理论上应该恒非负（Date.now() - anchorTime，anchorTime是
        // 过去的时间戳），但 _mergeRecord() 用 `_maxNullable()` 合并多设备的
        // lastMaintainedAt 时，如果某台设备时钟偏快，同步来的"未来"时间戳会
        // 让 anchorTime 落在 Date.now() 之后，remaining 算出负数。这里 clamp
        // 到不小于0——时钟偏差导致的"未来锚点"按"这一档刚刚重置、还没开始
        // 消耗"处理，不能让 windowElapsedMs 是负的（会让 getState() 算出的
        // daysUntilDecay 超出该窗口理论上限，比如3天窗口显示"约4天后恶化"）。
        return { tier: Math.min(tier, 3), windowElapsedMs: Math.max(0, remaining), windowThresholdMs: thresholdMs };
      }
      remaining -= thresholdMs;
      if (tier < 3) tier += 1; // tier本身的计算结果与修复前完全一致：封顶后不再递增
      cycleFirst = false; // 本次计算内只有第一段窗口用2天阈值，之后全部按3天算
    }
  }

  // 2026-08-16 qa-reviewer第三轮CONFIRMED修复：healthPercent 此前只用
  // "当前窗口剩余比例"（跟tier完全无关）算出0-100，导致tier=3（最差档）的
  // 问题第一次被读取时（窗口刚开始）显示 healthPercent=100——面板/3D环呈现
  // "满格绿色健康"，紧挨着"花N灵气立即调理"按钮并排出现，直接推翻"一眼看出
  // 哪条问题快恶化"的设计目标；且tier全程钉死3、什么都没变好时，
  // healthPercent会每个窗口周期从接近0跳回100一次（因为算的是"这一段窗口
  // 内部进度"，不是"这条问题总体多健康"）——tier1时两种含义碰巧同向所以
  // 没暴露，tier>1才会自相矛盾。
  //
  // 修复：healthPercent 现在同时编码 tier 本身——每个tier对应一个专属的
  // 数值区间，档位越差，可能达到的区间上限越低，不管窗口内部进度如何都不会
  // 越过所在档位的区间：
  //   tier1（安泰）→ [61,100]
  //   tier2（见微）→ [31,60]
  //   tier3（亟待）→ [0,30]
  // 区间边界故意精确对齐 js/wuxing-scene.js::_updateHealthRing() 里3D环颜色
  // 判定的既有阈值（`pct>60`绿/`pct>30`黄/否则红，见该文件注释与index.html
  // 对应CSS注释）——用/3均分成约33%一档看似更"整齐"，但跟前端已经上线的
  // 60/30阈值对不齐（比如tier2区间的上半段会越过60而被误判成绿色），这里
  // 特意不用均分，而是让每个tier的区间边界卡在frontend-3d的着色阈值上，
  // 这样"tier语义修对了"就自动等价于"3D环颜色也对了"，frontend-3d不需要
  // 跟着改一次颜色判定代码。TIER_HEALTH_FLOOR/WIDTH 与 wuxing-scene.js 的
  // 60/30阈值是"两处独立数字必须保持一致"的耦合点，同项目里哈希算法/severity
  // 分档阈值的双实现同步教训——未来若frontend-3d调整3D环的颜色阈值，这里
  // 也要同步改，本文件头/该常量定义处都留了这句提醒。
  const TIER_HEALTH_FLOOR = { 1: 61, 2: 31, 3: 0 };
  const TIER_HEALTH_WIDTH = { 1: 39, 2: 29, 3: 30 };

  /**
   * WuxingMaintenance.getState(baziData, wx, direction, severity)
   * → { tier, ownershipTier, lastMaintainedAt, createdAt, healthPercent, daysUntilDecay }
   * 不存在记录时懒创建默认记录（baseTier由severity算出）并持久化。
   * 本函数现在是纯读取（不再需要像修复前那样为了"记住已跨越过首次周期"而
   * 写回localStorage——见 _computeTier() 定义处的CONFIRMED修复说明），
   * 唯一的写入只发生在 _getOrCreateRecord() 首次创建记录时。
   *
   * healthPercent/daysUntilDecay（2026-08-15新增，与3D热点环形指示器
   * /面板进度条并行开发，frontend-3d 领域只读这两个字段，不读 tier 计算过程）：
   *   - 都是从 _computeTier() 新返回的 windowElapsedMs/windowThresholdMs
   *     （"当前这一段衰减窗口已经过去多久/这一段窗口总长多久"）派生，不
   *     引入任何新的独立计时状态，因此天然保证跟 tier 同源、不会不同步。
   *   - healthPercent = 该tier专属区间的floor + 窗口剩余比例×该区间宽度（见
   *     上方 TIER_HEALTH_FLOOR/WIDTH 定义处注释，2026-08-16修复，区间随tier
   *     单调下降，tier3永远落在[0,30]、不会再出现"最差档显示满格绿色"）。
   *   - daysUntilDecay = 当前窗口剩余时长（天，可以是小数）。tier<3时正常
   *     计算——语义是"距离下一次理论上的衰减节点还有多久"，会在用户拖拽维护
   *     后归位到"新窗口刚开始"，让用户能感知维护动作的即时反馈。
   *   - 2026-08-16 用户拍板修复（qa-reviewer第四轮PLAUSIBLE）：tier===3时
   *     healthPercent/daysUntilDecay 不再跟着窗口周期继续推进——修复前
   *     `_computeTier()`封顶后仍然继续消耗 windowElapsedMs/windowThresholdMs
   *     只是不递增tier，这曾经是"让公式统一、逻辑简单"特意保留的副作用，但
   *     实际表现是：tier已经封顶在最差档、颜色/结论（"亟待"/红色）全程没变
   *     的情况下，这个百分比数字本身还在每个周期从0诡异跳回30再逐渐掉回0，
   *     用户什么都没做数值却在莫名其妙抖动。现在tier===3时直接钉死
   *     healthPercent=0、daysUntilDecay=null，直到用户真的执行维护/瞬间
   *     调理/水晶购买（tier回到1）为止，不再有任何周期性波动。
   *     只影响这里的展示值——`_computeTier()`本身的tier计算逻辑、
   *     windowElapsedMs/windowThresholdMs 的计算完全不变（后续封顶后是否
   *     该继续推进这两个内部字段，取决于未来是否还有别的消费方需要它们；
   *     目前唯一消费方就是这里，钉死在展示层做，不去动数据源，改动面更小、
   *     也不影响下方已经用200000+组fuzz验证过的tier计算本身）。
   *   - ownershipTier==='shrine'：healthPercent固定100、daysUntilDecay固定
   *     null——已永久巩固，没有"还剩多久会恶化"这个概念，_computeTier() 对应
   *     分支的 windowThresholdMs 为 null，这里据此特判而不是用0除以0。
   *   - 维护动作（免费拖拽 maintain()/瞬间调理 instantFix()/水晶
   *     setOwnership(...,'crystal',...)）成功后 tier 会变回1（不再是3），下一次
   *     getState() 调用会自然跳过tier3特判分支、走回正常公式——rec.
   *     lastMaintainedAt 已经被置为 Date.now()，anchorTime变为"现在"，窗口内
   *     剩余比例回到100%，healthPercent自然算出tier1区间的上限
   *     （61+39=100），不需要这两个新字段有任何独立的重置逻辑。
   */
  function getState(baziData, wx, direction, severity) {
    const baziKey = _baziKeyOf(baziData);
    if (!baziKey || !wx || !_validDirection(direction)) {
      // 防御性兜底：调用方传参异常时不抛错，返回一个"安泰"态的空壳，避免UI层
      // 因为一次异常输入直接崩溃——正常调用路径不会走到这里。
      return { tier: 1, ownershipTier: 'none', lastMaintainedAt: null, createdAt: null, healthPercent: 100, daysUntilDecay: null };
    }
    const { rec } = _getOrCreateRecord(baziKey, wx, direction, severity);
    const { tier, windowElapsedMs, windowThresholdMs } = _computeTier(rec);
    const isShrine = rec.ownershipTier === 'shrine';
    // tier===3钉死分支须在shrine分支之后判断吗？不需要——shrine态下
    // _computeTier()顶部已经把tier短路成1，永远不会是3，两个特判互斥、
    // 判断顺序不影响结果，这里沿用原有isShrine优先判断的写法保持一致。
    let healthPercent, daysUntilDecay;
    if (isShrine) {
      healthPercent = 100;
      daysUntilDecay = null;
    } else if (tier >= 3) {
      // 2026-08-16 用户拍板修复：见上方 getState() 头部注释——tier封顶后
      // 不再让这两个值跟着窗口周期抖动，直接钉死。
      healthPercent = 0;
      daysUntilDecay = null;
    } else {
      const elapsedFraction   = windowThresholdMs > 0 ? Math.max(0, Math.min(1, windowElapsedMs / windowThresholdMs)) : 0;
      const remainingFraction = 1 - elapsedFraction;
      const floor = TIER_HEALTH_FLOOR[tier] || 0;
      const width = TIER_HEALTH_WIDTH[tier] || 0;
      healthPercent = Math.max(0, Math.min(100, Math.round(floor + remainingFraction * width)));
      daysUntilDecay = Math.max(0, (windowThresholdMs - windowElapsedMs) / 86400000);
    }
    return {
      tier,
      ownershipTier:    rec.ownershipTier,
      lastMaintainedAt: rec.lastMaintainedAt,
      createdAt:        rec.createdAt,
      healthPercent,
      daysUntilDecay,
    };
  }

  // ── 免费维护/瞬间调理的灵气公式（单一实现，maintain()/instantFix()与UI层
  //    "花N灵气立即调理"按钮预览价格共用同一份，不允许出现两份不同步的公式）──
  // 维护奖励：问题放置越久（旧tier越高）/severity越高赚得越多，参考范围8-15。
  function maintainReward(tier, severity) {
    const t = Math.max(1, Math.min(3, Number(tier) || 1));
    const sevBonus = (Number(severity) === 2) ? 3 : 0;
    return 8 + 4 * (t - 1) + sevBonus;
  }
  // 瞬间调理成本：按档位差+severity定价，单调递增，参考范围15-50。
  function instantFixCost(tier, severity) {
    const t = Math.max(1, Math.min(3, Number(tier) || 1));
    const sevBonus = (Number(severity) === 2) ? 10 : 0;
    return 15 + 15 * (t - 1) + sevBonus;
  }

  /**
   * WuxingMaintenance.maintain(baziData, wx, direction, severity)
   * → { ok:true, spiritEarned, newTier:1 }
   *   | { ok:false, reason:'daily_limit' }
   *   | { ok:false, reason:'invalid_params' }（baziKey/wx/direction 非法——
   *     2026-08-16 qa-reviewer PLAUSIBLE修复：此前参数非法时也返回
   *     reason:'daily_limit'，会让 js/wuxing-drag.js 弹出"今天已经打理过了"
   *     这种跟真实原因无关的误导性提示；参数非法在正常调用路径下不会发生，
   *     单独分支只是防御性区分真实原因，不影响现有 daily_limit 判断逻辑）
   *   | { ok:false, reason:'already_shrined' }（2026-08-16 qa-reviewer第二轮
   *     CONFIRMED配套修复：ownershipTier==='shrine'的issue已经彻底退出维护
   *     循环——正常UI路径下 WuxingScene.getActiveMarkers() 已经把这类issue
   *     从拖拽目标里过滤掉，理论上碰不到这个分支，但多设备合并
   *     （syncFromCloud()）完成前那段短暂窗口期，3D标注可能还没来得及被
   *     markShrined()，此时若用户手快点了一下拖拽，不能让"已巩固"的issue
   *     被绕过守卫继续刷灵气/被当作还需要维护——这里在数据层兜底一道，不
   *     依赖UI层过滤是唯一防线）
   * 免费拖拽维护成功后调用。每条issue每UTC自然日限一次。
   */
  function maintain(baziData, wx, direction, severity) {
    const baziKey = _baziKeyOf(baziData);
    if (!baziKey || !wx || !_validDirection(direction)) return { ok: false, reason: 'invalid_params' };

    const { all, key, rec } = _getOrCreateRecord(baziKey, wx, direction, severity);
    if (rec.ownershipTier === 'shrine') return { ok: false, reason: 'already_shrined' };
    const today = _utcDateStr();
    if (rec.lastFreeMaintainUTCDate === today) return { ok: false, reason: 'daily_limit' };

    // 用维护前（本次动作生效前）的tier算奖励——"问题放置越久赚得越多"应该反映
    // 维护之前的糟糕程度，不是维护后已经归1的状态。
    const { tier: oldTier } = _computeTier(rec);
    const spiritEarned = maintainReward(oldTier, severity);

    rec.lastMaintainedAt        = Date.now();
    rec.firstCycleConsumed      = true; // 维护一次即视为"首次紧凑周期"已消耗，此后转入正常节奏
    rec.lastFreeMaintainUTCDate = today;
    all[key] = rec;
    _writeAll(all);

    if (typeof UserState !== 'undefined' && typeof UserState.addSpirit === 'function') {
      UserState.addSpirit(spiritEarned);
    }
    _syncToCloud(baziKey, wx, direction, rec);

    return { ok: true, spiritEarned, newTier: 1 };
  }

  /**
   * WuxingMaintenance.instantFix(baziData, wx, direction, severity)
   * → { ok:true, spiritCost, newTier:1 }
   *   | { ok:false, reason:'insufficient_spirit' }
   *   | { ok:false, reason:'invalid_params' }（同 maintain() 的PLAUSIBLE修复，
   *     参数非法时不再冒充"灵气不足"这个跟真实原因无关的理由）
   *   | { ok:false, reason:'already_shrined' }（同 maintain() 的CONFIRMED配套
   *     修复——已彻底退出维护循环的issue不允许再花灵气"调理"，检查须发生在
   *     实际调用 UserState.useSpirit() 扣款之前，不能等扣完钱才发现）
   * 花灵气跳过拖拽直接回1档。灵气不足时不修改任何状态（UserState.useSpirit()
   * 内部灵气不够会返回false且不扣款，这里据此直接短路返回失败）。
   */
  function instantFix(baziData, wx, direction, severity) {
    const baziKey = _baziKeyOf(baziData);
    if (!baziKey || !wx || !_validDirection(direction)) return { ok: false, reason: 'invalid_params' };

    const { all, key, rec } = _getOrCreateRecord(baziKey, wx, direction, severity);
    if (rec.ownershipTier === 'shrine') return { ok: false, reason: 'already_shrined' };
    const { tier: curTier } = _computeTier(rec);
    const cost = instantFixCost(curTier, severity);

    if (typeof UserState === 'undefined' || typeof UserState.useSpirit !== 'function' || !UserState.useSpirit(cost)) {
      return { ok: false, reason: 'insufficient_spirit' };
    }

    rec.lastMaintainedAt   = Date.now();
    rec.firstCycleConsumed = true; // 与maintain()同一理由：瞬间调理同样"用掉"首次紧凑周期
    all[key] = rec;
    _writeAll(all);
    _syncToCloud(baziKey, wx, direction, rec);

    return { ok: true, spiritCost: cost, newTier: 1 };
  }

  /**
   * WuxingMaintenance.setOwnership(baziData, wx, direction, ownershipTier, productId)
   * → void
   * 由 Products.redeem() 兑换成功后调用。设置 ownershipTier/ownershipProductId
   * 并持久化。
   *
   * 2026-08-16 qa-reviewer CONFIRMED修复：此前的实现注释宣称"不改变
   * lastMaintainedAt等其它字段，3D视觉上的立即调理到档位1由调用方另行调用
   * WuxingScene.reflectTier(wx,direction,1)处理"——但 reflectTier() 只是改
   * 3D外观，getState() 下一次懒计算依然会从 baseTier 重新起算。结果是severity
   * ≥1的问题买完水晶后，getState().tier 完全不变（比如severity=2的问题买完
   * 水晶后台账依然是tier3），面板重渲染立刻显示"花55灵气立即调理"这类
   * 自相矛盾的按钮，直接违反方案文档397行"水晶购买唯一新增的动作：
   * setOwnership(...,'crystal',...)延长衰减周期+reflectTier(wx,direction,1)
   * 立即调理到档位1"——"立即调理到档位1"必须是真实状态变化，不能只是一次性
   * 视觉特效。修复：crystal分支跟 maintain()/instantFix() 成功时做的事保持
   * 一致，显式推进 lastMaintainedAt/firstCycleConsumed。shrine分支不需要这么
   * 做——_computeTier() 顶部已经对 ownershipTier==='shrine' 做了"永远返回1"
   * 的特判，不依赖 lastMaintainedAt。
   */
  function setOwnership(baziData, wx, direction, ownershipTier, productId) {
    const baziKey = _baziKeyOf(baziData);
    if (!baziKey || !wx || !_validDirection(direction)) return;
    if (ownershipTier !== 'crystal' && ownershipTier !== 'shrine') return;

    // 2026-08-16 qa-reviewer PLAUSIBLE修复：setOwnership() 的4参数签名是
    // 冻结契约，没有severity可传——正常调用路径下这条issue必然已经在面板
    // 渲染时被 getState() 命中创建过record（Products.redeem() 的调用点在那
    // 之后），下面 _getOrCreateRecord(...,0) 的 severity=0 只是"记录理论上
    // 不该缺失"这种情形的兜底值，会让 baseTier 被错误地钉死成1且不再有机会
    // 修正。这里在真正命中这种（不应发生的）情形时打一条warn，方便未来任何
    // 新调用方（忘记先调用一次 getState()）第一时间在控制台看到异常，而不是
    // 静默产生一条 baseTier 错误的记录。
    const recKey = _recKey(baziKey, wx, direction);
    if (!_readAll()[recKey]) {
      console.warn('[WuxingMaintenance] setOwnership() 在record不存在时被调用（' + recKey + '）——baseTier将被兜底设为1，正常调用路径应先调用一次 getState() 创建带正确severity的记录。');
    }

    const { all, key, rec } = _getOrCreateRecord(baziKey, wx, direction, 0);
    rec.ownershipTier      = ownershipTier;
    rec.ownershipProductId = productId || null;
    if (ownershipTier === 'crystal') {
      rec.lastMaintainedAt   = Date.now();
      rec.firstCycleConsumed = true; // 纯信息性字段（见 _computeTier() 定义处说明），跟随lastMaintainedAt同步
    }
    all[key] = rec;
    _writeAll(all);
    _syncToCloud(baziKey, wx, direction, rec);
  }

  // ── 多设备同步：写 ─────────────────────────────────────────────────
  // fire-and-forget，未登录/AuthManager尚未实现对应函数时静默跳过——本地
  // localStorage写入已经在调用方完成，云端只是"备份供换设备取回"，不阻断
  // 任何本地操作的即时可用性（与 js/user-state.js::_syncSpiritToCloud() 同款
  // 设计取舍）。
  function _syncToCloud(baziKey, wx, direction, rec) {
    if (typeof AuthManager === 'undefined' || typeof AuthManager.isLoggedIn !== 'function' || !AuthManager.isLoggedIn()) return;
    if (typeof AuthManager.syncWuxingMaintenanceState !== 'function') return;
    try {
      AuthManager.syncWuxingMaintenanceState(baziKey, wx, direction, rec);
    } catch (e) { /* fire-and-forget，不阻断本地操作 */ }
  }

  // ── 多设备同步：读 + 逐字段单调合并 ───────────────────────────────────
  // 不是 spirit_balance 那种整值取较大值——这是复合对象，每个字段各自选一个
  // "只会变好不会倒退"的方向合并（方案文档383行附近）：
  //   lastMaintainedAt  取较大（更晚维护过 = 更新鲜）
  //   ownershipTier     取等级较高者（none < crystal < shrine）
  //   ownershipProductId 跟随 ownershipTier 胜出方一起采用
  //   firstCycleConsumed 取 OR（任一端已消耗首次周期就算已消耗）
  //   createdAt         取较小（更早创建 = 更接近真实首次遇到这个问题的时间）
  //   lastFreeMaintainUTCDate 取较大日期字符串（字符串按 'YYYY-MM-DD' 格式可
  //     直接用字符串比较，等价于日期比较）
  //   baseTier          不参与合并——命理静态属性，本地若已存在则保留本地值
  //     （理论上两端算出的baseTier对同一命盘同一issue应该恒等，不存在冲突）
  //   tier 本身不同步——纯派生量，两端各自现算，见 _computeTier()。
  const _OWNERSHIP_RANK = { none: 0, crystal: 1, shrine: 2 };

  function _remoteRowToRecordShape(row) {
    return {
      baseTier:                row.base_tier,
      createdAt:                row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      lastMaintainedAt:         row.last_maintained_at ? new Date(row.last_maintained_at).getTime() : null,
      firstCycleConsumed:       !!row.first_cycle_consumed,
      ownershipTier:            row.ownership_tier || 'none',
      ownershipProductId:       row.ownership_product_id || null,
      lastFreeMaintainUTCDate:  row.last_free_maintain_date || null,
    };
  }

  function _maxNullable(a, b) {
    if (a == null) return b == null ? null : b;
    if (b == null) return a;
    return Math.max(a, b);
  }
  function _maxDateStr(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return a > b ? a : b;
  }

  function _mergeRecord(local, remote) {
    const ownershipRemoteWins = (_OWNERSHIP_RANK[remote.ownershipTier] || 0) > (_OWNERSHIP_RANK[local.ownershipTier] || 0);
    return {
      baseTier:                (local.baseTier != null) ? local.baseTier : remote.baseTier,
      createdAt:                Math.min(local.createdAt || Date.now(), remote.createdAt || Date.now()),
      lastMaintainedAt:         _maxNullable(local.lastMaintainedAt, remote.lastMaintainedAt),
      firstCycleConsumed:       !!(local.firstCycleConsumed || remote.firstCycleConsumed),
      ownershipTier:            ownershipRemoteWins ? remote.ownershipTier : local.ownershipTier,
      ownershipProductId:       ownershipRemoteWins ? remote.ownershipProductId : local.ownershipProductId,
      lastFreeMaintainUTCDate:  _maxDateStr(local.lastFreeMaintainUTCDate, remote.lastFreeMaintainUTCDate),
    };
  }

  /**
   * WuxingMaintenance.syncFromCloud(baziData) → Promise<void>
   * 登录成功/岛屿加载时调用（见 js/auth.js::AuthUI._mergeWuxingMaintenanceState()
   * 与 js/main-new.js::_onIslandReady() 两处调用点）。拉取当前命盘在云端的全部
   * 维护记录，与本地逐字段单调合并后写回 localStorage，并把合并结果fire-and-
   * forget推回云端（保持双端最终一致，幂等无害——即使推回的内容与云端已有值
   * 完全相同也不会产生副作用）。
   */
  async function syncFromCloud(baziData) {
    if (typeof AuthManager === 'undefined' || typeof AuthManager.isLoggedIn !== 'function' || !AuthManager.isLoggedIn()) return;
    if (typeof AuthManager.getWuxingMaintenanceStates !== 'function') return;

    const baziKey = _baziKeyOf(baziData);
    if (!baziKey) return;

    let remoteList = [];
    try {
      remoteList = await AuthManager.getWuxingMaintenanceStates(baziKey) || [];
    } catch (e) {
      return; // 网络错误等：静默放弃这次合并，本地数据原样可用，不影响主流程
    }
    if (!remoteList.length) return;

    const all = _readAll();
    let changed = false;

    remoteList.forEach(row => {
      if (!row || !row.wx || !_validDirection(row.direction)) return;
      const key = _recKey(baziKey, row.wx, row.direction);
      const localRec = all[key] || {
        baseTier:                row.base_tier || 1,
        createdAt:                Date.now(),
        lastMaintainedAt:         null,
        firstCycleConsumed:       false,
        ownershipTier:            'none',
        ownershipProductId:       null,
        lastFreeMaintainUTCDate:  null,
      };
      const merged = _mergeRecord(localRec, _remoteRowToRecordShape(row));
      all[key] = merged;
      changed = true;
      _syncToCloud(baziKey, row.wx, row.direction, merged); // 幂等推回，保持双端一致
    });

    if (changed) _writeAll(all);
  }

  return { getState, maintain, instantFix, setOwnership, instantFixCost, maintainReward, syncFromCloud };
})();
