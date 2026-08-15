"""
八字数据 → TripoAI 提示词生成器
核心映射：日主/五行强弱/纳音/神煞/空亡 → 3D命盘岛描述
"""

# ── 日主 → 岛屿核心形态（阴阳区分）──────────────────────────
DAY_MASTER_CORE = {
    '甲': {
        'core': 'massive ancient gnarled Chinese pine tree with dramatic exposed roots spreading across the island as centerpiece',
        'terrain': 'lush green moss-covered rocky terrain with bamboo groves',
        'atmosphere': 'mystical misty morning, soft green ambient glow',
        'color': 'deep forest green, mossy brown, jade green accents',
    },
    '乙': {
        'core': 'weeping willow trees and flowering vines cascading over cliff edges',
        'terrain': 'soft green gentle hills with scattered wildflower meadows',
        'atmosphere': 'gentle spring breeze, pink and white petals drifting',
        'color': 'soft green, pale pink, white blossom accents',
    },
    '丙': {
        'core': 'active volcanic peak with flowing lava streams, blazing sun floating directly above',
        'terrain': 'scorched dark volcanic rock, glowing orange lava cracks in ground',
        'atmosphere': 'intense dry heat, dramatic orange-red glow from below',
        'color': 'deep crimson, volcanic black, bright orange lava glow',
    },
    '丁': {
        'core': 'elaborate array of glowing Chinese lanterns on stone pillars, eternal flame altar at center',
        'terrain': 'smooth dark stone with candle-lit pathways and red silk banners',
        'atmosphere': 'warm intimate golden candlelight, evening festival glow',
        'color': 'deep red, warm gold, soft orange candle glow',
    },
    '戊': {
        'core': 'massive rugged stone mountain peak with layered rocky cliffs and ancient stone terraces',
        'terrain': 'dry gray-brown rocky terrain, boulder formations, dusty earth',
        'atmosphere': 'commanding and stable, strong direct sunlight, powerful presence',
        'color': 'warm golden-brown stone, deep gray rock, sand yellow',
    },
    '己': {
        'core': 'rolling fertile hills with rice terraces, garden pavilion surrounded by crops',
        'terrain': 'soft earth mounds, tilled dark soil, green crop rows',
        'atmosphere': 'warm and nurturing, abundant harvest feeling, gentle light',
        'color': 'warm earth brown, lush green crops, terracotta accents',
    },
    '庚': {
        'core': 'towering metallic blade formations and steel spires erupting from ground',
        'terrain': 'silver-gray metallic rocky ground with sharp angular formations',
        'atmosphere': 'sharp and gleaming, cool blue-white metallic reflection',
        'color': 'silver, steel gray, cold blue metallic sheen',
    },
    '辛': {
        'core': 'crystal quartz gem clusters and luminous pearl formations as centerpiece',
        'terrain': 'white crystalline rocky ground with scattered gemstone deposits',
        'atmosphere': 'shimmering soft light, pure refined elegance',
        'color': 'pure white, pale blue, soft pearl luminescence',
    },
    '壬': {
        'core': 'powerful wide waterfall cascading into large deep luminous pool at center',
        'terrain': 'dark blue-gray rocky shores, rushing water channels across island',
        'atmosphere': 'powerful flowing energy, cool mist rising, deep blue glow',
        'color': 'deep ocean blue, teal, dark aquamarine, foam white',
    },
    '癸': {
        'core': 'misty rain pools with glowing lotus flowers and dew-covered moss stones',
        'terrain': 'dark mossy stone with thin water film, delicate water droplets everywhere',
        'atmosphere': 'gentle rain mist, quiet reflection, mysterious fog',
        'color': 'deep teal, soft lotus pink, misty silver-gray',
    },
}

