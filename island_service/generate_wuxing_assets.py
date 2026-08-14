"""
司马八字 · 五行维护3D资产批量生成脚本 · Generate Wuxing Maintenance 3D Assets

用途：为"五行维护"3D装饰系统（第四阶段，见 claude-docs 记录的方案）离线批量
     生成占位GLB要替换成的真实资产——5个五行 × 2个方向（nourish滋养/restrain
     克制）× 3个档位（安泰/见微/亟待）= 30个基础模型，外加1个"已巩固"通用款
     `shrine_generic`（不分五行，代表某条五行问题已被彻底解决），共31个GLB。
     （注：上游任务说明里提到"共33个GLB"，但 5×2×3+1 实际算出来是31，这里按
     实际组合数量31为准，未强行凑数字。）

     产出物直接落地本地磁盘 `assets/decorations/wuxing/`，随前端静态代码一起
     部署（不经Supabase Storage——这批是随代码走的固定美术资产，不是用户生成
     内容），人工审核通过后由后续代码改动把文件名手动填进
     `js/island-decorations.js::DECOR_DEFS` 对应条目的 `glb` 字段（当前是
     `glb:null`，走Three.js内置形状兜底）。

流水线：build_prompt() 组装英文提示词 → gemini_image.generate_island_image()
       生成PNG → tripo_client.submit_image_to_3d() 提交图生3D任务 →
       tripo_client.poll_until_done() 轮询 → 从 output.pbr_model/output.model
       取GLB临时URL → supabase_storage.download_glb() 下载字节 → 落盘。

用法（本地手动运行，涉及真实付费API，务必先跑 --dry-run 审阅提示词文本，
再小范围 --sample 出图确认艺术方向，最后才考虑跑全量）：

    cd island_service
    python3 generate_wuxing_assets.py --dry-run
        # 只打印全部31条完整prompt文本，不调用任何API，零成本先审一遍文案

    GEMINI_API_KEY=xxx TRIPO_API_KEY=xxx python3 generate_wuxing_assets.py --sample
        # 只生成"木"一个五行的6个组合（2方向×3档）+ shrine_generic，共7个，
        # 出图看风格效果，人工确认满意后再决定要不要跑全量

    GEMINI_API_KEY=xxx TRIPO_API_KEY=xxx python3 generate_wuxing_assets.py
        # 跑全量31个（默认跳过已存在文件，支持断点续跑）

    GEMINI_API_KEY=xxx TRIPO_API_KEY=xxx python3 generate_wuxing_assets.py --force
        # 忽略已存在文件，强制全部重新生成

    GEMINI_API_KEY=xxx TRIPO_API_KEY=xxx python3 generate_wuxing_assets.py --only=木:nourish
        # 定点重跑某个五行×方向的3个档位（比如订正过该组合的提示词之后）

    GEMINI_API_KEY=xxx TRIPO_API_KEY=xxx python3 generate_wuxing_assets.py --only=shrine
        # 定点重跑 shrine_generic 单独一条

组织模式仿照 ingest_knowledge.py：docstring写清用法、裸sys.argv解析不用
argparse、主循环单项失败 continue 不中断整体、结尾打印✅/❌清单供人工审核。

**"不制造焦虑"产品原则**（贯穿全项目，见 gemini_analysis.py 相关注释）：
tier3（"亟待"，最严重档位）的视觉描述必须避免任何死亡/枯萎/凋零/恐怖意象——
只能是"平静地等待被关注"，不是"正在消逝"。这条约束体现在下面
`TIER_MODIFIER_NOURISH`/`TIER_MODIFIER_RESTRAIN` 的具体措辞里，改动前请
保持这条底线。

2026-08-13 二次修正：`TIER_MODIFIER` 最初是nourish/restrain共用的单一
字典，且只写"不能出现死亡/枯萎意象"这条禁止清单、没有给出正面描述，
真实`--sample`出图后发现木行nourish方向t3（亟待）反而比t1（安泰）看起来
更茂盛——现拆成 `TIER_MODIFIER_NOURISH`/`TIER_MODIFIER_RESTRAIN` 两份，
各自明确写出该档位具体该长什么样（不只是"不能怎样"），详见该常量定义处
的完整说明。
"""
import os
import sys
import time
from pathlib import Path

