/**
 * 司马八字 · 五行维护系统 3D挂载 wuxing-scene.js
 *
 * 2026-08-13：第三阶段"五行维护系统"（把岛屿地形本身变成命盘问题的具象化
 * 呈现），取代第一/二阶段的✅/⚠️ trait图标标注（island-annotate.js 的
 * TRAIT_LAYOUT/attachTraits()，见该文件顶部停用说明——本模块是替代者）。
 *
 * 职责边界：本文件只负责"把 issues 数组渲染成3D场景里的可点击装饰"，不负责
 * 判定问题（js/wuxing-issues.js::deriveIssues()，bazi-pipeline领域）、不负责
 * AI叙事拼装（main-new.js接线部分，user-system领域）、不负责详情面板渲染
 * （js/analysis.js::buildMaintenancePanel()）。本文件只消费一个约定好形状的
 * issues数组：
 *   Array<{ wx, direction:'nourish'|'restrain', severity:0-2,
 *           title, narrative, action_hint }>
 *
 * 复用 island-annotate.js 已验证过的包围盒定位逻辑（getIslandBox()/
 * layoutToWorld()），不重新实现射线贴地。
 *
 * 交互模式沿用 island-annotate.js::attachTraits() 的"CSS2DObject小圆点热点
 * → 点击展开卡片 → 卡片点击触发 onIslandZoneClick"三段式设计（含同一套
 * "展开时暂停场景自转/避免视口裁切"修复），只是环形布局点数从6个降到
 * 通常2-3个（issues.length，由命理判定动态决定，不强求固定数量）。
 *
 * 关键坑（务必保持）：window.onIslandZoneClick(zoneKey, baziData, force, extra)
 * 调用时的 {wx, direction, severity, title, narrative, action_hint} 必须在
 * 创建热点DOM时就用闭包直接携带，不能指望点击那一刻去查某个模块级变量——
 * 这是四柱/神煞面板早年踩过、trait系统重蹈过一次才修好的坑（见已知问题
 * 与修复记录.md），本文件从一开始就避开同一类问题。
 *
 * 2026-08-13追加：markResolved(wx, direction) —— 灵气兑换成功后（
 * js/products.js::redeem()）调用，把对应"问题"标注/装饰翻转为"已改善"
 * 视觉反馈（翻牌✅+发光过渡后移除），呼应第二阶段
 * island-annotate.js::markTraitResolved() 同一套设计语言。
 * 【注意】第四阶段 js/products.js 已经完全迁移到下面的 reflectTier()/
 * markShrined()，不再调用这个函数——markResolved() 目前零调用方，纯保留
 * 代码（不删除的理由跟 island-annotate.js 顶部停用说明一致：仍是这套
 * "翻牌+彻底删除热点"视觉语言的参考实现）。它的设计意图本来就跟
 * reflectTier()/markShrined() 是两套不同语义，不要混用/复用彼此的实现。
 *
 * 2026-08-15追加（第四阶段"拖拽维护+时间衰减+四层付费结构"）：统一3档
 * "维护档位"模型（1安泰/2见微/3亟待，懒计算，见 js/wuxing-maintenance.js）
 * 取代静态 severity 驱动视觉状态——新增：
 *   - reflectTier(wx, direction, tier)：把某条issue的3D装饰/热点发光切换到
 *     指定档位（免费拖拽维护①、瞬间调理②、水晶兑换③成功后都调这个，效果
 *     统一是"档位回1"，只是档位回落后的后续衰减节奏不同，那部分逻辑在
 *     js/wuxing-maintenance.js里，不属于本文件职责）。
 *   - markShrined(wx, direction)：④"请神仙/设炉灶"永久巩固后调用——与
 *     markResolved() 的关键区别是**不删除热点DOM**，永久保留可点击查看
 *     "已巩固"叙事内容，只是装饰换成通用造型（decorId per-issue独立，见
 *     _shrineDecorId()，视觉上仍是同一个shrine_generic.glb模型）+ 热点加
 *     .wx-shrined 金色柔光样式，退出 getActiveMarkers() 的拖拽维护目标池。
 *   - getActiveMarkers()：供 js/wuxing-drag.js 做拖拽命中检测用的只读列表，
 *     过滤掉已 markShrined() 的条目（那些不再是维护目标）。
 * attach() 相应改为消费 issue.tier / issue.ownershipTier（主流程接线属
 * user-system领域的 main-new.js，本文件只负责"收到这两个字段后应该渲染
 * 成什么"）：ownershipTier==='shrine' 时直接按已巩固态创建，不再创建"问题
 * 态"装饰；否则按 issue.tier 选择初始档位对应的 decorId（不再固定用某个
 * 默认档位）；未传 tier 时防御性按 t1 处理，不报错。
 */
