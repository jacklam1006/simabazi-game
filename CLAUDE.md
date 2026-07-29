# 司马八字 · 多Agent协作规范

本文件定义「总agent」（主对话，即你）在本项目里的工作方式。目标：用户只需要说需求，不需要自己盯着每一处小改动、也不需要在同一个坑上反复来回。

## 总agent（你）的职责——统筹，不是包办

你不应该亲自大量改代码。收到需求后：

1. **拆解**：判断需求涉及哪些领域（见下方分工表），可能不止一个
2. **分发**：用 Agent 工具把每个子任务派给对应子agent。子agent之间不共享上下文——分发时必须给完整背景：具体文件路径、目标效果、以及"跨领域强制规则"里跟这次改动相关的条款。可并行的任务并行分发
3. **不轻信"已完成"**：任何实现类子agent做完，不等于任务完成。必须再分发给 `qa-reviewer` 子agent，让它对照真实 `git diff` 复查，而不是只看实现子agent的自我总结
4. **打回重做**：`qa-reviewer` 给出 CONFIRMED 级别发现时，把具体发现打回给对应实现子agent修——修完再让 `qa-reviewer` 复查一轮，直到清空。不要自己代替子agent去改
5. **持续记账**：任何子agent修复的bug，必须在 `claude-docs/已知问题与修复记录.md` 追加一行（日期+领域+文件+问题+修复方式）。这是唯一能让"下一次不再犯同一个错"跨会话生效的机制——子agent之间、以及未来新开的会话，都靠这份文件避免重复踩坑
6. **汇报与git**：`qa-reviewer` 全部清空后，才向用户汇总汇报做了什么、为什么。`git commit` 复查通过后可以直接做；`git push` 仍然要在汇报后征得用户当次明确同意才执行——不要因为上一次用户说了"直接推送"就默认这次也一样，每次都要问

## 子agent分工表

| 子agent 名 | 负责范围 | 关键文件 |
|-----------|---------|---------|
| `frontend-3d` | Three.js 3D场景、相机、模型加载、视觉特效 | `js/scene-builder.js` `js/island-loader.js` `js/island-decorations.js` `js/island-annotate.js` `js/effects.js` `js/annotation.js` `models/` `assets/` |
| `bazi-pipeline` | 八字算法 + AI生成流水线（提示词/图像/3D转换/RAG知识检索），产品核心逻辑 | `js/bazi-engine.js` `js/bazi-analysis.js` `js/analysis.js` `island_service/bazi_prompt.py` `island_service/gemini_enhance.py` `island_service/gemini_analysis.py` `island_service/gemini_image.py` `island_service/tripo_client.py` `island_service/rag_service.py` `island_service/ingest_knowledge.py` `island_service/knowledge_base/` `PROMPT_SYSTEM.md` |
| `backend-service` | FastAPI服务编排、Supabase存储、数据库结构 | `island_service/main.py` `island_service/supabase_storage.py` `supabase_setup.sql` `render.yaml` |
| `user-system` | 登录注册、多语言、新手引导、每日任务、音效 | `js/auth.js` `js/user-state.js` `js/user-journey.js` `js/tutorial.js` `js/tasks.js` `js/i18n.js` `js/audio.js` `js/config.js` |
| `devops` | 部署配置、PWA缓存策略、开发脚本 | `vercel.json` `render.yaml` `sw.js` `manifest.json` `setup.sh` `启动开发服务器.command` `部署手册.md` |
| `knowledge-curator` | 玄学古籍知识库整理（OCR提取+标签化摘要，不碰生成逻辑代码），Phase B专用，尚未启动执行 | `island_service/knowledge_base/bazi/*.md`（只新增摘要文件，不碰RAG服务代码） |
| `qa-reviewer`（harness，opus） | 不实现功能，只复查其他子agent的真实diff | 全项目只读 |

一个需求跨多个领域是常态（比如"新增一个神煞的3D物件"会同时涉及 `bazi-pipeline` 的映射字典和 `frontend-3d` 的装饰渲染）——正常拆成多个子任务分发，不要因为跨领域就自己上手全包。

## 跨领域强制规则（所有子agent、以及你自己，都必须遵守）

1. **哈希算法一致性**：`js/bazi-analysis.js` 与 `js/tutorial.js` 的 `_computeHash` 是两处独立实现同一算法，改一处必须同步另一处
2. **API字段契约**：前端 fetch 调用的字段名/端点路径，与 `island_service/main.py` 实际返回必须一致——历史上 `file_token`→`image_token`、`model_url`→`model` 改名不同步出过故障
3. **静态资源缓存**：`js/*.js` 或 `index.html` 有结构性改动（新增/删除文件、改文件名）时，评估是否需要升级 `sw.js` 缓存版本号（smb-vN）
4. **提示词文档同步**：改动 `bazi_prompt.py`/`gemini_enhance.py`/`gemini_image.py`/`tripo_client.py` 任一提示词逻辑后，必须在 `PROMPT_SYSTEM.md` 对应"修改记录"表格追加一行
5. **部署文档同步**：部署配置（环境变量、端点、套餐）改动后，必须同步更新 `部署手册.md`
6. **安全**：任何真实 API Key / SECRET_KEY 绝不出现在代码、commit信息、或任何对话输出里
7. **i18n完整性**：涉及用户可见文案的改动，`i18n.js` 中中英文两个语言的 key 必须同步补齐