import gemini_image
import tripo_client
import supabase_storage

BASE_DIR = Path(__file__).parent
OUTPUT_DIR = BASE_DIR.parent / "assets" / "decorations" / "wuxing"

WX_LIST = ['木', '火', '土', '金', '水']
DIRECTIONS = ['nourish', 'restrain']
TIERS = [1, 2, 3]

WX_EN = {'木': 'wood', '火': 'fire', '土': 'earth', '金': 'metal', '水': 'water'}

# ── 风格锚点：复用 bazi_prompt.py 的同一份常量，避免两处各自维护一份
#    重复的风格描述文本以后走偏（2026-08-13本次改动同步抽取的常量）。
#    2026-08-13二次修正：这里特意只引用 `STYLE_ANCHOR_CORE`（跨场景通用
#    的风格语言，不含岛屿场景描述），**不引用**完整版 `STYLE_ANCHOR`——
#    后者内含"floating island with rocky underside, dark starry background
#    with subtle nebula"，本身就是在描述一整个地形/场景，会跟下面
#    ISOLATED_OBJECT_SUFFIX 明确要求的"no ground plane and no other
#    objects or scenery of any kind"直接打架，容易让生成模型把装饰物画成
#    "长在一座小浮岛上"而不是干净孤立的单个物件，破坏3D提取所需要的清晰
#    轮廓。详见 bazi_prompt.py 里 STYLE_ANCHOR_CORE 定义处的完整说明。
sys.path.insert(0, str(BASE_DIR))
from bazi_prompt import STYLE_ANCHOR_CORE  # noqa: E402


# ── 第一层：五行×方向 → 材质/形态描述（不是"树/环"字面几何体套模板，每个
#    五行、每个方向都有符合本体意象的独立描述）─────────────────────────
# 配色参考 island-decorations.js::CONFIG.WUXING_COLORS（木=嫩绿/火=红/
# 土=金黄/金=银灰/水=蓝），意境参考 bazi_prompt.py::DAY_MASTER_CORE 的
# 五行相关描述风格。nourish（喜用神不足，需要被滋养/照顾）与restrain
# （忌神过旺，需要被约束/收敛）是两种完全不同的失衡状态，不是简单"好/坏"
# 对立——这里刻意用"规模"而不是"当下状态"来体现这个区别：nourish的物件
# 本体是"小/幼/朴素"（代表数量不足），restrain的物件本体是"大/密/溢出"
# （代表过剩）。物件当下究竟是被悉心打理还是无人照料，交给下面独立的
# TIER_MODIFIER_NOURISH/TIER_MODIFIER_RESTRAIN 层控制，两层不重复表达
# 同一件事——避免出现"物件描述已经写死'正在枯萎'，档位1又要求它
# '欣欣向荣'"这种自相矛盾的组合。
BASE_FORM = {
    ('木', 'nourish'): (
        "a young tender green sapling with a handful of small delicate leaves, "
        "slender pale roots reaching into a modest patch of soil, rising from a "
        "low mound of bare earth"
    ),
    ('木', 'restrain'): (
        "a dense cluster of dark green thorny vines and tangled brambles coiling "
        "thickly around a small weathered stone marker, woody growth bristling "
        "with sharp thorns spreading outward"
    ),
    ('火', 'nourish'): (
        "a small glowing ember resting within a modest stone brazier, a thin "
        "wisp of smoke curling upward, a few unlit kindling twigs stacked beside it"
    ),
    ('火', 'restrain'): (
        "a large blazing bonfire with tall red-orange flames rising above a "
        "round stone hearth, flickering tongues of fire and scattering sparks "
        "spilling past the rim"
    ),
    ('土', 'nourish'): (
        "a modest mound of warm golden-brown earth resting on a bare rocky "
        "ledge, a shallow furrow carved into the loose soil, fine granular texture"
    ),
    ('土', 'restrain'): (
        "a tall precarious heap of large jagged golden-brown boulders piled "
        "high on a small stone platform, uneven rock stacked layer upon layer "
        "pressing outward"
    ),
    ('金', 'nourish'): (
        "a single slender sword blade resting half-sheathed in a low stone "
        "pedestal, plain silver-grey metal with a subtle cool sheen, modest and unadorned"
    ),
    ('金', 'restrain'): (
        "a bristling cluster of oversized angular silver-grey metal blades "
        "and spikes bursting outward from a stone base, jagged edges radiating "
        "in every direction with a cold metallic gleam"
    ),
    ('水', 'nourish'): (
        "a small round stone basin resting on bare rock, a single thin trickle "
        "of water dripping from a crack above into its shallow center"
    ),
    ('水', 'restrain'): (
        "a swelling tide of dark blue water surging up and spilling over the "
        "rim of a small stone embankment, foam and spray bursting outward past "
        "its boundary"
    ),
}

