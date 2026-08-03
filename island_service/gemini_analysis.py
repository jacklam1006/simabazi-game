"""
司马八字 · Gemini AI 命盘深度分析（六步命理框架 + RAG古籍知识检索）

2026-07-29 架构重构：从"一次Gemini调用产出全部内容"改为"六步独立调用 + 每步先做
RAG向量检索古籍/断语原文片段再生成"。完整背景与分工设计见项目根目录
PROMPT_SYSTEM.md 对应"修改记录"、claude-docs/已知问题与修复记录.md 对应日期条目。

六步框架（严格串行 Step1→Step2，Step3-6 用 asyncio.gather 并行发起）：
  Step1 命局「出厂设置」扫描（日主/月令/五行强弱/性格底色）
  Step2 定格局与找用神（依赖Step1）
  Step3 事业与财富深度剖析（依赖Step1+2）─┐
  Step4 婚恋与感情世界    （依赖Step1+2）─┤ 并行
  Step5 健康与潜在风险提示（依赖Step1+2）─┤
  Step6 大运与流年运势推演（依赖Step1+2）─┘

**必须保留、不改的机制**（都是踩过生产坑才做对的，见已知问题日志2026-07-29多轮记录）：
- _redact()：API Key脱敏，防止网络层异常把真实Key泄漏进响应体
- GeminiCallError：统一的、带明确诊断信息的调用失败异常
- ANALYSIS_MODEL_CHAIN：模型优先级回退链（环境变量 → gemini-flash-latest → gemini-3.6-flash）
- _extract_text()：显式检查响应结构，不做裸取字段
- MAX_TOKENS截断检测 + 加倍预算重试
- 三层缓存里的"文件缓存"这一层（_bazi_hash/_cache_read/_cache_write），但因为输出JSON
  结构整体变了，_cache_read() 新增了"是否含 step1_foundation 新字段"的校验，命中旧结构
  缓存文件时视为未命中，重新生成并覆盖（详见 _cache_read 注释）

**RAG检索的核心契约**：每一步生成前调用 rag_service.query()，检索失败/查不到内容时
返回空字符串——这是"锦上添花"，不是必需依赖，绝不能因为RAG层故障拖垮整条AI深析流水线。
Phase A（本轮）knowledge_base/bazi/ 下只有2份摘要文件（约545行），古籍知识密度有限；
九本古籍原文的深度整理是 Phase B，由 knowledge-curator 子agent负责，产出后追加进同一
知识库目录、重新跑一次 ingest_knowledge.py 即可自动扩充，本文件届时无需改动。
"""

import os
import json
import hashlib
import asyncio
import requests
from pathlib import Path

import rag_service

GEMINI_API_KEY  = os.environ.get('GEMINI_API_KEY', '')

# 模型优先级链（2026-07-29 第三轮修复，六步重构沿用不变）：生产环境实测确认
# `gemini-2.5-flash` 与 `gemini-2.0-flash` 均已被 Google 正式下线，留在回退链里
# 是纯粹的死路，已整体移除。现链：
#   1) 环境变量 GEMINI_ANALYSIS_MODEL 强制指定（留给以后确认好模型名/切换新模型用）
#   2) gemini-flash-latest —— Google 官方维护的稳定别名，目前指向 Gemini 3.x 系列
#   3) gemini-3.6-flash —— 显式版本号兜底，避免别名将来指向变化时无法追溯到具体版本
# 见 _call_gemini()：某个模型返回"模型不存在/无权限"这类配置性错误时自动换下一个候选。
_ENV_ANALYSIS_MODEL = os.environ.get('GEMINI_ANALYSIS_MODEL', '').strip()
ANALYSIS_MODEL_CHAIN = ([_ENV_ANALYSIS_MODEL] if _ENV_ANALYSIS_MODEL else []) + [
    'gemini-flash-latest',
    'gemini-3.6-flash',
]
ANALYSIS_CACHE  = Path('./persistent_data/analysis_cache')
ANALYSIS_CACHE.mkdir(parents=True, exist_ok=True)


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


