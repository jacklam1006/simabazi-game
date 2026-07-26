"""
Gemini 图像生成模块
流水线：文字提示词 → Gemini nanobanana → 2D命盘岛图像（bytes）
"""

import os
import base64
import requests

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')

# Nano Banana Pro（Gemini 3 Pro Image）— 高保真4K岛屿图像生成
# 备选：gemini-3-pro-image-preview（预览版）
GEMINI_IMAGE_MODEL = os.environ.get('GEMINI_IMAGE_MODEL', 'gemini-3-pro-image')


def generate_island_image(prompt: str) -> bytes:
    """
    调用 Gemini 图像生成API，返回PNG图像字节

    Args:
        prompt: 英文命盘岛描述提示词
    Returns:
        PNG图像字节数据
    """
    # Gemini REST API端点
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_IMAGE_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )

    # 强化提示词：确保生成的图像风格适合后续转3D
    enhanced_prompt = f"""{prompt}

ADDITIONAL STYLE NOTES FOR 3D CONVERSION:
- Clear distinct shapes with strong silhouettes
- Clean separation between foreground and background
- No text or labels overlaid on image
- Single centered island composition
- Dark starry background (important for 3D extraction)
- High contrast between island and background"""

    payload = {
        "contents": [{
            "parts": [{"text": enhanced_prompt}]
        }],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
            "responseMimeType": "image/png",
        }
    }

    resp = requests.post(url, json=payload, timeout=60)
    resp.raise_for_status()

    data = resp.json()

    # 提取图像数据
    for part in data.get('candidates', [{}])[0].get('content', {}).get('parts', []):
        if 'inlineData' in part:
            img_b64 = part['inlineData']['data']
            return base64.b64decode(img_b64)

    raise RuntimeError(f"Gemini未返回图像数据: {data}")