# ── 第二层：档位状态描述（安泰/见微/亟待）─────────────────────────────
# 2026-08-13 二次修正（`--sample`真实出图后总agent目视复查发现的问题）：
# 最初用nourish/restrain共用同一份TIER_MODIFIER文本，且每一档只写"不能
# 出现死亡/枯萎/恐怖意象"这条禁止清单，没有给出"那应该长什么样"的具体
# 正面描述。真实生成结果显示：木行nourish方向的t3（亟待）反而比t1（安泰）
# 看起来更茂盛——AI面对"嫩芽"这种本体意象就是"生机勃勃"的物件，只被告知
# "不能画得像要死"，很容易过度理解成"那就继续往健康了画"，导致该有的
# "疏于打理"视觉信号完全没体现，三档区分度不够。restrain方向（藤蔓/荆棘
# 那三档）当时目测区分度还可以，但因为是共用文本，修nourish不能顺手把
# restrain已经不错的效果改坏。
#
# 改法：拆成 TIER_MODIFIER_NOURISH / TIER_MODIFIER_RESTRAIN 两份独立文本
# （而不是继续共用一份、靠一段"两头都要适用"的文字硬撑）——nourish（物件
# 本体是"不足"，档位轴=是否被悉心照料，越差应该越"蔫"：叶片低垂、颜色
# 转暗、形态变得单薄稀疏）与restrain（物件本体是"过剩"，档位轴=是否被
# 修剪收敛，越差应该越"野"：向外蔓延得更远、轮廓更密更乱更失控）是两种
# 相反的视觉变化方向，硬要用同一段话覆盖容易两头都说不清楚，拆开后各自
# 才能给出真正具体、可操作的正面描述。每档仍然保留"不能出现死亡/腐烂/
# 阴森意象"这条红线（贯穿全项目的"不制造焦虑"原则，3D资产视觉基调需与
# AI文案 gemini_analysis.py 一致：平静、有希望感，不是凋零/死寂），但红线
# 之外必须先给出具体该长什么样的正面描述，不能只靠"禁止清单"倒逼AI自己
# 瞎猜。`build_prompt()` 相应地按 `direction` 查对应的字典，不再是共用
# 单一 `TIER_MODIFIER[tier]`。
TIER_MODIFIER_NOURISH = {
    1: (
        "currently full and vividly colored for its kind — upright and plump "
        "in shape, clearly thriving under attentive care, tended with quiet "
        "care, exactly as it should be"
    ),
    2: (
        "showing the first signs of being left unattended — a little duller "
        "in color and looser in shape than before, slightly less upright, "
        "but still holding together and not urgent"
    ),
    3: (
        "clearly overdue for attention after being left unattended for some "
        "time — visibly drooping and noticeably duller in color, thinner and "
        "sparser than it should be, quiet and still in the stillness of "
        "neglect, yet the mood remains calm and gently hopeful rather than "
        "alarming; absolutely no signs of decay, rot, death, or anything "
        "eerie or ominous — simply understated, dimmed, and in need of care"
    ),
}
TIER_MODIFIER_RESTRAIN = {
    1: (
        "currently kept in careful order — trimmed back into a neat, "
        "compact, contained shape, tended with quiet care, exactly as it "
        "should be"
    ),
    2: (
        "showing the first signs of being left unattended — spreading a "
        "little further and looking slightly less contained than before, "
        "edges starting to loosen outward, but still holding a recognizable "
        "shape, nothing urgent yet"
    ),
    3: (
        "clearly overdue for attention after being left unattended for some "
        "time — visibly spreading further outward into a denser, more "
        "tangled and sprawling silhouette than it should have, quiet and "
        "still in the stillness of neglect, yet the mood remains calm and "
        "gently hopeful rather than alarming; absolutely no signs of decay, "
        "rot, death, menace, or anything eerie or violent — simply "
        "overgrown, unchecked, and in need of trimming"
    ),
}