# 2026-07-29 第三轮修复：`gemini-flash-latest` 别名现在指向 Gemini 3.x 系列模型，
# 而 Gemini 3.x 把老版本 2.5 系列的数值型 `thinkingConfig.thinkingBudget` 参数换成了
# 字符串枚举 `thinkingConfig.thinkingLevel`（取值 minimal/low/medium/high）。
# ANALYSIS_MODEL_CHAIN 现在只剩 Gemini 3.x 系列模型，因此默认对链中所有模型都附加
# thinkingLevel=minimal（让 maxOutputTokens 尽量流向正文而非内部推理）。仍保留
# `_NON_THINKING_MODELS` 这个例外名单机制（当前为空）——如果未来往链里加入某个已知
# 完全不支持 thinkingConfig 的模型，把它加进这个集合即可跳过。
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
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except Exception:
        return None
    # 2026-07-29 六步重构：输出JSON结构整体变了（day_master_reading/four_pillars/
    # six_dimensions/year_advice 这套旧字段 → step1_foundation...step6_dayun_liunian
    # 这套新字段）。如果直接信任任何非空缓存文件，线上早于本次上线生成的旧结构缓存
    # 会被原样返回给新前端代码，读取 analysis.step1_foundation 等字段时全部是
    # undefined，报表整体空白但不会报错、很难排查。因此命中判定新增一道校验：
    # 必须含有 step1_foundation 这个新结构的标志字段，否则当作未命中，走全新生成
    # 覆盖掉旧缓存文件。
    if isinstance(data, dict) and 'step1_foundation' in data:
        return data
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


def _call_gemini_once(model: str, prompt: str, max_tokens: int, system_instruction: str = None) -> str:
    """对单个模型发起一次调用。成功返回文本；失败抛出 GeminiCallError（消息含明确原因，绝不含API Key）"""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={GEMINI_API_KEY}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": _build_generation_config(model, max_tokens, 0.72, 0.92),
    }
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
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
        # 否则这段不完整JSON会被当作"成功"一路带到调用方才在 _parse_json 解析
        # 时失败，那时已经跳出了重试循环，不会触发"加倍预算重试→换模型"链路。
        raise GeminiCallError(
            f'[{model}] 文本非空但finishReason=MAX_TOKENS，内容极可能在生成中途被截断'
            f'（maxOutputTokens={max_tokens}）；文本前100字：{text[:100]!r}'
        )
    return text


def _call_gemini(prompt: str, max_tokens: int = 2048, system_instruction: str = None) -> str:
    """
    依次尝试 ANALYSIS_MODEL_CHAIN 中的候选模型：
    - 某模型返回"模型不存在/无权限"这类配置性错误 → 直接换下一个候选模型
    - 某模型因 MAX_TOKENS 截断为空 → 先对同一模型加倍预算重试一次（封顶8192），
      仍失败才换模型（避免一次性把预算开到很大浪费配额，同时兼顾"确实是预算不够"的情况）
    全部失败时抛出 GeminiCallError，message 汇总每个模型的失败原因，方便定位。

    六步流水线的每一步都通过本函数调用（各步骤只是传入不同的 prompt/system_instruction/
    max_tokens），模型链/重试/脱敏这套机制对六步一视同仁，不需要每步各自实现一遍。
    """
    errors = []
    for model in ANALYSIS_MODEL_CHAIN:
        if not model:
            continue
        budget = max_tokens
        for attempt in range(2):  # 最多：原预算一次 + 加倍预算重试一次
            try:
                return _call_gemini_once(model, prompt, budget, system_instruction)
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


# ── 人格设计（统一贯穿六步的 system instruction）───────────────
# 用户原话要求的人设："专业且算命准确的百年玄学大师，同时能用通俗易懂的方式讲解，
# 并结合现代社会发展给建议"。风格上参考已归档前代项目 simabazi-api/app/services/
# ai_service.py 里"司马"人格的回复框架（共情切入→命盘数据引用→现代视角融入→
# 具体行动建议、口语化"少用您多用你"），但去掉水晶推荐/会员营销话术（本项目没有
# 商城）与MBTI语气适配（本项目没有MBTI数据）——这两部分不适用于本项目。
PERSONA_SYSTEM = (
    "你是一位专业且算命准确的百年玄学大师，精通中国传统八字命理（四柱、十神、"
    "五行生克制化、格局用神、大运流年、神煞），同时非常擅长用通俗易懂、接地气的"
    "方式把专业判断讲给普通人听，并结合当下（2026年）的现代社会发展给出切实可行"
    "的建议——不是空洞的'应该如何'，而是具体的'现在可以怎么做'。\n"
    "语气与结构要求：\n"
    "1. 先给让人觉得'这说的就是我'的具体判断，再给理由，不要绕圈子；\n"
    "2. 语言口语化，像一位懂你的长辈朋友在聊天：少用'您'多用'你'，少讲抽象理论"
    "多讲'我看你这命盘...'这种具体判断；\n"
    "3. 专业但不故弄玄虚，温暖但不敷衍，不说模棱两可的正确废话；\n"
    "4. 如果提供了古籍/断语参考资料，可以化用其中的判断逻辑增强专业依据感，"
    "但不要生硬地大段引用原文，要转译成现代人能听懂的话；没有参考资料时，"
    "凭你自己扎实的命理功底正常判断，不要在正文里提及'没有找到参考资料'这类话；\n"
    "5. 结合现代视角（职业形态、生活方式、心理健康观念）让传统命理判断更贴近"
    "当下真实生活，而不是只讲古代语境下的官运财路。\n"
    "严格只输出用户要求的JSON格式，不输出markdown代码块围栏，不输出JSON之外的任何文字。"
)


