"""
Gemini 图像生成模块
流水线：文字提示词 → Gemini nanobanana → 2D命盘岛图像（bytes）
"""

import os
import re
import base64
import requests

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')

# Nano Banana Pro（Gemini 3 Pro Image）— 高保真4K岛屿图像生成
# 备选：gemini-3-pro-image-preview（预览版）
GEMINI_IMAGE_MODEL = os.environ.get('GEMINI_IMAGE_MODEL', 'gemini-3-pro-image')


def _redact(msg: str) -> str:
    """
    去除异常信息里可能内嵌的真实 GEMINI_API_KEY，防止通过job状态/日志泄漏。
    requests 库的连接层异常（超时/DNS失败等）的 str(e) 常常带出完整请求URL，
    其中包含 ?key=<真实KEY>；此前 gemini_analysis.py/gemini_enhance.py 已因
    同类问题修复过（见 已知问题与修复记录.md 2026-07-29二次修复），本模块同步补上。
    """
    if not msg:
        return msg
    if GEMINI_API_KEY:
        msg = msg.replace(GEMINI_API_KEY, '***REDACTED***')
    # 兜底：即使KEY变量为空或大小写/编码有差异，也把URL里的 key= 参数值统一打码
    msg = re.sub(r'([?&]key=)[^&\s"\']+', r'\1***REDACTED***', msg)
    return msg


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
            # 根因（2026-07-29排查确认）：Gemini 3 系列图像模型（含 gemini-3-pro-image）的
            # GenerationConfig.responseModalities 语义是"与响应模态精确匹配（exact match）"——
            # 官方 REST API 参考原文："If the requested modalities do not match any of the
            # supported combinations, an error will be returned."
            # gemini-3-pro-image 实际支持的组合是 TEXT+IMAGE，不支持单独 IMAGE-only；
            # 旧代码只传 ["IMAGE"] 会被判定为不支持的组合，Gemini 立即返回 400，且不消耗生成算力
            # ——这与生产实测"提交后极短时间内就快速失败"的现象完全吻合（不是超时/偶发网络问题）。
            # 依据：ai.google.dev/api/generate-content 官方REST参考（GenerationConfig.responseModalities
            # 字段说明）+ ai.google.dev/gemini-api/docs/image-generation 历次归档快照
            # （2026-05-22/06-12/06-21/07-01/07-05/07-07）中 gemini-3-pro-image-preview/
            # gemini-3.1-flash-image-preview 的全部官方示例（Python/JS/Go/Java/REST curl）无一例外
            # 都设置 responseModalities=["TEXT","IMAGE"]，从未出现单独["IMAGE"]的用法。
            # 注：generateContent 接口本身并未下线——2026-07-21更新的 interactions-overview 文档明确写道
            # "the original generateContent API remains fully supported"，所以本次不需要迁移到新的
            # Interactions API（/v1beta/interactions），只需修正这个被遗漏的必需字段。
            "responseModalities": ["TEXT", "IMAGE"],
            # imageConfig 是当前（非deprecated）官方字段，用于控制分辨率/构图比例：
            # aspectRatio="1:1" 匹配下方 enhanced_prompt 里"Single centered island composition"的构图要求；
            # imageSize="4K" 对应本文件顶部注释与 PROMPT_SYSTEM.md 里"高保真4K岛屿图像生成"的既定设计目标
            # （不显式设置时模型默认仅出 1K，会与设计目标不符）
            "imageConfig": {
                "aspectRatio": "1:1",
                "imageSize": "4K",
            },
        }
    }

    try:
        resp = requests.post(url, json=payload, timeout=90)
    except requests.exceptions.RequestException as e:
        # 网络层异常（超时/DNS失败/连接被拒等）的 str(e) 常内嵌完整请求URL（含 ?key=真实KEY），
        # 必须打码后才能抛出——上游 main.py 会把该异常信息截断后写入job状态，前端可见
        raise RuntimeError(f"Gemini图像API请求异常: {_redact(str(e))[:300]}")

    if not resp.ok:
        raise RuntimeError(f"Gemini API错误 {resp.status_code}: {_redact(resp.text)[:300]}")

    data = resp.json()

    # 提取图像数据（responseModalities改为TEXT+IMAGE后，parts里可能混有文本part，
    # 需遍历全部parts找到inlineData，而不是假设第一个part就是图像）
    for part in data.get('candidates', [{}])[0].get('content', {}).get('parts', []):
        if 'inlineData' in part:
            img_b64 = part['inlineData']['data']
            return base64.b64decode(img_b64)

    raise RuntimeError(f"Gemini未返回图像数据: {_redact(str(data))[:300]}")
