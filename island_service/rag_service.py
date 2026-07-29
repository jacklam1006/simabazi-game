"""
司马八字 · RAG 知识库检索服务（ChromaDB 本地向量库）

背景：2026-07-29 "AI深析"从单次Gemini调用重构为六步命理框架流水线（见
gemini_analysis.py），每一步在生成前会先向本模块检索相关古籍/断语原文片段，
拼进该步骤专属prompt，增强专业依据感。

设计要点（移植自已归档前代项目 simabazi-api/app/services/rag_service.py 的
已验证可行模式，不是复活那个项目——本文件是 island_service 内部的独立实现）：
- 不在模块级别导入 chromadb，延迟到首次真正调用时才 import + 初始化，
  避免服务启动瞬间就承担这个重依赖的开销
- 不使用 ChromaDB 官方 embedding_function（会触发下载约83MB的ONNX默认模型，
  拖慢 Render 冷启动）；改为手动调用 Gemini REST embedContent 接口计算 embedding，
  写法与 gemini_analysis.py 里已有的 requests.post 调 Gemini 保持一致风格
- PersistentClient 路径 ./chroma_db，与现有 ./analysis_cache 同级——服务以
  island_service 为 rootDir/cwd 启动（main.py 用 `uvicorn main:app` 且
  render.yaml rootDir=island_service），这个相对路径会落在 render.yaml 已经
  挂载给 island_service 目录的 1GB 持久盘上，不需要额外改 render.yaml
- **核心契约：query() 绝不抛异常**。RAG 只是六步生成流水线的"锦上添花"，
  任何失败（无API Key、collection为空、embedding失败、chromadb本身异常）
  都必须优雅降级返回空字符串——六步流水线在拿到空字符串时应当照常生成
  （只是该步骤少了古籍引用片段），不能因为RAG层故障拖垮整条AI深析流程

Phase A / Phase B 范围提醒（详见 claude-docs/已知问题与修复记录.md 对应记录）：
本轮上线时 knowledge_base/bazi/ 下只有 2 份人工整理的标签化摘要文件（约545行），
覆盖面有限；九本古籍原文的深度整理是 Phase B，由 knowledge-curator 子agent
负责，产出后追加进同一个 knowledge_base/bazi/ 目录、重新跑一次
ingest_knowledge.py 即可自动扩充检索覆盖面，本文件与 gemini_analysis.py
届时都不需要改动。
"""
import os
import requests

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
EMBED_MODEL = 'gemini-embedding-001'
CHROMA_DIR = './chroma_db'

# Phase A 只有一个知识库分类——不做 simabazi-api 那种 bazi/chakra/mbti/crystal
# 多集合区分，本项目没有脉轮/水晶/MBTI数据。六步流水线的六个查询函数统一查这一个集合。
COLLECTION_NAME = 'bazi'

_client = None
_collections: dict = {}


def _redact(s: str) -> str:
    """把字符串里可能出现的真实 GEMINI_API_KEY 替换掉。

    这是 gemini_analysis.py::_redact() 同款防护机制的独立副本，不是共用同一个函数
    对象——gemini_analysis.py 会导入本模块（六步流水线各步骤都要调用 query()），
    若反过来从 gemini_analysis 导入 _redact 会形成循环导入。两处实现逻辑必须保持
    一致，改动其中一处务必同步另一处（这正是已知问题日志里"哈希算法双实现耦合"
    同一类风险的又一个实例：两处独立实现同一逻辑，靠人为约定同步）。
    """
    if GEMINI_API_KEY and GEMINI_API_KEY in s:
        return s.replace(GEMINI_API_KEY, '***REDACTED***')
    return s


def _get_client():
    global _client
    if _client is None:
        import chromadb
        os.makedirs(CHROMA_DIR, exist_ok=True)
        _client = chromadb.PersistentClient(path=CHROMA_DIR)
    return _client


def get_collection(name: str = COLLECTION_NAME):
    """获取（或创建）一个 ChromaDB collection。ingest_knowledge.py 也调用本函数，
    确保读（query）写（ingest）两端用的是同一份 collection 定义（cosine 距离），
    不会出现两处各自 get_or_create_collection 导致 metadata 配置互相偏离的情况。"""
    if name not in _collections:
        client = _get_client()
        _collections[name] = client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
        )
    return _collections[name]