# ── 命盘上下文构建（六步共享）────────────────────────────────
def _as_list(v) -> list:
    """兼容 favorable/favorable2/unfavorable/shensha/kongwang 等字段历史上"应为
    数组却被存成字符串"的情况（见已知问题记录 2026-07-27）。统一转成 list[str]，
    None/空值转成 []。"""
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x) for x in v if x]
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return []
        for sep in ('、', ',', '，'):
            if sep in v:
                return [x.strip() for x in v.split(sep) if x.strip()]
        return [v]
    return [str(v)]


def _flatten_shensha(bazi_data: dict) -> list:
    """优先用已经拍平去重的 `shenshe` 数组字段；没有的话退回按柱分组的 `shensha`
    字典字段（{year:[...], month:[...], ...}），手动拍平去重（镜像前端 bazi-engine.js
    里 `[...new Set(Object.values(shensha).flat())]` 的逻辑）。"""
    flat = bazi_data.get('shenshe')
    if flat:
        return _as_list(flat)
    per_pillar = bazi_data.get('shensha')
    if isinstance(per_pillar, dict):
        out = []
        for v in per_pillar.values():
            for item in _as_list(v):
                if item not in out:
                    out.append(item)
        return out
    return _as_list(per_pillar)


def _ten_gods_matching(ten_gods: dict, names: list) -> list:
    """从 tenGods（各柱十神映射）里取出属于指定十神名称集合的条目。"""
    if not isinstance(ten_gods, dict):
        return []
    return [v for v in ten_gods.values() if v in names]


def _build_context(bazi_data: dict, gender: str, birth_year: int) -> dict:
    """把前端传来的完整八字命盘对象，抽取整理成六步流水线共享的上下文 dict——
    只在这里做一次字段提取/类型兼容处理，六个 _stepN_sync 函数都从这个 ctx 取值，
    避免每步各自重复解析 bazi_data 且各自处理方式不一致。"""
    p = bazi_data.get('pillars', {}) or {}

    def fp(col):
        pl = p.get(col, {}) or {}
        return f"{pl.get('stem','')}{pl.get('branch','')}"

    ten_gods = bazi_data.get('tenGods', {}) or {}
    ten_gods_str = '、'.join(f"{k}:{v}" for k, v in ten_gods.items() if v and v != '日主')

    dayuns_raw = bazi_data.get('dayuns', [])
    dayuns = dayuns_raw[:4] if isinstance(dayuns_raw, list) else []
    current_dayun = bazi_data.get('dayun') or (dayuns[0] if dayuns else {}) or {}

    strength_raw = bazi_data.get('strength', '')
    if isinstance(strength_raw, (int, float)):
        strength_str = '身强' if strength_raw >= 50 else ('中和' if strength_raw >= 30 else '身弱')
    else:
        strength_str = str(strength_raw) or '中和'

    interactions = bazi_data.get('interactions', []) or []
    interaction_descs = [
        i.get('desc', '') for i in interactions
        if isinstance(i, dict) and i.get('desc')
    ]
    has_chong = any(isinstance(i, dict) and i.get('type') == '冲' for i in interactions)

    wuxing = bazi_data.get('wuxing', {}) or {}
    weakest_wx = ''
    if isinstance(wuxing, dict) and wuxing:
        try:
            weakest_wx = min(wuxing.items(), key=lambda kv: kv[1])[0]
        except Exception:
            weakest_wx = ''

    return {
        'gender': gender or '男',
        'birth_year': birth_year or 0,
        'year_p': fp('year'), 'month_p': fp('month'), 'day_p': fp('day'), 'hour_p': fp('hour'),
        'month_zhi': (p.get('month') or {}).get('branch', ''),
        'day_zhi': (p.get('day') or {}).get('branch', ''),
        'dm': bazi_data.get('dayMaster', ''),
        'dm_wx': bazi_data.get('dayMasterWx', ''),
        'dm_nature': bazi_data.get('dayMasterNature', ''),
        'strength_str': strength_str,
        'wuxing': wuxing,
        'wuxing_str': json.dumps(wuxing, ensure_ascii=False),
        'weakest_wx': weakest_wx,
        'favorable': _as_list(bazi_data.get('favorable')),
        'favorable2': _as_list(bazi_data.get('favorable2')),
        'unfavorable': _as_list(bazi_data.get('unfavorable')),
        'shensha': _flatten_shensha(bazi_data),
        'kongwang': _as_list(bazi_data.get('kongwang')),
        'ten_gods': ten_gods,
        'ten_gods_str': ten_gods_str,
        'interaction_descs': interaction_descs,
        'interaction_str': '；'.join(interaction_descs) if interaction_descs else '命局地支无明显刑冲合害',
        'has_chong': has_chong,
        'dayun_str': '  '.join(
            f"{r.get('gan','')}{r.get('zhi','')}（{r.get('startAge','')}岁起）" for r in dayuns
        ) if dayuns else '暂无',
        'current_dayun_ganzhi': f"{current_dayun.get('gan','')}{current_dayun.get('zhi','')}",
        'current_year': 2026,
        'current_ganzhi': '丙午',
    }