# ── 日主 → 岛屿核心形态（中文摘要版，供AI中文叙事prompt用）──────────────
# 2026-08-13新增（第三阶段"五行维护系统"）：上面的 DAY_MASTER_CORE 是纯英文，
# 专供 TripoAI 图像生成提示词使用。island_service/gemini_analysis.py 新增的
# `step_wuxing_maintenance`步骤需要喂给Gemini中文叙事prompt——如果直接把英文
# DAY_MASTER_CORE 塞进中文prompt，模型会自己音译/直译，造成风格漂移和中英文
# 语言混杂（比如生硬地把"gnarled pine tree"翻成"多节的松树"这类不自然表达），
# 所以单独维护一份中文对照版本，供中文叙事prompt直接引用。内容参考了
# js/config.js::STEMS_INFO 里已有的 `gloss` 字段（那个是给3D标注UI用的
# 8字短语，本版本是给AI做叙事扩写用的完整句子，信息量更大：形态+习性+
# 大致需要什么/忌讳什么，但故意不写死"缺什么"，因为具体缺什么由当次命盘的
# `favorable`/`favorable2`/`unfavorable`决定，不是日主本身固定的）。
# 10个日主必须与 DAY_MASTER_CORE/STEMS_INFO 保持同一套天干顺序，不遗漏。
DAY_MASTER_CORE_ZH = {
    '甲': '参天古松，根系深扎山野，枝干笔直冲天，是山林里最挺拔的存在。',
    '乙': '柔韧藤蔓与花草，依势而生、随风摇曳，缠绕山石也能开出繁花。',
    '丙': '烈日当空，光芒万丈，如活火山喷薄的岩浆，热力四射、普照万物。',
    '丁': '一豆烛火，在夜色里静静燃烧，光虽微弱却温暖绵长，照亮咫尺之间。',
    '戊': '巍峨山岳，层峦叠嶂，厚重岩石堆叠出稳固的轮廓，任风吹雨打岿然不动。',
    '己': '肥沃田园，阡陌纵横，是滋养万物生长的一方厚土，静静孕育着生机。',
    '庚': '利刃剑锋，寒光凛冽，如钢铁淬炼而成的兵刃，锐不可当、斩钉截铁。',
    '辛': '珠玉美石，精雕细琢，温润中透着锋芒，是首饰匣里最耀眼的存在。',
    '壬': '江海大川，奔涌不息，浩荡水势冲刷四方，气势磅礴、志在千里。',
    '癸': '雨露甘霖，细密无声，悄然滋润着每一寸土地，看似柔弱却渗透深远。',
}

# ── 五行 → 视觉元素（受强弱影响）──────────────────────────────
WUXING_VISUAL = {
    '木': {
        'strong': 'dense ancient pine forest covering large areas, multiple large trees',
        'medium': 'several mature trees and bamboo groves scattered around',
        'weak':   'sparse dry trees, a few struggling plants in rock crevices',
        'absent': 'completely barren of vegetation, only bare rock',
    },
    '火': {
        'strong': 'blazing lava pools, multiple fire formations, enormous glowing sun overhead, scorched terrain everywhere',
        'medium': 'moderate lava cracks, warm fire torches, partial sun glow',
        'weak':   'faint ember glow in stone, small scattered candle flames',
        'absent': 'cold dark terrain, no fire, icy stone surfaces',
    },
    '土': {
        'strong': 'massive stone mountain dominates, thick layered rock terraces everywhere',
        'medium': 'solid rock formations, steady stone pathways',
        'weak':   'thin soil layer, small rock mounds',
        'absent': 'floating platform only, minimal earth material',
    },
    '金': {
        'strong': 'gleaming metal spires everywhere, abundant crystal formations, metallic veins glowing',
        'medium': 'several crystal clusters, mineral veins in rock faces',
        'weak':   'faint metallic glints in stone, scattered small gems',
        'absent': 'no metal or crystal elements visible',
    },
    '水': {
        'strong': 'water everywhere, large pools, multiple waterfalls, misty fog across whole island',
        'medium': 'flowing streams, medium pool, gentle waterfall',
        'weak':   'small puddles, dried riverbed with trace moisture',
        'absent': 'completely dry, cracked earth, no water at all',
    },
}

def wuxing_level(pct: float) -> str:
    if pct >= 0.35: return 'strong'
    if pct >= 0.20: return 'medium'
    if pct >= 0.06: return 'weak'
    return 'absent'