# ── 第三层：孤立物件取景后缀 ───────────────────────────────────────────
# 参考 gemini_image.py 内部已经在追加的"ADDITIONAL STYLE NOTES FOR 3D
# CONVERSION"写法风格，但这次是"孤立小装饰物"不是"完整岛屿"，强调
# single object / 无地面 / 无其它物体，方便TripoAI后续图生3D干净提取。
ISOLATED_OBJECT_SUFFIX = (
    "ISOLATED OBJECT SHOT: a single small decorative object centered in frame, "
    "plain solid dark background with no ground plane and no other objects or "
    "scenery of any kind, clean and clearly readable silhouette suitable for "
    "3D extraction, soft studio-style lighting from above, no text or labels "
    "anywhere in the image."
)

# ── "已巩固"通用款：单独一条提示词，不分五行 ──────────────────────────
# 灵位/香炉一类庄重、"问题已被彻底解决"的意象，与其它五行问题态明显区分开
# （其它是"未完成/待关注"，这条是"已完成/已安放"），风格仍遵循同一套
# STYLE_ANCHOR_CORE保持协调（不引用完整STYLE_ANCHOR，理由见上方import处
# 的说明——岛屿场景描述与"孤立物件"取景要求互相矛盾）。
SHRINE_PROMPT = (
    "a small solemn ancestral shrine altar carved from warm golden-brown stone, "
    "a single bronze incense burner resting on top with three thin sticks of "
    "incense gently smoking, a faint warm golden glow radiating from within the "
    "altar, calm and dignified, conveying a sense of resolution and lasting peace "
    "— this object represents a matter that has been fully and permanently settled. "
    f"{ISOLATED_OBJECT_SUFFIX} {STYLE_ANCHOR_CORE}"
)


def build_prompt(wx: str, direction: str, tier: int) -> str:
    tier_dict = TIER_MODIFIER_NOURISH if direction == 'nourish' else TIER_MODIFIER_RESTRAIN
    return f"{BASE_FORM[(wx, direction)]}, {tier_dict[tier]}. {ISOLATED_OBJECT_SUFFIX} {STYLE_ANCHOR_CORE}"


def _all_combos():
    """返回全部31个 (label, prompt, out_path) 组合，label供人类阅读用。"""
    combos = []
    for wx in WX_LIST:
        for direction in DIRECTIONS:
            for tier in TIERS:
                label = f"{wx}_{direction}_t{tier}"
                out_path = OUTPUT_DIR / f"{WX_EN[wx]}_{direction}_t{tier}.glb"
                combos.append((label, build_prompt(wx, direction, tier), out_path))
    combos.append(("shrine_generic", SHRINE_PROMPT, OUTPUT_DIR / "shrine_generic.glb"))
    return combos


def _is_valid_glb(path: Path) -> bool:
    """
    2026-08-14 qa-reviewer复查发现问题3新增：粗粒度glTF二进制格式校验——只检查
    文件开头4字节magic number是否为 `b'glTF'`，不引入 `pygltflib` 等额外依赖做
    完整结构解析。

    用于断点续跑"文件已存在则跳过"的判断，取代此前只看 `size > 1024字节` 的
    弱校验：本脚本单次全量跑几十分钟，中途Ctrl-C是大概率会发生的事——如果正好
    卡在 `write_bytes` 写到一半，或者 `download_glb()` 拿到了被截断的HTTP响应，
    磁盘上会留下一个几百KB、size校验能通过、但内容其实是残缺/非法GLB的文件，
    此前会被永久当成"已完成"跳过，直到接进 `island-decorations.js` 后才会在
    浏览器GLTFLoader里报解析失败，届时已经很难追溯是哪一步出的问题。
    """
    try:
        if path.stat().st_size <= 1024:
            return False
        with open(path, 'rb') as f:
            return f.read(4) == b'glTF'
    except OSError:
        return False