def _shared_chart_block(ctx: dict) -> str:
    """六步共享的命盘核心资料文本块，保证每一步引用的原始数据完全一致（避免六次
    独立调用因为各自拼的命盘摘要不一致而在细节上互相矛盾）。"""
    fav = '、'.join(ctx['favorable']) or '未知'
    fav2 = '、'.join(ctx['favorable2']) or '无'
    unfav = '、'.join(ctx['unfavorable']) or '未知'
    ss = '、'.join(ctx['shensha']) or '无'
    kw = '、'.join(ctx['kongwang']) or '无'
    return f"""【命盘核心资料】
四柱：年柱{ctx['year_p']} · 月柱{ctx['month_p']} · 日柱{ctx['day_p']} · 时柱{ctx['hour_p']}
日主：{ctx['dm']}（{ctx['dm_wx']}行{'，' + ctx['dm_nature'] if ctx['dm_nature'] else ''}） · {ctx['strength_str']}
性别：{ctx['gender']}
十神：{ctx['ten_gods_str'] or '未知'}
五行得分：{ctx['wuxing_str']}
喜用神：{fav}（次喜：{fav2}） · 忌神：{unfav}
神煞：{ss} · 空亡：{kw}
地支刑冲合害：{ctx['interaction_str']}
大运（前四运）：{ctx['dayun_str']} · 当前大运：{ctx['current_dayun_ganzhi'] or '未知'}
当前年份：{ctx['current_year']}年（{ctx['current_ganzhi']}年）"""


def _rag_block(snippet: str) -> str:
    if not snippet:
        return ''
    return f"\n【古籍/断语参考资料（可化用判断逻辑增强专业依据感，勿逐字大段照抄）】\n{snippet}\n"


def _fallback_keywords(ctx: dict) -> list:
    """Step2 若未按要求返回 keywords 字段时的确定性兜底——不额外调用AI，用命盘
    已有的确定性数据（日主/身强弱/喜用神/神煞）拼凑5个关键词，避免为了补一个小
    字段多打一次Gemini请求，拖慢整体响应。"""
    kws = []
    if ctx.get('dm'):
        kws.append(f"{ctx['dm']}日主")
    if ctx.get('strength_str'):
        kws.append(ctx['strength_str'])
    for f in ctx.get('favorable', [])[:2]:
        kws.append(f"喜{f}")
    for s in ctx.get('shensha', [])[:2]:
        kws.append(s)
    seen = []
    for k in kws:
        if k and k not in seen:
            seen.append(k)
    filler = (ctx.get('dm_wx', '') + '行') if ctx.get('dm_wx') else '八字命盘'
    while len(seen) < 5:
        seen.append(filler)
    return seen[:5]