# ── 全局风格锚点 ─────────────────────────────────────────────
# 2026-08-13抽取（第四阶段"3D资产生产流程"）：此前只内联在
# generate_island_prompt() 结尾一处，本次新增的离线批量资产生成脚本
# generate_wuxing_assets.py 也需要同一套风格描述——抽成命名常量后两处
# 共享同一份文本，避免各自维护一份、日后走偏。
#
# 2026-08-13 二次修正（总agent复查`--dry-run`输出后发现的自相矛盾）：
# 最初把 generate_island_prompt() 结尾整段文本原样抽成单一 STYLE_ANCHOR，
# 但这段文本混了两类完全不同性质的内容——①真正跨场景通用的风格语言
# （低多边形/无写实渲染/中式神话美学/从上方打光）；②专属"完整浮岛取景"
# 的场景描述（"floating island with rocky underside"本身就是在描述一整个
# 地形/场景物体，不是纯风格形容词）。generate_wuxing_assets.py 的"孤立
# 小装饰物"提示词如果原样整段复用这个常量，会同时出现"ISOLATED OBJECT
# SHOT: ...no ground plane and no other objects or scenery of any kind..."
# （要求干净孤立、绝对没有场景）和"floating island with rocky underside,
# dark starry background with subtle nebula"（本身就是在要求画一整个浮岛
# 场景）两句互相矛盾的指令，容易让生成模型画成"装饰物长在一座小浮岛上"
# 而不是干净孤立的单个物件，直接破坏3D提取所需要的清晰轮廓这个目的。
#
# 现拆成三个不再互相依赖拼接顺序的最小拼图块（下方 `_STYLE_*`，唯一权威
# 定义处），再由这些拼图块分别组装出两个用途不同的公开常量——不是从旧的
# 单一 STYLE_ANCHOR 用字符串切片/替换的方式"抠掉"岛屿场景部分（那种做法
# 脆弱易碎，一旦原始措辞顺序变化就会切错位置）：
# - `STYLE_ANCHOR`：完整岛屿专用，内容与拆分前的原始文本逐字节完全一致
#   （`generate_island_prompt()` 的输出因此不受本次拆分影响），继续包含
#   "floating island with rocky underside..."这段场景描述。
# - `STYLE_ANCHOR_CORE`：跨场景通用部分（含"从上方打光"——孤立小物件同样
#   需要这条通用的布光要求），**不含**任何岛屿场景描述，供
#   generate_wuxing_assets.py 的孤立物件提示词使用。
_STYLE_GENERIC = (
    "low-poly geometric style like premium mobile game art, clean faceted "
    "surfaces, no photorealism, Chinese mythology aesthetic"
)
_STYLE_LIGHTING = "dramatic lighting from above"
_STYLE_ISLAND_SCENE = (
    "floating island with rocky underside, dark starry background with subtle nebula"
)

STYLE_ANCHOR = (
    f"STYLE REQUIREMENTS: {_STYLE_GENERIC}, {_STYLE_ISLAND_SCENE}, {_STYLE_LIGHTING}."
)
STYLE_ANCHOR_CORE = f"STYLE REQUIREMENTS: {_STYLE_GENERIC}, {_STYLE_LIGHTING}."

# ── 纳音 → 地貌材质修饰 ─────────────────────────────────────
NAYIN_MODIFIER = {
    '海中金': 'ocean-floor metallic mineral deposits beneath water surface',
    '火中木': 'charred ancient trees surviving volcanic heat',
    '大林木': 'vast ancient forest covering hillside',
    '路旁土': 'dusty roadside earthen texture, worn stone paths',
    '剑锋金': 'sharp metallic rock formations like sword edges jutting from ground',
    '山头火': 'mountaintop eternal flame burning in stone bowl',
    '涧下水': 'hidden underground spring emerging between rocks',
    '城头土': 'ancient fortress walls integrated into terrain',
    '白蜡金': 'pale white waxy mineral deposits coating rocks like candle wax',
    '杨柳木': 'weeping willow trees lining the island edge',
    '泉中水': 'crystal-clear natural spring forming small pool',
    '屋上土': 'ancient tiled roof fragments and earthen building ruins',
    '霹雳火': 'lightning strike marks scorched into stone, crackling energy',
    '松柏木': 'tall straight pine and cypress trees in formation',
    '长流水': 'long continuous flowing river channeled through island',
    '砂中金': 'gold flecks and metallic sand sparkling in terrain',
    '山下火': 'underground lava glow visible through rock cracks at base',
    '平地木': 'flat grassy meadow with scattered young trees',
    '壁上土': 'ancient cliff face with carved patterns and weathered stone',
    '金箔金': 'ultra-thin gold leaf texture coating stone surfaces',
    '覆灯火': 'upturned lantern shapes carved in stone, glowing from inside',
    '天河水': 'celestial water stream falling from above like a meteor shower',
    '大驿土': 'ancient post road earthen texture, travel-worn stone',
    '钗钏金': 'ornate jewelry-like metallic decorations on stone pillars',
    '桑柘木': 'mulberry trees with large leaves and twisted trunks',
    '大溪水': 'large flowing river streams with rapids crossing the island',
    '沙中土': 'sandy desert-like terrain with fine golden sand',
    '天上火': 'blazing sun hanging directly overhead, scorched dry terrain below',
    '石榴木': 'pomegranate trees with red fruit hanging from branches',
    '大海水': 'deep ocean energy, vast dark water surrounding island base',
    '砂石金': 'metallic sand and stone mineral texture, rough and glittering',
    '天河水': 'starwater raining down from cosmos above',
}

