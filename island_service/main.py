"""
司马八字 · 岛屿生成 API
FastAPI 后端，部署到 Render

完整流水线：
  八字数据 → 提示词 → Gemini生图 → TripoAI转3D → GLB URL
  （TripoAI失败时自动降级为文生3D兜底）

端点：
  POST /generate              提交任务，返回job_id（即时）
  GET  /status/{job_id}       前端轮询进度
  GET  /health                健康检查（含API key状态）
  GET  /ping                  保活端点（前端每14分钟调用）
"""

import os
import json
import hashlib
import asyncio
import uuid
import time
from pathlib import Path
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from bazi_prompt import generate_island_prompt, generate_tripo_short_prompt
from gemini_enhance import enhance_island_prompt
from gemini_analysis import analyze_bazi
from gemini_image import generate_island_image
from tripo_client import submit_image_to_3d, submit_text_to_3d, get_task_status
from supabase_storage import download_glb, upload_glb

app = FastAPI(title="司马八字 Island Generator API")

# CORS：允许前端跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 存储（文件式 + Render持久化磁盘）─────────────────────────
CACHE_DIR = Path("./cache")
JOBS_DIR  = Path("./jobs")
CACHE_DIR.mkdir(exist_ok=True)
JOBS_DIR.mkdir(exist_ok=True)

def _cache_key(bazi_data: dict) -> str:
    return hashlib.md5(json.dumps(bazi_data, sort_keys=True).encode()).hexdigest()

def _read(path): return json.loads(path.read_text()) if path.exists() else None
def _write(path, data): path.write_text(json.dumps(data, ensure_ascii=False))


# ── Schema ───────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    bazi_data: dict          # 前端BaziEngine.calculate()的完整结果
    force_regen: bool = False

class CheckEmailRequest(BaseModel):
    email: str

class AnalyzeRequest(BaseModel):
    bazi_data: dict
    gender: str = '男'
    birth_year: int = 0


# ── TripoAI 轮询（含超时）────────────────────────────────────
async def _poll_tripo(task_id: str, max_wait: int = 180) -> str:
    """轮询TripoAI任务，返回GLB URL。超时或失败抛出异常。"""
    deadline = time.time() + max_wait
    while time.time() < deadline:
        await asyncio.sleep(3)
        result = get_task_status(task_id)
        status = result.get("status", "")

        if status == "success":
            # TripoAI v3：output.model 是GLB下载链接
            url = result.get("output", {}).get("model_url")
            if not url:
                raise RuntimeError(f"TripoAI返回成功但无model字段: {result}")
            return url

        if status in ("failed", "cancelled"):
            raise RuntimeError(f"TripoAI任务失败({status}): {result.get('message','')}")

    raise TimeoutError(f"TripoAI超时（>{max_wait}s）")


# ── 后台生成任务 ─────────────────────────────────────────────
async def _run_generation(job_id: str, bazi_data: dict, cache_key: str):
    job_path = JOBS_DIR / f"{job_id}.json"
    prompt = ""

    def update(stage: str, progress: int, **extra):
        data = {"job_id": job_id, "stage": stage, "progress": progress, **extra}
        _write(job_path, data)

    try:
        # ── 阶段1：规则引擎生成基础提示词 ─────────────────
        update("generating_prompt", 5)
        prompt = generate_island_prompt(bazi_data)
        update("prompt_ready", 8)

        # ── 阶段1.5：Gemini 3.5 Flash 深度分析优化 ────────
        update("enhancing_prompt", 10)
        enhanced = enhance_island_prompt(prompt, bazi_data)
        if enhanced != prompt:
            print(f"[Gemini Enhance] 成功，长度 {len(prompt)} → {len(enhanced)}")
        else:
            print(f"[Gemini Enhance] 静默失败或跳过，使用原始提示词（{len(prompt)}字）")
        prompt = enhanced
        update("prompt_enhanced", 15)

        # ── 阶段2：Nano Banana Pro 生成2D命盘岛图像 ───────
        update("generating_image", 15)
        image_bytes = None
        try:
            image_bytes = generate_island_image(prompt)
            update("image_ready", 35)
        except Exception as img_err:
            # Gemini失败 → 跳过图生3D，直接用文生3D
            err_msg = str(img_err)
            print(f"[Gemini ERROR] {err_msg}")   # Render日志可见
            update("image_failed_fallback", 35,
                   warning=f"Gemini生图失败: {err_msg[:200]}")

        # ── 阶段3：TripoAI 图生3D（优先）或 文生3D（兜底）─
        update("converting_to_3d", 40)
        model_url = None

        if image_bytes:
            # 优先路径：Gemini图 → TripoAI image-to-3D
            try:
                task_id = submit_image_to_3d(image_bytes)
                update("tripo_processing", 45, tripo_task_id=task_id)
                model_url = await _poll_tripo(task_id, max_wait=300)
            except Exception as tripo_err:
                # image-to-3D失败 → 降级为文生3D
                tripo_err_msg = str(tripo_err)
                print(f"[Tripo ERROR] {tripo_err_msg[:200]}")   # Render日志可见
                update("tripo_fallback", 50,
                       warning=f"图生3D失败，改用文生3D: {tripo_err}")
                image_bytes = None   # 触发下方文生3D路径

        if not model_url:
            # 兜底路径：text-to-3D 用专用短提示词（长提示词会被TripoAI 400拒绝）
            short_prompt = generate_tripo_short_prompt(bazi_data)
            print(f"[TripoAI fallback] 短提示词({len(short_prompt)}字): {short_prompt}")
            task_id = submit_text_to_3d(short_prompt)
            update("tripo_text_processing", 55, tripo_task_id=task_id)
            model_url = await _poll_tripo(task_id, max_wait=240)

        # ── 上传GLB到Supabase Storage（永久保存）──────────
        update("uploading", 90)
        try:
            glb_bytes    = download_glb(model_url)
            model_url    = upload_glb(glb_bytes)
            print(f"[Pipeline] 永久URL: {model_url}")
        except Exception as storage_err:
            # Storage失败不阻断流程，继续用TripoAI临时URL（5分钟内仍可用）
            print(f"[Storage ERROR] {storage_err}")

        # ── 写缓存 + 完成 ──────────────────────────────────
        _write(CACHE_DIR / f"{cache_key}.json", {
            "model_url": model_url,
            "prompt": prompt,
        })
        update("completed", 100, model_url=model_url, prompt=prompt)

    except Exception as e:
        _write(job_path, {
            "job_id": job_id,
            "stage": "error",
            "progress": 0,
            "error": str(e),
            "prompt": prompt,
        })