# ── 六步流水线：Step1 命局「出厂设置」扫描 ───────────────────
def _step1_foundation_sync(ctx: dict) -> dict:
    rag_query = f"{ctx['dm']}日主 生于{ctx['month_zhi']} 五行强弱"
    # Step1 是命局基础盘面扫描，对应知识库标签里的日主/五行/基础理论条目
    rag_snippet = rag_service.query(rag_service.COLLECTION_NAME, rag_query,
                                     tags=['日主', 'wuxing', 'daymaster', 'fundamentals'])

    prompt = f"""{_shared_chart_block(ctx)}
{_rag_block(rag_snippet)}
【本步骤任务】命局"出厂设置"扫描——这是六步命理分析的第一步，只做基础盘面判断，
不涉及格局用神（那是下一步的任务，这一步不用提格局）。

请输出严格JSON（不含markdown代码块，不含JSON之外的任何文字）：
{{
  "title": "命局「出厂设置」扫描",
  "narrative": "对{ctx['dm']}日主整体命局的深度解读，180-220字：结合生于{ctx['month_zhi']}月的月令旺衰、四柱五行分布、{ctx['strength_str']}的身强身弱判断，说明这个人天生的性格底色、核心优势与潜在短板，语气要让人觉得'这说的就是我'",
  "wuxing_note": "五行力量分布的具体解读，50-80字：哪个五行最旺、哪个最弱，这对日常状态/精力/情绪有什么直接影响"
}}"""
    raw = _call_gemini(prompt, max_tokens=2048, system_instruction=PERSONA_SYSTEM)
    return _parse_json(raw)


async def _step1_foundation(ctx: dict) -> dict:
    return await asyncio.to_thread(_step1_foundation_sync, ctx)


# ── Step2 定格局与找用神 ─────────────────────────────────────
def _step2_pattern_yongshen_sync(ctx: dict, step1: dict) -> dict:
    rag_query = f"{ctx['ten_gods_str'] or (ctx['dm'] + '日主')} 格局 用神 忌神"
    # Step2 定格局找用神，对应知识库标签里的格局/用神/十神条目。
    # 2026-07-30 补充：03_geju_yongshen.md（子平真诠格局理论+穷通宝鉴调候用神，
    # Phase B第一批古籍整理）文件头标签是 格局,用神,调候,子平真诠,穷通宝鉴,正官,
    # 七杀,正财,食神,伤官,五行总论,病药,扶抑；而 02_bazi_duanyu.md 标签更宽泛
    # （八字断语,十神,格局,大运,流年,日主,用神,神煞），本步骤原tags只有'格局'
    # '用神'和02文件重合，'十神'/'ten-gods'02文件也命中，导致rag_service.query()
    # 的标签重合度重排里02文件（重合3个标签）稳定压过03文件（重合2个），03文件
    # 这批古籍整理investment实际从未在Step2检索里真正发挥作用（详见已知问题记录）。
    # 补上'调候''扶抑''病药''正官''七杀'——这几个都是03文件独有、02文件完全没有
    # 的标签，且正是Step2"格局与用神"任务本身核心涉及的概念，加上后03文件重合度
    # 变为7（远高于02文件的3），可稳定排到02文件前面。
    rag_snippet = rag_service.query(rag_service.COLLECTION_NAME, rag_query,
                                     tags=['格局', '用神', '十神', 'ten-gods',
                                           '调候', '扶抑', '病药', '正官', '七杀'])

    prompt = f"""{_shared_chart_block(ctx)}

【上一步结论（供你衔接语气与判断，不要在本步重复输出这段内容）】
{step1.get('narrative', '')}
{_rag_block(rag_snippet)}
【本步骤任务】定格局 + 找用神忌神：基于命盘十神组合与五行力量，判断这个命属于什么
格局（如伤官生财格/杀印相生格/从强格/建禄格等），说明为什么是这个格局，并给出更
精准的用神忌神判断（不要只是照抄命盘资料里给出的喜用神/忌神字段，要结合格局给出
更有策略含义的解读——这套用神忌神组合具体能给这个人带来什么样的人生方向指导）。

同时请顺带给出5个能概括这个人命盘特质的关键词（2-4字词组，如"伤官生财""身弱用印"
"天乙贵人"等，供UI标签展示用，不要写成一句话）。

请输出严格JSON（不含markdown代码块）：
{{
  "title": "定格局与找用神",
  "pattern": "命格定位，如'伤官生财格'/'杀印相生格'/'从强格'等，20字以内",
  "yongshen": ["用神1", "用神2"],
  "narrative": "150-200字：说明为什么是这个格局、用神忌神各自的作用，以及这套判断能给这个人带来什么样的人生策略指导（比如往什么方向努力更顺、要有意识避开什么）",
  "keywords": ["关键词1", "关键词2", "关键词3", "关键词4", "关键词5"]
}}"""
    raw = _call_gemini(prompt, max_tokens=2560, system_instruction=PERSONA_SYSTEM)
    return _parse_json(raw)