# ── 神煞 → 具体3D物件 ────────────────────────────────────────
SHENSHA_VISUAL = {
    '驿马':   'galloping horse figure on stone path, dynamic motion pose',
    '红鸾':   'colorful phoenix bird with spread wings perched on branch',
    '天乙贵人': 'crowned noble figure in flowing robes, standing on stone pedestal',
    '禄神':   'stack of gold ingots arranged on stone platform',
    '将星':   'imposing armored warrior general statue with raised sword',
    '亡神':   'crumbling stone ruins with broken pillars and collapsed walls',
    '文昌':   'scholar pavilion with open scroll and ink brush on stone desk',
    '桃花':   'peach blossom tree cluster with soft pink petals drifting',
    '华盖':   'ornate ceremonial silk canopy pavilion on stone platform',
    '金舆':   'golden ceremonial palanquin carriage on stone dais',
    '孤辰':   'solitary stone lantern standing alone on cliff edge',
    '羊刃':   'ancient ornate sword thrust vertically into large boulder',
    '咸池':   'peach blossom tree near water edge, petals on water surface',
    '太极贵人': 'yin-yang symbol carved in flat stone, surrounded by candles',
    '国印贵人': 'imperial jade seal carved in green stone on pedestal',
    '德秀贵人': 'elegant lady figure reading scroll in stone pavilion',
    '福星贵人': 'smiling fortune star figure holding golden gourd',
    '学堂':   'ancient Chinese study hall pavilion with stacked books',
    '天喜':   'red celebration ribbons and festive lanterns on poles',
    '沐浴':   'small natural hot spring pool with rising steam',
    '劫煞':   'menacing dark warrior figure with broken chains',
    '太极贵人': 'yin-yang carved stone disc glowing softly',
    '月德贵人': 'moonlight goddess figure holding crescent moon',
    '天德贵人': 'heavenly deity figure with golden halo',
    '三台':   'three-tiered ceremonial stone altar with offerings',
    '八座':   'eight stone seats arranged in circle formation',
    '恩光':   'radiant golden beam of light from above onto a stone',
    '天官贵人': 'celestial official in imperial robes on elevated platform',
}

# ── 十神 → 主导倾向视觉修饰（2026-08-16新增）──────────────────
# 不逐个列出四柱各自对应哪个十神（信息密度对3D视觉没有直接意义），只统计
# 命盘里十神的"主导类别"（哪一类出现次数最多），给这个主导类别一句视觉
# 修饰语。5大类，仿 WUXING_VISUAL/NAYIN_MODIFIER/SHENSHA_VISUAL 的字典风格。
TEN_GOD_CATEGORY = {
    '正印': '印枭', '偏印': '印枭',
    '比肩': '比劫', '劫财': '比劫',
    '食神': '食伤', '伤官': '食伤',
    '正财': '财星', '偏财': '财星',
    '正官': '官杀', '七杀': '官杀',
}

TEN_GOD_VISUAL = {
    '印枭': 'a weathered stone archway or sheltering shrine niche tucked into the terrain, radiating a quiet protective, nurturing presence',
    '比劫': 'paired rock spires or twin trees standing shoulder to shoulder near the core, echoing companionship and quiet rivalry',
    '食伤': 'flowing silk ribbons, swaying wind chimes, or drifting petals scattered across the island, light and expressive in motion',
    '财星': 'small clusters of glinting treasure — stacked coins, jade ingots, or a modest vault — tucked into a corner of the terrain',
    '官杀': 'a solemn stone gate flanked by armored guardian statues near the island edge, commanding and disciplined in bearing',
}