# ── 端点1：提交生成任务 ──────────────────────────────────────
@app.post("/generate")
async def generate_island(req: GenerateRequest, background_tasks: BackgroundTasks):
    ck = _cache_key(req.bazi_data)

    # 命中缓存（URL已永久存储到Supabase，直接返回）
    if not req.force_regen:
        cached = _read(CACHE_DIR / f"{ck}.json")
        if cached and cached.get("model_url"):
            return {
                "job_id":    f"cached_{ck}",
                "source":    "cache",
                "status":    "completed",
                "progress":  100,
                "model_url": cached["model_url"],
            }

    # 新建job
    job_id = str(uuid.uuid4())
    _write(JOBS_DIR / f"{job_id}.json", {
        "job_id": job_id,
        "stage": "queued",
        "progress": 0,
    })

    background_tasks.add_task(_run_generation, job_id, req.bazi_data, ck)
    return {"job_id": job_id, "source": "new", "status": "queued", "progress": 0}


# ── 端点2：查询任务进度 ──────────────────────────────────────
@app.get("/status/{job_id}")
async def job_status(job_id: str):
    if job_id.startswith("cached_"):
        ck = job_id[7:]
        cached = _read(CACHE_DIR / f"{ck}.json")
        if cached:
            return {"job_id": job_id, "stage": "completed", "progress": 100,
                    "model_url": cached.get("model_url")}

    job = _read(JOBS_DIR / f"{job_id}.json")
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ── 端点3：健康检查 ──────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "api_keys": {
            "gemini": bool(os.environ.get("GEMINI_API_KEY")),
            "tripo":  bool(os.environ.get("TRIPO_API_KEY")),
        }
    }


# ── 端点4：保活（前端每14分钟调用，防止Render冷启动）────────
@app.get("/ping")
def ping():
    return {"pong": True}


# ── 端点5：检查邮箱是否已注册 ───────────────────────────────
@app.post("/auth/check-email")
async def check_email_endpoint(req: CheckEmailRequest):
    """检查邮箱是否已注册（主页表单用，判断新老用户）"""
    email = req.email.strip().lower()
    if not email or "@" not in email:
        return {"exists": False}

    service_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not service_key or not supabase_url:
        return {"exists": False}

    try:
        resp = requests.get(
            f"{supabase_url}/auth/v1/admin/users",
            headers={
                "Authorization": f"Bearer {service_key}",
                "apikey": service_key,
            },
            params={"page": 1, "per_page": 1000},
            timeout=10,
        )
        if not resp.ok:
            return {"exists": False}
        users = resp.json().get("users", [])
        exists = any(u.get("email", "").lower() == email for u in users)
        return {"exists": exists}
    except Exception as e:
        print(f"[check-email ERROR] {e}")
        return {"exists": False}


# ── 端点6：八字AI深度分析 ────────────────────────────────────
@app.post("/analyze-bazi")
async def analyze_bazi_endpoint(req: AnalyzeRequest):
    """
    调用 Gemini 对八字命盘进行深度分析。
    后端有文件缓存：相同八字（干支+性别）只调用一次，后续即时返回。
    """
    result = analyze_bazi(req.bazi_data, req.gender, req.birth_year)
    if result.get('error') == 'no_api_key':
        raise HTTPException(status_code=503, detail="AI analysis service not configured")
    return result


# ── 本地运行 ─────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080, reload=True)