async def _step2_pattern_yongshen(ctx: dict, step1: dict) -> dict:
    return await asyncio.to_thread(_step2_pattern_yongshen_sync, ctx, step1)


def _step2_context_block(step1: dict, step2: dict) -> str:
    """Step3-6 共享：把Step1+2的结论浓缩成一小段上下文，供后续步骤衔接语气/判断，
    避免每步都把Step1+2的完整narrative整段复制进prompt（浪费token预算）。"""
    return (f"日主底色：{step1.get('narrative','')[:80]}...\n"
            f"命格：{step2.get('pattern','')}｜用神：{'、'.join(step2.get('yongshen') or [])}")


# ── Step3 事业与财富深度剖析 ──────────────────────────────────
def _step3_career_wealth_sync(ctx: dict, step1: dict, step2: dict) -> dict:
    wealth_stars = _ten_gods_matching(ctx['ten_gods'], ['正财', '偏财'])
    career_stars = _ten_gods_matching(ctx['ten_gods'], ['正官', '七杀'])
    rag_query = f"{'、'.join(wealth_stars) or '财星'}{'、'.join(career_stars) or '官杀星'} 事业方向 财运"
    # Step3 财官分析主要依赖十神组合与格局判断。2026-07-30 补充：03_geju_yongshen.md
    # 里恰好有"正官格""七杀格""正财格""食神格""伤官格"各自独立小节，直接对应本步骤
    # 判断"财官印组合→职业赛道/单干还是打工"的核心依据，比02文件泛泛的"事业财运"
    # 断语更具体、更有策略含义。补上这5个03文件独有标签，同理提升其检索重排优先级
    # （原因同Step2，详见Step2注释与已知问题记录）。
    rag_snippet = rag_service.query(rag_service.COLLECTION_NAME, rag_query,
                                     tags=['十神', 'ten-gods', '格局',
                                           '正官', '七杀', '正财', '食神', '伤官'])

    prompt = f"""{_shared_chart_block(ctx)}

【前两步结论（供你衔接判断，不要重复输出）】
{_step2_context_block(step1, step2)}
财星：{'、'.join(wealth_stars) or '命局无明显正偏财，需结合藏干/大运判断'}
官杀星：{'、'.join(career_stars) or '命局无明显正官七杀，需结合藏干/大运判断'}
{_rag_block(rag_snippet)}
【本步骤任务】财官印组合分析：结合财星、官杀星、印星的力量与位置，精准定位最适合
的职业赛道，并明确判断这个人更适合单干创业还是团队协作/打工，给出具体理由。

请输出严格JSON（不含markdown代码块）：
{{
  "title": "事业与财富深度剖析",
  "narrative": "180-220字：财官印组合的具体解读，财运走向、事业发展节奏，以及单干还是团队协作更适合这个人的明确判断和理由",
  "career_directions": ["具体职业方向建议1（不超过20字）", "具体职业方向建议2", "具体职业方向建议3"]
}}"""
    raw = _call_gemini(prompt, max_tokens=2048, system_instruction=PERSONA_SYSTEM)
    return _parse_json(raw)


async def _step3_career_wealth(ctx: dict, step1: dict, step2: dict) -> dict:
    return await asyncio.to_thread(_step3_career_wealth_sync, ctx, step1, step2)


# ── Step4 婚恋与感情世界 ─────────────────────────────────────
def _step4_relationship_sync(ctx: dict, step1: dict, step2: dict) -> dict:
    if ctx['gender'] == '女':
        spouse_star_names = ['正官', '七杀']
        spouse_label = '官杀星（夫星）'
    else:
        spouse_star_names = ['正财', '偏财']
        spouse_label = '财星（妻星）'
    spouse_stars = _ten_gods_matching(ctx['ten_gods'], spouse_star_names)
    spouse_desc = '、'.join(spouse_stars) if spouse_stars else f'命局中未见明显{spouse_label}，需结合藏干与大运判断'

    rag_query = f"{ctx['day_zhi']}夫妻宫 {'、'.join(spouse_stars) or spouse_label} 婚恋"
    # Step4 婚恋分析依赖日主状态与十神（配偶星）搭配、神煞（如桃花/红鸾类）
    rag_snippet = rag_service.query(rag_service.COLLECTION_NAME, rag_query,
                                     tags=['日主', '十神', 'ten-gods', '神煞'])

    prompt = f"""{_shared_chart_block(ctx)}

【前两步结论（供你衔接判断，不要重复输出）】
{_step2_context_block(step1, step2)}
日支（夫妻宫）：{ctx['day_zhi']}
{spouse_label}：{spouse_desc}
{_rag_block(rag_snippet)}
【本步骤任务】婚恋与感情世界：结合日支夫妻宫与{spouse_label}的状况，预测伴侣的
大致特质、两人相处模式，以及感情上值得留意的关键节点（如大运/流年带来的机会或波动）。

请输出严格JSON（不含markdown代码块）：
{{
  "title": "婚恋与感情世界",
  "narrative": "180-220字：夫妻宫与{spouse_label}状况的解读，感情相处模式、容易遇到的问题类型、经营感情的具体建议",
  "partner_traits": "对伴侣特质/类型的预测，60-90字",
  "key_periods": ["感情关键节点1（含大致时间与提示，不超过25字）", "感情关键节点2"]
}}"""
    raw = _call_gemini(prompt, max_tokens=2048, system_instruction=PERSONA_SYSTEM)
    return _parse_json(raw)