const WuxingScene = (() => {

  // ── 环形布局参数 ──────────────────────────────────────────
  // 半径/高度刻意跟四柱（PILLAR_LAYOUT，半径约0.8，y 0.55~0.85）、神煞
  // （SHENSHA_LAYOUT，半径1.0，y=0.25定高）、以及已停用但代码仍保留的
  // 旧trait环（TRAIT_LAYOUT，半径0.26~0.52，y 0.18/0.32）都错开，降低
  // 多套标注/装饰互相重叠视觉冲突的概率。起始角度 30° 是刻意选的，避免
  // 与四柱/神煞常用的 0°/45°/90° 整数角完全对齐（见 SHENSHA_LAYOUT 里
  // x/z 组合换算出的角度集合：0/45/90/135/180/315）。
  const RADIUS = 0.58;
  const START_ANGLE_DEG = 30;
  const Y_BY_DIRECTION     = { nourish: 0.20, restrain: 0.34 };
  const HOVER_BY_DIRECTION = { nourish: 0.22, restrain: 0.28 };
  // 拖拽维护交互（下一轮独立子阶段）预告的隐喻在这里先用图标体现：
  // nourish（喜用神不足，需要"灌溉"）= 💧，restrain（忌神过旺，需要"除草/
  // 克制"）= ✂️。与 island-decorations.js 里对应 decorId 的3D占位形状
  // （tree=需要培育的幼苗 / ring=需要约束的锁环）呼应同一套隐喻，不是
  // 随意选的图标。
  const ICON_BY_DIRECTION = { nourish: '💧', restrain: '✂️' };

  // i18n查表辅助（2026-08-13新增）——跟 js/products.js::_t()/js/analysis.js::_t()
  // 同款写法，Lang.t()本身不支持占位符插值，这里补一层简单replace；Lang模块
  // 未加载时原样返回key，不报错（不同文件各自维护一份同款小helper是本项目
  // 既有惯例，见 products.js/main-new.js/settings.js/analysis.js 里同名函数）。
  function _t(key, vars) {
    let s = (typeof Lang !== 'undefined') ? Lang.t(key) : key;
    if (vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }

  // [{ css2d, div, wx, direction, decorId, pos, tier, shrined }]
  // 2026-08-15追加 pos/tier/shrined 三个字段（第四阶段）：
  //   - pos：attach() 时环形布局算出的世界坐标（THREE.Vector3），reflectTier()/
  //     markShrined() 换装饰时直接复用，避免重新查一次包围盒/重算角度。
  //   - tier：当前渲染的档位（1/2/3），reflectTier() 调用后写回这里，供
  //     getActiveMarkers() 读取。
  //   - shrined：是否已"请神仙/设炉灶"永久巩固——true 的条目会被
  //     getActiveMarkers() 过滤掉（不再是拖拽维护目标）。
  let _markers = [];
  // attach() 时记录的场景引用，供 markResolved() 在没有 scene 参数的调用签名下
  // （见 js/products.js::redeem() 既定调用 WuxingScene.markResolved(wx, direction)
  // 的约定，不传scene）仍能把对应CSS2DObject从场景移除。detach() 会清空它。
  let _scene = null;
  // attach() 时记录的命盘数据，供 reflectTier()/markShrined() 在同样不传
  // baziData 的调用签名下（跟 markResolved() 同一惯例）仍能调用
  // IslandDecorations.add(decorId, baziData, pos) 换装饰。detach() 会清空它。
  let _baziData = null;

  /** issue.tier 缺失/非法时防御性按 1 处理，合法范围内四舍五入夹到 1-3。 */
  function _clampTier(tier) {
    const n = Math.round(Number(tier));
    if (!n || n < 1) return 1;
    return n > 3 ? 3 : n;
  }

  // 2026-08-16 qa-reviewer CONFIRMED修复：已巩固款decorId此前是单一通用值
  // 'wxmaint_shrine'（不分五行方向），但 IslandDecorations.add() 对同一个
  // decorId只会真正放置一次（`if (_placed[decorId]) return`）——同一张命盘
  // 有多条issue先后被markShrined()时，第二条起会因为decorId冲突被直接
  // 跳过，而旧问题态decorId已经被remove()掉，净效果是"花灵气巩固，3D装饰
  // 反而变少"（qa-reviewer用真实BaziEngine实测复现）。改成per-issue的
  // decorId（对应 island-decorations.js::DECOR_DEFS 新增的
  // wxmaint_shrine_{wx}_{direction} 10条），全部继续指向同一个
  // shrine_generic.glb 文件——视觉上还是同一个模型，只是不再共享同一个
  // decorId、不会互相顶掉。attach()/markShrined() 两处生成"已巩固"decorId
  // 的地方统一走这个helper，不允许各写一份容易失配的拼接。
  function _shrineDecorId(wx, direction) {
    return `wxmaint_shrine_${wx}_${direction}`;
  }

  /** 按 issues.length 均分角度，2条→180°对置，3条→120°三等分，以此类推 */
  function _computeAngles(n) {
    if (!n) return [];
    const spacing = 360 / n;
    const out = [];
    for (let i = 0; i < n; i++) {
      const rad = (START_ANGLE_DEG + i * spacing) * Math.PI / 180;
      out.push({ x: Math.cos(rad) * RADIUS, z: Math.sin(rad) * RADIUS });
    }
    return out;
  }

  /**
   * 挂载五行维护装饰。独立于 IslandAnnotate.attach()/attachTraits() 的
   * 生命周期——由AI异步分析完成后单独调用（main-new.js接线部分）。
   * @param {THREE.Scene} scene
   * @param {object} baziData
   * @param {Array<{wx,direction,severity,title,narrative,action_hint,tier,ownershipTier}>} issues
   *   tier（1/2/3，第四阶段新增字段，main-new.js接线传入，user-system领域）
   *   缺失时防御性按1处理；ownershipTier==='shrine'时直接按已巩固态创建
   *   （不创建可维护的"问题态"装饰/发光样式）。
   */
  function attach(scene, baziData, issues) {
    detach(scene);
    if (!scene || !Array.isArray(issues) || !issues.length) return;
    if (typeof IslandAnnotate === 'undefined' ||
        !IslandAnnotate.getIslandBox || !IslandAnnotate.layoutToWorld) {
      console.warn('[WuxingScene] IslandAnnotate 定位API不可用，跳过挂载');
      return;
    }

    _scene = scene;
    _baziData = baziData;
    const { box, group } = IslandAnnotate.getIslandBox();
    const angles = _computeAngles(issues.length);

    issues.forEach((issue, i) => {
      if (!issue || !issue.wx) return;
      const wx        = issue.wx;
      const direction = issue.direction === 'restrain' ? 'restrain' : 'nourish';
      const angle     = angles[i] || { x: 0, z: 0 };
      const frac = {
        x: angle.x,
        z: angle.z,
        y: Y_BY_DIRECTION[direction],
        hover: HOVER_BY_DIRECTION[direction],
      };
      const pos = IslandAnnotate.layoutToWorld(frac, box, group);

      // 统一3档"维护档位"模型（第四阶段）：ownershipTier==='shrine' 时直接
      // 按已巩固态创建（decorId用per-issue的已巩固款，见_shrineDecorId()，
      // 不再是"问题态"），否则按 issue.tier 选初始档位对应的 decorId——
      // 不再像第三阶段那样固定用某个默认档位，保证刚进岛看到的装饰状态
      // 就是当次真实的维护档位。
      const isShrined = issue.ownershipTier === 'shrine';
      const tier       = isShrined ? 1 : _clampTier(issue.tier);
      const decorId    = isShrined ? _shrineDecorId(wx, direction) : `wxmaint_${wx}_${direction}_t${tier}`;

      // 3D装饰（tree=需要培育 / ring=需要约束 / shrine通用款，见
      // island-decorations.js 新增的 DECOR_DEFS 三档条目）——overridePos 是
      // 跳过 DECOR_DEFS 里静态 frac 坐标，直接用这里动态算出的世界坐标。
      if (typeof IslandDecorations !== 'undefined' && IslandDecorations.add) {
        IslandDecorations.add(decorId, baziData, pos);
      }

      // 点击热点（CSS2DObject小圆点+展开卡片），闭包直接携带完整issue数据
      const { css2d, div } = _makeHotspot(wx, direction, issue, baziData, tier, isShrined);
      css2d.position.copy(pos);
      scene.add(css2d);
      // 记录 wx/direction/decorId/pos/tier/shrined，供 markResolved()/
      // reflectTier()/markShrined()/getActiveMarkers() 按key查找——不依赖
      // 数组下标（issues顺序理论上稳定，但按语义key查找更稳妥，跟
      // island-annotate.js::markTraitResolved() 按 kind+idx 查找是同一思路）。
      _markers.push({ css2d, div, wx, direction, decorId, pos: pos.clone(), tier, shrined: isShrined });
    });
  }

  /**
   * 清理五行维护装饰——CSS2D热点 + 对应的3D占位装饰网格都要清（qa-reviewer
   * 2026-08-13复查发现：此前这里只清了CSS2D热点，`wxmaint_*` 网格完全没人
   * 移除，唯一真正清理它们的路径只有 island-decorations.js::clearAll()，
   * 而那个函数只从 main-new.js::restoreAll() 触发——"轻量刷新AI深析"这条
   * 不经过 restoreAll() 的路径下，重算出的新issue集合会跟旧issue遗留的
   * 网格错位（新一批issue重新计算环形角度，但旧decorId因为
   * IslandDecorations.add() 的"已存在则直接return"逻辑，位置停留在旧坐标，
   * 造成热点跟3D物体对不上）。修复：detach() 对 _markers 里每个条目都补一句
   * IslandDecorations.remove(decorId)。
   *
   * 与 markResolved() 的关系：markResolved() 处理"单个issue被兑换后清理"，
   * detach() 处理"整批issue因换岛屿/重新生成而整体作废"，触发场景不同，但
   * 都会调 IslandDecorations.remove(decorId)——如果某个issue在detach()之前
   * 已经被 markResolved() 处理过（decorId已经remove过一次），这里对同一个
   * decorId再调一次remove()不会报错：island-decorations.js::remove() 内部
   * 用 `if (_placed[decorId])` 判空，对不存在的decorId是安全的no-op（已读
   * 该函数源码确认，不是假设），不需要在这里额外加判断跳过。
   */
  function detach(scene) {
    _markers.forEach(({ css2d, decorId }) => {
      if (scene) scene.remove(css2d);
      if (typeof IslandDecorations !== 'undefined' && IslandDecorations.remove) {
        IslandDecorations.remove(decorId);
      }
    });
    _markers = [];
    _scene = null;
    _baziData = null;
    // 无条件交还自转停转锁——与 island-annotate.js::detachTraits() 同一个
    // 修复模式（见该函数2026-08-12注释）：即使销毁时恰有卡片展开
    // （'wxCard'锁被占用），DOM直接被移除也不会经过用户点击收起那条路径，
    // 不无条件释放的话会让锁永久卡住、自转再也无法恢复。
    if (typeof IslandLoader !== 'undefined' && IslandLoader.startAutoRotate) {
      IslandLoader.startAutoRotate('wxCard');
    }
  }

  /**
   * 兑换实体商品"改善"某条五行问题成功后调用（js/products.js::redeem()）。
   * 契约：调用方只传 (wx, direction)，不传scene——世界坐标/场景引用已经在
   * attach() 时存进了闭包(_markers条目)/模块变量(_scene)，不需要调用方
   * 重新提供。视觉过渡沿用 island-annotate.js::markTraitResolved() 的设计
   * 语言（翻牌scale+rotateY，中点切图标，末尾发光收尾），做完过渡后才真正
   * 清理，让用户能感知"这条问题被处理了"，不是无声无息的DOM消失：
   *   1) 热点圆点翻牌成 ✅ 并短暂发光（CSS .wx-resolving，见index.html）；
   *   2) 3D"问题"占位装饰立即用 IslandDecorations.remove(decorId) 移除
   *      （该函数早已实现但此前从未被业务逻辑调用过，这是第一个真实调用
   *      场景，按计划文档明确要求复用，不重新实现一份）；
   *   3) 翻牌+发光动画播完后（约1s），热点本身也从场景/DOM彻底移除，避免
   *      残留死节点/事件监听器——对齐 detach() 的清理力度，只是这里只清理
   *      这一个entry，不影响场上其余未resolve的issue。
   * @param {string} wx        - 五行，如 '木'
   * @param {string} direction - 'nourish' | 'restrain'
   */
  function markResolved(wx, direction) {
    const entry = _markers.find(m => m.wx === wx && m.direction === direction);
    if (!entry) {
      // 防御性：可能AI分析尚未挂载完成/已被 detach()（换岛屿、刷新AI深析）
      // 清理掉，不是代码异常——灵气已扣、后端记录已写入，3D视觉只是暂时
      // 没能同步，不应该让兑换流程崩溃（同款处理见 markTraitResolved()）。
      console.warn(`[WuxingScene] markResolved 未找到对应标注 wx=${wx} direction=${direction}（可能尚未挂载或已被清理）`);
      return;
    }

    const { div, css2d, decorId } = entry;
    // 防止同一条被重复触发两次动画（如兑换成功回调因网络重试被意外调用两次）
    if (div.dataset.wxResolved === '1') return;
    div.dataset.wxResolved = '1';

    // 若恰好正展开着，先收起（避免翻牌/淡出动画期间卡片还悬在那）
    if (div.classList.contains('expanded')) {
      div.classList.remove('expanded', 'wx-expand-left');
      const card = div.querySelector('.wx-card');
      if (card) card.style.maxWidth = '';
      if (typeof IslandLoader !== 'undefined') IslandLoader.startAutoRotate('wxCard');
    }

    // 3D"问题"占位装饰立即移除——不用等视觉过渡播完，用户点开兑换弹窗时
    // 视线焦点在弹窗上，装饰这时候就该开始消失
    if (typeof IslandDecorations !== 'undefined' && IslandDecorations.remove) {
      IslandDecorations.remove(decorId);
    }

    // 热点翻牌成✅ + 短暂发光，动画期间禁用交互避免用户在过渡中途误触
    const dotEl = div.querySelector('.wx-dot');
    if (dotEl) {
      dotEl.textContent = '✅';
      dotEl.style.pointerEvents = 'none';
    }
    div.classList.add('wx-resolving');

    // 动画播完（翻牌.5s + 发光停留.2s + 淡出.3s ≈ 1.0s，见index.html对应
    // @keyframes 时长，留20ms余量避免setTimeout精度导致边缘截断）后彻底清理：
    // 从场景移除CSS2DObject、从_markers里摘掉这一条，不留死引用。
    setTimeout(() => {
      if (_scene) _scene.remove(css2d);
      const i = _markers.indexOf(entry);
      if (i !== -1) _markers.splice(i, 1);
    }, 1020);
  }

  /**
   * 把某条issue的3D装饰/热点发光切换到指定档位（第四阶段"统一3档维护档位
   * 模型"）——①免费拖拽维护（js/wuxing-drag.js）、②瞬间调理（灵气购买立即
   * 生效）、③水晶兑换成功后都调这个，效果统一是"档位回1"。
   * 【与 markResolved() 的区别】不删除任何东西——只是把 decorId 从旧档位
   * 换成新档位（如果确实变化了），热点DOM/CSS2DObject原样保留继续存活，
   * 这条issue会继续留在 getActiveMarkers() 里等待下一轮衰减/维护。
   * @param {string} wx        - 五行，如 '木'
   * @param {string} direction - 'nourish' | 'restrain'
   * @param {number} tier      - 1|2|3（新档位）
   */
  function reflectTier(wx, direction, tier) {
    // 已巩固（markShrined过）的条目不再参与档位切换——那条issue已经完全
    // 退出衰减循环，永久停留在 wxmaint_shrine_{wx}_{direction} 装饰，
    // 不应该被误切回问题态。
    const entry = _markers.find(m => m.wx === wx && m.direction === direction && !m.shrined);
    if (!entry) {
      console.warn(`[WuxingScene] reflectTier 未找到对应标注 wx=${wx} direction=${direction}（可能尚未挂载/已被清理/已巩固）`);
      return;
    }

    const newTier    = _clampTier(tier);
    const newDecorId = `wxmaint_${wx}_${direction}_t${newTier}`;
    if (newDecorId !== entry.decorId) {
      // 全量替换：先移除旧档位装饰，再在同一世界坐标 add() 新档位装饰——
      // 复用 IslandDecorations 现成的"从下方浮现"入场动画做过渡，不需要
      // GLB形变（该函数早已支持 overridePos 第三参数，直接复用 entry.pos，
      // 不重新查一次包围盒）。
      if (typeof IslandDecorations !== 'undefined' && IslandDecorations.remove) {
        IslandDecorations.remove(entry.decorId);
      }
      if (typeof IslandDecorations !== 'undefined' && IslandDecorations.add) {
        IslandDecorations.add(newDecorId, _baziData, entry.pos);
      }
      entry.decorId = newDecorId;
    }

    // 热点发光样式同步切换到新档位（.wx-sev-0/1/2 对应 tier 1/2/3），不管
    // decorId 是否真的变化了——调用方可能是"档位没变但仍要确保样式跟当前
    // 数据一致"的幂等调用，这里始终重算一次class，成本可忽略。
    entry.div.classList.remove('wx-sev-0', 'wx-sev-1', 'wx-sev-2');
    entry.div.classList.add(`wx-sev-${newTier - 1}`);
    entry.tier = newTier;
  }

  /**
   * "请神仙/设炉灶"永久巩固后调用（第四阶段④，未来 js/products.js 领域）。
   * 【与 markResolved() 的关键区别】不删除热点DOM——永久保留可点击查看
   * "已巩固"叙事内容，只做 remove旧decor → add(per-issue已巩固decorId,...)，
   * 热点div加 .wx-shrined class（金色柔光，见index.html对应CSS）。这条
   * issue从此彻底退出衰减循环、也退出 getActiveMarkers() 拖拽维护目标池
   * （不再是免费/付费维护动作的目标——已经是终态）。
   *
   * 2026-08-16修复：decorId 不再用单一通用的 'wxmaint_shrine'（那会导致
   * 同一命盘第二条起被markShrined()时，因IslandDecorations.add()对同一
   * decorId"已存在则跳过"的逻辑而放不进新装饰，见 _shrineDecorId() 声明处
   * 注释），改用 per-issue 的 `wxmaint_shrine_{wx}_{direction}`。
   * @param {string} wx        - 五行，如 '木'
   * @param {string} direction - 'nourish' | 'restrain'
   */
  function markShrined(wx, direction) {
    const entry = _markers.find(m => m.wx === wx && m.direction === direction);
    if (!entry) {
      console.warn(`[WuxingScene] markShrined 未找到对应标注 wx=${wx} direction=${direction}（可能尚未挂载或已被清理）`);
      return;
    }
    if (entry.shrined) return;   // 幂等：防止重复触发（网络重试等）造成重复remove/add

    const shrineDecorId = _shrineDecorId(wx, direction);
    if (typeof IslandDecorations !== 'undefined' && IslandDecorations.remove) {
      IslandDecorations.remove(entry.decorId);
    }
    if (typeof IslandDecorations !== 'undefined' && IslandDecorations.add) {
      IslandDecorations.add(shrineDecorId, _baziData, entry.pos);
    }
    entry.decorId = shrineDecorId;
    entry.shrined = true;
    entry.tier = 1;

    const { div } = entry;
    div.classList.remove('wx-sev-0', 'wx-sev-1', 'wx-sev-2');
    div.classList.add('wx-shrined');
    // 热点图标换成✨——跟 js/wuxing-drag.js 里"水晶态维护动作换皮消磁✨"
    // 同一套"已巩固/超脱日常维护"的视觉语言，跟💧/✂️（仍需要日常打理）
    // 明确区分开，不需要额外文字才能一眼看出这条已经不需要再维护了。
    const dotEl = div.querySelector('.wx-dot');
    if (dotEl) dotEl.textContent = '✨';
  }

  /**
   * 供 js/wuxing-drag.js 做拖拽命中检测用的只读列表——不暴露 _markers 的
   * 其它内部字段（css2d/decorId/pos等），过滤掉已 markShrined() 的条目
   * （不再是拖拽维护目标）。
   * @returns {Array<{wx:string, direction:'nourish'|'restrain', dotEl:HTMLElement, tier:number}>}
   */
  function getActiveMarkers() {
    return _markers
      .filter(m => !m.shrined)
      .map(m => ({
        wx: m.wx,
        direction: m.direction,
        dotEl: m.div.querySelector('.wx-dot') || m.div,
        tier: m.tier,
      }));
  }

  // ── 热点 DOM ─────────────────────────────────────────────
  // tier/isShrined（第四阶段新增参数）驱动初始视觉状态：已巩固态用
  // .wx-shrined + ✨图标，否则用 .wx-sev-{tier-1}（不再用静态 issue.severity
  // 驱动发光——tier 是"当前维护档位"这个动态量，severity 只是命理静态权重，
  // 两者已在第四阶段统一收敛到同一条3档轴，视觉状态该跟着动态的那个走）。
  function _makeHotspot(wx, direction, issue, baziData, tier, isShrined) {
    const div = document.createElement('div');
    const t = _clampTier(tier);
    div.className = `wx-marker wx-${direction} ` + (isShrined ? 'wx-shrined' : `wx-sev-${t - 1}`);

    const wxColor = (typeof CONFIG !== 'undefined' && CONFIG.WUXING_COLORS && CONFIG.WUXING_COLORS[wx])
      ? CONFIG.WUXING_COLORS[wx] : null;
    if (wxColor) {
      div.style.setProperty('--wx-color', wxColor.primary);
      div.style.setProperty('--wx-glow', wxColor.glow);
    }

    // 已巩固态图标换成✨（见 markShrined() 同款处理），跟仍需日常打理的
    // 💧/✂️明确区分开。
    const icon  = isShrined ? '✨' : (ICON_BY_DIRECTION[direction] || '❔');
    // 2026-08-13修复（qa-reviewer复查PLAUSIBLE）：兜底文案此前硬编码中文，
    // AI叙事漏了某条issue的title时（现在因缓存校验放宽为"非空即有效"，属于
    // 会被长期缓存下来的常态情况，不是罕见边界）英文界面会直接漏出中文。
    // 复用 js/i18n.js 已有的 wxmaint.title_fallback_nourish/restrain
    // 两个key（js/analysis.js::buildMaintenancePanel() 同一兜底场景已经在用，
    // 不新增key）。wxSuffix 对齐 analysis.js 同款处理："行"是中文语法后缀
    // （"木行"=Wood element），英文不需要。
    const isZh     = (typeof Lang === 'undefined') || Lang.getLang() === 'zh';
    const wxSuffix = isZh ? '行' : '';
    const title = issue.title || _t(
      direction === 'nourish' ? 'wxmaint.title_fallback_nourish' : 'wxmaint.title_fallback_restrain',
      { wx: wx + wxSuffix }
    );

    div.innerHTML = `
      <span class="wx-dot">${icon}</span>
      <div class="wx-leader"></div>
      <div class="wx-card">${title}</div>
    `;

    div.querySelector('.wx-dot').addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleExpand(div);
    });

    div.querySelector('.wx-card').addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof UIEffects !== 'undefined' && UIEffects.labelPulse) UIEffects.labelPulse(div);
      if (window.onIslandZoneClick) {
        // extra 数据在创建热点时就通过闭包直接携带，不依赖点击那一刻去查
        // 任何模块级缓存变量（见文件头注释"关键坑"）。force 固定传 false——
        // 这批热点不需要绕开教程guard，跟 island-annotate.js::attachTraits()
        // 的既有4参数约定保持一致。
        window.onIslandZoneClick(`wxmaint_${wx}_${direction}`, baziData, false, {
          wx, direction,
          severity: issue.severity,
          title: issue.title,
          narrative: issue.narrative,
          action_hint: issue.action_hint,
          // 第四阶段新增：把渲染时用的档位/巩固态一并透传给面板层，供未来
          // buildMaintenancePanel()（bazi-pipeline领域）按需展示"当前档位"，
          // 不强制要求对方消费——纯additive字段，不影响既有解构用法。
          tier: t, shrined: !!isShrined,
        });
      }
    });

    return { css2d: new THREE.CSS2DObject(_wrapAnchor(div)), div };
  }

  // 同款"定位锚点/视觉内容解耦"写法，见 island-annotate.js::_wrapAnchor()
  // 处的详细根因注释（CSS2DRenderer每帧写内联transform定位锚点，若锚点
  // 自身又挂了会动画transform的class会互相打架）——本模块热点虽然目前不会
  // 被 Tutorial highlightLabel 之类逻辑加class，但保持同一套防御结构，
  // 成本为零、且未来若需要接入高亮不会重新踩坑。
  function _wrapAnchor(contentDiv) {
    const anchor = document.createElement('div');
    anchor.appendChild(contentDiv);
    return anchor;
  }

  /** 同一时刻只允许一张卡片展开；展开时暂停自转（避免自转把卡片带出视口
   *  被裁切——island-annotate.js::_toggleTraitExpand() 修过的同一类问题，
   *  这里直接照搬同款修复，不重新踩一次）。*/
  function _toggleExpand(targetDiv) {
    const wasExpanded = targetDiv.classList.contains('expanded');
    _markers.forEach(({ div }) => {
      div.classList.remove('expanded', 'wx-expand-left');
      const card = div.querySelector('.wx-card');
      if (card) card.style.maxWidth = '';
    });
    if (!wasExpanded) {
      _positionCard(targetDiv);
      targetDiv.classList.add('expanded');
      if (typeof IslandLoader !== 'undefined') IslandLoader.stopAutoRotate('wxCard');
    } else if (typeof IslandLoader !== 'undefined') {
      IslandLoader.startAutoRotate('wxCard');
    }
  }

  /** 展开前判断该往视口哪一侧展开、以及实际能用多宽——同款逻辑见
   *  island-annotate.js::_positionTraitCard() 的详细注释，只在展开这一刻
   *  算一次（不是每帧），gap/margin 数值对齐本文件底部 index.html 里
   *  .wx-card 的 left/right:50px。*/
  function _positionCard(markerDiv) {
    const dot  = markerDiv.querySelector('.wx-dot');
    const card = markerDiv.querySelector('.wx-card');
    if (!dot || !card) return;
    const rect   = dot.getBoundingClientRect();
    const vw     = window.innerWidth || document.documentElement.clientWidth;
    const margin = 8;
    const gap    = 50;

    const spaceRight = vw - margin - (rect.left + gap);
    const spaceLeft  = (rect.left + rect.width) - gap - margin;
    const expandLeft = spaceLeft > spaceRight;
    const available  = expandLeft ? spaceLeft : spaceRight;

    markerDiv.classList.toggle('wx-expand-left', expandLeft);
    card.style.maxWidth = Math.max(120, Math.min(190, available)) + 'px';
  }

  // resize时若有卡片正展开，重算一次位置/宽度（防抖，同款见
  // island-annotate.js 底部对应实现的注释）
  let _resizeReflowTimer = null;
  window.addEventListener('resize', () => {
    if (_resizeReflowTimer) clearTimeout(_resizeReflowTimer);
    _resizeReflowTimer = setTimeout(() => {
      const expanded = _markers.find(({ div }) => div.classList.contains('expanded'));
      if (expanded) _positionCard(expanded.div);
    }, 150);
  });

  return { attach, detach, markResolved, reflectTier, markShrined, getActiveMarkers };
})();
