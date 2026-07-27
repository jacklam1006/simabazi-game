"""
司马八字 · Gemini AI 命盘深度分析
缓存策略：文件级永久缓存（相同八字 + 性别 → 相同分析，不重复调用）
"""

import os
import json
import hashlib
import requests
from pathlib import Path

GEMINI_API_KEY  = os.environ.get('GEMINI_API_KEY', '')
ANALYSIS_MODEL  = 'gemini-2.0-flash'          # 速度快、够用
ANALYSIS_CACHE  = Path('./analysis_cache')
ANALYSIS_CACHE.mkdir(exist_ok=True)


# ── 哈希 ─────────────────────────────────────────────────
def _bazi_hash(bazi_data: dict, gender: str = '') -> str:
    """用四柱干支 + 性别生成唯一指纹（与五行/神煞计算结果无关，只取原始干支）"""
    p = bazi_data.get('pillars', {})
    parts = []
    for col in ('year', 'month', 'day', 'hour'):
        pl = p.get(col, {})
        parts.append(f"{pl.get('stem','')}{pl.get('branch','')}")
    parts.append(gender or '')
    return hashlib.md5('|'.join(parts).encode()).hexdigest()


def _cache_read(h: str):
    path = ANALYSIS_CACHE / f"{h}.json"
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return None
    return None


def _cache_write(h: str, data: dict):
    (ANALYSIS_CACHE / f"{h}.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2)
    )


# ── Gemini 调用 ───────────────────────────────────────────
def _call_gemini(prompt: str, max_tokens: int = 2200) -> str:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{ANALYSIS_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.72,
            "maxOutputTokens": max_tokens,
            "topP": 0.92,
        },
    }
    resp = requests.post(url, json=payload, timeout=50)
    resp.raise_for_status()
    return resp.json()['candidates'][0]['content']['parts'][0]['text'].strip()


def _parse_json(text: str) -> dict:
    """容错解析：strip markdown code fences，定位最外层 {}"""
    # Remove markdown fences
    if '```' in text:
        start = text.find('{')
        end   = text.rfind('}') + 1
        text  = text[start:end]
    elif not text.startswith('{'):
        start = text.find('{')
        end   = text.rfind('}') + 1
        text  = text[start:end]
    return json.loads(text)


# ── 主分析函数 ────────────────────────────────────────────
def analyze_bazi(bazi_data: dict, gender: str = '男', birth_year: int = 0) -> dict:
    """
    分析八字命盘。
    Returns:
        { hash, analysis: {...}, from_cache: bool }
        或 { hash, analysis: None, error: str }
    """
    bz_hash = _bazi_hash(bazi_data, gender)

    # 命中文件缓存 → 即时返回
    cached = _cache_read(bz_hash)
    if cached:
        return {'hash': bz_hash, 'analysis': cached, 'from_cache': True}

    if not GEMINI_API_KEY:
        return {'hash': bz_hash, 'analysis': None, 'error': 'no_api_key'}

    # ── 组装提示词 ─────────────────────────────────────
    p        = bazi_data.get('pillars', {})
    dm       = bazi_data.get('dayMaster', '')
    dm_wx    = bazi_data.get('dayMasterWx', '')
    wuxing   = bazi_data.get('wuxing', {})
    favorable= bazi_data.get('favorable', [])
    shensha  = bazi_data.get('shenshe') or bazi_data.get('shensha', [])
    dayuns   = bazi_data.get('dayuns', [])[:4]
    strength = bazi_data.get('strength', '')

    def fp(col):
        pl = p.get(col, {})
        return f"{pl.get('stem','')}{pl.get('branch','')}"

    year_p  = fp('year')
    month_p = fp('month')
    day_p   = fp('day')
    hour_p  = fp('hour')

    current_year = 2026  # 丙午年
    current_ganzhi = '丙午'

    # 命主强弱描述
    if isinstance(strength, (int, float)):
        strength_str = '身强' if strength >= 50 else ('中和' if strength >= 30 else '身弱')
    else:
        strength_str = str(strength) or '中和'

    dayun_str = '  '.join(
        f"{r.get('gan','')}{r.get('zhi','')}（{r.get('startAge','')}岁起）"
        for r in dayuns
    ) if dayuns else '暂无'

    fav_str = '、'.join(favorable) if favorable else '未知'
    ss_str  = '、'.join(shensha)   if shensha   else '无'
    wx_str  = json.dumps(wuxing, ensure_ascii=False)

    prompt = f"""你是精通中国传统八字命理的资深命理师，兼具现代心理学与人生规划视野。
请对以下八字命盘进行深度分析，输出 **严格 JSON 格式**，禁止 markdown，禁止 JSON 之外的任何文字。

【命盘资料】
四柱：年柱{year_p} · 月柱{month_p} · 日柱{day_p} · 时柱{hour_p}
日主：{dm}（{dm_wx}行） · {strength_str}
性别：{gender}
五行得分：{wx_str}
喜用神：{fav_str}
神煞：{ss_str}
大运（前四运）：{dayun_str}
当前年份：{current_year}年（{current_ganzhi}年）

【输出格式】（所有值均为中文字符串，长度要求如注释所示）
{{
  "day_master_reading": "对{dm}日主的深度解读，160-200字，结合命盘五行、神煞、大运，分析性格特质、天赋优势与人生挑战，语气温暖真诚",
  "pattern": "命格定位（如：木火通明格 / 身旺财旺格 / 从强格等）及一句话解释（30字以内）",
  "four_pillars": {{
    "year":  "年柱{year_p}：60字解读，侧重祖上根基与早年环境影响",
    "month": "月柱{month_p}：60字解读，侧重父母家庭与青年发展方向",
    "day":   "日柱{day_p}：60字解读，侧重日主本体与婚姻感情宫位",
    "hour":  "时柱{hour_p}：60字解读，侧重子女缘分与晚年内心志向"
  }},
  "six_dimensions": {{
    "career":        "事业维度：结合喜用神和格局，给出最适合的职业方向与事业策略，80字",
    "wealth":        "财富维度：分析财星状况与财运路径，给出财富积累方式建议，80字",
    "relationships": "感情维度：分析夫妻宫与感情缘分，给出感情经营建议，80字",
    "health":        "健康维度：结合五行偏弱部分，给出具体养生重点与注意事项，80字",
    "development":   "成长维度：分析命主最需培养的能力与品质，给出成长路径，80字",
    "spirit":        "精神维度：分析命主的人生使命与内在精神追求，给出精神滋养建议，80字"
  }},
  "year_advice": "针对{current_year}年（{current_ganzhi}年）的流年运势分析：结合流年干支与命盘，给出今年的机遇方向、注意事项与行动建议，130字",
  "keywords": ["命格关键词1", "命格关键词2", "命格关键词3", "命格关键词4", "命格关键词5"]
}}"""

    try:
        raw = _call_gemini(prompt)
        analysis = _parse_json(raw)
        _cache_write(bz_hash, analysis)
        return {'hash': bz_hash, 'analysis': analysis, 'from_cache': False}
    except Exception as e:
        print(f"[gemini_analysis ERROR] {e}")
        return {'hash': bz_hash, 'analysis': None, 'error': str(e)}