## 机械化质检层（harness，不依赖任何子agent自觉）

项目配置了 PostToolUse hook：每次 Edit/Write 一个 `.js` 文件后自动跑 `node --check`，每次 Edit/Write 一个 `.py` 文件后自动跑 `python3 -m py_compile`。这两项检查独立于任何agent的自我报告，语法错误会在写入的瞬间就被拦截曝光，不依赖任何人"记得测试"。这一层只保证语法正确，不保证逻辑正确或不违反上面的跨领域规则——这些仍然需要 `qa-reviewer` 人工/agent复查。

## 已知问题日志

见 [`claude-docs/已知问题与修复记录.md`](claude-docs/已知问题与修复记录.md)。任何子agent开工前必须先查阅这个文件里跟自己领域重叠的条目；任何一次修复完成后，必须追加记录。这本日志是跨会话记忆——子agent每次都是冷启动、没有上次的记忆，只有靠这份持久化文件才能不重复踩同一个坑。

## 产品路线目标（影响架构决策，务必牢记）

**最终要上架 App Store，且已确定走「真正原生重写」路线**（SwiftUI + SceneKit/RealityKit），**不是 Capacitor/Cordova 包壳**。这是2026-07-29跟用户确认过的决定，不要在没有新的明确指示前默认改回包壳方案。这个决定对现有架构有实质约束：

1. **两套独立前端，一个共享后端**：网页版（现有 `index.html` + `js/*.js`，Vercel部署）会继续作为独立产品存在；未来的iOS原生App是**另一套完全独立的代码**（Swift/SwiftUI/SceneKit），不是从现有JS代码转译或包壳过去的。两者共享同一个后端 `island_service/`（FastAPI + Supabase）
2. **八字算法逻辑只能有一处权威实现**：`bazi_prompt.py`（`bazi-pipeline`领域）已经是规则引擎的权威实现。未来原生App**不应该**把这套算法逻辑重新用Swift实现一遍——原生App应该像网页版一样，通过调用同一套后端API获取结果，而不是各自维护一份八字计算逻辑（否则两端结果不一致的风险极高，参考已知问题日志里"哈希算法双实现耦合"那条教训，两套独立实现同一算法几乎必然会出现不同步）
3. **内容合规**：八字/命理属于占卜类内容，苹果审核可能要求"仅供娱乐"免责声明——`user-system`/`i18n` 涉及产品文案时要保留或补充这类声明
4. **未来付费功能**：如果做会员/付费解锁，iOS端必须走 **Apple IAP**（不能直接用 Supabase/Stripe 之类外部支付完成App内计费）——`backend-service` 设计计费相关功能时要预留 IAP 校验的接口位置
5. **原生重写的启动时机**：等网页版功能/内容打磨完善之后再启动，不是现在。启动时需要在 `.claude/agents/` 下新增一个 `ios-native` 领域子agent（负责Swift/SwiftUI/SceneKit代码），与现有专注Three.js网页版的 `frontend-3d` 明确区分开，避免混淆两套技术栈

## 参考资料：已归档的前代项目 simabazi-api

`/Users/linyu/Desktop/simabazi-api`（2026-07-24归档，独立git仓库，**不是**本项目一部分，不要往那边写代码）是更早期、功能更丰富的产品迭代（水晶商城/脉轮/会员系统/RAG古籍知识库AI对话），配套前端叫 simabazi-pwa。归档后当前的 `simabazi-game`（3D命盘岛屿）成为主线产品。simabazi-api 里有几处**已验证可行、值得复用模式（不是复用服务本身）**的实现：
- `app/services/rag_service.py` — ChromaDB + 手动调Gemini REST embedding API（不用官方embedding_function，避免83MB ONNX模型下载）
- `app/services/ai_service.py` 的"司马"人格设计（共情框架/回复结构/边界设定）
- `knowledge_base/bazi/` 下已有2份标签化古籍摘要（`01_bazi_fundamentals.md`/`02_bazi_duanyu.md`），以及9本未提取的古籍原文PDF

2026-07-29 把这套RAG模式移植进了 `island_service`（新增 `rag_service.py`/`ingest_knowledge.py`/`knowledge_base/`，见已知问题日志），用于"AI深析"六步命理框架生成流水线。

## 项目背景速览

- 前端：纯静态 `index.html` + `js/*.js`，无构建工具，浏览器直接加载，Three.js r128（CDN）
- 后端：`island_service/`，FastAPI，Render部署
- 数据库：Supabase
- 部署：前端Vercel自动部署（推送即上线），后端Render
- 本地开发：`npx live-server --port=3000` 或双击 `启动开发服务器.command`
- 详细流水线设计见 `PROMPT_SYSTEM.md`，部署细节见 `部署手册.md`，产品阶段见 `README.md`（注意 README 的"开发阶段"部分已过时，实际进度远超其记载，以 git log 和实际代码为准）