def _ten_god_dominant_line(ten_gods: dict) -> str:
    """统计四柱十神里出现次数最多的类别，只在存在唯一主导类别时才输出一句
    视觉修饰（全部不同/平局时不输出，保证确定性——同一八字必得同一结果，
    不做任意选择）。'日主'（日柱固定值）不在 TEN_GOD_CATEGORY 里，天然被
    跳过，不需要单独排除。"""
    if not isinstance(ten_gods, dict) or not ten_gods:
        return ''
    counts = {}
    for k in ['year', 'month', 'day', 'hour']:
        cat = TEN_GOD_CATEGORY.get(ten_gods.get(k))
        if cat:
            counts[cat] = counts.get(cat, 0) + 1
    if not counts:
        return ''
    max_count = max(counts.values())
    top = [c for c, v in counts.items() if v == max_count]
    if len(top) != 1 or max_count < 2:
        return ''  # 平局或没有任何类别重复出现，不做任意选择
    dominant = top[0]
    return f"CHART TENDENCY ({dominant}主导): {TEN_GOD_VISUAL[dominant]}."


# ── 地支关系 → 地形动态一句话（2026-08-16新增）────────────────
# 命中的关系类型可能多达8种，不全列，只按优先级挑最有代表性的一类：
# 三会（气最集中）> 三刑/自刑（内在张力/冲突）> 冲（现有代码此前完全没用
# 上 interactions 里的冲）。挑到即用一句英文视觉暗示收尾，不逐条展开。
INTERACTION_VISUAL = {
    '三会': 'the terrain feels unusually unified and concentrated — a single dominant biome radiates outward with denser, more cohesive detail than a typical scattered island',
    '三刑': 'faint cracks and knotted, tangled root or rock formations run through part of the terrain, hinting at inner tension and unresolved conflict beneath the surface',
    '冲': 'a visible fault line or fractured ridge splits across part of the terrain, hinting at two clashing energies pulling against each other',
}

def _interaction_dynamics_line(interactions: list) -> str:
    if not interactions:
        return ''
    types = {it.get('type') for it in interactions if isinstance(it, dict)}
    if '三会' in types:
        key = '三会'
    elif '三刑' in types or '自刑' in types:
        key = '三刑'  # 自刑与三刑共用同一句视觉描述（都是"内在张力/纠缠"）
    elif '冲' in types:
        key = '冲'
    else:
        return ''
    return f"TERRAIN DYNAMICS: {INTERACTION_VISUAL[key]}."


# ── 喜用神 → 整体基调强化（2026-08-16新增）──────────────────
# favorable 是单字五行字符串（如'木'），不是数组——历史上出现过"应为数组
# 却被存成字符串"的反向bug，这里做防御性类型处理：字符串直接用，意外传入
# list/tuple 时取第一个元素，其余类型一律忽略不报错（不影响主提示词生成）。
WUXING_EN = {'木': 'WOOD', '火': 'FIRE', '土': 'EARTH', '金': 'METAL', '水': 'WATER'}

def _favorable_emphasis_line(favorable) -> str:
    """喜用神在命理上经常就是命盘里占比最低甚至为0%的那个五行（身弱命局取
    生我同我两条（印+比劫），中和命局直接取占比最低的一行，见 js/bazi-engine.js::
    _favorable()）——这不是边界情况而是常态。措辞不能预设"这个元素在上文
    已经描述得很多、再强调多一点"，那种写法在占比0%时会与FIVE ELEMENTS
    LANDSCAPE里"completely absent"的描述自相矛盾（2026-08-16修复，同类问题
    此前也在PROMPT_SYSTEM.md记录过）。改为不预设数量基础的写法：哪怕稀少
    也要给这一点该元素以不寻常的清澈/光泽感，无论该元素在上文占比多少都
    成立，不需要按占比设阈值分支。"""
    if isinstance(favorable, (list, tuple)):
        favorable = favorable[0] if favorable else None
    if not isinstance(favorable, str):
        return ''
    label = WUXING_EN.get(favorable)
    if not label:
        return ''
    return (f"FAVORABLE ELEMENT EMPHASIS: {label} is this chart's most beneficial element. "
            f"Even if {label} is sparse or nearly absent elsewhere on the island, let at least "
            f"one small trace of it — a glint, a droplet, a thread of color — survive somewhere, "
            f"feeling unusually clear and luminous, like a quiet point of hope rather than an "
            f"afterthought.")


