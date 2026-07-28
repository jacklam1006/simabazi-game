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

# 'gemini-3.5-flash' 并非已确认存在的模型ID（详见 gemini_analysis.py 的说明——
# 本项目里唯一已验证可用的是 gemini_image.py 的 `gemini-3-pro-image`，命名规律
# 并不支持 "3.5" 这个版本号）。这里同样改成候选链，任一模型失败就换下一个，
# 全部失败才回退到原始提示词（原有行为不变，调用方不需要感知失败）。
#
# 2026-07-29 二次修复：原链只有 gemini-flash-latest / gemini-2.5-flash 两个候选，
# 两者都是"思考型"模型（会把推理过程也计入 maxOutputTokens），一旦复现
# gemini_analysis.py 同款"HTTP 200但candidate文本为空"的症状，会一路失败到底、
# 静默回退到 raw_prompt，等于这次修复对本模块没有实质改善。补上非思考模型
# gemini-2.0-flash 作为最终回退，与 gemini_analysis.py 的 ANALYSIS_MODEL_CHAIN 对齐。
_ENV_ENHANCE_MODEL = os.environ.get('GEMINI_ENHANCE_MODEL', '').strip()
ENHANCE_MODEL_CHAIN = ([_ENV_ENHANCE_MODEL] if _ENV_ENHANCE_MODEL else []) + [
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
]

# gemini-2.0-flash 不支持 thinkingConfig（传入会被API拒绝），只对已知的思考型模型
# （2.5系列 / flash-latest别名）附加 thinkingConfig.thinkingBudget=0，关闭思考token
# 消耗，让 maxOutputTokens 全部用于生成正文——与 gemini_analysis.py 的处理逻辑一致。
_NON_THINKING_MODELS = {'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'}


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
        # generationConfig 按模型单独构建：只有思考型模型才附加 thinkingConfig，
        # 传给 gemini-2.0-flash 这类非思考模型会被API拒绝（400）
        generation_config = {
            "temperature": 0.65,
            "maxOutputTokens": 900,
            "topP": 0.9,
        }
        if model not in _NON_THINKING_MODELS:
            generation_config["thinkingConfig"] = {"thinkingBudget": 0}
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