def _label_for(wx: str, direction, tier) -> str:
    """统一的人类可读标签拼接逻辑，`generate_one()`/`_run_batch()`（额度熔断
    打印用）共用同一处，避免各自实现一遍——此前 `_run_batch()` 的额度耗尽
    分支单独拼了一次 `f"{wx}_{direction}_t{tier}"`，没有像 `generate_one()`
    那样处理 `wx=='shrine'` 的特例，导致卡在shrine_generic这一项时打印出
    "shrine_None_tNone" 这种不可读的标签（纯展示问题，不影响功能，但没必要
    留着两份不一致的拼接逻辑）。"""
    return "shrine_generic" if wx == 'shrine' else f"{wx}_{direction}_t{tier}"


def generate_one(wx: str, direction: str, tier, force: bool = False) -> tuple:
    """
    生成单个组合的GLB，落盘到 OUTPUT_DIR。
    `tier` 传 None 表示这是 shrine_generic 特例（不分五行/方向/档位）。

    返回 ('ok'|'skip'|'fail', 详情字符串)。

    2026-08-14 qa-reviewer复查发现问题1修复：`tripo_client.TripoInsufficientCreditError`
    （账户额度耗尽）不在这里被吞掉——原来的 `except Exception` 会统一捕获成
    `'fail'` 继续跑下一个组合，导致额度耗尽后剩余的每一个组合仍会先烧一次付费
    Gemini出图，才在Tripo提交阶段失败。现在显式重新抛出，交给上一层 `_run_batch()`
    识别并整批熔断，不在本函数内部处理。
    """
    label = _label_for(wx, direction, tier)
    if wx == 'shrine':
        prompt = SHRINE_PROMPT
        out_path = OUTPUT_DIR / "shrine_generic.glb"
    else:
        prompt = build_prompt(wx, direction, tier)
        out_path = OUTPUT_DIR / f"{WX_EN[wx]}_{direction}_t{tier}.glb"

    # 断点续跑核心机制：文件已存在且通过GLB magic bytes校验（不只是size>1024）
    # 时才判定"已完成"直接跳过。
    if not force and _is_valid_glb(out_path):
        return ('skip', str(out_path))

    try:
        print(f"  [{label}] 生成2D图像...")
        png_bytes = gemini_image.generate_island_image(prompt)

        print(f"  [{label}] 提交TripoAI图生3D（face_limit=5000）...")
        task_id = tripo_client.submit_image_to_3d(png_bytes, face_limit=5000)

        print(f"  [{label}] 轮询任务 {task_id}...")
        result = tripo_client.poll_until_done(task_id, max_wait=300)
        output = result.get('output', {}) or {}
        # 与 main.py::_poll_tripo 同一套字段兼容逻辑（生产验证过）：优先取
        # pbr_model（当前默认开texture=True时TripoAI实际返回的字段名），
        # 取不到再退回官方SDK文档标注的model字段。
        glb_url = output.get('pbr_model') or output.get('model')
        if not glb_url:
            return ('fail', f"{label}: TripoAI成功但无model/pbr_model字段: {result}")

        print(f"  [{label}] 下载GLB...")
        glb_bytes = supabase_storage.download_glb(glb_url)

        # 写入前先校验magic bytes——被截断/损坏的下载不应该以"看起来完成"的
        # 状态落盘，否则会被下一次续跑的 `_is_valid_glb()` 之外的旧逻辑（或者
        # 万一将来又被改回弱校验）误判为已完成；现在直接在这里拦截成明确的
        # 'fail'，问题在下载这一步就暴露，不拖到后续续跑/浏览器加载才发现。
        if glb_bytes[:4] != b'glTF':
            return ('fail', f"{label}: 下载到的内容不是合法GLB（开头4字节非glTF，"
                             f"可能是被截断的响应或TripoAI返回了非二进制内容），"
                             f"共{len(glb_bytes)}字节，未写入磁盘")

        # 原子写入：先写临时文件，成功后再 os.replace() 原子改名——避免中途
        # 被Ctrl-C或进程崩溃打断，导致目标路径（`out_path`）上留下一个写到
        # 一半的残缺文件。`.tmp`文件本身仍有极小概率在`write_bytes()`执行到
        # 一半时被打断——那不会污染`out_path`（还没replace过去），但会在目录
        # 里留一个孤儿`.tmp`文件。用`except BaseException`（覆盖`KeyboardInterrupt`，
        # 它不是`Exception`的子类）兜底清理，清理后重新抛出，不吞掉中断信号。
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        tmp_path = out_path.with_suffix(out_path.suffix + '.tmp')
        try:
            tmp_path.write_bytes(glb_bytes)
            os.replace(tmp_path, out_path)
        except BaseException:
            tmp_path.unlink(missing_ok=True)
            raise
        return ('ok', f"{label}: {out_path} ({len(glb_bytes)//1024} KB)")
    except tripo_client.TripoInsufficientCreditError:
        raise  # 不吞掉，交给 _run_batch() 识别并整批熔断，见上方函数docstring
    except Exception as e:
        return ('fail', f"{label}: {e}")