# ── 完整命盘 → TripoAI提示词 ──────────────────────────────────
def generate_island_prompt(bazi_data: dict) -> str:
    """
    输入：BaziEngine计算出的完整八字数据字典
    输出：用于TripoAI API的英文提示词
    """
    dm = bazi_data.get('dayMaster', '甲')          # 日主天干
    core = DAY_MASTER_CORE.get(dm, DAY_MASTER_CORE['甲'])

    # 五行占比
    wx = bazi_data.get('wuxing', {})
    total = sum(wx.values()) or 1
    wx_pct = {k: v / total for k, v in wx.items()}

    wx_lines = []
    for elem, label in [('木','WOOD'), ('火','FIRE'), ('土','EARTH'), ('金','METAL'), ('水','WATER')]:
        pct = wx_pct.get(elem, 0)
        level = wuxing_level(pct)
        desc = WUXING_VISUAL[elem][level]
        wx_lines.append(f"  - {label} ({pct:.0%}): {desc}")

    # 纳音修饰（取日柱+时柱）
    nayin_day  = bazi_data.get('nayin', {}).get('day', '')
    nayin_hour = bazi_data.get('nayin', {}).get('hour', '')
    nayin_parts = []
    for n in [nayin_day, nayin_hour]:
        if n and n in NAYIN_MODIFIER:
            nayin_parts.append(NAYIN_MODIFIER[n])

    # 神煞列表
    all_shensha = []
    for pillar_key in ['year', 'month', 'day', 'hour']:
        for ss in bazi_data.get('shensha', {}).get(pillar_key, []):
            if ss in SHENSHA_VISUAL and ss not in all_shensha:
                all_shensha.append(ss)

    shensha_lines = []
    for ss in all_shensha[:8]:  # 最多取8个，避免提示词过长
        shensha_lines.append(f"  - {SHENSHA_VISUAL[ss]}")

    # 空亡处理（BaziEngine返回kongwang为数组，如['戌','亥']）
    kongwang = bazi_data.get('kongwang', [])
    void_note = ""
    if kongwang:
        void_note = f"One corner of the island shows crumbling ruins and empty voids (空亡/Kong Wang): the {', '.join(kongwang)} branch positions are absent and desolate."

    # 四柱方位标注
    pillar_labels = "Four stone marker pillars labeled: 年柱 (Year), 月柱 (Month), 日柱 (Day), 时柱 (Hour) at four cardinal positions of the island."

    # 十神主导倾向 / 地支关系动态 / 喜用神强调（2026-08-16新增，均为可选的
    # 画龙点睛一句话，数据不满足条件时返回空字符串，不影响提示词其余部分）
    ten_god_line = _ten_god_dominant_line(bazi_data.get('tenGods', {}))
    interaction_line = _interaction_dynamics_line(bazi_data.get('interactions', []))
    favorable_line = _favorable_emphasis_line(bazi_data.get('favorable'))
    extra_lines = [l for l in [favorable_line, ten_god_line, interaction_line] if l]
    extra_block = ('\n' + '\n'.join(extra_lines)) if extra_lines else ''

    # 组装提示词
    prompt = f"""Chinese mythology fantasy floating island, dark starry cosmos background, low-poly stylized 3D game art style, sphere-shaped island, isometric view, high quality detailed render.

ISLAND CORE ({dm}日主): {core['core']}.
TERRAIN: {core['terrain']}.
ATMOSPHERE: {core['atmosphere']}.
COLOR PALETTE: {core['color']}.

FIVE ELEMENTS LANDSCAPE:
{chr(10).join(wx_lines)}

NAYIN TEXTURE: {'; '.join(nayin_parts) if nayin_parts else 'natural stone texture'}.

SHENSHA OBJECTS ON ISLAND:
{chr(10).join(shensha_lines) if shensha_lines else '  - ancient stone guardian statue'}
{extra_block}

{void_note}

{pillar_labels}

{STYLE_ANCHOR}"""

    return prompt.strip()


