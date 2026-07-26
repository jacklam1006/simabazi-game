"""
TripoAI Developer API 客户端
文档：https://developers.tripo3d.ai/en/docs

支持：
  - 图片 → 3D模型（image-to-model）← 主要用途
  - 文字 → 3D模型（text-to-model）← 备用
"""

import os
import time
import requests

TRIPO_API_KEY = os.environ.get('TRIPO_API_KEY', '')
BASE_URL = 'https://openapi.tripo3d.ai/v3'

def _headers():
    return {
        'Authorization': f'Bearer {TRIPO_API_KEY}',
        'Content-Type': 'application/json',
    }


# ── 上传图像文件 → 获取file_token ─────────────────────────────
def upload_image(image_bytes: bytes, filename: str = 'island.png') -> str:
    """
    上传PNG图像到TripoAI，返回file_token
    file_token有效期30分钟
    """
    upload_headers = {
        'Authorization': f'Bearer {TRIPO_API_KEY}',
    }
    files = {
        'file': (filename, image_bytes, 'image/png'),
    }
    resp = requests.post(
        f'{BASE_URL}/upload/file',
        headers=upload_headers,
        files=files,
        timeout=60
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get('code') != 0:
        raise RuntimeError(f"TripoAI上传失败: {data}")
    return data['data']['image_token']


# ── 图片 → 3D模型（主流水线）─────────────────────────────────
def submit_image_to_3d(
    image_bytes: bytes,
    model: str = 'P1-20260311',
    face_limit: int = 15000
) -> str:
    """
    Gemini生成的图像 → TripoAI image-to-3D → 返回task_id
    """
    # 1. 上传图像
    file_token = upload_image(image_bytes)

    # 2. 提交image-to-model任务
    resp = requests.post(
        f'{BASE_URL}/generation/image-to-model',
        headers=_headers(),
        json={
            'image_token': file_token,   # TripoAI v3 字段名为 image_token
            'model': model,
            'face_limit': face_limit,
            'texture': True,             # 保留材质贴图
        },
        timeout=30
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get('code') != 0:
        raise RuntimeError(f"TripoAI image-to-3D提交失败: {data}")
    return data['data']['task_id']


# ── 文字 → 3D模型（备用）────────────────────────────────────
def submit_text_to_3d(
    prompt: str,
    model: str = 'v3.1-20260211',
) -> str:
    resp = requests.post(
        f'{BASE_URL}/generation/text-to-model',
        headers=_headers(),
        json={
            'prompt': prompt,
            'model': model,
        },
        timeout=30
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get('code') != 0:
        raise RuntimeError(f"TripoAI text-to-3D提交失败: {data}")
    return data['data']['task_id']


# ── 查询任务状态 ──────────────────────────────────────────────
def get_task_status(task_id: str) -> dict:
    resp = requests.get(
        f'{BASE_URL}/tasks/{task_id}',
        headers=_headers(),
        timeout=15
    )
    resp.raise_for_status()
    return resp.json()['data']


# ── 等待任务完成（后端内部用）────────────────────────────────
def poll_until_done(task_id: str, max_wait: int = 180) -> dict:
    deadline = time.time() + max_wait
    while time.time() < deadline:
        result = get_task_status(task_id)
        if result['status'] == 'success':
            return result
        if result['status'] in ('failed', 'cancelled'):
            raise RuntimeError(f"Task {task_id} 失败: {result}")
        time.sleep(3)
    raise TimeoutError(f"Task {task_id} 超过{max_wait}秒")
