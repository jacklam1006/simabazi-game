"""
TripoAI Developer API 客户端
文档：https://developers.tripo3d.ai/en/docs
官方 Python SDK（本次修复主要依据）：https://github.com/VAST-AI-Research/tripo-python-sdk
  （PyPI包名 tripo3d，作者 Tripo Development Team，即TripoAI官方团队）

支持：
  - 图片 → 3D模型（image-to-model）← 主要用途
  - 文字 → 3D模型（text-to-model）← 备用

── 2026-07-29 修复记录 ──────────────────────────────────────
生产环境实测捕获真实报错：`404 Client Error: for url: https://openapi.tripo3d.ai/v3/upload/file`。
排查后发现本文件从项目第一个commit（04dd8ad）起，就把整条图生3D/文生3D流水线建立在一套
「TripoAI官方SDK里完全找不到对应实现」的host+路径组合上：
  - BASE_URL = 'https://openapi.tripo3d.ai/v3'
  - 上传：POST {BASE_URL}/upload/file
  - 图生3D提交：POST {BASE_URL}/generation/image-to-model  （字段名 image_token / model）
  - 文生3D提交：POST {BASE_URL}/generation/text-to-model
  - 查任务：GET {BASE_URL}/tasks/{task_id}
这不是"TripoAI最近改版"，而是这套路径从一开始就不存在——`openapi.tripo3d.ai/v3` 这个host，
经查官方SDK `tripo3d/client.py` 源码注释确认，是TripoAI专门给"segment v2"（模型网格分割，
与本项目"图生3D主流程"完全是两个不同功能）开的窄通道，只有 `/v3/files`（上传）、
`/v3/tasks/{id}`（查任务）、`/v3/mesh/segment`（提交分割任务）三个路由，
从未有过 `/upload/file`、`/generation/image-to-model`、`/generation/text-to-model`、`/tasks/{id}`
这几个路径。

官方SDK真正用于"图生3D/文生3D"主流程的，是完全不同的host+路径体系（`tripo3d/client.py`
第25/60/113-120/200-226/439-482行，`tripo3d/client_impl/legacy_client_impl.py`
第213-247行 实测确认）：
  - BASE_URL = 'https://api.tripo3d.ai/v2/openapi'
  - 上传：POST {BASE_URL}/upload （multipart，字段名"file"）→ 响应 {"code":0,"data":{"image_token":"..."}}
  - 建任务（图生3D/文生3D统一走同一个端点）：POST {BASE_URL}/task
    body: {"type":"image_to_model"|"text_to_model", "file":{...}（仅图生3D）,
           "prompt":...（仅文生3D）, "model_version":...（字段名是 model_version，不是 model！），
           "face_limit":..., "texture":...}
    → 响应 {"code":0,"data":{"task_id":"..."}}
  - 查任务：GET {BASE_URL}/task/{task_id} （单数task，不是tasks！）
    → 响应 {"code":0,"data":{"task_id":..,"status":..,"output":{"model":"...", ...},
             "error_code":..,"error_msg":..., ...}}（`tripo3d/models.py` TaskOutput.from_dict
             第84行确认 output对象里GLB下载链接字段名是 "model"，不是 "model_url"）

已用 curl 对两个host（不带认证）做过路径探测：TripoAI网关会在路由匹配"之前"先统一检查
Authorization，无论路径真实存在与否，未认证请求一律返回同样的 `{"code":2/1002,
"message":"Authentication..."}`，因此空手（无Key）无法用HTTP状态码/响应体本身区分
"路径不存在"和"未认证"——这也是为什么生产环境线上（带着真实Key）明确报出的是404而不是本文件
无Key探测到的401/403，两者不矛盾。这意味着**本次修复未做真实API Key端到端验证**，
是完全基于官方开源SDK源码（一手、官方维护、可直接对照read的证据，见下方引用）做的严谨重写。

⚠️ 已知直接关联、但不在本文件修复范围内（main.py 属于 backend-service 领域）：
`island_service/main.py` 的 `_poll_tripo()` 读取 `result.get("output", {}).get("model_url")`
和 `result.get('message', '')`，这两个字段名按上面确认的真实响应结构应该是
`output.get("model")` 和 `result.get("error_msg", "")`。如果不同步修正，即使本文件的
路径修复生效、TripoAI任务真正跑成功了，`_poll_tripo` 依然会因为取不到 `model` 字段而报
"TripoAI返回成功但无model字段"，整条修复链路仍然跑不通——这是当前"model_url→model"历史
坑（见 claude-docs/已知问题与修复记录.md）在这次修复里的又一次复现，必须和本文件的改动
一起上线才有意义。
"""