def _run_batch(combos, force: bool = False):
    """combos: [(wx, direction, tier_or_None), ...]（shrine用wx='shrine'）

    2026-08-14 qa-reviewer复查发现问题1修复：TripoAI账户额度耗尽是"整批都会
    继续失败"的场景（不是某一个组合偶发失败），此前每个组合各自 `except
    Exception` 兜底+无条件 `continue`，导致额度耗尽后剩余组合仍会一个不落地
    先烧一次付费Gemini出图、再在Tripo提交阶段失败——真实全量跑时水行6个组合
    就是这样被逐个白扣了一次Gemini的钱。现在对 `tripo_client.
    TripoInsufficientCreditError` 单独识别、立即 `break` 整批，不再继续烧钱。
    """
    ok_list, skip_list, fail_list = [], [], []
    total = len(combos)
    for i, (wx, direction, tier) in enumerate(combos):
        try:
            result, detail = generate_one(wx, direction, tier, force=force)
        except tripo_client.TripoInsufficientCreditError as e:
            remaining = total - i - 1
            print(f"  🛑 TripoAI账户额度耗尽，立即停止本批次（还剩 {remaining} "
                  f"个组合未执行，避免继续白烧Gemini出图费用）: {e}")
            fail_list.append(f"[额度耗尽，批次中断] {_label_for(wx, direction, tier)}: {e}")
            break
        if result == 'ok':
            print(f"  ✅ {detail}")
            ok_list.append(detail)
        elif result == 'skip':
            print(f"  ⏭️  跳过（已存在）: {detail}")
            skip_list.append(detail)
        else:
            print(f"  ❌ {detail}")
            fail_list.append(detail)
        time.sleep(1)  # 轻微限速，避免连续触发API速率限制

    print(f"\n{'='*60}")
    print(f"完成：✅ {len(ok_list)}成功  ⏭️  {len(skip_list)}跳过  ❌ {len(fail_list)}失败")
    if fail_list:
        print("\n❌ 失败清单（可用 --only=五行:方向 定点重跑）:")
        for f in fail_list:
            print(f"   - {f}")
    print(f"{'='*60}\n")


def dry_run():
    combos = _all_combos()
    print(f"共 {len(combos)} 条 prompt（{len(combos)-1}个五行×方向×档位 + 1个shrine_generic）：\n")
    for label, prompt, out_path in combos:
        print(f"{'─'*60}")
        print(f"[{label}] → {out_path}")
        print(f"{'─'*60}")
        print(prompt)
        print()


def sample_run(force: bool = False):
    """只生成"木"一个五行的6个组合（2方向×3档）+ shrine_generic，共7个。"""
    combos = []
    for direction in DIRECTIONS:
        for tier in TIERS:
            combos.append(('木', direction, tier))
    combos.append(('shrine', None, None))
    print(f"--sample: 生成 {len(combos)} 个组合（木×2方向×3档 + shrine_generic）\n")
    _run_batch(combos, force=force)


def full_run(force: bool = False):
    combos = []
    for wx in WX_LIST:
        for direction in DIRECTIONS:
            for tier in TIERS:
                combos.append((wx, direction, tier))
    combos.append(('shrine', None, None))
    print(f"全量: 生成 {len(combos)} 个组合\n")
    _run_batch(combos, force=force)


