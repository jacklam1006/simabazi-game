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

{void_note}

{pillar_labels}

STYLE REQUIREMENTS: low-poly geometric style like premium mobile game art, clean faceted surfaces, no photorealism, Chinese mythology aesthetic, floating island with rocky underside, dark starry background with subtle nebula, dramatic lighting from above."""

    return prompt.strip()


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
        'kongwang': {
            'year': ['申', '酉'],
            'month': ['辰', '巳'],
            'day': ['子', '丑'],
            'hour': ['子', '丑'],
        },
        'pillars': {
            'year':  {'stem': '辛', 'branch': '巳'},
            'month': {'stem': '甲', 'branch': '午'},
            'day':   {'stem': '戊', 'branch': '午'},
            'hour':  {'stem': '己', 'branch': '未'},
        },
    }
    print(generate_island_prompt(sample_data))