# ── TripoAI 专用短提示词（text-to-model 限制约500字）──────────
DAY_MASTER_SHORT = {
    '甲': 'ancient towering pine tree island, lush green forest terrain',
    '乙': 'flowering vine island with willow trees and wildflower meadows',
    '丙': 'volcanic island with lava streams, blazing sun above, scorched terrain',
    '丁': 'lantern-lit island with glowing candles and red silk banners',
    '戊': 'massive mountain peak island with rocky cliffs and stone terraces',
    '己': 'fertile farm island with rice terraces and garden pavilion',
    '庚': 'metallic blade island with steel spires and silver rock formations',
    '辛': 'crystal gem island with quartz clusters and pearl formations',
    '壬': 'waterfall island with large deep pool and rushing water channels',
    '癸': 'misty rain island with lotus pools and dew-covered moss stones',
}

def generate_tripo_short_prompt(bazi_data: dict) -> str:
    """
    生成适合 TripoAI text-to-model 的短提示词（<400字符）
    text-to-3D 需要简洁聚焦的描述，不需要长篇细节
    """
    dm = bazi_data.get('dayMaster', '甲')
    core_desc = DAY_MASTER_SHORT.get(dm, 'mystical floating island with ancient trees')

    # 取最强五行
    wx = bazi_data.get('wuxing', {})
    dominant = max(wx, key=wx.get) if wx else '木'
    wx_map = {'木': 'forest and wood', '火': 'fire and lava', '土': 'earth and stone',
              '金': 'crystal and metal', '水': 'water and mist'}
    wx_desc = wx_map.get(dominant, 'natural elements')

    prompt = (
        f"Low-poly stylized Chinese mythology floating island: {core_desc}. "
        f"Dominant element: {wx_desc}. "
        f"Sphere-shaped island with rocky underside, dark starry cosmos background, "
        f"fantasy game art style, dramatic lighting, high quality 3D render."
    )
    return prompt[:450]  # 硬限制450字符


# ── 测试用例（命盘：2001-06-24 未时，日主戊土）────────────────
if __name__ == '__main__':
    sample_data = {
        'dayMaster': '戊',
        'wuxing': {'木': 5, '火': 38, '土': 35, '金': 12, '水': 0},
        'nayin': {'day': '天上火', 'hour': '天上火', 'month': '砂石金', 'year': '白蜡金'},
        'shensha': {
            'day':  ['将星', '天乙贵人', '沐浴', '咸池', '羊刃', '德秀贵人'],
            'month':['将星', '天乙贵人', '咸池', '羊刃'],
            'year': ['禄神', '福星贵人', '国印贵人', '学堂', '亡神'],
            'hour': ['天乙贵人', '金舆', '太极贵人'],
        },
        # 空亡在真实 js/bazi-engine.js::_calcKongwang() 里是整盘唯一的一对
        # 扁平数组（如 ['戌','亥']，取自日柱旬空），不是逐柱各一份的dict——
        # 此前这里误写成逐柱dict，join()会拼出"year, month, day, hour"这种
        # 无意义英文而非真实地支，是测试夹具本身的既存小bug，顺手一并修正，
        # 不影响 generate_island_prompt() 主逻辑（主逻辑一直按数组处理是对的）。
        'kongwang': ['子', '丑'],
        'pillars': {
            'year':  {'stem': '辛', 'branch': '巳'},
            'month': {'stem': '甲', 'branch': '午'},
            'day':   {'stem': '戊', 'branch': '午'},
            'hour':  {'stem': '己', 'branch': '未'},
        },
        # 2026-08-16新增：十神/地支关系/喜用神样例，用于验证新增的
        # _ten_god_dominant_line() / _interaction_dynamics_line() /
        # _favorable_emphasis_line()。interactions 数组是真实用
        # js/bazi-engine.js::BaziEngine._interactions(['巳','午','午','未'])
        # （与上面 pillars 的四支一致）跑出来的结果，不是拍脑袋编的。
        'tenGods': {'year': '正官', 'month': '七杀', 'day': '日主', 'hour': '正官'},
        'interactions': [
            {'type': '合', 'desc': '月支午 合 时支未（化火土）'},
            {'type': '合', 'desc': '日支午 合 时支未（化火土）'},
            {'type': '三会', 'desc': '三会南方火局（气最纯，比三合更集中）'},
            {'type': '自刑', 'desc': '午午 自刑（急躁耗神·情绪反复）'},
        ],
        'favorable': '水',
        'favorable2': '金',
        'unfavorable': '火',
    }
    print(generate_island_prompt(sample_data))
