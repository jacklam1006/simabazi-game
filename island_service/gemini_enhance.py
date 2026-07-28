"""
Gemini Flash · 八字命盘提示词增强器
流水线位置：规则提示词 → [本模块] → Nano Banana Pro 图像生成

作用：用 Gemini 的推理能力，把规则映射的结构化描述
      升华为更有层次感、更适合 3D 图像生成的提示词。
失败时自动回退到原始提示词，不影响主流程。
"""

import os
import requests

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')

# 模型优先级链（2026-07-29 第三轮修复，与 gemini_analysis.py 的 ANALYSIS_MODEL_CHAIN
# 对齐）：生产环境实测确认 `gemini-2.5-flash` 与 `gemini-2.0-flash` 均已被 Google
# 正式下线（HTTP 404 NOT_FOUND，"no longer available to new users"），已整体移除。
# 现链：环境变量 GEMINI_ENHANCE_MODEL 强制指定 → gemini-flash-latest（官方稳定别名，
# 目前指向 Gemini 3.x 系列）→ gemini-3.6-flash（显式版本号兜底，2026-07-21发布，
# 已确认可用）。任一模型失败就换下一个，全部失败才回退到原始提示词（原有行为不变，
# 调用方不需要感知失败）。
_ENV_ENHANCE_MODEL = os.environ.get('GEMINI_ENHANCE_MODEL', '').strip()
ENHANCE_MODEL_CHAIN = ([_ENV_ENHANCE_MODEL] if _ENV_ENHANCE_MODEL else []) + [
    'gemini-flash-latest',
    'gemini-3.6-flash',
]

# 2026-07-29 第三轮修复：`gemini-flash-latest` 别名现在指向 Gemini 3.x 系列模型，
# 而 Gemini 3.x 把老版本 2.5 系列的数值型 `thinkingConfig.thinkingBudget` 参数换成了
# 字符串枚举 `thinkingConfig.thinkingLevel`（minimal/low/medium/high），不再接受
# thinkingBudget 字段——这正是生产环境实测 "[gemini-flash-latest] HTTP 400
# INVALID_ARGUMENT" 的根因。ENHANCE_MODEL_CHAIN 现在只剩 Gemini 3.x 系列模型
# （不支持 thinkingConfig 的老模型 gemini-2.0-flash 已移除，见上），因此默认对链中
# 所有模型都附加 thinkingLevel=minimal。仍保留 `_NON_THINKING_MODELS` 例外名单机制
# （当前为空）——如果未来往链里加入某个已知完全不支持 thinkingConfig 的模型，加进
# 这个集合即可跳过，而不是重新引入400错误的风险。
_NON_THINKING_MODELS = set()


def _redact(s: str) -> str:
    """把字符串里可能出现的真实 GEMINI_API_KEY 替换掉，用法与 gemini_analysis.py 的
    同名函数一致：requests 的网络层异常会把含 ?key=真实KEY 的完整URL嵌进 str(e)。
    本模块的错误只进日志（不进HTTP响应），但同样不该让Key出现在任何输出里。"""
    if GEMINI_API_KEY and GEMINI_API_KEY in s:
        return s.replace(GEMINI_API_KEY, '***REDACTED***')
    return s


def enhance_island_prompt(raw_prompt: str, bazi_data: dict) -> str:
    """
    使用 Gemini（模型见 ENHANCE_MODEL_CHAIN）分析八字命盘，深度优化岛屿生成提示词。

    Args:
        raw_prompt: bazi_prompt.py 规则生成的基础英文提示词
        bazi_data:  完整八字数据字典（含 dayMaster, wuxing 等）
    Returns:
        增强后的提示词字符串（失败时回退到原始提示词）
    """
    if not GEMINI_API_KEY:
        return raw_prompt

    day_master = bazi_data.get('dayMaster', '')
    wuxing = bazi_data.get('wuxing', {})

    system_instruction = f"""You are a master of Chinese BaZi (八字) metaphysics and a professional 3D concept artist specializing in fantasy game environments.

Your task: Refine the following floating island description to maximize visual quality when processed by Nano Banana Pro (Google's premium image generation model).

Strict rules:
1. Preserve ALL specific objects, materials, colors, and named elements already listed
2. Strengthen 3D depth composition: clear foreground focal point → rich midground detail → atmospheric background
3. Add 1-2 sentences of poetic atmosphere that capture the destiny essence of this BaZi chart
4. Enhance light and shadow contrast for better 3D conversion (strong rim lighting, dramatic shadows)
5. Keep the style: low-poly stylized game art, floating island, dark starry cosmos background
6. Do NOT add photorealism, do NOT remove Chinese mythology elements
7. Output ONLY the refined prompt text, no explanations, no Chinese characters, no markdown

Day Master (日主): {day_master}
Five Elements: {wuxing}"""

    contents = [{
        "parts": [{"text": f"{system_instruction}\n\nOriginal prompt:\n{raw_prompt}"}]
    }]

    for model in ENHANCE_MODEL_CHAIN:
        if not model:
            continue
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={GEMINI_API_KEY}"
        )
        # generationConfig 按模型单独构建：Gemini 3.x 系列用字符串枚举
        # thinkingConfig.thinkingLevel（非 3.x 老模型如加入 _NON_THINKING_MODELS
        # 则跳过，避免被API拒绝）
        generation_config = {
            "temperature": 0.65,
            "maxOutputTokens": 900,
            "topP": 0.9,
        }
        if model not in _NON_THINKING_MODELS:
            generation_config["thinkingConfig"] = {"thinkingLevel": "minimal"}
        payload = {"contents": contents, "generationConfig": generation_config}
        try:
            resp = requests.post(url, json=payload, timeout=25)
            if not resp.ok:
                print(f"[gemini_enhance] [{model}] HTTP {resp.status_code}，回退到原始提示词或尝试下一模型")
                continue
            data = resp.json()
            candidates = data.get('candidates') or []
            if not candidates:
                print(f"[gemini_enhance] [{model}] candidates为空（可能被安全过滤），尝试下一模型")
                continue
            parts = (candidates[0].get('content') or {}).get('parts') or []
            enhanced = ''.join(p.get('text', '') for p in parts).strip()
            # 安全检查：增强后的提示词必须足够长才使用
            if len(enhanced) > 150:
                return enhanced
            print(f"[gemini_enhance] [{model}] 返回文本过短或为空，尝试下一模型")
        except Exception as e:
            # 单个模型的网络/解析失败不影响主流程，换下一个候选；全部失败则最终回退。
            # requests 的网络层异常（超时/连接失败等）str(e)常含完整请求URL（含真实
            # ?key=），即使这里只进日志不进HTTP响应，也必须脱敏后才能打印。
            print(f"[gemini_enhance] [{model}] 调用异常 {_redact(f'{type(e).__name__}: {e}')}，尝试下一模型")
            continue

    # 全部候选模型都失败 → 静默回退到原始提示词，不影响主流程
    return raw_prompt
