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

# 模型优先级链（2026-07-29 第三轮修复）：生产环境实测确认 `gemini-2.5-flash` 与
# `gemini-2.0-flash` 均已被 Google 正式下线（HTTP 404 NOT_FOUND，"no longer
# available to new users"），留在回退链里是纯粹的死路，已整体移除。现链：
#   1) 环境变量 GEMINI_ANALYSIS_MODEL 强制指定（留给以后确认好模型名/切换新模型用）
#   2) gemini-flash-latest —— Google 官方维护的稳定别名，目前指向 Gemini 3.x 系列
#      （如 gemini-3.6-flash），始终指向当前推荐的 flash 版本
#   3) gemini-3.6-flash —— 显式版本号兜底（2026-07-21发布，已确认可用），避免
#      `gemini-flash-latest` 别名将来指向变化时无法追溯到具体版本
# 见 _call_gemini()：某个模型返回"模型不存在/无权限"这类配置性错误时自动换下一个候选，
# 不会让整条AI分析流水线因为一个写错的模型ID而彻底瘫痪。
_ENV_ANALYSIS_MODEL = os.environ.get('GEMINI_ANALYSIS_MODEL', '').strip()
ANALYSIS_MODEL_CHAIN = ([_ENV_ANALYSIS_MODEL] if _ENV_ANALYSIS_MODEL else []) + [
    'gemini-flash-latest',
    'gemini-3.6-flash',
]
ANALYSIS_CACHE  = Path('./analysis_cache')
ANALYSIS_CACHE.mkdir(exist_ok=True)


class GeminiCallError(Exception):
    """Gemini 调用失败：message 里必须包含明确原因（不含 API Key），
    禁止让底层异常（如空字符串导致的 JSONDecodeError）不加解释地冒泡上去。"""
    pass


def _redact(s: str) -> str:
    """把字符串里可能出现的真实 GEMINI_API_KEY 替换掉。

    背景：requests 在网络层异常（ConnectTimeout/ConnectionError/DNS失败等）时，会把
    完整请求URL（含 `?key=<真实KEY>`）嵌进异常对象的字符串表示（str(e)）里。这类异常
    经由 GeminiCallError → analyze_bazi() 的 `error` 字段 → main.py 的HTTP响应体，
    会原样出现在给前端的响应里——任何用户打开devtools就能看到生产环境的Gemini Key。
    因此任何可能把 str(exception) 或完整URL塞进消息/日志的地方，都必须先经过这里脱敏。
    """
    if GEMINI_API_KEY and GEMINI_API_KEY in s:
        return s.replace(GEMINI_API_KEY, '***REDACTED***')
    return s


# 2026-07-29 第三轮修复：`gemini-flash-latest` 别名现在指向 Gemini 3.x 系列模型
# （如 gemini-3.6-flash），而 Gemini 3.x 把老版本 2.5 系列的数值型
# `thinkingConfig.thinkingBudget` 参数换成了字符串枚举 `thinkingConfig.thinkingLevel`
# （取值 minimal/low/medium/high），已不再接受 thinkingBudget 字段——这正是生产环境
# 实测 "[gemini-flash-latest] HTTP 400 INVALID_ARGUMENT" 的根因：传了 3.x 不认识的
# 旧格式参数。ANALYSIS_MODEL_CHAIN 现在只剩 Gemini 3.x 系列模型（gemini-2.0-flash
# 等不支持 thinkingConfig 的老模型已被移除，见上），因此默认对链中所有模型都附加
# thinkingLevel=minimal（让 maxOutputTokens 尽量流向正文而非内部推理）。仍保留
# `_NON_THINKING_MODELS` 这个例外名单机制（当前为空）——如果未来往链里加入某个已知
# 完全不支持 thinkingConfig 的模型，把它加进这个集合即可跳过，而不是重新引入
# 400错误的风险。
_NON_THINKING_MODELS = set()


def _build_generation_config(model: str, max_tokens: int, temperature: float, top_p: float) -> dict:
    cfg = {
        "temperature": temperature,
        "maxOutputTokens": max_tokens,
        "topP": top_p,
    }
    if model not in _NON_THINKING_MODELS:
        cfg["thinkingConfig"] = {"thinkingLevel": "minimal"}
    return cfg


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
def _extract_text(data: dict) -> tuple:
    """
    从 Gemini generateContent 的响应体中提取文本。
    显式检查响应结构，不做裸取（data['candidates'][0]['content']['parts'][0]['text']）——
    一旦结构不是预期（被安全过滤器拦截、candidates为空、content无parts等），
    过去会一路冒泡成语义不明的异常（例如对空字符串 json.loads 报出的
    "Expecting value: line 1 column 1 (char 0)"，完全看不出真实原因）。

    Returns: (text, diagnostic, finish_reason)
        text 非空 → 提取成功（但调用方仍需检查 finish_reason，见下方说明）；
        text 为空 → diagnostic 说明具体原因，供上层拼错误信息。
        finish_reason 无论 text 是否为空都会返回，供调用方判断"非空但被截断"的情况——
        Gemini 在 finishReason=MAX_TOKENS 时即使已经吐出了一部分文本，那段文本也往往
        是生成到一半被硬切断的（常见于JSON输出被砍在中途），不能当作完整有效结果使用。
    """
    candidates = data.get('candidates') or []
    if not candidates:
        block_reason = (data.get('promptFeedback') or {}).get('blockReason')
        if block_reason:
            return '', f'prompt被安全过滤器整体拦截（blockReason={block_reason}）', ''
        return '', 'Gemini响应中candidates为空', ''

    cand = candidates[0]
    finish_reason = cand.get('finishReason', '')
    parts = (cand.get('content') or {}).get('parts') or []
    text = ''.join(p.get('text', '') for p in parts).strip()

    if text:
        return text, '', finish_reason

    # 拿到了candidate，但没有提取出有效文本——按finishReason给出明确诊断
    if finish_reason == 'SAFETY':
        return '', 'candidate被安全过滤器拦截（finishReason=SAFETY）', finish_reason
    if finish_reason == 'RECITATION':
        return '', 'candidate因版权检测被拦截（finishReason=RECITATION）', finish_reason
    if finish_reason == 'MAX_TOKENS':
        return '', ('输出为空且finishReason=MAX_TOKENS：maxOutputTokens预算在生成'
                     '正文前就被耗尽（常见于思考型模型把预算花在内部推理上），需提高预算重试'), finish_reason
    return '', f'candidate无有效文本（finishReason={finish_reason or "未知"}）', finish_reason


