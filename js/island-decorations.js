/**
 * 司马八字 · 岛屿装饰管理 island-decorations.js
 *
 * 任务/成就解锁后，在基础岛屿上叠加小型3D装饰物件（GLB）。
 * 装饰物件预生成后放在 /assets/decorations/ 目录下。
 *
 * 未来接入真实GLB之前，用Three.js几何体作为占位符（placeholder）。
 */

const IslandDecorations = (() => {

  // ── 装饰定义（id → 配置）─────────────────────────────────
  // 2026-08-01：此前这里的 `pos` 是写死的绝对世界坐标（如 welcome_glow
  // [0,6,0]），是针对某个假想"标准尺寸岛屿"手动调校的，跟 island-annotate.js
  // 修复前的 PILLAR_POSITIONS/SHENSHA_POSITIONS 是同一类问题：TripoAI 针对
  // 不同八字生成的岛屿模型长宽高比例差异很大，写死坐标在比例偏离较大的模型上
  // 会出现装饰物悬空或埋进模型里。
  //
  // 修复：改用 `frac`（相对岛屿真实包围盒的比例，跟 island-annotate.js 的
  // PILLAR_LAYOUT/SHENSHA_LAYOUT 同款格式：x/z ∈ 大致[-1,1]，y ∈ [0,1]表示
  // 包围盒底→顶插值比例，可以略超出[0,1]表示"明显高于/低于模型本体"，
  // hover 表示在地形射线检测命中点之上再叠加的悬浮高度）。实际换算复用
  // island-annotate.js 已经验证过的 getIslandBox()/layoutToWorld()（见该文件
  // 2026-08-01 新增的公开API），不重复实现一份容易失配的复制品。
  //
  // ring 类型（shensha_glow 环绕光环 / island_expand 岛屿扩展光环）的"位置"
  // 含义是"围绕整个岛屿"而不是单点贴地，额外用 radiusFrac 表示光环半径相对
  // 岛屿水平半径的比例，随模型尺寸动态缩放，不再是写死的 5.0/6.0。半径基准用
  // Math.max(hx, hz)（水平最长维度）而不是 (hx+hz)/2（平均值）——footprint
  // 非正方形时（如10×4的长条岛屿）用平均值算出的半径会比较窄的那个维度还窄，
  // 导致"环绕全岛"的光环反而比岛屿本体窄、被埋进模型里看不见（2026-08-01
  // qa-reviewer 用真实模块代码实测复现，见已知问题日志同日期条目）。
  // island_expand 额外标记 noRaycast:true——它的原始设计意图是贴着岛屿"基座"
  // 环绕一圈（原绝对坐标 y=-0.5 接近包围盒底部），如果对它做地形射线检测，
  // 命中的会是光环中心那一列（x=0,z=0）的地形高度，对多峰/不规则模型来说
  // 那一点可能正好是最高的山峰而不是岛屿边缘的基座高度，反而更容易算错；
  // 所以这类"环绕全岛"的光环改用纯包围盒线性插值，不做地形吸附。
  const DECOR_DEFS = {
    // 任务解锁
    welcome_glow    : { frac:{x: 0.00, z: 0.00, y:1.40, hover:2.50}, type:'glow',    color:0xc9a96e, size:0.8, glb:null },
    sprout_plant    : { frac:{x:-0.40, z:-0.40, y:0.40, hover:0.15}, type:'crystal', color:0x6FCF97, size:0.4, glb:'sprout.glb' },
    cherry_blossom  : { frac:{x: 0.40, z: 0.40, y:0.50, hover:0.20}, type:'tree',    color:0xffb7c5, size:1.2, glb:'cherry.glb' },
    moon_shrine     : { frac:{x: 0.00, z:-0.80, y:0.50, hover:0.25}, type:'crystal', color:0xaad4ff, size:1.5, glb:'moon_shrine.glb' },
    share_flower    : { frac:{x: 0.60, z:-0.20, y:0.30, hover:0.15}, type:'crystal', color:0xff9cdf, size:0.5, glb:'flower.glb' },
    shensha_glow    : { frac:{x: 0.00, z: 0.00, y:1.00, hover:1.00}, type:'ring', color:0xc9a96e, size:5.0, radiusFrac:1.0, glb:null },
    island_expand   : { frac:{x: 0.00, z: 0.00, y:0.10, hover:0.00}, type:'ring', color:0x6EB5FF, size:6.0, radiusFrac:1.2, noRaycast:true, glb:null },

    // 水晶商品购买后（预留）
    crystal_water   : { frac:{x:-0.60, z: 0.20, y:0.30, hover:0.15}, type:'crystal', color:0x6EB5FF, size:0.8, glb:'basin_clear.glb' },
    crystal_amethyst: { frac:{x: 0.00, z:-0.60, y:0.30, hover:0.15}, type:'crystal', color:0x9b59b6, size:0.8, glb:'pillar_amethyst.glb' },
    crystal_rose    : { frac:{x: 0.60, z:-0.20, y:0.30, hover:0.15}, type:'crystal', color:0xffb7c5, size:0.6, glb:'bracelet_rose.glb' },
    crystal_obsidian: { frac:{x:-0.60, z:-0.40, y:0.30, hover:0.15}, type:'crystal', color:0x1a1a2e, size:0.7, glb:'bracelet_obsidian.glb' },
  };

  // ── 五行维护系统装饰（第三阶段2026-08-13新增占位 → 第四阶段2026-08-15
  //    扩展为三档 + 接入首批真实GLB资产）──────────────────────────────
  // js/wuxing-scene.js::attach()/reflectTier()/markShrined() 按当次命盘
  // WuxingIssues.deriveIssues() 算出的 {wx, direction} 组合 + 动态"维护档位"
  // （tier 1安泰/2见微/3亟待，懒计算，见 js/wuxing-maintenance.js）决定挂哪个
  // decorId、挂在哪——世界坐标由调用方通过本文件的 add(decorId, baziData,
  // overridePos) 第三参数直接给出，这里的 frac 字段因此实际上不会被用到
  // （overridePos 总是有值），只是为了防御性兜底（万一将来某处误调用不传
  // overridePos，也不会因为 DECOR_DEFS 里没有这个 key 而直接跳过渲染）保留
  // 一个占位坐标，不代表真实设计位置。
  //
  // decorId 命名规则：`wxmaint_{wx}_{nourish|restrain}_t{1|2|3}`（三层循环，
  // 5行×2方向×3档=30条）+ `wxmaint_shrine_{wx}_{direction}`（10条，"请神仙/
  // 设炉灶"永久巩固后的款式，虽然视觉上全部复用同一个 shrine_generic.glb
  // 模型文件，但每个 wx+direction 组合各自注册独立的 decorId）。此前（第三
  // 阶段）decorId 不带 `_t{tier}` 后缀、每个 wx+direction 只有一条占位——
  // 本轮改为三档后旧的无后缀 key 直接废弃替换（不保留），js/wuxing-scene.js
  // 相应改为按 tier 选取 decorId。
  //
  // 2026-08-16 qa-reviewer CONFIRMED修复："请神仙"decorId此前是单一通用款
  // `wxmaint_shrine`（不分五行方向）——但 add(decorId,...) 第一行是
  // `if (_placed[decorId]) return`（同一个decorId只会真正放置一次）。同一张
  // 命盘如果有多条issue先后被markShrined()，第二条起 add('wxmaint_shrine',
  // ...) 会因为decorId已存在直接被跳过，但markShrined()自己remove()掉的是
  // 上一条issue的旧问题态decorId——净效果是"花1000灵气巩固第二条issue，3D
  // 装饰反而从场景里凭空消失一个，什么也没补上"（qa-reviewer用真实
  // BaziEngine+真实IslandDecorations实测复现：3条issue全部markShrined后，
  // 3个CSS2D热点仍在，但3D装饰只剩1个）。修复：decorId 改成
  // per-issue（`wxmaint_shrine_{wx}_{direction}`），5行×2方向=10条，`glb`
  // 字段全部继续指向同一个 shrine_generic.glb 文件（视觉上还是同一个模型，
  // 只是不共享同一个decorId、不会互相顶掉），js/wuxing-scene.js::attach()/
  // markShrined() 生成decorId的地方同步改成per-issue拼接方式。
  //
  // 首批3D美术资产已由离线脚本（island_service/generate_wuxing_assets.py）
  // 生成，落地在 assets/decorations/wuxing/ 下，文件名用英文（GLB_BASE +
  // 'wuxing/{wx_en}_{direction}_t{tier}.glb'）——五行中文名→英文文件名前缀
  // 映射见下方 WX_EN_PREFIX（这是JS端独立维护的一份，风格参考
  // island_service/bazi_prompt.py 里同类中英映射的写法，但两侧语言不同不复用
  // 同一份定义）。水行（水→water）6个组合（2方向×3档）因预算原因这批暂缺，
  // glb 留 null，走 _addPlaceholder() 现成的占位几何体兜底——这是已知且
  // 用户已接受的状态，不是bug，资产补齐后只需要把对应几条的 glb 字段填上
  // 文件名，不需要改代码结构。
  //
  // 视觉隐喻区分方向（与 wuxing-scene.js 里 💧/✂️ 图标呼应，不靠颜色区分
  // 方向）：nourish（喜用神不足，需要"培育/灌溉"）用 tree（幼苗）占位类型；
  // restrain（忌神过旺，需要"约束/克制"）用 ring（锁环）占位类型——占位类型
  // 只在 glb 缺失（水行）时才会真正被渲染，有真实GLB的四行直接走 _loadGLB()
  // 不受此影响。颜色统一复用 CONFIG.WUXING_COLORS[wx].hex（不新造配色系统，
  // 跨全项目一致）。shrine 款不分五行，用统一的暖金色（呼应"庄重已巩固"调性）。
  const WX_EN_PREFIX = { '木': 'wood', '火': 'fire', '土': 'earth', '金': 'metal', '水': 'water' };
  (function _registerWuxingMaintenanceDecors() {
    const WX_LIST = ['木', '火', '土', '金', '水'];
    const DIRECTIONS = ['nourish', 'restrain'];
    WX_LIST.forEach(wx => {
      const hex = (typeof CONFIG !== 'undefined' && CONFIG.WUXING_COLORS && CONFIG.WUXING_COLORS[wx])
        ? CONFIG.WUXING_COLORS[wx].hex : 0xc9a96e;
      const enPrefix = WX_EN_PREFIX[wx];
      const hasAsset = enPrefix !== 'water';   // 水行资产暂缺（见上方注释）
      DIRECTIONS.forEach(direction => {
        [1, 2, 3].forEach(tier => {
          DECOR_DEFS[`wxmaint_${wx}_${direction}_t${tier}`] = {
            frac: { x: 0.00, z: 0.00, y: 0.30, hover: 0.15 },
            type: direction === 'nourish' ? 'tree' : 'ring',
            color: hex,
            size: direction === 'nourish' ? 0.9 : 0.5,
            glb: hasAsset ? `wuxing/${enPrefix}_${direction}_t${tier}.glb` : null,
          };
        });
      });
    });
    // "请神仙/设炉灶"永久巩固款——视觉上是同一个通用造型（灵位/香炉意象，
    // 不分五行），但每个 wx+direction 各自注册一条独立 decorId（见上方
    // 2026-08-16修复注释），避免共享同一个decorId导致add()的"已存在则
    // 跳过"逻辑把后续issue的巩固装饰顶掉。
    WX_LIST.forEach(wx => {
      DIRECTIONS.forEach(direction => {
        DECOR_DEFS[`wxmaint_shrine_${wx}_${direction}`] = {
          frac: { x: 0.00, z: 0.00, y: 0.30, hover: 0.15 },
          type: 'crystal', color: 0xc9a96e, size: 0.9,
          glb: 'wuxing/shrine_generic.glb',
        };
      });
    });
  })();

  // IslandAnnotate 计算包围盒失败/未就绪时的最终兜底（与 island-annotate.js
  // 的 FALLBACK_BOX 保持一致比例），只在异常路径触发，正常情况下走
  // IslandAnnotate.getIslandBox() 现算真实包围盒
  const FALLBACK_BOX = { min:{x:-5,y:-1,z:-5}, max:{x:5,y:4,z:5} };

  const GLB_BASE  = '/assets/decorations/';
  let _scene      = null;
  let _placed     = {};   // decorId → THREE.Object3D
  // 2026-08-16 qa-reviewer两轮修复迭代到这个最终版本：
  //
  // 第一轮问题（PLAUSIBLE）：GLTFLoader是异步的，`_loadGLB()`发出请求到
  // 成功/失败回调之间有一段真实存在的时间窗口，这段时间里`_placed[decorId]`
  // 还没被赋值。如果这段窗口内调用方对同一个decorId调了一次remove()
  // （reflectTier()/markShrined()的"remove旧→add新"两连击最容易撞上），
  // 旧档位的GLB如果还没加载完，remove()会因为_placed[旧]为空而直接no-op，
  // 但稍后GLTFLoader的成功回调仍会无条件`_scene.add(model)`，旧档位模型
  // 就永久残留在场景里、跟新装饰重叠。
  //
  // 第一轮的修复方案（用_loading/_pendingRemoved两个Set + add()里
  // `if(_loading.has(decorId)) return`拦一次并发）引入了第二轮CONFIRMED
  // 回归：`add(X)→remove(X)（仍在途）→add(X)`这个序列里，第二次add(X)会被
  // "已经在加载"的守卫直接吞掉、什么也不做，随后X的GLTFLoader回调触发时
  // 又因为_pendingRemoved标记把模型丢弃——最终这个decorId对应的装饰一个
  // 都没有。qa-reviewer指出这不是构造出来的边界情况：`wxmaint_*`系列
  // decorId只由`{wx}_{direction}_t{tier}`决定、不含baziKey，跨命盘会撞
  // 同一个id；GLB体积大（约1MB/个），移动网络加载窗口是数秒级，用户在这
  // 几秒内切岛屿/轻量刷新AI深析，新旧两张命盘刚好命中同一个五行方向+档位
  // 组合时就会真实触发。
  //
  // 最终修复（本轮，token机制）：不再用"是否正在加载"这个布尔状态去拦截
  // 后续add()调用（那正是回归的根源——拦截意味着"忽略"，而忽略了的这次
  // add()诉求就永远丢了），改为让每次add()都能真正发起一次新的加载请求，
  // 但给每个decorId维护一个单调递增的"版本号"（_loadToken[decorId]）：
  // `_loadGLB()`发起时读取+自增当前版本号并记住"这是我的版本号"，GLTFLoader
  // 的回调触发时只有当自己的版本号仍然等于`_loadToken[decorId]`当前值（即
  // "我是这个decorId最后一次被请求的那次"）才真正落地`_scene.add()`/写
  // `_placed`，否则静默丢弃自己这次的加载结果——不管丢弃的是"过期"还是
  // "被取消"的那次。`remove()`同样只需要把版本号自增一次（不需要真的
  // 知道"是否正在加载"），后续任何仍在途的旧版本回调天然就不再匹配。
  // 这样无论中途发生多少次"remove又add"，只有**最后一次add()**捕获到的
  // placement/内容会真正生效——因为每次add()都会重新计算并闭包捕获当次
  // 调用传入的placement（见_computePlacement()/_placementFromOverride()
  // 调用点），不会退回到某次更早请求时的旧坐标。
  // 代价：remove()后紧跟着add()同一decorId时，前一次尚未完成的网络请求会
  // 被浪费（继续下载但结果被丢弃），不做真正的HTTP层面取消——GLB文件不大
  // 且这类"边加载边改主意"的场景本身低频，用少量带宽换正确性是合理取舍，
  // 不引入 AbortController 这类更复杂的机制。
  let _loadToken = {};   // decorId → 最新一次_loadGLB()请求的版本号（整数）

  // ── 初始化（传入scene引用）───────────────────────────────
  function init(scene) { _scene = scene; }

  // ── 恢复已解锁装饰（每次进岛屿后调用）──────────────────
  // 2026-08-01：`_placed` 是模块级变量，整个浏览器会话共用同一个 THREE.Scene
  // （island-loader.js 的 initScene 有 `if (_scene) return` 守卫，不会重建
  // 场景），切换岛屿（loadSavedIsland/retryGenerate）时旧岛屿的装饰物从未被
  // 清理——`add()` 里 `if (_placed[decorId]) return` 会认为"已经摆过"直接跳过，
  // 导致装饰带着上一个岛屿的包围盒坐标残留在新岛屿上（形状差异越大越明显）。
  // 修复：每次 restoreAll（换岛屿必经的唯一装饰恢复入口）开头先 clearAll()，
  // 保证按当次岛屿的真实包围盒重新摆放。
  function restoreAll(baziData) {
    clearAll();
    const decorations = UserState.getDecorations();
    decorations.forEach(d => add(d.id, baziData));
  }

  // ── 清空当前场景里所有已摆放的装饰（换岛屿前调用）──────
  function clearAll() {
    if (!_scene) { _placed = {}; return; }
    Object.keys(_placed).forEach(decorId => remove(decorId));
    _placed = {};   // 兜底：remove() 理论上已逐一删除，这里确保万无一失
    // 换岛屿/清空这一刻仍在异步加载中的装饰（还没进_placed，上面基于
    // Object.keys(_placed) 的 remove() 循环覆盖不到）也需要让它们的
    // token失效，否则加载完成后会凭空挂在新场景/新一批装饰之间（见
    // _loadToken 声明处注释的token机制）。这里没有一份"当前正在加载的
    // decorId列表"可以精确遍历，改为把 _loadToken 里出现过的每个decorId
    // 的token都递增一次——已经完成加载的那些（早被上面remove()清过）
    // 再碰一次token是无副作用的no-op，仍在途的那些则被正确标记为过期。
    Object.keys(_loadToken).forEach(decorId => {
      _loadToken[decorId] = (_loadToken[decorId] || 0) + 1;
    });
  }

  // ── 添加单个装饰 ─────────────────────────────────────────
  // 2026-08-13：新增可选第三参数 overridePos（THREE.Vector3 或 {x,y,z} 世界
  // 坐标）——js/wuxing-scene.js 的五行维护装饰点位是按当次命盘问题动态算出的
  // （环形分布，数量2-3个），不是 DECOR_DEFS 里写死的静态 frac 比例。传入时
  // 直接使用该坐标，跳过 _computePlacement() 内部查 DECOR_DEFS[decorId].frac
  // 那一步；不传（undefined）时行为与改动前完全一致——全部既有调用方
  // （本文件 restoreAll()、tasks.js:139、products.js:198）都只传两个参数，
  // 不受此次改动影响（已逐一核实，见本次改动的验证记录）。
  function add(decorId, baziData, overridePos) {
    if (!_scene) return;
    if (_placed[decorId]) return;   // 已存在
    // 2026-08-16：此前这里有一道"该decorId已经有一次GLTFLoader请求在途就
    // 直接return"的守卫，本意是防止并发重复加载，但引入了CONFIRMED回归——
    // `add(X)→remove(X)（仍在途）→add(X)`序列里第二次add(X)会被这道守卫
    // 直接吞掉、什么也不做，随后GLTFLoader的回调再因为"已被remove()取消"
    // 把模型丢弃，最终这个decorId一个装饰都没有。已改为不在这里拦截，让
    // 每次add()都能真正发起一次新的加载请求，用_loadGLB()内部的token机制
    // （见_loadToken声明处注释）保证"无论中途发生多少次remove又add，只有
    // 最后一次的坐标/内容会真正生效"，不会静默丢失这次add()的诉求。

    const def = DECOR_DEFS[decorId];
    if (!def) return;

    // 每次 add() 都现算一次真实包围盒——不同岛屿模型尺寸/比例不同，
    // 不能复用上一次或其他装饰算出的结果（overridePos 有值时跳过这步）
    const placement = overridePos ? _placementFromOverride(overridePos, def) : _computePlacement(def);

    // 有GLB文件优先加载，否则用几何占位
    if (def.glb && typeof THREE.GLTFLoader !== 'undefined') {
      _loadGLB(decorId, def, placement);
    } else {
      _addPlaceholder(decorId, def, placement);
    }
  }

  // ── 外部直接给定世界坐标时的占位换算 ──────────────────────
  // 只做 Vector3/{x,y,z} → [x,y,z] 数组的形状归一化 + 沿用 def.size，不做
  // ring 类型的 radiusFrac 动态缩放（那需要现算包围盒 hx/hz，而 overridePos
  // 路径的设计意图就是跳过包围盒计算）——目前唯一的 overridePos 调用方
  // （wuxing-scene.js）传入的 decorId 都不是 radiusFrac 类型，不受影响；
  // 未来若有新调用方需要 ring+radiusFrac+overridePos 组合，需要另外扩展。
  function _placementFromOverride(overridePos, def) {
    const pos = (overridePos && typeof overridePos.x === 'number')
      ? [overridePos.x, overridePos.y, overridePos.z]
      : [0, 0, 0];
    return { pos, size: def.size };
  }

  // ── 相对比例 → 世界坐标 ──────────────────────────────────
  // 复用 island-annotate.js 已验证过的 getIslandBox()/layoutToWorld()（同一套
  // "用当次实际加载模型的真实包围盒按比例换算+地形射线检测贴合"逻辑，见该文件
  // 2026-08-01 新增的公开API），避免在这里重复实现一份容易失配的复制品。
  function _computePlacement(def) {
    let box = null, group = null;
    if (typeof IslandAnnotate !== 'undefined' && IslandAnnotate.getIslandBox) {
      try {
        ({ box, group } = IslandAnnotate.getIslandBox());
      } catch (e) {
        console.warn('[IslandDecorations] IslandAnnotate.getIslandBox() 失败，改用兜底比例', e);
      }
    }

    let pos, hx, hz;
    if (box && typeof IslandAnnotate !== 'undefined' && IslandAnnotate.layoutToWorld) {
      // ring 类型且标记 noRaycast 时传 group=null，让 layoutToWorld 退化为
      // 纯包围盒线性插值，不做地形吸附（见 DECOR_DEFS 上方注释）
      const useGroup = def.noRaycast ? null : group;
      pos = IslandAnnotate.layoutToWorld(def.frac, box, useGroup);
      hx  = (box.max.x - box.min.x) / 2;
      hz  = (box.max.z - box.min.z) / 2;
    } else {
      // IslandAnnotate 理论上不会缺席（index.html 已保证 island-annotate.js
      // 先于 island-decorations.js 加载），这里只是极端异常下的最终安全网
      const f  = def.frac || { x:0, z:0, y:0.4 };
      hx = (FALLBACK_BOX.max.x - FALLBACK_BOX.min.x) / 2;
      hz = (FALLBACK_BOX.max.z - FALLBACK_BOX.min.z) / 2;
      const sizeY = FALLBACK_BOX.max.y - FALLBACK_BOX.min.y;
      pos = new THREE.Vector3(
        f.x * hx,
        FALLBACK_BOX.min.y + f.y * sizeY,
        f.z * hz
      );
    }

    let size = def.size;
    if (def.type === 'ring' && def.radiusFrac) {
      // 用最长维度而不是水平半宽/半深的平均值——footprint 非正方形（如
      // 10×4 的长条形岛屿）时，(hx+hz)/2 会比较窄的那个维度还窄，导致
      // "环绕全岛"的光环反而被岛屿本体挡住/埋进模型里看不见
      size = Math.max(hx, hz) * def.radiusFrac;
    }

    return { pos: [pos.x, pos.y, pos.z], size };
  }

  // ── 移除装饰 ─────────────────────────────────────────────
  function remove(decorId) {
    if (_placed[decorId]) {
      _scene.remove(_placed[decorId]);
      delete _placed[decorId];
    }
    // 无论此刻这个decorId是否已经真正放置/是否还有GLTFLoader请求在途，都
    // 让它的"版本号"自增一次——仍在途的旧请求的回调触发时，token比对会
    // 发现自己已经不是最新版本，从而静默丢弃这次加载结果，不会把即将被
    // 移除的旧装饰又添加进场景（见 _loadToken 声明处注释的token机制）。
    // 对从没add()过的decorId调用remove()，这里只是把它的token从0变成1，
    // 无副作用、不影响该decorId未来第一次真正的add()。
    _loadToken[decorId] = (_loadToken[decorId] || 0) + 1;
  }

  // ── 加载真实 GLB ─────────────────────────────────────────
  function _loadGLB(decorId, def, placement) {
    // token机制（见 _loadToken 声明处注释）：每次发起加载都占用一个新的
    // 版本号并记住"这是我的版本号"（闭包变量 myToken）。回调触发时只有
    // 自己的版本号仍然等于 _loadToken[decorId] 当前值（即"我是这个decorId
    // 最后一次被请求的那次"）才真正落地，否则说明中途发生过remove()/新的
    // add()，静默丢弃——不管是被"取消"还是被"更新的请求"取代，处理方式
    // 相同：只有最后一次赢。
    const myToken = (_loadToken[decorId] || 0) + 1;
    _loadToken[decorId] = myToken;
    new THREE.GLTFLoader().load(
      GLB_BASE + def.glb,
      (gltf) => {
        if (_loadToken[decorId] !== myToken) return;   // 已被后续remove()/add()淘汰，丢弃这次结果，不进场景
        const model = gltf.scene;
        model.position.set(...placement.pos);
        model.scale.setScalar(placement.size);
        model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        _scene.add(model);
        _placed[decorId] = model;
        _addEntryAnimation(model);
      },
      undefined,
      () => {
        if (_loadToken[decorId] !== myToken) return;   // 同上：已过期，加载失败也不用回退占位了
        _addPlaceholder(decorId, def, placement);       // 加载失败回退占位
      }
    );
  }

  // ── 几何占位符（GLB未就绪时）────────────────────────────
  function _addPlaceholder(decorId, def, placement) {
    let mesh;
    const size = placement.size;
    const mat = new THREE.MeshStandardMaterial({
      color      : def.color,
      emissive   : def.color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity    : 0.85,
    });

    switch (def.type) {
      case 'glow': {
        // 发光球
        const geo = new THREE.SphereGeometry(size, 16, 16);
        mesh = new THREE.Mesh(geo, mat);
        // 添加点光源——挂载为 mesh 的子对象（而不是直接 _scene.add），
        // 这样 clearAll()/remove() 只需移除 mesh 本体，点光源作为其子节点
        // 会随场景图一起被移除，不会残留成永久生效的孤儿光源（2026-08-01：
        // 换岛屿时 restoreAll 会重复 add() 同一个已解锁装饰，若光源脱离
        // mesh 单独挂在 _scene 上，每次都会新增一个删不掉的点光源）。
        const light = new THREE.PointLight(def.color, 1.5, 6);
        mesh.add(light);   // 局部坐标 (0,0,0)，随 mesh.position 一起定位
        break;
      }
      case 'ring': {
        // 光环（半径已在 _computePlacement 里按岛屿包围盒尺寸动态缩放）
        const geo = new THREE.TorusGeometry(size, 0.05, 8, 64);
        mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = Math.PI / 2;
        break;
      }
      case 'tree': {
        // 锥形树
        const group = new THREE.Group();
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.1, size * 0.6, 6),
          new THREE.MeshStandardMaterial({ color: 0x8B6914 })
        );
        const crown = new THREE.Mesh(
          new THREE.ConeGeometry(size * 0.5, size, 8),
          mat
        );
        crown.position.y = size * 0.8;
        group.add(trunk, crown);
        mesh = group;
        break;
      }
      default: {
        // 水晶柱
        const geo = new THREE.ConeGeometry(size * 0.3, size, 6);
        mesh = new THREE.Mesh(geo, mat);
      }
    }

    mesh.position.set(...placement.pos);
    _scene.add(mesh);
    _placed[decorId] = mesh;
    _addEntryAnimation(mesh);
  }

  // ── 入场动画（从下方浮现）───────────────────────────────
  function _addEntryAnimation(obj) {
    const startY = obj.position.y - 3;
    const endY   = obj.position.y;
    obj.position.y = startY;

    let elapsed = 0;
    const duration = 1200;
    const startTime = Date.now();

    const tick = () => {
      elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);   // cubic ease-out
      obj.position.y = startY + (endY - startY) * ease;
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
  }

  // ── 流年/大运触发的氛围变化 ──────────────────────────────
  function applyLiunianEffect(liuNianElement) {
    const colorMap = {
      '木': 0x6FCF97, '火': 0xEB5757,
      '土': 0xF2C94C, '金': 0xC8C8D8, '水': 0x6EB5FF,
    };
    const color = colorMap[liuNianElement] || 0xc9a96e;

    // 修改环境光色调
    if (_scene) {
      _scene.traverse(obj => {
        if (obj.isAmbientLight) obj.color.setHex(color);
      });
    }
  }

  return { init, restoreAll, clearAll, add, remove, applyLiunianEffect };
})();