async def _step4_relationship(ctx: dict, step1: dict, step2: dict) -> dict:
    return await asyncio.to_thread(_step4_relationship_sync, ctx, step1, step2)


# ── Step5 健康与潜在风险提示 ──────────────────────────────────
def _step5_health_sync(ctx: dict, step1: dict, step2: dict) -> dict:
    chong_desc = '有明显地支相冲' if ctx['has_chong'] else '地支冲克关系不明显'
    rag_query = f"{ctx['weakest_wx'] or ctx['dm_wx']}五行偏弱 地支{chong_desc} 健康"
    # Step5 健康风险主要看五行失衡与神煞（凶煞类）提示
    rag_snippet = rag_service.query(rag_service.COLLECTION_NAME, rag_query,
                                     tags=['wuxing', '神煞'])

    prompt = f"""{_shared_chart_block(ctx)}

【前两步结论（供你衔接判断，不要重复输出）】
{_step2_context_block(step1, step2)}
五行中最偏弱：{ctx['weakest_wx'] or '不明显'}
地支相冲情况：{ctx['interaction_str']}
{_rag_block(rag_snippet)}
【本步骤任务】健康与潜在风险提示：结合五行强弱分布与地支相冲等关系，预警身体
相对薄弱的部位/系统，给出日常保养的具体建议，以及需要格外留意身体状况的年份
（结合大运流年判断，不需要精确到某一天，给到年份或阶段即可）。

请输出严格JSON（不含markdown代码块）：
{{
  "title": "健康与潜在风险提示",
  "narrative": "150-190字：五行失衡对应的身体薄弱环节，以及为什么（用五行生克逻辑说明，但要转译成现代人能懂的表达，比如'某脏器/系统容易疲劳'而不是纯古文）",
  "watch_points": ["日常保养建议/需留意的具体点1（不超过25字）", "日常保养建议/需留意的具体点2", "需要格外留意的年份或阶段（不超过25字）"]
}}"""
    raw = _call_gemini(prompt, max_tokens=2048, system_instruction=PERSONA_SYSTEM)
    return _parse_json(raw)


async def _step5_health(ctx: dict, step1: dict, step2: dict) -> dict:
    return await asyncio.to_thread(_step5_health_sync, ctx, step1, step2)


# ── Step6 大运与流年运势推演 ──────────────────────────────────
def _step6_dayun_liunian_sync(ctx: dict, step1: dict, step2: dict) -> dict:
    rag_query = f"{ctx['current_dayun_ganzhi'] or ctx['dm'] + '日主'} 2026丙午 流年"
    # Step6 大运流年推演直接对应知识库标签里的大运/流年条目
    rag_snippet = rag_service.query(rag_service.COLLECTION_NAME, rag_query,
                                     tags=['大运', '流年'])

    prompt = f"""{_shared_chart_block(ctx)}

【前两步结论（供你衔接判断，不要重复输出）】
{_step2_context_block(step1, step2)}
{_rag_block(rag_snippet)}
【本步骤任务】大运与流年运势推演：结合当前大运（{ctx['current_dayun_ganzhi'] or '未知'}）
与{ctx['current_year']}年（{ctx['current_ganzhi']}年）流年，给出该猛冲还是该沉淀的
具体判断，以及今年可以立刻执行的一条具体行动建议。

请输出严格JSON（不含markdown代码块）：
{{
  "title": "大运与流年运势推演",
  "narrative": "180-220字：当前大运的整体基调 + {ctx['current_year']}年（{ctx['current_ganzhi']}年）流年与命局的生克关系解读，说明今年整体是适合猛冲还是适合沉淀积累",
  "current_year_action": "今年可以立刻执行的一条具体行动建议，40-60字，要具体不要空泛"
}}"""
    raw = _call_gemini(prompt, max_tokens=2048, system_instruction=PERSONA_SYSTEM)
    return _parse_json(raw)