def _call_gemini_once(model: str, prompt: str, max_tokens: int) -> str:
    """对单个模型发起一次调用。成功返回文本；失败抛出 GeminiCallError（消息含明确原因，绝不含API Key）"""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={GEMINI_API_KEY}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": _build_generation_config(model, max_tokens, 0.72, 0.92),
    }
    try:
        resp = requests.post(url, json=payload, timeout=50)
    except requests.exceptions.RequestException as e:
        # RequestException 的 str(e) 常含完整请求URL（含 ?key=真实KEY），必须脱敏后才能
        # 抛出——这条消息会一路传播到 analyze_bazi() 的 error 字段、再到HTTP响应体。
        raise GeminiCallError(f'[{model}] 网络请求失败：{_redact(f"{type(e).__name__}: {e}")}')

    if not resp.ok:
        detail = resp.text[:200]
        try:
            err = resp.json().get('error', {})
            detail = f"{err.get('status', '')} {err.get('message', '')}".strip()
        except Exception:
            pass
        raise GeminiCallError(f'[{model}] HTTP {resp.status_code}：{_redact(detail)}')

    try:
        data = resp.json()
    except Exception as e:
        raise GeminiCallError(f'[{model}] 响应不是合法JSON：{_redact(str(e))}')

    text, diagnostic, finish_reason = _extract_text(data)
    if not text:
        raise GeminiCallError(f'[{model}] {diagnostic}（maxOutputTokens={max_tokens}）')

    if finish_reason == 'MAX_TOKENS':
        # 拿到了非空文本，但 finishReason=MAX_TOKENS 说明这段文本极可能是在生成中途
        # （常见于JSON输出写到一半）被硬性截断的，不是完整结果。必须当作失败抛出，
        # 消息里带上 'MAX_TOKENS' 标记，好让 _call_gemini() 的重试循环识别并加倍预算重试——
        # 否则这段不完整JSON会被当作"成功"一路带到 analyze_bazi() 才在 _parse_json 解析
        # 时失败，那时已经跳出了重试循环，不会触发"加倍预算重试→换模型"链路。
        raise GeminiCallError(
            f'[{model}] 文本非空但finishReason=MAX_TOKENS，内容极可能在生成中途被截断'
            f'（maxOutputTokens={max_tokens}）；文本前100字：{text[:100]!r}'
        )
    return text


def _call_gemini(prompt: str, max_tokens: int = 4096) -> str:
    """
    依次尝试 ANALYSIS_MODEL_CHAIN 中的候选模型：
    - 某模型返回"模型不存在/无权限"这类配置性错误 → 直接换下一个候选模型
    - 某模型因 MAX_TOKENS 截断为空 → 先对同一模型加倍预算重试一次（封顶8192），
      仍失败才换模型（避免一次性把预算开到很大浪费配额，同时兼顾"确实是预算不够"的情况）
    全部失败时抛出 GeminiCallError，message 汇总每个模型的失败原因，方便定位。
    """
    errors = []
    for model in ANALYSIS_MODEL_CHAIN:
        if not model:
            continue
        budget = max_tokens
        for attempt in range(2):  # 最多：原预算一次 + 加倍预算重试一次
            try:
                return _call_gemini_once(model, prompt, budget)
            except GeminiCallError as e:
                errors.append(str(e))
                is_max_tokens = 'MAX_TOKENS' in str(e)
                if is_max_tokens and budget < 8192:
                    budget = min(budget * 2, 8192)
                    continue
                break  # 非MAX_TOKENS原因，或已经重试过 → 换下一个模型
    raise GeminiCallError('；'.join(errors) or 'Gemini调用链全部失败，原因未知')


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
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        # 常见于JSON在生成到一半时被截断（token预算不够）——把原始文本片段带出来，
        # 避免只看到一句"Expecting value"却不知道Gemini到底说了什么
        raise GeminiCallError(f'Gemini返回文本无法解析为JSON（{e}）；原始文本前200字：{text[:200]!r}')


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
    except GeminiCallError as e:
        # 明确诊断过的失败（模型不存在/安全过滤/MAX_TOKENS截断/JSON解析失败等）
        print(f"[gemini_analysis ERROR] {e}")
        return {'hash': bz_hash, 'analysis': None, 'error': str(e)}
    except Exception as e:
        # 兜底：真正没预料到的异常，仍然带上类型名方便定位，不让它裸露成一句模糊的话；
        # 同样先脱敏——不能假设未预料到的异常类型一定不含API Key（例如requests的
        # 网络层异常理论上可能绕过上面专门的except分支，以其他形式冒泡到这里）
        msg = _redact(f"{type(e).__name__}: {e}")
        print(f"[gemini_analysis ERROR] unexpected {msg}")
        return {'hash': bz_hash, 'analysis': None, 'error': f'unexpected_error({msg})'}