import os
import time
import requests

TRIPO_API_KEY = os.environ.get('TRIPO_API_KEY', '')
BASE_URL = 'https://api.tripo3d.ai/v2/openapi'


def _redact(msg: str) -> str:
    """
    去除异常信息里可能内嵌的真实 TRIPO_API_KEY，防止通过job状态/日志泄漏。
    （本文件鉴权走 Authorization header，不像Gemini那样把key拼进URL query，
    理论上更不容易泄漏，但仍保留这层防护，和 gemini_image.py/gemini_analysis.py 同款约定一致）
    """
    if not msg:
        return msg
    if TRIPO_API_KEY:
        msg = msg.replace(TRIPO_API_KEY, '***REDACTED***')
    return msg


def _headers():
    return {
        'Authorization': f'Bearer {TRIPO_API_KEY}',
        'Content-Type': 'application/json',
    }


class TripoAuthError(RuntimeError):
    """
    TripoAI鉴权失败（Key无效/过期/被吊销/未配置），区别于路径错误、参数错误等其他故障，
    方便排查时第一时间判断"该去TripoAI控制台查Key"还是"该查代码逻辑"，不要把两类完全
    不同的故障混在一条模糊的报错里。
    """
    pass


_AUTH_ERROR_HINTS = (
    'authentication', 'unauthorized', 'invalid credentials',
    'invalid api key', 'auth failed', 'credentials is valid',
)


def _parse_tripo_response(resp: requests.Response, context: str) -> dict:
    """
    统一解析TripoAI响应，明确区分三类故障，全部抛出包含完整（脱敏后）响应内容的错误：
      1. 鉴权失败（Key无效/过期/被吊销）——抛 TripoAuthError
      2. 路径/参数错误等其他API层错误（HTTP非2xx，或 code 显式非0）——抛 RuntimeError
      3. 响应不是合法JSON（比如网关/CDN直接返回HTML错误页）——抛 RuntimeError，带原始文本
    """
    status = resp.status_code
    try:
        data = resp.json()
    except ValueError:
        raise RuntimeError(
            f"TripoAI{context}: HTTP {status} 响应不是合法JSON（可能是网关/CDN层错误页，"
            f"也可能路径本身就不存在）。原始响应前300字符: {_redact(resp.text)[:300]}"
        )

    message = str(data.get('message', ''))
    message_lower = message.lower()
    is_auth_error = (
        status in (401, 403)
        or any(hint in message_lower for hint in _AUTH_ERROR_HINTS)
    )

    if status >= 400 or data.get('code') not in (0, None):
        if is_auth_error:
            raise TripoAuthError(
                f"TripoAI{context}: 鉴权失败，怀疑 TRIPO_API_KEY 无效/过期/被吊销/未配置，"
                f"请到TripoAI控制台核实Key状态（不是路径或参数问题）。"
                f"原始响应: {_redact(str(data))[:300]}"
            )
        raise RuntimeError(
            f"TripoAI{context}失败: HTTP {status}, 响应: {_redact(str(data))[:500]}"
        )

    return data


# ── 上传图像文件 → 获取image_token ─────────────────────────────
def upload_image(image_bytes: bytes, filename: str = 'island.png') -> str:
    """
    上传PNG图像到TripoAI，返回image_token（后续建任务时作为 file.file_token 使用）。
    参照官方SDK legacy_client_impl.py upload_file()：POST {BASE_URL}/upload，
    multipart字段名"file"，响应结构 {"code":0,"data":{"image_token":"..."}}
    """
    upload_headers = {
        'Authorization': f'Bearer {TRIPO_API_KEY}',
    }
    files = {
        'file': (filename, image_bytes, 'image/png'),
    }
    try:
        resp = requests.post(
            f'{BASE_URL}/upload',
            headers=upload_headers,
            files=files,
            timeout=60
        )
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"TripoAI上传图像请求异常: {_redact(str(e))[:300]}")

    data = _parse_tripo_response(resp, "上传图像")
    payload = data.get('data') or {}
    # 官方SDK确认这个端点字段名是 image_token；保留 file_token 兜底，
    # 防止TripoAI未来把这个端点也统一成 /v3/files 那套命名却没人注意到。
    token = payload.get('image_token') or payload.get('file_token')
    if not token:
        raise RuntimeError(
            f"TripoAI上传图像HTTP成功但响应里找不到 image_token/file_token 字段，"
            f"完整响应: {_redact(str(data))[:500]}"
        )
    return token