async def _step6_dayun_liunian(ctx: dict, step1: dict, step2: dict) -> dict:
    return await asyncio.to_thread(_step6_dayun_liunian_sync, ctx, step1, step2)


# ── 主分析函数 ────────────────────────────────────────────
async def analyze_bazi(bazi_data: dict, gender: str = '男', birth_year: int = 0,
                        force_refresh: bool = False) -> dict:
    """
    分析八字命盘，六步命理框架流水线。
    Returns:
        { hash, analysis: {...}, from_cache: bool }
        或 { hash, analysis: None, error: str }

    调用方（main.py）注意：本函数是 `async def`，必须 `await` 调用——这是2026-07-29
    六步重构里唯一需要同步改动 island_service/main.py（backend-service领域）一行调用
    方式的地方：Step3-6 要用 asyncio.gather() 真正并行发起，前提是 analyze_bazi() 本身
    运行在事件循环里，而不是被同步直接调用（同步直接调用 asyncio.run() 会在 FastAPI
    已经运行的事件循环里抛 "cannot be called from a running event loop"）。

    force_refresh: True 时跳过 _cache_read() 直接走六步生成流程（用于"设置面板→轻量
    刷新AI深析"，测试RAG知识库/prompt改动效果时绕开文件缓存）。生成结果仍然经
    _cache_write() 覆盖写入同一个哈希对应的缓存文件（覆盖写语义本就如此，不需要
    额外改动），后续非 force_refresh 的正常请求会读到这次刷新后的最新结果。
    """
    bz_hash = _bazi_hash(bazi_data, gender)

    # 命中文件缓存 → 即时返回（force_refresh 时跳过，直接走下面的生成流程）
    if not force_refresh:
        cached = _cache_read(bz_hash)
        if cached:
            return {'hash': bz_hash, 'analysis': cached, 'from_cache': True}

    if not GEMINI_API_KEY:
        return {'hash': bz_hash, 'analysis': None, 'error': 'no_api_key'}

    ctx = _build_context(bazi_data, gender, birth_year)

    try:
        # Step1 → Step2 严格串行：Step2 的 prompt 依赖 Step1 的文本输出作为上下文
        step1 = await _step1_foundation(ctx)
        step2 = await _step2_pattern_yongshen(ctx, step1)
        keywords = step2.pop('keywords', None) or _fallback_keywords(ctx)

        # Step3-6 互相独立，只依赖 Step1+2 的结果，用 asyncio.gather 并行发起——
        # 把墙钟时间从"6次严格串行"压缩到约等于"3次串行"（Step1 + Step2 + max(Step3..6)）
        step3, step4, step5, step6 = await asyncio.gather(
            _step3_career_wealth(ctx, step1, step2),
            _step4_relationship(ctx, step1, step2),
            _step5_health(ctx, step1, step2),
            _step6_dayun_liunian(ctx, step1, step2),
        )

        analysis = {
            'step1_foundation': step1,
            'step2_pattern_yongshen': step2,
            'step3_career_wealth': step3,
            'step4_relationship': step4,
            'step5_health': step5,
            'step6_dayun_liunian': step6,
            'keywords': keywords,
        }
        _cache_write(bz_hash, analysis)
        return {'hash': bz_hash, 'analysis': analysis, 'from_cache': False}
    except GeminiCallError as e:
        # 明确诊断过的失败（模型不存在/安全过滤/MAX_TOKENS截断/JSON解析失败等）
        print(f"[gemini_analysis ERROR] {e}")
        return {'hash': bz_hash, 'analysis': None, 'error': str(e)}
    except Exception as e:
        # 兜底：真正没预料到的异常，仍然带上类型名方便定位，不让它裸露成一句模糊的话；
        # 同样先脱敏——不能假设未预料到的异常类型一定不含API Key
        msg = _redact(f"{type(e).__name__}: {e}")
        print(f"[gemini_analysis ERROR] unexpected {msg}")
        return {'hash': bz_hash, 'analysis': None, 'error': f'unexpected_error({msg})'}
