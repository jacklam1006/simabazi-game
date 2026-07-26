"""
Supabase Storage 客户端
将 TripoAI 生成的 GLB 文件永久存储，解决 5 分钟过期问题

依赖环境变量：
  SUPABASE_URL          = https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY  = service_role 密钥（在 Supabase Settings > API 获取）

Supabase Storage 需提前创建名为 "glb-models" 的 Public Bucket。
"""

import os
import uuid
import requests

SUPABASE_URL        = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
BUCKET              = 'glb-models'


def _storage_headers():
    return {
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type':  'model/gltf-binary',
        'x-upsert':      'true',
    }


def download_glb(tripo_url: str) -> bytes:
    """从 TripoAI 临时 URL 下载 GLB 字节（必须在 URL 过期前调用）"""
    resp = requests.get(tripo_url, timeout=60)
    if not resp.ok:
        raise RuntimeError(f"GLB下载失败 {resp.status_code}: {tripo_url[:80]}")
    return resp.content


def upload_glb(glb_bytes: bytes) -> str:
    """
    上传 GLB 到 Supabase Storage，返回永久公开 URL。
    文件名使用 UUID，避免冲突。
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError("未配置 SUPABASE_URL 或 SUPABASE_SERVICE_KEY")

    filename   = f"{uuid.uuid4()}.glb"
    upload_url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{filename}"

    resp = requests.post(
        upload_url,
        headers=_storage_headers(),
        data=glb_bytes,
        timeout=120,
    )
    if not resp.ok:
        raise RuntimeError(
            f"Supabase Storage 上传失败 {resp.status_code}: {resp.text[:200]}"
        )

    permanent_url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{filename}"
    print(f"[Supabase Storage] 上传成功: {filename} ({len(glb_bytes)//1024} KB)")
    return permanent_url