# ── 图片 → 3D模型（主流水线）─────────────────────────────────
def submit_image_to_3d(
    image_bytes: bytes,
    model: str = 'P1-20260311',
    face_limit: int = 15000
) -> str:
    """
    Gemini生成的图像 → TripoAI image-to-3D → 返回task_id
    参照官方SDK client.py image_to_model()：统一走 POST {BASE_URL}/task，
    body 用 "type":"image_to_model" + "file":{"type":..,"file_token":..} + "model_version"
    （官方SDK字段名是 model_version，不是 model——历史上这个函数一直用错字段名，
    等于TripoAI服务端从未真正收到过我们指定的model版本）
    """
    # 1. 上传图像，取得 image_token
    file_token = upload_image(image_bytes)

    # 2. 提交建任务请求（图生3D）
    try:
        resp = requests.post(
            f'{BASE_URL}/task',
            headers=_headers(),
            json={
                'type': 'image_to_model',
                'file': {
                    'type': 'png',        # 与 upload_image() 实际上传的PNG格式对应
                    'file_token': file_token,
                },
                'model_version': model,   # 真实字段名 model_version，不是 model
                'face_limit': face_limit,
                'texture': True,          # 保留材质贴图
            },
            timeout=30
        )
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"TripoAI image-to-3D提交请求异常: {_redact(str(e))[:300]}")

    data = _parse_tripo_response(resp, "image-to-3D提交")
    task_id = (data.get('data') or {}).get('task_id')
    if not task_id:
        raise RuntimeError(
            f"TripoAI image-to-3D提交HTTP成功但响应里找不到task_id: {_redact(str(data))[:500]}"
        )
    return task_id


# ── 文字 → 3D模型（备用）────────────────────────────────────
def submit_text_to_3d(
    prompt: str,
    model: str = 'v3.1-20260211',
) -> str:
    # TripoAI prompt 上限约1000字符
    safe_prompt = prompt[:900] if len(prompt) > 900 else prompt
    payload = {
        'type': 'text_to_model',
        'prompt': safe_prompt,
        'model_version': model,   # 真实字段名 model_version，不是 model
    }
    print(f"[TripoAI text-to-3D] prompt({len(safe_prompt)}chars): {safe_prompt[:100]}...")
    try:
        resp = requests.post(
            f'{BASE_URL}/task',
            headers=_headers(),
            json=payload,
            timeout=30
        )
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"TripoAI text-to-3D提交请求异常: {_redact(str(e))[:300]}")

    data = _parse_tripo_response(resp, "text-to-3D提交")
    task_id = (data.get('data') or {}).get('task_id')
    if not task_id:
        raise RuntimeError(
            f"TripoAI text-to-3D提交HTTP成功但响应里找不到task_id: {_redact(str(data))[:500]}"
        )
    return task_id


# ── 查询任务状态 ──────────────────────────────────────────────
def get_task_status(task_id: str) -> dict:
    """
    GET {BASE_URL}/task/{task_id}（单数task——官方SDK get_task()真实路径，
    此前代码用的 /tasks/{id}（复数）在真实API上不存在）
    返回 data.data，字段形状见 tripo3d/models.py Task.from_dict/TaskOutput.from_dict：
    顶层含 task_id/type/status/output/progress/error_code/error_msg 等，
    output 子对象里GLB下载链接字段名是 "model"（不是"model_url"）。
    """
    try:
        resp = requests.get(
            f'{BASE_URL}/task/{task_id}',
            headers=_headers(),
            timeout=15
        )
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"TripoAI查询任务状态请求异常: {_redact(str(e))[:300]}")

    data = _parse_tripo_response(resp, "查询任务状态")
    result = data.get('data')
    if result is None:
        raise RuntimeError(
            f"TripoAI查询任务状态HTTP成功但响应里找不到data字段: {_redact(str(data))[:500]}"
        )
    return result


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
