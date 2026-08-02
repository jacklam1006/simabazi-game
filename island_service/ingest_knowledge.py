"""
司马八字 · 知识库注入脚本 · Ingest Knowledge Base into ChromaDB

用途：把 island_service/knowledge_base/bazi/*.md 按 `##` 二级标题切块，逐块调用
     Gemini embedding 接口计算向量，upsert 进 rag_service.py 定义的同一个
     ChromaDB collection（"bazi"），供六步命理分析流水线检索古籍/断语引用。

用法（本地手动运行一次即可，**不**接入 main.py 的服务启动流程——避免拖慢 Render
冷启动、占用请求处理时间；知识库内容不常变，没必要每次启动都重新注入一遍）：

    cd island_service
    GEMINI_API_KEY=xxx python3 ingest_knowledge.py

    # 怀疑数据已脏（例如曾经手动误操作导致重复/残留），想整体清空重建：
    GEMINI_API_KEY=xxx python3 ingest_knowledge.py --reset

2026-08-02 修复：`ingest_markdown_file()` 现在每次都会先按 `source`（文件名）
删除该文件在 collection 里已有的旧 chunk、再写入本次新解析出的 chunk，可以
放心反复重新运行本脚本（含订正过内容后重新运行）——不会造成 collection 无限
膨胀或新旧版本混杂。详见 `claude-docs/已知问题与修复记录.md` "代码质量/健壮性"
第20条。

**注意（重要局限）**：上面的 delete-by-source 只覆盖"文件名不变、内容变化"这
一种场景。如果知识库文件被**重命名**或**删除**，`ingest_all()` 只会遍历当前
目录里实际存在的文件，旧文件名对应的 chunk 不会被自动清理，会作为"孤儿 chunk"
永久残留在 collection 里并继续被检索召回（脚本运行结束时会打印孤儿 chunk 警告，
但不会自动清理）。这种情况需要执行 `--reset`（在确认 embedding 可用的前提下，
见下方 `--reset` 的前置守卫说明）整体清空重建，才能真正清除。

2026-08-02 第二次修复（返工）：`--reset` 曾经是无条件先清空整个 collection、
之后才逐文件重新计算 embedding 写回——一旦 embedding 在中途失败（例如忘记配置
`GEMINI_API_KEY`、或 API 配额耗尽），`ingest_markdown_file()`"embedding 失败时
保留旧版本更安全"这个设计初衷会被"旧版本已经在第一步被删掉了"整个架空，导致
collection 清零且无法回滚。现在 `--reset` 执行前会先做一次真实的 embedding
探测（见 `_check_embedding_available()`），确认能正常算出向量才会真的执行删除；
探测失败会直接中止，不删除任何数据。

**注意（本守卫的边界）**：`_check_embedding_available()` 只能拦住"开跑前就已经
不可用"的情况（Key 未配置/已过期/配额耗尽在探测那一刻就能测出来）。它拦不住
"探测通过、但跑到一半才失败"的情况——例如配额恰好在处理到某个文件时耗尽、或
中途出现网络异常，导致 `reset_collection()` 已经清空旧数据，但后续部分文件
embedding 持续失败、未能重新写回，造成本次 `--reset` 运行的净数据损失。这种情况
下 `ingest_all()` 结尾不会再打印成功语气的"✨完成"，而是打印醒目的
"⚠️ --reset 未完整成功"警告并列出具体哪些文件被跳过（详见 `ingest_all()` 内的
汇总逻辑）；源 Markdown 文件本身仍完整保存在 git 仓库里，重新运行一次不带
`--reset` 的普通 ingest 即可完整恢复，不是不可逆问题。

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
    """返回值语义（`ingest_all()` 依赖此约定判断 `--reset` 是否完整成功）：
    - `> 0`：成功写入的 chunk 数
    - `0`：文件本身没有解析出有效内容块（不是失败，无需写入）
    - `-1`：解析出了内容块，但 embedding 调用失败导致本次未能写入（真正的失败，
      `--reset` 模式下意味着该文件的旧版本已被清空且这次没能补回）
    """
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
        # 因此这里直接跳过写入，不做任何 upsert（也不删除该文件已有的旧chunk——
        # embedding 失败时保留旧版本总比"删掉旧的、新的又写不进去"导致该文件
        # 检索结果整体消失要安全）。
        print(f"  ⚠️  {filepath.name}: 未获取到 embedding（检查 GEMINI_API_KEY），跳过写入——"
              f"若无向量写入会触发 ChromaDB 默认ONNX模型并把 collection 锁死在错误维度")
        # 用 -1 区分"embedding 真的失败了"和上面"文件没有有效内容块"的 0——
        # `ingest_all()` 靠这个区分判断 --reset 模式下是否发生了真正的数据损失。
        return -1

    # 2026-08-02 修复"重新ingest=覆盖旧版本"这个假设不成立的问题（详见
    # claude-docs/已知问题与修复记录.md "代码质量/健壮性"第20条）：id 用随机
    # UUID 生成，每次运行都不同，upsert 因此永远匹配不到旧 id、只会不断追加，
    # 不会覆盖——重复运行 ingest 会导致 collection 无限膨胀（生产环境已实测
    # 因此事故性膨胀到 809 条，正常值应为 130 条）。
    #
    # 修复方式是"按来源先删除、再插入"：不依赖 id 是否碰巧匹配，而是先把这个
    # 文件（metadata["source"] == filepath.name，注意是带 .md 后缀的完整文件名，
    # 不是 filepath.stem——parse_markdown_chunks() 里就是这么存的）在 collection
    # 里已有的所有旧 chunk 整体删除，再插入本次重新解析出的全部 chunk。这样无论
    # 这次解析出的 chunk 数量比上次多、少、还是内容完全不同，旧版本都会被彻底
    # 清空，不会有"部分覆盖、部分残留"的情况。
    #
    # col.delete(where=...) 在没有任何记录匹配该 source（包括 collection 还是
    # 空的、这个文件是第一次 ingest 的情况）时已本地验证是安全的空操作，不会
    # 抛异常（见本次修复的验证记录）。
    col.delete(where={"source": filepath.name})
    col.upsert(documents=texts, ids=ids, metadatas=metas, embeddings=embeddings)
    print(f"  ✅ {filepath.name} → [{rag_service.COLLECTION_NAME}] {len(chunks)} 块（已清除该文件旧版本chunk再写入）")
    return len(chunks)


def _check_embedding_available() -> bool:
    """`--reset` 的前置守卫：真实调用一次 embedding 接口，确认当前环境下能正常
    算出向量，才允许 `ingest_all(reset=True)` 继续往下执行 `reset_collection()`。

    2026-08-02 返工背景：`reset_collection()` 是"先删后建"——在 `ingest_all()`
    一开始就无条件删除整个 collection，之后才逐文件重新计算 embedding 写回。
    `ingest_markdown_file()` 本身对"embedding 失败"的设计策略是"跳过写入、保留
    旧版本更安全"（见该函数内注释），但 `--reset` 会把这层保护完全架空——因为
    旧版本在第一步就已经被删掉了，之后任何一个文件 embedding 失败都会造成净
    数据损失且无法回滚。

    实际复现过的两种触发方式：
    1. 在 Render Shell 敲 `python3 ingest_knowledge.py --reset` 时漏加
       `GEMINI_API_KEY=xxx` 前缀——`rag_service.GEMINI_API_KEY` 是 import 时
       读取的环境变量，为空时 `_embed_texts()` 会立刻返回 `[]`，甚至不会真的
       发出网络请求。
    2. API Key 配额耗尽/网络异常——130 个 chunk 是 130 次独立 embedContent
       请求，跑到一半持续失败，重试放弃后半部分文件的旧版本已经在第一步被删除，
       是净损失（不带 `--reset` 时这些文件会保留旧版本，带了就是彻底丢失）。

    这里选择"真实调用一次测试文本的 embedding"而不是只检查环境变量是否非空——
    仅检查非空无法发现"Key 配置了但已过期/配额耗尽"这种同样会导致数据清零的
    情况。探测失败时不删除任何数据，直接中止整个 `--reset` 流程。
    """
    if not rag_service.GEMINI_API_KEY:
        print("❌ 拒绝 --reset：未配置 GEMINI_API_KEY（环境变量为空）。清空 collection 后将"
              "无法写回任何数据，可能导致生产知识库永久清零且无法回滚。\n"
              "   请以 `GEMINI_API_KEY=xxx python3 ingest_knowledge.py --reset` 的方式重新运行。")
        return False
    print("🔍 --reset 前置检查：正在真实调用一次 embedding 接口验证连通性...")
    test_embedding = rag_service._embed_texts(
        ["八字命理知识库 --reset 连通性探测"], task_type='RETRIEVAL_DOCUMENT'
    )
    if not test_embedding:
        print("❌ 拒绝 --reset：embedding 测试调用失败（GEMINI_API_KEY 可能已过期/配额耗尽/"
              "网络异常，详见上方 [RAG] 日志）。为避免清空 collection 后无法写回造成生产知识库"
              "永久清零，已中止，未删除任何数据。请排查 embedding 问题后重试。")
        return False
    print("✅ embedding 接口可用，继续执行 --reset。\n")
    return True


def reset_collection() -> None:
    """整个 collection 清空重建（`client.delete_collection` + 重新 `get_or_create_collection`）。

    2026-08-02 新增：此前一次生产事故（collection 因重复 ingest 膨胀到809条，
    正常应为130条）是靠用户手动在 Render Shell 敲 `client.delete_collection('bazi')`
    做的一次性应急清理，容易敲错、也没有留下操作记录。现在
    `ingest_markdown_file()` 已经改为逐文件"按来源先删后插"，正常情况下不再需要
    整体清空重建；本函数只用于"确实怀疑数据已经脏了、想要一次彻底清零重来"这种
    小概率场景（例如手动误操作、或未来排查不出来的数据不一致），通过
    `python3 ingest_knowledge.py --reset` 显式触发，而不是让操作者直连数据库敲命令。

    调用方（`ingest_all()`）必须先经过 `_check_embedding_available()` 探测通过
    才能调到本函数——本函数自身不做该项检查，避免探测逻辑散落在两处。
    """
    client = rag_service._get_client()
    try:
        client.delete_collection(rag_service.COLLECTION_NAME)
        print(f"🗑️  已删除 collection \"{rag_service.COLLECTION_NAME}\"")
    except Exception as e:
        # collection 本来就不存在（例如全新环境从未 ingest 过）时 delete_collection
        # 会报错——这属于"目标状态已经满足"，不算失败，打印后继续走 get_or_create。
        print(f"（collection 不存在或删除时出现异常，视为已是空白状态，继续：{e}）")
    # 立即重新创建，且清掉本模块进程内的缓存引用，确保后续 get_collection() 拿到的
    # 是刚重建的新 collection 对象，不是指向已被删除的旧对象。
    rag_service._collections.pop(rag_service.COLLECTION_NAME, None)
    rag_service.get_collection(rag_service.COLLECTION_NAME)
    print(f"✅ 已重新创建空 collection \"{rag_service.COLLECTION_NAME}\"，可以重新 ingest\n")


def _warn_orphan_chunks(actual_filenames: set) -> None:
    """检测 collection 里是否存在"孤儿 chunk"——`source` 元数据指向的文件已经不在
    `knowledge_base/bazi/` 目录里（被重命名或删除），但 chunk 本身仍残留在向量库
    中并会继续被检索召回。

    `ingest_all()` 的 delete-by-source 机制只在"文件名不变、重新 ingest 同一个
    文件"这种场景下生效；它不会主动清理"目录里已经没有对应文件"的旧数据，因为
    `ingest_all()` 本身只遍历当前实际存在的文件，从未见过那个已经消失的文件名。
    这里只做检测+警告，不自动清理——清理需要整体 `--reset`（并经过 embedding
    可用性前置守卫）或手动按 `source` 精确删除，本函数不代为决策。
    """
    try:
        col = rag_service.get_collection(rag_service.COLLECTION_NAME)
        all_items = col.get(include=["metadatas"])
        metas = all_items.get("metadatas") or []
        stored_sources = {m.get("source") for m in metas if m and m.get("source")}
        orphans = stored_sources - actual_filenames
        if orphans:
            print(f"⚠️  检测到 {len(orphans)} 个已不存在的来源文件残留于向量库中："
                  f"{', '.join(sorted(orphans))} —— 这些文件可能已被重命名或删除，但其旧 chunk "
                  f"仍会被检索召回。建议手动清理，或执行 `--reset` 整体清空重建"
                  f"（`--reset` 前会先做 embedding 可用性检查，探测失败不会删除任何数据）。")
    except Exception as e:
        print(f"（孤儿chunk检测跳过，出现异常：{e}）")


# ─── 主流程：扫描 knowledge_base/bazi/ 下所有 Markdown 文件 ───
def ingest_all(reset: bool = False) -> None:
    if not KNOWLEDGE_DIR.exists():
        print(f"❌ 知识库目录不存在：{KNOWLEDGE_DIR}")
        return
    if reset:
        if not _check_embedding_available():
            print("🛑 已中止：--reset 未执行，collection 保持原样，本次不会注入任何内容。")
            return
        reset_collection()
    print(f"\n📚 开始注入知识库 Markdown 文件（{KNOWLEDGE_DIR}）...\n")
    total = 0
    actual_filenames = set()
    failed_files = []
    for md_file in sorted(KNOWLEDGE_DIR.glob("*.md")):
        actual_filenames.add(md_file.name)
        result = ingest_markdown_file(md_file)
        if result < 0:
            failed_files.append(md_file.name)
        else:
            total += result

    # `--reset` 模式下，reset_collection() 已在函数开头把整个 collection 清空——
    # 如果这里有任何文件因 embedding 中途失败而没能写回，就是本次运行造成的真实
    # 数据损失，不能再用成功语气的"✨完成"收尾，否则运维人员很容易误以为一切正常。
    if reset and failed_files:
        print(f"\n⚠️  --reset 未完整成功！collection 已被清空，但以下 {len(failed_files)} "
              f"个文件因 embedding 失败未能重新写入：{', '.join(failed_files)}\n"
              f"   本次运行实际只成功写入 {total} 个知识块（collection="
              f"\"{rag_service.COLLECTION_NAME}\"），上述文件的内容目前在向量库中缺失。\n"
              f"   这不是不可逆问题——源 Markdown 文件仍完整保存在 git 仓库中，请尽快重新运行一次\n"
              f"   `python3 ingest_knowledge.py`（不带 --reset）以补齐缺失内容。\n")
    else:
        print(f"\n✨ 完成！共注入 {total} 个知识块（collection=\"{rag_service.COLLECTION_NAME}\"）\n")
    _warn_orphan_chunks(actual_filenames)


def test_query(question: str) -> None:
    print(f"\n🔍 测试查询：{question}")
    result = rag_service.query(rag_service.COLLECTION_NAME, question)
    if not result:
        print("（无结果——若刚运行过 ingest_all() 且当时无 GEMINI_API_KEY，属预期）")
    else:
        print(result[:500] + '...' if len(result) > 500 else result)


if __name__ == '__main__':
    import sys
    # `--reset`：先整体清空 collection 再重建（应急/怀疑数据已脏时使用）；
    # 默认（不带参数）：逐文件按来源先删旧chunk再插入新chunk的增量更新，
    # 正常情况（含日常古籍内容订正后重新 ingest）都应该用默认方式，不需要 --reset。
    ingest_all(reset='--reset' in sys.argv)
    test_query("甲木日主 性格特质")
    test_query("伤官 格局 用神")