def _embed_texts(texts: list, task_type: str = 'RETRIEVAL_QUERY') -> list:
    """
    调用 Gemini REST embedContent 接口逐条计算 embedding。

    task_type 区分"检索查询"（RETRIEVAL_QUERY，query() 使用）与"入库文档"
    （RETRIEVAL_DOCUMENT，ingest_knowledge.py 写入知识库时使用）——这是 Gemini
    embedding API 的标准做法：两种 task_type 对应不同的训练目标，用混了会明显
    降低检索相关性（查询向量和文档向量不是同一个优化目标算出来的，即使内容语义
    相关，向量距离也可能偏大）。

    任何一条 embedding 失败都直接返回 []（不做部分成功），调用方据此判断
    "embedding 当前不可用"并整体优雅降级，不会出现"部分文本有向量、部分没有"
    导致 upsert 时 embeddings 数组与 texts 数组长度不一致的边界情况。
    """
    if not GEMINI_API_KEY:
        return []
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{EMBED_MODEL}:embedContent?key={GEMINI_API_KEY}"
    )
    embeddings = []
    for text in texts:
        try:
            resp = requests.post(
                url,
                json={
                    "model": f"models/{EMBED_MODEL}",
                    "content": {"parts": [{"text": text}]},
                    "taskType": task_type,
                },
                timeout=15,
            )
            resp.raise_for_status()
            embeddings.append(resp.json()["embedding"]["values"])
        except Exception as e:
            print(f"[RAG] embedding失败（task_type={task_type}）：{_redact(str(e))}")
            return []
    return embeddings


def query(collection_name: str, question: str, n_results: int = 3, tags: list = None) -> str:
    """
    语义检索古籍/断语知识库，返回拼接好的原文片段字符串（多个片段用 '\\n---\\n' 分隔）。

    核心契约（六步流水线依赖此保证才敢在每一步直接调用，不用各自包 try/except）：
    任何失败——无API Key、collection为空、embedding失败、chromadb本身抛异常——
    都在这里被吞掉并返回 ''，绝不向上抛异常。RAG查不到东西时，调用方应当把 ''
    当作"这一步没有古籍引用片段"照常继续生成，而不是把这当成致命错误中断整条
    AI深析流水线。

    tags（可选）：六步流水线每一步擅长的领域标签列表（如 Step2 用神判断传
    ["格局","用神"]），需要与 knowledge_base/bazi/*.md 文件头部 `## 标签:` 行里
    实际写的标签值对齐（ingest_knowledge.py 已把这行原样存进每个 chunk 的
    metadata["tags"]，是一个逗号分隔的字符串，未做归一化/大小写处理）。

    实现方式是"先语义检索候选、再按标签重合度重排"，不是 ChromaDB `where` 精确
    过滤——精确过滤在候选文档很少、标签体系还在 Phase A 早期阶段（只有2份文件、
    标签取值不统一）时容易把结果过滤到空，重合度加权排序更稳妥：语义相关性还是
    主排序依据，标签只用来在同样相关的候选里把命中当前步骤领域的片段往前提。
    """
    try:
        col = get_collection(collection_name)
        if col.count() == 0:
            # 静默返回空字符串本身是设计好的优雅降级（见上方核心契约），但"静默"不等于
            # "无日志"——Phase A 上线时 ingest_knowledge.py 是手动本地脚本，生产环境
            # Render 磁盘上很可能从未真正跑过它，这会导致六步流水线的 RAG 查询一直
            # 返回空、prompt 里完全没有古籍引用，却没有任何信号能让人发现。加这行日志
            # 方便直接去 Render 日志里搜"RAG"确认知识库是否真的注入生效。
            print(f"[RAG] collection \"{collection_name}\" 为空（count=0），本次检索降级为空——"
                  f"请确认是否已运行过 ingest_knowledge.py 注入知识库")
            return ""
        q_emb = _embed_texts([question], task_type='RETRIEVAL_QUERY')
        if not q_emb:
            return ""

        if tags:
            # 过取一批候选（语义检索排序范围放宽到 n_results 的若干倍，但不超过
            # collection 实际大小），再按 tags 重合度做后置重排，取回前 n_results 个。
            fetch_n = min(col.count(), max(n_results * 4, 10))
            results = col.query(query_embeddings=q_emb, n_results=fetch_n)
            docs = (results.get("documents") or [[]])[0]
            metas = (results.get("metadatas") or [[]])[0]
            if not docs:
                return ""
            wanted = {t.strip() for t in tags if t and t.strip()}
            scored = []
            for rank, (doc, meta) in enumerate(zip(docs, metas)):
                doc_tags = {t.strip() for t in (meta or {}).get("tags", "").split(",") if t.strip()}
                overlap = len(wanted & doc_tags)
                # 语义rank是主排序依据（每差1名代价1分），标签命中只给有限加分（每个
                # 标签2分）——命中再多标签也不能盖过明显更相关的语义排名靠前结果，
                # 只在语义相近的候选之间起"优先"作用，符合上面docstring描述的设计。
                scored.append((rank - overlap * 2, rank, doc))
            scored.sort()
            top_docs = [doc for _, _, doc in scored[:n_results]]
            return "\n---\n".join(top_docs) if top_docs else ""

        results = col.query(query_embeddings=q_emb, n_results=n_results)
        docs = (results.get("documents") or [[]])[0]
        return "\n---\n".join(docs) if docs else ""
    except Exception as e:
        print(f"[RAG] 检索失败：{_redact(str(e))}")
        return ""
