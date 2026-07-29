"""
司马八字 · 知识库注入脚本 · Ingest Knowledge Base into ChromaDB

用途：把 island_service/knowledge_base/bazi/*.md 按 `##` 二级标题切块，逐块调用
     Gemini embedding 接口计算向量，upsert 进 rag_service.py 定义的同一个
     ChromaDB collection（"bazi"），供六步命理分析流水线检索古籍/断语引用。

用法（本地手动运行一次即可，**不**接入 main.py 的服务启动流程——避免拖慢 Render
冷启动、占用请求处理时间；知识库内容不常变，没必要每次启动都重新注入一遍）：

    cd island_service
    GEMINI_API_KEY=xxx python3 ingest_knowledge.py

Phase A / Phase B 范围提醒：本轮（2026-07-29）knowledge_base/bazi/ 下只有两份
现成的标签化摘要（01_bazi_fundamentals.md、02_bazi_duanyu.md）。九本古籍原文的
深度知识整理是 Phase B，由 knowledge-curator 子agent负责产出同样格式的
03_xxx.md/04_xxx.md……本脚本对新增文件无需任何改动，直接重新运行一遍即可把
新内容也注入进同一个 collection。
"""
import re
import time
import uuid
from pathlib import Path
from typing import List, Tuple

import rag_service

BASE_DIR = Path(__file__).parent
KNOWLEDGE_DIR = BASE_DIR / "knowledge_base" / "bazi"


# ─── Markdown 解析与分块 ──────────────────────────────────
def parse_markdown_chunks(text: str, source: str) -> List[Tuple[str, dict]]:
    """
    按 H2（`##`）标题将 Markdown 切分成独立的检索 chunk。

    每个 chunk 带上文件级元数据：
    - `## 标签:` 行 → tags（供未来"标签加权检索"用，本轮只存进 metadata，
      不实现真正的加权/过滤逻辑）
    - `## 来源:` 行 → source_book
    以及块级信息：所在文件名（source）、文档主标题（doc_title，取 `# ` 一级标题）、
    小节标题（section）。

    返回: [(chunk_text, metadata_dict), ...]
    """
    tags = ""
    source_line = ""
    for line in text.split("\n")[:5]:
        if line.startswith("## 标签:"):
            tags = line.replace("## 标签:", "").strip()
        elif line.startswith("## 来源:"):
            source_line = line.replace("## 来源:", "").strip()

    h1_match = re.search(r'^# (.+)', text, re.MULTILINE)
    doc_title = h1_match.group(1) if h1_match else source

    sections = re.split(r'\n## ', text)
    chunks = []
    for section in sections:
        stripped = section.strip()
        # 跳过文件头部的 "标签:"/"来源:" 元数据行本身（它们在切分时可能单独成块）
        if stripped.startswith("标签:") or stripped.startswith("来源:"):
            continue
        if len(stripped) < 50:
            continue

        lines = stripped.split("\n")
        section_title = lines[0].strip().lstrip("#").strip()
        chunk = f"【{doc_title}】{section_title}\n\n{stripped}"

        meta = {
            "source": source,
            "doc_title": doc_title,
            "section": section_title,
            "tags": tags,
            "source_book": source_line,
        }
        chunks.append((chunk, meta))
    return chunks


# ─── Embedding（带重试，复用 rag_service 的实现避免重复造轮子）──
def _embed_with_retry(texts: List[str], max_retries: int = 3) -> list:
    """
    对 rag_service._embed_texts（task_type=RETRIEVAL_DOCUMENT）包一层重试。
    入库是一次性手动运行的脚本，遇到 429/503 等瞬时错误时多等几十秒重试，
    远比让整批 upsert 因为一条文本失败而全部落空划算——这与查询场景（query()
    必须快速优雅降级返回''）的取舍是不同的，所以重试逻辑放在本脚本里而不是
    rag_service.py 的通用路径上。
    """
    for attempt in range(max_retries):
        embeddings = rag_service._embed_texts(texts, task_type='RETRIEVAL_DOCUMENT')
        if embeddings:
            return embeddings
        if attempt < max_retries - 1:
            wait = 10 * (attempt + 1)  # 10s, 20s
            print(f"  ⚠️  embedding 失败，{wait}秒后重试（{attempt + 1}/{max_retries}）...")
            time.sleep(wait)
    return []


# ─── 注入单个 Markdown 文件 ───────────────────────────────
def ingest_markdown_file(filepath: Path) -> int:
    text = filepath.read_text(encoding='utf-8')
    chunks = parse_markdown_chunks(text, str(filepath.name))
    if not chunks:
        print(f"  ⚠️  {filepath.name}: 未找到有效内容块")
        return 0

    texts, ids, metas = [], [], []
    for chunk_text, meta in chunks:
        uid = f"{filepath.stem}_{uuid.uuid4().hex[:8]}"
        texts.append(chunk_text)
        ids.append(uid)
        metas.append(meta)

    col = rag_service.get_collection(rag_service.COLLECTION_NAME)
    embeddings = _embed_with_retry(texts)
    if not embeddings:
        # 无可用 embedding（例如本地没配 GEMINI_API_KEY）时绝不能退回到
        # `col.upsert(documents=..., ids=..., metadatas=...)` 不传 embeddings 的写法——
        # ChromaDB 在这种调用下不会真的"不存向量"，而是用 collection 自带的
        # embedding function 当场计算向量；get_collection() 创建 collection 时没有
        # 指定 embedding_function，会自动退回默认的 384 维 ONNX 模型（这正是本项目从
        # 一开始就要绕开的 83MB 下载）。一旦这个分支被触发过一次，collection 会被
        # 锁死在 384 维，之后任何正确的 3072 维 gemini-embedding-001 向量写入都会
        # 因为维度不匹配报错，query() 也会失败，只能手动删掉整个
        # persistent_data/chroma_db/ 目录重来。
        # 因此这里直接跳过写入，不做任何 upsert。
        print(f"  ⚠️  {filepath.name}: 未获取到 embedding（检查 GEMINI_API_KEY），跳过写入——"
              f"若无向量写入会触发 ChromaDB 默认ONNX模型并把 collection 锁死在错误维度")
        return 0

    col.upsert(documents=texts, ids=ids, metadatas=metas, embeddings=embeddings)
    print(f"  ✅ {filepath.name} → [{rag_service.COLLECTION_NAME}] {len(chunks)} 块")
    return len(chunks)


# ─── 主流程：扫描 knowledge_base/bazi/ 下所有 Markdown 文件 ───
def ingest_all() -> None:
    if not KNOWLEDGE_DIR.exists():
        print(f"❌ 知识库目录不存在：{KNOWLEDGE_DIR}")
        return
    print(f"\n📚 开始注入知识库 Markdown 文件（{KNOWLEDGE_DIR}）...\n")
    total = 0
    for md_file in sorted(KNOWLEDGE_DIR.glob("*.md")):
        total += ingest_markdown_file(md_file)
    print(f"\n✨ 完成！共注入 {total} 个知识块（collection=\"{rag_service.COLLECTION_NAME}\"）\n")


def test_query(question: str) -> None:
    print(f"\n🔍 测试查询：{question}")
    result = rag_service.query(rag_service.COLLECTION_NAME, question)
    if not result:
        print("（无结果——若刚运行过 ingest_all() 且当时无 GEMINI_API_KEY，属预期）")
    else:
        print(result[:500] + '...' if len(result) > 500 else result)


if __name__ == '__main__':
    ingest_all()
    test_query("甲木日主 性格特质")
    test_query("伤官 格局 用神")