def only_run(spec: str, force: bool = False):
    """--only=木:nourish → 该五行×方向的3个档位；--only=shrine → 单独shrine_generic"""
    if spec == 'shrine':
        print("--only=shrine: 重跑 shrine_generic\n")
        _run_batch([('shrine', None, None)], force=force)
        return
    if ':' not in spec:
        print(f"❌ --only 格式错误，应为 五行:方向（如 木:nourish）或 shrine，收到: {spec}")
        return
    wx, direction = spec.split(':', 1)
    if wx not in WX_LIST or direction not in DIRECTIONS:
        print(f"❌ --only 参数无效: wx={wx}（应为{WX_LIST}之一）"
              f" direction={direction}（应为{DIRECTIONS}之一）")
        return
    combos = [(wx, direction, tier) for tier in TIERS]
    print(f"--only={spec}: 重跑 {len(combos)} 个组合\n")
    _run_batch(combos, force=force)


KNOWN_FLAGS = {'--force', '--dry-run', '--sample', '--help', '-h'}


if __name__ == '__main__':
    args = sys.argv[1:]

    # 2026-08-14 qa-reviewer复查发现问题2修复：`--help`/`-h`、拼错的`--dryrun`
    # （少一个连字符）、`--only 木:nourish`（`=`打成空格）这几种情况，此前
    # 都会因为没有命中任何已知分支而静默落进最后的 `else` 全量付费生成分支——
    # 对一个文档里反复强调"务必先--dry-run"的付费脚本，这是最容易出事的漏洞
    # （用户随手敲个`--help`想看用法，结果直接触发真实扣费）。
    #
    # 2026-08-14 qa-reviewer第二轮复查发现修复本身有漏洞（CONFIRMED）：上一版
    # 未知参数校验被塞在最内层"既不是dry-run也不是sample也不是only"的`else`
    # 分支里，只覆盖了"全量"这一条路径——真正会出事的场景是"合法flag和拼错的
    # flag混在同一条命令里"，比如 `--sample --dryrun --force`：`elif '--sample'
    # in args` 这个条件本身依然为真，会直接跳进 `sample_run()` 触发真实付费
    # 生成，压根不会走到那段只挂在全量分支里的校验逻辑。同理 `--only=水:nourish
    # --dryrun`、`--sample --force --typo` 都会被部分合法参数"带飞"，实测全部
    # 直接跑了真实付费生成。
    #
    # 现在改为：不管最终要走哪个分支，一律先对整个 `args` 做一次统一校验——
    # 剔除已知的 `KNOWN_FLAGS`（不含 `--only=xxx`，用前缀匹配单独处理）之后，
    # 只要还有任何无法识别的token，直接打印用法说明+`sys.exit(2)`，不再往下
    # 分发到任何一个会花钱的分支。校验放在分支派发**之前**做一次性判断，不会
    # 出现"部分参数合法就放行整体"的漏洞。零参数触发全量这个既有行为不受
    # 影响（`unknown`会是空列表）。
    unknown = [a for a in args if a not in KNOWN_FLAGS and not a.startswith('--only=')]
    if unknown:
        print(f"❌ 无法识别的参数: {unknown}\n"
              f"（想跑全量付费生成请不带任何参数；想看用法说明用 --help）\n")
        print(__doc__)
        sys.exit(2)

    if '--help' in args or '-h' in args:
        print(__doc__)
        sys.exit(0)

    if '--dry-run' in args:
        dry_run()
    elif '--sample' in args:
        sample_run(force='--force' in args)
    else:
        only_arg = next((a for a in args if a.startswith('--only=')), None)
        if only_arg:
            spec = only_arg.split('=', 1)[1]
            if not spec:
                # `--only=`（空值）此前直接 `return` 退出码0，跟其它用法错误的
                # `exit(2)` 不一致，容易让shell脚本/CI把这种明显的用法错误
                # 误判成"成功"。统一成用法错误处理。
                print("❌ --only 格式错误，`--only=` 后面必须跟具体的 五行:方向"
                      "（如 木:nourish）或 shrine，不能为空\n")
                print(__doc__)
                sys.exit(2)
            only_run(spec, force='--force' in args)
        else:
            full_run(force='--force' in args)
