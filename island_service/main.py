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
  POST /notify-redemption     水晶兑换请求通知邮件（纯转发，不写数据库）
"""

import os
import json
import hashlib
import asyncio
import uuid
import time
import requests
from pathlib import Path
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from bazi_prompt import generate_island_prompt, generate_tripo_short_prompt
from gemini_enhance import enhance_island_prompt
from gemini_analysis import analyze_bazi
from gemini_image import generate_island_image
from tripo_client import submit_image_to_3d, submit_text_to_3d, get_task_status
from supabase_storage import download_glb, upload_glb

# ── 默认线程池（asyncio.to_thread 底层用的executor）───────────
# 2026-08-01 评估已知问题日志"代码质量/健壮性"第13条（asyncio.to_thread默认
# 线程池在多用户并发时可能成为瓶颈）后显式设置，理由：
#   1. 本服务单进程单event loop（uvicorn未开--workers），/analyze-bazi的
#      七个并行步骤（十神详解+事业+婚恋+健康+大运+命柱详解+神煞详解）用
#      asyncio.gather并行发起7次asyncio.to_thread（单个请求峰值占用7个线程，
#      2026-08-11新增命柱详解/神煞详解两步后从5个变为7个——见下方注释4的
#      数字已同步更新）；同一次评估中还发现并修复了_run_generation/_poll_tripo里
#      原本直接同步阻塞调用（未用to_thread）的问题（见下方改动），修复后
#      /generate的每个生成中任务也会在其网络调用期间占用1个线程——两类端点
#      叠加后，多用户同时使用时对线程数的需求比修复前更高，不是更低。
#   2. Python默认executor大小是min(32, os.cpu_count()+4)。Render容器的
#      os.cpu_count()在cgroup配额限制（当前用的Starter套餐，非整数vCPU）下
#      具体返回什么值取决于host是否设置了CPU亲和性掩码——不同基础设施表现
#      不一致，本地也无法在Render真实容器里验证，属于不确定量。
#   3. 这些to_thread包裹的调用几乎全部是requests.post/get等阻塞网络I/O
#      （等待Gemini/TripoAI/Supabase响应），线程在等待期间会释放GIL、不占用
#      CPU，只是占着一个OS线程和少量内存——对"I/O密集型"场景，线程数适度
#      超配的成本很低，不同于CPU密集型场景。
#   4. 综合以上：与其依赖一个在容器环境下值不确定、且可能低至个位数
#      （cpu_count()==1时默认池只有5）的隐式默认值，不如显式设一个有把握
#      覆盖"数个用户同时触发生成/深析"场景的下限。20是估算值：可覆盖约
#      2-3个用户同时处于/analyze-bazi的七步并行阶段（20/7≈2.86，向下取整
#      约2个用户能完全不排队；2026-08-11新增命柱/神煞详解两步后从"4个用户
#      (4*5=20)"降为"2-3个用户(20/7≈2.86)"，20这个总数未变，只是新增两步
#      分摊到每用户的线程数变多、能同时覆盖的用户数相应变少——如果3个用户
#      同一时刻都进入并行阶段，会有21个to_thread任务>20个worker，至少1个
#      任务要排队等空闲worker，该用户这一步墙钟时间被拉长），或更多用户
#      同时处于/generate的单线程网络调用阶段——不是压测得出的精确值，产品
#      当前阶段用户规模尚小，如果后续实际观察到线程仍然不够用（Render
#      监控里CPU持续高位、请求排队/超时增多），再回来上调或改用更专门的
#      并发控制（如按端点分别限流）。
_EXECUTOR = ThreadPoolExecutor(max_workers=20, thread_name_prefix="smb-worker")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    asyncio.get_running_loop().set_default_executor(_EXECUTOR)
    yield


app = FastAPI(title="司马八字 Island Generator API", lifespan=_lifespan)

# CORS：允许前端跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 存储（文件式 + Render持久化磁盘）─────────────────────────
# 磁盘挂载在 persistent_data 子目录（而非 island_service 根目录），
# 避免持久磁盘内容覆盖代码文件导致部署后服务找不到 main.py（2026-07-30生产事故）
PERSIST_DIR = Path("./persistent_data")
CACHE_DIR = PERSIST_DIR / "cache"
JOBS_DIR  = PERSIST_DIR / "jobs"
PERSIST_DIR.mkdir(exist_ok=True)
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
    force_refresh: bool = False  # true 时跳过后端文件缓存，强制重新走六步AI深析流水线
                                  # （设置面板"轻量刷新AI深析"用，见 gemini_analysis.py::analyze_bazi()）

class NotifyRedemptionRequest(BaseModel):
    # 2026-08-12 第二阶段"灵气兑换水晶"：`redemption_requests`表才是权威数据
    # （前端已用supabase-js直接insert过），这个请求体只用于拼一封提醒邮件，
    # 字段全部给默认值——即使前端传漏某个字段，也不应该让这个锦上添花的
    # 端点因为pydantic校验失败而报错。
    product_name: str = ''
    trait_summary: str = ''
    contact_phone: str = ''
    user_email: str = ''


# ── TripoAI 轮询（含超时）────────────────────────────────────
async def _poll_tripo(task_id: str, max_wait: int = 180) -> str:
    """轮询TripoAI任务，返回GLB URL。超时或失败抛出异常。"""
    deadline = time.time() + max_wait
    while time.time() < deadline:
        await asyncio.sleep(3)
        # get_task_status 是同步阻塞的 requests.get 调用，2026-08-01评估并发
        # 瓶颈问题时发现此前直接同步调用会在每次轮询（每3秒一次，持续最长
        # 300秒）期间独占事件循环，导致该job运行期间整个单进程服务对其他所有
        # 用户请求（含/status /health /ping /analyze-bazi）都失去响应——
        # 改用 to_thread 把这次网络调用挪到线程池执行，事件循环不再被阻塞
        result = await asyncio.to_thread(get_task_status, task_id)
        status = result.get("status", "")

        if status == "success":
            # GLB下载链接字段名在output对象里，实测发现字段名不止一种：
            # - 官方SDK文档/TaskOutput.from_dict 标注为 output.model
            # - 但2026-07-29生产环境实测：请求参数带 texture=True, pbr=True 时，
            #   TripoAI实际返回的字段名是 output.pbr_model（不是model），
            #   推测base mesh（无贴图）输出叫model，PBR材质输出叫pbr_model，
            #   取决于请求参数。两种情况都要兼容，优先取pbr_model（更常见，
            #   因为当前tripo_client默认开texture/pbr），取不到再退回model。
            output = result.get("output", {})
            url = output.get("pbr_model") or output.get("model")
            if not url:
                raise RuntimeError(f"TripoAI返回成功但无model/pbr_model字段: {result}")
            return url

        if status in ("failed", "cancelled"):
            # 官方SDK Task.from_dict 确认：错误信息字段名是 error_msg（不是 message）
            raise RuntimeError(f"TripoAI任务失败({status}): {result.get('error_msg','')}")

    raise TimeoutError(f"TripoAI超时（>{max_wait}s）")


# ── 后台生成任务 ─────────────────────────────────────────────
async def _run_generation(job_id: str, bazi_data: dict, cache_key: str):
    job_path = JOBS_DIR / f"{job_id}.json"
    prompt = ""

    def update(stage: str, progress: int, **extra):
        data = {"job_id": job_id, "stage": stage, "progress": progress, **extra}
        _write(job_path, data)

    # 2026-08-01 评估已知问题日志"asyncio.to_thread默认线程池瓶颈"待办时发现：
    # 本函数以下调用 enhance_island_prompt/generate_island_image/
    # submit_image_to_3d/submit_text_to_3d/download_glb/upload_glb 全部是同步
    # 阻塞的requests调用，此前直接在这个async函数体内同步调用（没有用
    # asyncio.to_thread包裹）。_run_generation本身是靠BackgroundTasks
    # 调度的协程，Starlette对"传入的task本身是async def"的处理方式是直接
    # await它、而不会自动丢进线程池——意味着这些同步网络调用会直接占用
    # 唯一的事件循环线程，期间（单次最长可达90秒的图像生成或GLB下载/上传）整个
    # 单进程服务对其他所有用户的所有请求（含另一个用户的/generate /status
    # /health /ping /analyze-bazi）都会失去响应，是比"Step3-6线程池够不够"
    # 更直接的并发瓶颈。改为 asyncio.to_thread 包裹，让这些调用真正在线程池
    # 里执行、不阻塞事件循环。generate_island_prompt是纯规则引擎计算（无网络
    # 调用），不需要包裹。
    try:
        # ── 阶段1：规则引擎生成基础提示词 ─────────────────
        update("generating_prompt", 5)
        prompt = generate_island_prompt(bazi_data)
        update("prompt_ready", 8)

        # ── 阶段1.5：Gemini 3.5 Flash 深度分析优化 ────────
        update("enhancing_prompt", 10)
        enhanced = await asyncio.to_thread(enhance_island_prompt, prompt, bazi_data)
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
            image_bytes = await asyncio.to_thread(generate_island_image, prompt)
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
                task_id = await asyncio.to_thread(submit_image_to_3d, image_bytes)
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
            task_id = await asyncio.to_thread(submit_text_to_3d, short_prompt)
            update("tripo_text_processing", 55, tripo_task_id=task_id)
            model_url = await _poll_tripo(task_id, max_wait=240)

        # ── 上传GLB到Supabase Storage（永久保存）──────────
        update("uploading", 90)
        try:
            glb_bytes    = await asyncio.to_thread(download_glb, model_url)
            model_url    = await asyncio.to_thread(upload_glb, glb_bytes)
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
# 2026-08-01：此端点原为 async def，内部 requests.get 是同步阻塞调用，未用
# asyncio.to_thread 包裹时会占用唯一的事件循环线程，冻结全服务器（跟
# _run_generation/_poll_tripo 同类问题）。改为普通 def：Starlette 会自动把
# 同步函数整体丢进 anyio 线程池执行，不占用事件循环——与本文件 /health、
# /ping 的写法风格一致（方案A，见已知问题日志）。
@app.post("/auth/check-email")
def check_email_endpoint(req: CheckEmailRequest):
    """检查邮箱是否已注册（主页表单用，判断新老用户）"""
    email = req.email.strip().lower()
    if not email or "@" not in email:
        return {"exists": False}

    service_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not service_key or not supabase_url:
        return {"exists": False}

    try:
        # TODO(2026-08-01): 只拉了第一页（per_page=1000），用户量超过1000后
        # 第1001个及以后注册的用户在这里会被误判为"未注册"。当前用户规模下
        # 不会触发，超过后需要补翻页逻辑（循环 page+1 直到返回的 users 为空）。
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
    # 2026-07-29 六步RAG流水线重构：analyze_bazi() 改为 async def（当前7路并行：
    # 十神详解+事业+婚恋+健康+大运+命柱详解+神煞详解，2026-08-11新增命柱/神煞
    # 详解两步后从5路变为7路，容量推导见文件顶部_EXECUTOR注释），调用方
    # 必须 await；见 gemini_analysis.py::analyze_bazi()
    # 顶部注释——同步直接调用会导致内部 asyncio.gather 语义失效/在某些路径下报错。
    result = await analyze_bazi(req.bazi_data, req.gender, req.birth_year, req.force_refresh)
    if result.get('error') == 'no_api_key':
        raise HTTPException(status_code=503, detail="AI analysis service not configured")
    return result


def _redact_resend_key(msg: str) -> str:
    """
    去除异常信息里可能内嵌的真实 RESEND_API_KEY，防止通过日志/响应泄漏。
    Resend鉴权走Authorization header（不像Gemini那样把key拼进URL query），
    理论上更不容易泄漏，但仍保留这层防护，与 gemini_analysis.py/tripo_client.py
    的 _redact() 同款约定一致（见已知问题日志"Key泄漏"系列条目）。
    """
    if not msg:
        return msg
    key = os.environ.get("RESEND_API_KEY", "")
    if key:
        msg = msg.replace(key, "***REDACTED***")
    return msg


# ── 端点7：水晶兑换请求通知邮件 ───────────────────────────────
# 2026-08-12 第二阶段"灵气兑换水晶"：纯转发用途的轻量端点，不写数据库——
# `redemption_requests`表才是权威数据（前端已用supabase-js直接insert过），
# 这里只负责给业务方发一封即时提醒邮件，方便尽快通过WhatsApp联系用户发货。
# 前端是fire-and-forget调用，即使这封邮件没发出去，兑换记录依然完整落库，
# 业务方仍可直接查表兜底——因此本端点任何失败都不应该抛错阻塞前端、更不
# 应该让用户看到"兑换失败"这种误导性报错，一律 print 警告后照常返回200。
@app.post("/notify-redemption")
def notify_redemption(req: NotifyRedemptionRequest):
    resend_key = os.environ.get("RESEND_API_KEY", "")
    owner_email = os.environ.get("OWNER_NOTIFY_EMAIL", "")
    if not resend_key or not owner_email:
        print("[notify-redemption] RESEND_API_KEY 或 OWNER_NOTIFY_EMAIL 未配置，跳过发信")
        return {"sent": False}

    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {resend_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": "司马八字 <onboarding@resend.dev>",
                "to": [owner_email],
                "subject": f"新的水晶兑换请求：{req.product_name}",
                "text": (
                    f"商品：{req.product_name}\n"
                    f"命盘特点：{req.trait_summary}\n"
                    f"联系电话：{req.contact_phone}\n"
                    f"用户邮箱：{req.user_email}\n\n"
                    "完整记录请前往 Supabase Studio 查看 redemption_requests 表，"
                    "并通过 WhatsApp 联系用户安排发货。"
                ),
            },
            timeout=10,
        )
        if not resp.ok:
            print(f"[notify-redemption WARNING] Resend返回非200: "
                  f"{resp.status_code} {_redact_resend_key(resp.text)[:200]}")
            return {"sent": False}
        return {"sent": True}
    except Exception as e:
        # 网络异常/超时/DNS失败等——不抛错，只警告日志，见函数顶部注释
        print(f"[notify-redemption WARNING] 发信异常（不阻塞前端）: "
              f"{_redact_resend_key(str(e))[:200]}")
        return {"sent": False}


# ── 本地运行 ─────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080, reload=True)
