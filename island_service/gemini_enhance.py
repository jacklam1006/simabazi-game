"""
Gemini 3.5 Flash · 八字命盘提示词增强器
流水线位置：规则提示词 → [本模块] → Nano Banana Pro 图像生成

作用：用 Gemini 3.5 Flash 的推理能力，把规则映射的结构化描述
      升华为更有层次感、更适合 3D 图像生成的提示词。
失败时自动回退到原始提示词，不影响主流程。
"""

import os
import requests

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
ENHANCE_MODEL = 'gemini-3.5-flash'


def enhance_island_prompt(raw_prompt: str, bazi_data: dict) -> str:
    """
    使用 Gemini 3.5 Flash 分析八字命盘，深度优化岛屿生成提示词。

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

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{ENHANCE_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )

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

    payload = {
        "contents": [{
            "parts": [{"text": f"{system_instruction}\n\nOriginal prompt:\n{raw_prompt}"}]
        }],
        "generationConfig": {
            "temperature": 0.65,
            "maxOutputTokens": 900,
            "topP": 0.9,
        }
    }

    try:
        resp = requests.post(url, json=payload, timeout=25)
        resp.raise_for_status()
        data = resp.json()
        enhanced = data['candidates'][0]['content']['parts'][0]['text'].strip()
        # 安全检查：增强后的提示词必须足够长才使用
        if len(enhanced) > 150:
            return enhanced
        return raw_prompt
    except Exception:
        # 任何失败（网络/超时/解析）均静默回退
        return raw_prompt
