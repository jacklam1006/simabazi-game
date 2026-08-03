# 司马八字 · AI 提示词系统库
> 版本：v1.1 | 最后更新：2026-07-29（AI深析改为六步RAG流水线）  
> 维护原则：每次修改提示词后，在对应章节末尾记录"修改日期 + 修改内容 + 效果反馈"

---

## 一、整体 AI 流水线概览

```
用户输入生辰八字
    ↓
[步骤 1] 规则引擎（bazi_prompt.py）
    八字数据 → 结构化英文描述
    纯代码逻辑，无AI调用，速度极快
    ↓
[步骤 2] Gemini 深度分析提示词增强（gemini_enhance.py，模型链见文件内 ENHANCE_MODEL_CHAIN）
    结构化描述 → 意境丰富的3D提示词
    AI理解八字命局，优化视觉层次感
    ↓
[步骤 3] Nano Banana Pro 图像生成（gemini_image.py）
    优化后的提示词 → 高保真2D命盘岛屿图
    Google最强图像生成模型，最高4K质量
    ↓
[步骤 4] TripoAI 3D转换（tripo_client.py）
    2D图像 → GLB 3D模型文件
    TripoAI image-to-3D（主路径）
    TripoAI text-to-3D（自动兜底）
    ↓
用户看到自己的3D命盘岛屿

[并行分支] Gemini AI 命盘深度解读（gemini_analysis.py，模型链见文件内 ANALYSIS_MODEL_CHAIN）
    八字数据 → 六步命理框架JSON（命局扫描→格局用神→事业财富→婚恋→健康→大运流年）
    每一步先经 rag_service.py 向量检索古籍/断语知识库，拿到原文片段拼进该步骤专属prompt
    （检索失败/查不到内容时优雅降级为空字符串，不影响该步骤照常生成）
    Step1→Step2 严格串行（Step2依赖Step1输出），Step3-6 用 asyncio.gather 并行发起
    独立于图像流水线，供前端"AI深析"标签页展示，详见下方"六、"章节
```

---

## 二、步骤1：规则引擎 — bazi_prompt.py

### 设计原则
- **确定性**：相同八字 → 相同基础描述，保证可重复性
- **专业性**：严格按传统玄学逻辑映射（日主→核心形态，五行→地貌，神煞→具体物件）
- **可扩展**：所有映射以字典形式存储，人工可直接编辑

### 2.1 日主天干 → 岛屿核心形态（DAY_MASTER_CORE）

| 日主 | 五行属性 | 岛屿核心 | 设计逻辑 |
|------|---------|---------|---------|
| 甲 | 阳木 | 参天古松，盘根错节 | 甲木刚直，主大树 |
| 乙 | 阴木 | 垂柳藤蔓，繁花点缀 | 乙木柔韧，主花草 |
| 丙 | 阳火 | 活火山，熔岩流淌 | 丙火炎上，主太阳与火山 |
| 丁 | 阴火 | 灯笼石柱，永恒焰台 | 丁火文明，主烛火 |
| 戊 | 阳土 | 巍峨山峰，层叠岩台 | 戊土厚重，主高山 |
| 己 | 阴土 | 肥沃梯田，农耕园圃 | 己土滋润，主平原 |
| 庚 | 阳金 | 金属刃阵，钢铁尖柱 | 庚金锋利，主刀剑 |
| 辛 | 阴金 | 水晶宝石，珍珠光华 | 辛金细腻，主珠宝 |
| 壬 | 阳水 | 壮阔瀑布，深邃碧潭 | 壬水奔腾，主江河 |
| 癸 | 阴水 | 雨雾莲池，青苔滴露 | 癸水涓涓，主甘霖 |

**如何优化**：在 `DAY_MASTER_CORE` 字典中修改对应天干的 `core`/`terrain`/`atmosphere`/`color` 四个字段。

---

### 2.2 五行强弱 → 地貌元素（WUXING_VISUAL）

五行占比决定视觉密度，分四档：

| 档位 | 占比阈值 | 视觉表现 |
|------|---------|---------|
| strong（旺） | ≥35% | 元素遍布全岛，大量、壮观 |
| medium（中） | 20-35% | 几处明显元素 |
| weak（弱） | 6-20% | 少量、零星 |
| absent（无） | <6% | 完全不出现该元素 |

**如何优化**：在 `WUXING_VISUAL` 字典中，按 `木/火/土/金/水` 分别调整各档描述。

---

### 2.3 纳音 → 地貌材质（NAYIN_MODIFIER）

取日柱和时柱的纳音，叠加到地貌上（最多2个）。目前共收录31个纳音词。

**如何优化**：在 `NAYIN_MODIFIER` 字典中修改纳音对应的英文视觉描述。

---

### 2.4 神煞 → 具体3D物件（SHENSHA_VISUAL）

每个神煞对应岛屿上的一个具体3D摆件，最多取前8个神煞。目前收录26个神煞。

**常见高吉神煞**：天乙贵人（有靠山）、文昌（学业）、禄神（财富）、将星（领导力）  
**常见凶煞**：亡神（破败）、羊刃（锋芒）、劫煞（险阻）

**如何优化**：在 `SHENSHA_VISUAL` 字典中修改神煞对应的3D物件描述。

---

### 2.5 空亡 → 废墟残缺区域

空亡地支对应岛屿某个角落的废墟/虚无区域，给用户以视觉提示。

**如何优化**：在 `main.py` 中找到 `void_note` 字符串，修改描述文字。

---

## 三、步骤2：Gemini 提示词增强系统提示词 — gemini_enhance.py

### 模型信息（2026-07-29 更新，第三轮修复，见下方修改记录）
- **模型链（当前）**：`ENHANCE_MODEL_CHAIN`，依次尝试 `GEMINI_ENHANCE_MODEL`环境变量（若设置）→ `gemini-flash-latest`（Google官方稳定别名，现指向Gemini 3.x系列）→ `gemini-3.6-flash`（显式版本号兜底）。`gemini-2.5-flash`/`gemini-2.0-flash`已被Google下线，不再作为候选
- 不再硬编码单一模型名 `gemini-3.5-flash`（该ID未经确认存在，历史上曾导致本模块一直静默回退到原始提示词而无人察觉）
- 任一模型HTTP失败/candidates为空/文本过短，自动尝试下一个候选；全部失败才静默回退到 `raw_prompt`，不影响主流程
- **二次修复（2026-07-29）**：首版模型链只有 `gemini-flash-latest`/`gemini-2.5-flash` 两个候选，两者都是"思考型"模型
  （会把推理过程计入 `maxOutputTokens`），一旦复现 `gemini_analysis.py` 同款"HTTP 200但candidate文本为空"症状会
  一路失败到底、静默回退到 `raw_prompt`，等于修复未生效。补上非思考模型 `gemini-2.0-flash` 作为最终回退；
  同时给思考型模型的 `generationConfig` 加上 `thinkingConfig: {thinkingBudget: 0}`（关闭思考token消耗，`gemini-2.0-flash`
  不支持该参数故不附加，否则会被API拒绝）；异常日志统一脱敏，`requests` 网络层异常字符串中可能嵌入的
  `?key=真实KEY` 一律替换为 `***REDACTED***` 后才打印

### 当前系统提示词（完整版）

```
You are a master of Chinese BaZi (八字) metaphysics and a professional 3D concept artist 
specializing in fantasy game environments.

Your task: Refine the following floating island description to maximize visual quality 
when processed by Nano Banana Pro (Google's premium image generation model).

Strict rules:
1. Preserve ALL specific objects, materials, colors, and named elements already listed
2. Strengthen 3D depth composition: clear foreground focal point → rich midground detail → atmospheric background
3. Add 1-2 sentences of poetic atmosphere that capture the destiny essence of this BaZi chart
4. Enhance light and shadow contrast for better 3D conversion (strong rim lighting, dramatic shadows)
5. Keep the style: low-poly stylized game art, floating island, dark starry cosmos background
6. Do NOT add photorealism, do NOT remove Chinese mythology elements
7. Output ONLY the refined prompt text, no explanations, no Chinese characters, no markdown
```

### 调参说明

| 参数 | 当前值 | 作用 | 调整建议 |
|------|--------|------|---------|
| `temperature` | 0.65 | 创意随机性 | 提高→更有创意；降低→更忠实原稿 |
| `maxOutputTokens` | 900 | 输出长度 | 增大→描述更细节；减小→更精炼 |
| `topP` | 0.9 | 词汇多样性 | 一般不需要改 |

### 优化方向
- 想要岛屿**更有神话感**：在规则1后加 "Emphasize mythological storytelling"
- 想要**更强的低多边形风格**：在规则5后加 "Strong emphasis on flat faceted surfaces, visible polygon edges"
- 想要**更明亮的配色**：在规则4后加 "Use vibrant saturated colors, avoid dark muddy tones"

### 修改记录
| 日期 | 修改内容 | 效果 |
|------|---------|------|
| 2026-07-26 | 初始版本上线 | 待测试 |
| 2026-07-29 | `ENHANCE_MODEL_CHAIN` 补上 `gemini-2.0-flash` 最终回退（原链只有两个思考型模型）；`generationConfig` 按模型区分附加 `thinkingConfig.thinkingBudget=0`（`gemini-2.0-flash`不附加，避免400）；网络异常日志脱敏，`requests`异常字符串里的 `?key=真实KEY` 统一替换为 `***REDACTED***` 后才打印 | 待测试（本地无真实 `GEMINI_API_KEY` 无法端到端验证；已用mock覆盖模型链回退顺序/thinkingConfig按模型区分/异常日志脱敏三类控制流路径，见 `claude-docs/已知问题与修复记录.md` 2026-07-29条目） |
| 2026-07-29（第三轮修复） | 总agent对生产 `/analyze-bazi` 实测拿到确凿报错：`gemini-2.5-flash`/`gemini-2.0-flash` 已被Google正式下线（HTTP 404 NOT_FOUND），`gemini-flash-latest` 现指向 Gemini 3.x 系列（含 `gemini-3.6-flash`），而 3.x 系列已把数值型 `thinkingConfig.thinkingBudget` 换成字符串枚举 `thinkingConfig.thinkingLevel`（minimal/low/medium/high），旧格式导致 `gemini-flash-latest` 返回 HTTP 400 INVALID_ARGUMENT。修复：`ENHANCE_MODEL_CHAIN` 移除已下线的 `gemini-2.5-flash`/`gemini-2.0-flash`，改为 `gemini-flash-latest` → `gemini-3.6-flash`；`generationConfig` 改用 `thinkingConfig: {thinkingLevel: "minimal"}`；`_NON_THINKING_MODELS` 例外名单保留机制但清空（链中模型均为3.x，默认都支持thinkingConfig） | 待测试（总agent将直接对生产端点发起真实请求验证，本轮未做本地mock测试） |

---

## 四、步骤3：Nano Banana Pro 图像生成 — gemini_image.py

### 模型信息
- **模型ID**：`gemini-3-pro-image`（环境变量 `GEMINI_IMAGE_MODEL` 控制）
- **能力**：最高4K分辨率，studio级别图像质量，精准理解复杂场景描述
- **成本**：约 $0.13-0.24 / 张

### 图像增强提示词（附加在提示词末尾）

```
ADDITIONAL STYLE NOTES FOR 3D CONVERSION:
- Clear distinct shapes with strong silhouettes
- Clean separation between foreground and background
- No text or labels overlaid on image
- Single centered island composition
- Dark starry background (important for 3D extraction)
- High contrast between island and background
```

### 如何优化图像质量
- **提高轮廓清晰度**（利于TripoAI转3D）：加入 "strong outline, clear edge definition"
- **增加材质细节**：加入 "detailed surface textures, PBR-ready materials"
- **调整构图**：修改 "Single centered island composition" 为具体的视角描述

### 修改记录
| 日期 | 修改内容 | 效果 |
|------|---------|------|
| 2026-07-26 | 从 gemini-2.0-flash 升级到 Nano Banana Pro | 待测试 |
| 2026-07-29 | **修复"图生3D主路径静默失败"故障**：`generationConfig.responseModalities` 从 `["IMAGE"]` 改为 `["TEXT", "IMAGE"]`；新增 `generationConfig.imageConfig: {aspectRatio: "1:1", imageSize: "4K"}`；新增 `_redact()` 防止网络层异常泄漏真实API Key。根因：生产环境4次真实实测均在提交后极短时间内跳过图生3D、直接进入文生3D兜底，`main.py` 的 try/except 把这个失败完全静默掉，用户和开发者都看不到报错。经查 `ai.google.dev/api/generate-content` 官方REST参考，`GenerationConfig.responseModalities` 语义是"与响应模态精确匹配"——"If the requested modalities do not match any of the supported combinations, an error will be returned"；`gemini-3-pro-image` 实际支持的组合是 TEXT+IMAGE，不支持单独 IMAGE-only，旧代码只传 `["IMAGE"]` 会被判定为不支持的组合，Gemini 立即返回400，与生产实测"极快失败"的现象完全吻合。交叉核对 `ai.google.dev/gemini-api/docs/image-generation` 2026-05-22至07-07的多个历史归档快照，`gemini-3-pro-image-preview`/`gemini-3.1-flash-image-preview` 的全部官方示例（Python/JS/Go/Java/REST curl）无一例外都设置 `responseModalities: ["TEXT","IMAGE"]`。已排除"需要迁移到新版Interactions API"的猜测——2026-07-21更新的官方文档明确写道"the original generateContent API remains fully supported"，本次改动范围仅限修正被遗漏的必需字段+补充可选的 `imageConfig`（对齐本文件"4K"设计目标，不设置时模型默认仅出1K）+ 安全补丁，未改动端点/认证方式/响应解析结构（`candidates[0].content.parts[].inlineData.data` 官方格式与改动前代码本就一致，未变）。响应解析新增遍历所有parts查找`inlineData`（原代码假设第一个part即图像，但改为TEXT+IMAGE后响应可能先出现文本part）。本地无真实`GEMINI_API_KEY`，用mock覆盖测试了payload结构/混合文本+图像part解析/400错误打码/网络异常打码/无图像数据兜底5个场景全部通过，但**未做真实API端到端调用验证**，需部署后对生产环境实测确认 |
| 2026-08-01 | **审查已知问题日志第12条"4K出图从未压力测试过TripoAI上传限制"这一风险点**（不是修bug，是防御性加固）：查证官方文档确认 `imageSize:"4K"` 对1:1宽高比实际产出 4096x4096 PNG（`ai.google.dev/gemini-api/docs/image-generation` 归档快照明确写着4K分辨率对应4096x4096），属于较大文件但未找到TripoAI官方文档/开源SDK对上传大小的明确上限说明。新增：图像生成成功后打印实际字节数/MB（`print(f"[Gemini Image] 生成图像 ... bytes（约 ... MB）")`），用于在生产环境积累"4K PNG真实体量"的第一手数据，回应这条风险点自身提出的"从未实测过"问题 | 待生产环境实测确认真实4K图片字节数量级（本地无真实`GEMINI_API_KEY`无法端到端验证），配合`tripo_client.py`同批次的上传前日志一起在Render日志里对照排查 |

---

## 五、步骤4：TripoAI 3D转换 — tripo_client.py

### 模型信息
- **模型ID**：`P1-20260311`（TripoAI当前最新模型）
- **主路径**：image-to-3D（Gemini图像 → 3D）
- **兜底路径**：text-to-3D（直接用提示词 → 3D，Gemini失败时自动切换）
- **超时设置**：150秒（约2.5分钟）

### API端点（2026-07-29 修正，见下方修改记录）
- **BASE_URL**：`https://api.tripo3d.ai/v2/openapi`（此前误用 `https://openapi.tripo3d.ai/v3`，
  那个host是TripoAI给"segment v2"网格分割功能开的窄通道，跟图生3D/文生3D完全无关）
- **上传图片**：`POST {BASE_URL}/upload`（multipart，字段名`file`）→ `data.data.image_token`
- **建任务**（图生3D/文生3D共用）：`POST {BASE_URL}/task`，body含 `type`
  （`image_to_model`/`text_to_model`）+ `model_version`（字段名是 `model_version`，不是 `model`）
  + 图生3D的 `file:{type,file_token}` 或文生3D的 `prompt` → `data.data.task_id`
- **查任务**：`GET {BASE_URL}/task/{task_id}`（单数task）→ `data.data`，其中
  `output.model` 是GLB下载链接（不是 `output.model_url`）、失败原因在 `error_msg`（不是 `message`）
- 依据：TripoAI官方开源Python SDK（`github.com/VAST-AI-Research/tripo-python-sdk`，
  `tripo3d/client.py` + `tripo3d/client_impl/legacy_client_impl.py` + `tripo3d/models.py`）源码

### 转换质量参数

| 参数 | 当前值 | 作用 |
|------|--------|------|
| `face_limit` | 15000 | 模型面数，越高越精细 |
| `texture` | True | 保留材质贴图 |

### 如何优化3D质量
- **提高精细度**：将 `face_limit` 从 15000 提高到 30000（成本加倍）
- **提高轮廓质量**：优化 Nano Banana Pro 生成图的边缘清晰度（见步骤3）

### 修改记录
| 日期 | 修改内容 | 效果 |
|------|---------|------|
| 2026-07-26 | 初始版本上线；修正 model ID 为 `v3.1-20260211`；text-to-model prompt截断900字防400错误 | 未验证即上线 |
| 2026-07-29 | **修复"图生3D主路径404、全线静默降级为文生3D"故障**：生产日志实测捕获 `404 Client Error: for url: https://openapi.tripo3d.ai/v3/upload/file`。排查发现本文件从第一次提交起就用了一套TripoAI官方SDK里完全不存在的host+路径组合（`openapi.tripo3d.ai/v3` + `/upload/file`、`/generation/image-to-model`、`/generation/text-to-model`、`/tasks/{id}`）；`openapi.tripo3d.ai/v3` 经查官方SDK源码注释确认只是"segment v2"网格分割功能的专用窄通道，从未开放过图生3D/文生3D用到的这几个路径。改用官方SDK真正用于图生3D/文生3D主流程的 `https://api.tripo3d.ai/v2/openapi`，上传端点改为 `POST {BASE_URL}/upload`，建任务统一改为 `POST {BASE_URL}/task`（body用`type`+`model_version`字段名，此前一直误用`model`——服务端很可能一直静默忽略这个不存在的字段、从未真正应用过我们指定的模型版本），查任务改为 `GET {BASE_URL}/task/{task_id}`（单数）。新增 `TripoAuthError` 独立异常类型 + `_parse_tripo_response()` 统一响应解析，明确区分"鉴权失败（Key无效/过期）"与"路径/参数错误"与"响应非JSON"三类故障，不再混在一条模糊报错里；新增 `_redact()` 防止网络层异常泄漏真实Key，与`gemini_image.py`等同款约定对齐 | **未做真实API Key端到端验证**（本地无真实`TRIPO_API_KEY`）。全部依据为TripoAI官方开源Python SDK源码逐行核对（非文档推测），置信度较高，但需部署后由总agent对生产环境实测确认。**已知直接关联但未同步修复**：`island_service/main.py`（backend-service领域）的 `_poll_tripo()` 读取 `output.model_url`/`message` 字段，按本次核实的真实响应结构应为 `output.model`/`error_msg`，不修正的话即使本文件的路径问题解决，任务成功后仍会因取不到`model`字段而报错，需backend-service一并修复才能真正打通 |
| 2026-08-01 | **加固`upload_image()`应对4K大图上传**（审查已知问题日志第12条风险点，见`gemini_image.py`同批次记录）：查证官方SDK（`legacy_client_impl.py` `upload_file`/`upload_multipart`）确认客户端侧本就没有文件大小校验逻辑（纯粹整体读入内存转发），也未找到官方文档/SDK对上传大小的明确上限，故不虚构一个数字做客户端拦截。改为三处加固：①上传超时 60s→120s（给4096x4096 PNG更宽松的传输时间余量）；②网络层异常（超时/连接重置等，不含TripoAI已正常响应的显式错误如413/400）重试1次，间隔1秒；③上传前打印文件字节数/MB，且不论是网络层异常还是`_parse_tripo_response`抛出的显式API错误，最终异常信息里都附带本次上传的文件大小，方便一眼判断失败是否与文件体积有关，不依赖分别查两条日志再手动对照 | 用mock覆盖3个场景全部通过：①网络层异常两次尝试后失败，确认重试确实发生且最终错误信息含文件大小、真实Key已脱敏；②显式413响应（模拟"payload too large"）确认不触发重试（只调用1次`requests.post`）且错误信息含文件大小；③正常成功路径确认沿用原有`image_token`解析逻辑不受影响。`TripoAuthError`异常类型在包装文件大小信息后仍正确保持为`TripoAuthError`（用`type(parse_err)(...)`重新构造而非统一降级为`RuntimeError`）。本地无真实`TRIPO_API_KEY`，**未做真实4K大图端到端上传验证**，是主动风险跟踪性加固而非确认修复了某个已复现的故障 |

---

## 六、并行分支：Gemini AI 命盘深度解读 — gemini_analysis.py + rag_service.py

### 作用（2026-07-29 架构重构：从"单次调用"改为"六步RAG流水线"）
独立于"八字→图像→3D"主流水线的分支，供前端命盘报告"AI深析"标签页展示。有文件级
永久缓存（相同八字+性别只调用一次）。

**这次架构变化的核心**：原来是一次 Gemini 调用产出一份JSON（`day_master_reading`/
`four_pillars`/`six_dimensions`/`year_advice`），内容单薄、无古籍依据。现在改为
**六步独立命理框架**，每一步都是一次独立的 Gemini 调用，并且在生成前先向本地
ChromaDB 知识库做一次 RAG（检索增强生成）向量检索，把命中的古籍/断语原文片段
拼进该步骤专属 prompt，让输出更有专业依据（而不是模型凭空发挥）：

```
Step1 命局「出厂设置」扫描（日主/月令/五行强弱/性格底色）──┐
    ↓ 输出作为Step2输入                                    │ 严格串行
Step2 定格局与找用神（依赖Step1）────────────────────────────┘
    ↓ Step1+2输出作为Step3-6的共享上下文
Step3 事业与财富深度剖析（财官印组合）─┐
Step4 婚恋与感情世界（日支夫妻宫+异性星）─┤ asyncio.gather 并行发起
Step5 健康与潜在风险提示（五行偏弱+地支相冲）─┤（互不依赖，只依赖Step1+2）
Step6 大运与流年运势推演（当前大运+2026丙午流年）─┘
```

每一步内部：① 用该步骤专属的数据（如日主、十神组合、财官印星、日支等）拼一句
检索query → ② 调 `rag_service.query("bazi", query)` 检索知识库，拿到原文片段
（查不到就是空字符串，正常继续，见下方"RAG检索契约"）→ ③ 把命盘核心资料 + 检索
片段 + 该步骤专属输出格式要求拼成完整prompt → ④ 调用 `_call_gemini()`（复用原有
的模型链+MAX_TOKENS重试机制，全六步共用同一套）→ ⑤ 解析成dict。

**输出JSON结构**（替换原来的 `day_master_reading`/`four_pillars`/`six_dimensions`/
`year_advice`）：
```json
{
  "step1_foundation":       { "title": "...", "narrative": "...", "wuxing_note": "..." },
  "step2_pattern_yongshen": { "title": "...", "pattern": "...", "yongshen": [...], "narrative": "..." },
  "step3_career_wealth":    { "title": "...", "narrative": "...", "career_directions": [...] },
  "step4_relationship":     { "title": "...", "narrative": "...", "partner_traits": "...", "key_periods": [...] },
  "step5_health":           { "title": "...", "narrative": "...", "watch_points": [...] },
  "step6_dayun_liunian":    { "title": "...", "narrative": "...", "current_year_action": "..." },
  "keywords": ["...", "...", "...", "...", "..."]
}
```
`keywords`（5个关键词）由 Step2 顺带生成后提升到顶层（Step2掌握格局+用神这个
最能概括命盘特质的信息，不额外为了5个关键词多打一次请求）；若 Gemini 未返回该
字段，`_fallback_keywords()` 用命盘已有确定性数据（日主/身强弱/喜用神/神煞）
拼凑兜底，不调用AI。

**人格设计**：用户原话要求——"专业且算命准确的百年玄学大师，同时能用通俗易懂的
方式讲解，并结合现代社会发展给建议"。六步共用同一个 `PERSONA_SYSTEM` 常量，
通过 Gemini REST API 的 `systemInstruction` 字段传入（原来的实现没有用这个字段，
本轮改造顺带加上）。风格参考已归档前代项目 `simabazi-api/app/services/ai_service.py`
里"司马"人格的回复框架（共情切入→命盘数据引用→现代视角融入→具体行动建议、口语化
"少用您多用你"），但**去掉**水晶推荐/会员营销话术与MBTI语气适配——两者都不适用于
本项目（无商城、无MBTI数据）。

### RAG知识检索 — rag_service.py（新增）
- 用 `chromadb.PersistentClient`，路径 `./persistent_data/chroma_db`，与现有
  `./persistent_data/analysis_cache` 同级，落在 `render.yaml` 挂载给
  `island_service/persistent_data`（不含代码的子目录，2026-07-30事故修复后的路径）
  的1GB持久盘上
- **不使用**ChromaDB官方 `embedding_function`（会触发下载约83MB的ONNX默认模型，拖慢
  Render冷启动）——改为手动调用 `gemini-embedding-001:embedContent` REST接口计算
  embedding，查询用 `taskType: RETRIEVAL_QUERY`，入库用 `taskType: RETRIEVAL_DOCUMENT`
  （`ingest_knowledge.py` 使用），这是Gemini embedding API区分查询/文档向量的标准做法
- **核心契约（六步流水线依赖此保证）**：`query(collection_name, question, n_results=3)`
  绝不抛异常——无API Key、collection为空、embedding失败、chromadb本身异常，统统在
  函数内部捕获并返回 `''`。六步流水线拿到空字符串时应当照常生成（只是这一步少了
  古籍引用片段），RAG是"锦上添花"不是"必需依赖"，绝不能因为RAG层故障拖垮整条
  AI深析流水线

### 知识库 — island_service/knowledge_base/bazi/ + ingest_knowledge.py（新增）
- `ingest_knowledge.py`：本地手动运行的一次性脚本（`python3 ingest_knowledge.py`，
  **不**接入 `main.py` 启动流程），把 `knowledge_base/bazi/*.md` 按 `##` 二级标题
  切块（每块携带文件级 `## 标签:` 元数据，供未来"标签加权检索"扩展用，本轮只存
  标签不做真正的加权/过滤），逐块算embedding后写入同一个ChromaDB collection
  （`"bazi"`）。**2026-08-02 起的写入机制**：每个文件在写入前会先按 `source`
  （文件名）删除该文件在 collection 里已有的全部旧 chunk，再插入本次重新解析
  出的全部新 chunk（`col.delete(where={"source": ...})` + `col.upsert(...)`），
  不是简单地不断 `upsert` 追加——这保证重复运行本脚本（含订正过古籍内容后重新
  运行）不会导致同一文件新旧版本混杂或 collection 无限膨胀。该机制只覆盖"文件名
  不变、内容变化"的场景，不会自动清理被重命名/删除的旧文件遗留的"孤儿chunk"
  （脚本运行结束会打印孤儿chunk警告，但不自动清理）；确实需要整体清空重建时用
  `python3 ingest_knowledge.py --reset`，该参数执行前会先真实调用一次embedding
  接口做可用性探测，探测失败会直接中止且不删除任何数据，避免"删完了才发现算不出
  向量"导致知识库清零且无法回滚
- **知识库范围分两阶段**：
  - **Phase A（本轮已完成）**：只有2份现成的标签化摘要文件——`01_bazi_fundamentals.md`
    （八字基础：天干地支/五行生克/十神/日主特质/大运流年框架）、`02_bazi_duanyu.md`
    （十神断语/日主断语/格局断语/大运流年断语/神煞断语/特殊组合口诀），原样从已归档
    前代项目 `simabazi-api/knowledge_base/bazi/` 拷贝，共约545行、12个检索块
  - **Phase B（尚未开始，另立子agent负责）**：九本古籍原文（三命通会、渊海子平、
    穷通宝鉴、滴天髓、子平真诠、千里命稿、四柱预测学、四柱命理学自修教程）的OCR
    提取与标签化整理，由新增的 `.claude/agents/knowledge-curator.md` 子agent负责，
    产出后追加进同一目录、重新跑一次 `ingest_knowledge.py` 即可自动扩充检索覆盖面，
    `rag_service.py`/`gemini_analysis.py` 届时都不需要改动
  - **⚠️ 明确提醒：本轮上线后"引用古籍"的知识密度仍是Phase A水平**（仅两份摘要，
    非九本古籍原文），不要误以为这次上线=九本古籍已经全部生效

### 模型信息（2026-07-29 更新，修复"AI深析一直显示兜底文案"故障）
- **故障现象**：生产环境 `/analyze-bazi` 返回 `{"analysis": null, "error": "Expecting value: line 1 column 1 (char 0)"}`，
  即 Gemini 返回了 200 OK 但candidate文本为空字符串，旧代码对空字符串 `json.loads('')` 报出的错误完全看不出真实原因
- **根因排查**：`ANALYSIS_MODEL = 'gemini-3.5-flash'`（2026-07-27引入）是未经确认存在的模型ID——本项目里唯一
  已验证可用的图像模型是 `gemini-3-pro-image`（见步骤3），命名规律并不支持"3.5"这个版本号；同时原有
  `maxOutputTokens=2200` 相对于本模块要求的JSON输出量（六维度×80字+四柱×60字+日主解读200字等，中文字符
  在Gemini分词器下往往消耗更多token）明显偏紧，思考型模型很容易把预算耗尽在内部推理上导致正文为空
- **模型链（当前，2026-07-29第三轮修复后）**：`ANALYSIS_MODEL_CHAIN`，依次尝试 `GEMINI_ANALYSIS_MODEL`环境变量
  （若设置）→ `gemini-flash-latest`（Google官方稳定别名，现指向Gemini 3.x系列）→ `gemini-3.6-flash`（显式版本号兜底）。
  `gemini-2.5-flash`/`gemini-2.0-flash`已被Google下线（HTTP 404），不再作为候选
- **maxOutputTokens**：2026-07-29六步重构后不再是单一全局值——`_call_gemini()` 默认值改为2048（原为4096，因为
  拆成六步后单步输出内容量比原来"一次性产出全部"小很多），各步骤按自身JSON输出量传入具体预算（Step1/3/4/5/6
  为2048，Step2因额外要求`keywords`字段用2560）；仍保留遇到 `finishReason=MAX_TOKENS` 且文本为空/被截断时对
  同一模型自动加倍预算重试一次（封顶8192），仍失败才换下一个候选模型的机制，六步共用同一套 `_call_gemini()`
- **防御性解析**：`_extract_text()` 显式检查响应结构（candidates是否为空、是否被安全过滤器/版权检测拦截、
  finishReason），拿不到有效文本时返回明确原因，不再让裸取字段的异常一路冒泡成语义不明的 JSONDecodeError；
  `analyze_bazi()` 返回的 `error` 字段现在会直接说明"哪个模型、什么原因"失败，不用再靠猜

### 如何优化解读质量
- 调整每一步 narrative/字段的字数要求：直接改对应 `_stepN_xxx_sync()` 函数里的 prompt 模板
- 调整某一步的检索方向：改对应函数里拼接 `rag_query` 字符串的逻辑
- 想要更简洁：降低对应步骤的 `max_tokens` 参数，同时相应缩短 prompt 里的字数要求
- 切换到确认可用的更强模型：设置环境变量 `GEMINI_ANALYSIS_MODEL` 即可，无需改代码（六步共用同一条模型链）
- 扩充古籍知识密度：往 `knowledge_base/bazi/` 加新的标签化 `.md` 文件（见Phase B），重新跑一次 `ingest_knowledge.py`

### 修改记录
| 日期 | 修改内容 | 效果 |
|------|---------|------|
| 2026-07-27 | 从 `gemini-2.0-flash` 改为 `gemini-3.5-flash` | 未验证即上线，实际导致生产环境AI深析持续报错 |
| 2026-07-29 | 改为模型优先级链（`gemini-flash-latest` → `gemini-2.5-flash` → `gemini-2.0-flash`，支持环境变量强制指定）+ `maxOutputTokens` 2200→4096并支持MAX_TOKENS自动加倍重试 + `_extract_text()` 显式诊断响应结构 | 待测试（生产环境需配置真实 `GEMINI_API_KEY` 后实测；本地已用mock覆盖模型链切换/MAX_TOKENS重试/安全过滤诊断/无Key泄露等控制流路径） |
| 2026-07-29（二次修复） | qa-reviewer复查发现三个问题并修复：①`RequestException`（网络超时/连接失败）的`str(e)`会内嵌含真实key的完整URL，经`analyze_bazi()`的`error`字段一路传到前端HTTP响应体导致Key泄漏——新增`_redact()`在所有可能字符串化异常的地方脱敏；②MAX_TOKENS截断时若candidate文本非空（如部分JSON），旧逻辑会当作"成功"返回、跳出重试循环后才在`_parse_json`失败且不再重试——`_extract_text()`新增返回`finish_reason`，`_call_gemini_once`对非空文本仍检查`finishReason==MAX_TOKENS`并抛出可重试错误；③`generationConfig`补充`thinkingConfig.thinkingBudget=0`（仅思考型模型，`gemini-2.0-flash`等非思考模型不附加以免400），关闭思考token消耗以缓解"HTTP 200但candidate为空"的根本原因 | 待测试（本地无真实`GEMINI_API_KEY`仍无法端到端验证；已用mock+真实`requests.exceptions.ConnectTimeout`复现场景补充11个单元测试，断言异常/日志中不含真实key字符串、MAX_TOKENS部分文本触发加倍预算重试与模型回退、thinkingConfig按模型区分生成，全部通过） |
| 2026-07-29（第三轮修复） | 总agent对生产 `/analyze-bazi` 实测拿到确凿报错：`[gemini-flash-latest] HTTP 400 INVALID_ARGUMENT`；`[gemini-2.5-flash] HTTP 404 NOT_FOUND`（已不再对新用户开放）；`[gemini-2.0-flash] HTTP 404 NOT_FOUND`（已下线）。根因：`gemini-2.5-flash`/`gemini-2.0-flash`均已被Google正式下线；`gemini-flash-latest`别名现指向Gemini 3.x系列（如`gemini-3.6-flash`，2026-07-21发布），3.x系列已把数值型`thinkingConfig.thinkingBudget`换成字符串枚举`thinkingConfig.thinkingLevel`（minimal/low/medium/high），旧格式字段被3.x模型拒绝返回400。修复：`ANALYSIS_MODEL_CHAIN`移除已下线的`gemini-2.5-flash`/`gemini-2.0-flash`，改为`gemini-flash-latest` → `gemini-3.6-flash`；`_build_generation_config`改用`thinkingConfig: {thinkingLevel: "minimal"}`；`_NON_THINKING_MODELS`例外名单保留机制但清空（链中模型均为3.x，默认都支持thinkingConfig，若未来加入不支持的模型可放回此名单跳过） | 待测试（总agent将直接对生产端点发起真实请求验证是否返回有效analysis，本轮未做本地mock测试，交由部署后实测确认） |
| 2026-07-29（六步RAG流水线重构） | **架构性重写**（非参数微调，见本章节上方"作用"完整说明）：`analyze_bazi()` 从单次Gemini调用改为六步独立调用（`_step1_foundation`…`_step6_dayun_liunian`，各自独立 prompt + 独立 max_tokens 预算），Step1→2严格串行、Step3-6用 `asyncio.gather` 并行发起（底层同步 `requests.post` 用 `asyncio.to_thread` 包一层，使 gather 真正并发而非排队）；每步生成前新增 RAG 检索（`rag_service.query()`，新增文件，见上方"RAG知识检索"小节），检索失败优雅降级不影响生成；新增六步共用的 `PERSONA_SYSTEM`，通过 Gemini REST `systemInstruction` 字段传入（原实现未用该字段）；输出JSON结构从 `day_master_reading`/`four_pillars`/`six_dimensions`/`year_advice` 整体替换为 `step1_foundation`...`step6_dayun_liunian`+`keywords`；`_cache_read()` 新增结构校验（检查 `step1_foundation` 字段），旧结构缓存文件视为未命中避免前端读到undefined；`analyze_bazi()` 改为 `async def`，联动 `main.py`（backend-service领域，`analyze_bazi_endpoint` 内改为 `await`）——这是本次唯一需要跨到 backend-service 文件的改动，因为 `asyncio.gather` 要求调用方运行在事件循环里才能真正并发，纯属技术必要性，未改动 `main.py` 其他任何逻辑 | 用mock测试验证控制流：①favorable字符串→数组等历史字段兼容问题在新 `_build_context()` 里仍正确处理；②`_cache_read()` 对旧结构缓存文件正确判定未命中、新结构正确命中；③`_redact()`（本文件+`rag_service.py`独立副本）脱敏均生效；④RAG `query()` 在无API Key等场景下确认优雅返回空字符串不抛异常；⑤模型链回退+MAX_TOKENS加倍重试机制在新代码结构下依然正确触发；⑥**用真实计时+线程级并发计数器实测**Step1严格先于Step2开始、Step2严格先于Step3-6开始、Step3-6起始时间差<0.001s且实测最大并发数=4（证明真并行而非伪并行/排队串行）、总耗时0.93s显著低于严格串行理论值1.8s；⑦文件缓存命中时完全跳过Gemini调用；⑧GeminiCallError从任一步骤正确传播为 `analysis:None`+明确诊断的 `error` 字段。`ingest_knowledge.py` 本地用真实 `chromadb` 包（无GEMINI_API_KEY环境）跑通一次完整流程：两份知识库文件各自正确切成6个块（共12块，字段/标签元数据核对无误），embedding失败时按预期重试2次后优雅降级为写入无向量原文、不抛异常。**本轮全部验证均无真实 `GEMINI_API_KEY`/真实向量数据支撑**（mock模拟Gemini响应文本、真实chromadb但embedding必然因无Key失败），六步prompt的实际生成质量、RAG检索到的片段是否真的提升输出专业度、`asyncio.to_thread`包同步requests在真实网络延迟下的并发表现，均需部署后用真实API Key对生产 `/analyze-bazi` 端点实测确认 |
| 2026-07-29（qa-reviewer复查二次修复） | 复查上一行"六步RAG流水线重构"发现4个问题，逐条修复：①**CONFIRMED，最高优先级**——`ingest_knowledge.py::ingest_markdown_file()` 在 `_embed_with_retry()` 返回空列表（无 `GEMINI_API_KEY` 等场景）时，原逻辑仍会 `col.upsert(documents=..., ids=..., metadatas=...)`（不传 `embeddings=`）。注释原以为"没有向量的文档在query()语义检索时不会被命中"，但实际上 ChromaDB 不传 `embeddings=` 时会用 collection 自带的 embedding function **当场计算**向量；`rag_service.get_collection()` 创建时未指定 `embedding_function`，会自动退回默认384维ONNX模型（正是本设计从一开始要绕开的83MB下载）。一旦触发，collection会被锁死在384维，之后任何正确的3072维 `gemini-embedding-001` 向量写入都会因维度不匹配报错、查询也失败，只能手动删 `chroma_db/` 目录重来——本地忘设 `GEMINI_API_KEY` 跑一次这个脚本就会触发。修复为：无embedding时直接跳过，不做任何upsert，只打印警告。②`rag_service.py::query()` 在 collection为空（`count()==0`）时原先完全静默返回`""`，无日志——与"AI深析"故障的教训同源（Phase A的 `ingest_knowledge.py` 是手动本地脚本，Render生产磁盘很可能从未真正跑过，导致RAG一直静默查空却无人发现）。新增一行 `print()` 日志，方便去Render日志搜"RAG"确认知识库是否注入生效，不改变返回值/契约。③`query()` 新增可选 `tags: list[str]` 参数，实现approved plan里要求但此前未接线的"标签加权检索"：传tags时先用语义相似度过取一批候选（`n_results`的4倍或至少10个，不超过collection实际大小），再按候选doc的 `metadata["tags"]`（逗号分隔字符串）与传入tags的重合度做后置重排序取回top-N（重合度优先、语义原始排名作为并列时的tie-breaker），不用ChromaDB `where`精确过滤（候选文档少、标签体系还在Phase A早期阶段，精确过滤容易把结果过滤到空）；六步各自的 `rag_query` 调用处按各步骤擅长领域补上对齐 `knowledge_base/bazi/*.md` 文件头部 `## 标签:` 实际取值的 `tags` 参数（Step1→日主/wuxing/daymaster/fundamentals，Step2→格局/用神/十神/ten-gods，Step3→十神/ten-gods/格局，Step4→日主/十神/ten-gods/神煞，Step5→wuxing/神煞，Step6→大运/流年）。④`js/bazi-analysis.js` 的 `getAnalysis()` 原本没有真正的"进行中请求"去重机制，与 `js/main-new.js` 预热调用处的注释（声称"BaziAnalysis自带去重"）不符——若报告弹窗在预热请求完成前打开会并发发出两份完整六步流水线请求（12次Gemini调用配额翻倍）。新增模块内 `Map<hash, Promise>` 做in-flight去重：同一八字哈希的并发调用复用同一个进行中Promise，完成后从Map清除；同步改正 `main-new.js` 里原本描述不准确的注释 | 无真实 `GEMINI_API_KEY`/`chromadb`向量数据支撑（问题依旧），全部用mock验证控制流：①mock `rag_service` 模块+空embedding场景，断言 `ingest_markdown_file()` 返回0且**零次**`upsert`调用（此前会调用1次，是本次修复的核心验证点）；②mock空collection，断言 `query()` 打印含"count=0"的日志且仍返回`""`；③mock带5个候选文档+分散tags的假collection，断言传 `tags=["格局"]` 时语义排名更低但tag重合度更高的文档被排到前面，同时验证不传tags时保持原有纯语义排序行为不变（向后兼容）；④用Node vm模块加载真实 `bazi-analysis.js` 源码、mock `fetch`/`localStorage`，对同一八字哈希发起两个并发 `getAnalysis()` 调用并在fetch resolve前用setTimeout探测，断言实际只发出1次网络请求（`fetchCallCount===1`）且两个Promise resolve到同一对象，随后第3次调用命中localStorage缓存、fetch计数仍为1。四项mock测试全部通过；未做真实API/生产端到端验证 |
| 2026-07-30（qa-reviewer复查三次修复） | qa-reviewer实测六步真实tags发现：Phase B第一批古籍整理 `03_geju_yongshen.md`（子平真诠格局理论+穷通宝鉴调候用神，文件头标签`格局,用神,调候,子平真诠,穷通宝鉴,正官,七杀,正财,食神,伤官,五行总论,病药,扶抑`）在六步检索里几乎永远排不到 `02_bazi_duanyu.md` 前面——根因是 `ingest_knowledge.py` 按`##`标题切块但tags是**文件级**的（同一文件所有chunk共享文件头`## 标签:`那一行），而 `02_bazi_duanyu.md` 标签列表很宽泛（`八字断语,十神,格局,大运,流年,日主,用神,神煞`共8个），Step2原tags`['格局','用神','十神','ten-gods']`与02文件重合3个标签（格局/用神/十神）而与03文件只重合2个（格局/用神），`rag_service.query()`的`(rank - overlap*2, rank, doc)`重排公式里02文件靠标签重合度稳定压过03文件，与真实语义相关度无关——这次古籍整理investment实际从未在Step2检索里真正发挥作用。Step3（`['十神','ten-gods','格局']`）同理：与02重合2、与03只重合1。修复：Step2 tags补上03文件独有、02文件完全没有的5个标签`调候,扶抑,病药,正官,七杀`（这些恰好是"格局与用神"任务本身核心涉及的概念），改后与02重合仍为3，与03重合升至7；Step3 tags补上03文件里"正官格/七杀格/正财格/食神格/伤官格"五个独立小节对应的标签`正官,七杀,正财,食神,伤官`（03文件对这五种格局的成格路径描述比02文件泛泛断语更具体、更有策略含义，直接对应Step3"财官印组合→职业赛道判断"的任务），改后与02重合仍为2，与03重合升至6。Step1/4/5/6未改动——04文件内容（日主基础/调候）与这几步的语义关联不如Step2/3明确，未见足够依据强行加tag。 | 用真实 `ingest_knowledge.parse_markdown_chunks()` 解析02/03两份文件拿到与生产环境完全一致的 `metadata["tags"]`（不是手写模拟值），复刻 `rag_service.query()` 里`(rank - overlap*2, rank)`重排公式做验证脚本：假设一个保守场景——02文件语义排名较靠前（rank=2）、03文件语义排名中等靠后（rank=5，模拟"03文件用词偏文言、语义分数不占绝对优势"的悲观情况）。**结果**：改动前Step2重排score 02=(-4,2) < 03=(1,5)，02排第一；改动后Step2重排score 02=(-4,2) > 03=(-9,5)，**03反超排到第一**。Step3同理：改动前02=(-2,2) < 03=(3,5)，02第一；改动后02=(-2,2) > 03=(-7,5)，**03反超**。**已知残留局限**（诚实记录，非本次改动引入）：额外测试了更悬殊场景（03语义rank=9接近`fetch_n`候选池边缘、02语义rank=1）——此时即使tags全部命中（03重合7 vs 02重合3），score03=(-5,9)与score02=(-5,1)一级分数打平，二级tie-breaker用原始rank，02仍获胜（03的语义排名太靠后导致进不了候选池核心区）。这是`rag_service.py`重排公式本身"语义为主、标签为辅（每标签仅+2分）"设计的固有边界，不是本次tags调整能解决的，本次改动已达成"典型场景下03能反超"这一效果，若要覆盖更悬殊的边缘场景需改动重排公式本身（如提高单标签权重），超出本次"至少对齐调用方tags"的最低要求范围，留给未来若生产环境实测仍不理想时再处理 |
| 2026-08-02（`ingest_knowledge.py` chunk id 覆盖bug修复） | 已知问题日志"代码质量/健壮性"第20条记录的生产事故根因修复：`ingest_markdown_file()` 里 chunk id 用随机 UUID 生成，每次运行都不同，`col.upsert()` 因此永远匹配不到旧 id、只会不断追加，不会覆盖旧版本——2026-08-01~08-02期间因反复重新 ingest（每批古籍整理完成后都在生产Render Shell跑一次，累计约7-8次）导致生产 ChromaDB 实际记录数从应有的130条膨胀到809条，已用 `client.delete_collection('bazi')` 应急清空重建过一次，但代码层面根因此前未修。修复为"按来源先删除、再插入"：`ingest_markdown_file()` 在 `col.upsert()` 之前新增 `col.delete(where={"source": filepath.name})`，先清空该文件在 collection 里已有的全部旧 chunk（`source` 是 `parse_markdown_chunks()` 存入 metadata 的带 `.md` 后缀完整文件名，不是 `filepath.stem`），再插入本次重新解析出的全部 chunk，不依赖 id 是否碰巧匹配，无论 chunk 数量/内容如何变化都能彻底清空旧版本；id 生成机制本身未改（随机UUID+文件名前缀）；新增 `reset_collection()` 与 `python3 ingest_knowledge.py --reset` CLI flag，把此前用户手动敲 `client.delete_collection()` 的应急操作固化成脚本内可复用的显式命令，日常增量更新场景不需要用它 | 本地装真实 `chromadb`（Python 3.11 独立venv，无需真实 `GEMINI_API_KEY`，mock `rag_service._embed_texts` 返回随机向量即可）做端到端验证：①同一文件连续两次 ingest（第二次内容订正、chunk数从2变1）——修复前会产生3条（2旧+1新）混杂新旧内容，修复后精确为1条且内容为最新版本；②同一批次连续运行 ingest_all() 两次模拟"误连续跑两次"场景——collection总数保持不变（未翻倍）；③delete-by-source 只清空目标文件、`02_test.md` 等其它文件的chunk不受影响；④`col.delete(where=...)` 在 collection 全新为空（从未ingest过）、以及该 source 从未出现过两种情况下均验证不抛异常，可安全作为无条件前置步骤；⑤`ingest_all(reset=True)`（即 `--reset`）验证整体清空重建后重新注入的总数与预期一致。`python3 -m py_compile ingest_knowledge.py rag_service.py` 通过。本次修复本身不需要用户在生产环境立即操作验证——上次应急清理后生产库已是干净的130条，下次任何一次古籍内容订正需要重新 ingest 时会自然验证这次修复生效（届时该文件chunk数应稳定等于其实际解析出的chunk数，不再增长） |
| 2026-08-02（qa-reviewer复查返工：`--reset`前置守卫+孤儿chunk警告） | qa-reviewer独立复现出上一行`delete-by-source`修复本身有效，但新增的`--reset`是"先毁后建"——`reset_collection()`在`ingest_all(reset=True)`一开始就无条件删除整个collection，之后才逐文件重新计算embedding写回；`ingest_markdown_file()`"embedding失败时保留旧版本更安全"这一设计被`--reset`完全架空（旧版本第一步就已被删）。实测出两种真实触发方式：①Render Shell漏加`GEMINI_API_KEY=xxx`前缀，`_embed_texts()`立刻返回`[]`；②API Key配额耗尽/429，130次独立embedContent请求跑到一半持续失败，重试放弃后半部分文件净损失。**CONFIRMED修复**：新增`_check_embedding_available()`前置守卫函数，`ingest_all(reset=True)`在调用`reset_collection()`之前必须先经过此函数返回`True`。守卫分两层：①检查`rag_service.GEMINI_API_KEY`是否为空，为空直接拒绝并打印明确提示；②非空时再真实调用一次`_embed_texts()`对一段测试文本算embedding，调用失败（配额耗尽/网络异常等）同样拒绝，均不删除任何数据。**另处理一个PLAUSIBLE建议**：新增`_warn_orphan_chunks()`，`ingest_all()`结束时把collection里全部`source`元数据集合与本次实际遍历到的文件名集合做差集，若有孤儿（文件被重命名或删除后旧chunk残留）打印明确警告（不自动清理，建议手动清理或`--reset`）；同步在模块docstring补充"delete-by-source不清理重命名/删除文件产生的孤儿chunk，需要`--reset`"的说明 | 本地装真实`chromadb`（Python 3.11独立venv）端到端验证`_check_embedding_available()`三种场景：①`GEMINI_API_KEY`为空时，`ingest_all(reset=True)`调用前后collection.count()保持不变（3→3），未被清空，且打印明确拒绝提示；②`GEMINI_API_KEY`非空但mock`_embed_texts`返回`[]`模拟调用失败，同样确认collection未被清空、打印拒绝提示；③mock`_embed_texts`返回正常向量的对照组，确认守卫正确放行返回`True`。另单独验证`_warn_orphan_chunks()`：手动写入一条`source`指向不存在文件的chunk，调用后确认打印警告；传入包含该文件名的集合后确认不再警告（无孤儿时静默）。`python3 -m py_compile ingest_knowledge.py`通过 |
| 2026-08-02（qa-reviewer复查返工：非`--reset`模式全新文件失败被"✨完成"掩盖，PLAUSIBLE P1加固） | qa-reviewer复查上一行`--reset`加固时发现更常见的日常场景未覆盖：**非**`--reset`模式（即日常最常用的`python3 ingest_knowledge.py`）下，若某份**全新文件**（collection里此前从未有过它的`source`记录）embedding失败，`ingest_markdown_file()`按既有设计"跳过写入、不删旧版本"直接返回`-1`，但该文件根本没有旧版本可保留——内容100%缺失；而`ingest_all()`结尾此前只区分`reset`模式下是否完整成功，非`reset`模式无论`failed_files`是否非空，一律打印成功语气的"✨完成"，中途那行`⚠️ xxx.md: 未获取到embedding`提示在几十个文件的滚屏输出里很容易被刷过，运维人员容易误以为新知识已生效，实际RAG永远检索不到这份内容 | 新增`_get_existing_sources()`：在非`--reset`模式下、逐文件处理循环开始前，先对collection做一次`col.get(include=["metadatas"])`快照，取得运行前已存在的全部`source`集合（读取异常时返回`None`哨兵值，表示"无法判断"）；`ingest_all()`结尾非`--reset`分支里，若`failed_files`非空，先照常打印"✨完成"，再用这份快照把失败文件分成两组并分别追加提示：①**全新文件**（快照里没有它——`new_file_failures`）：追加醒目的`⚠️`警告，明确列出文件名，说明"内容目前完全缺失，不是沿用旧版本那种相对安全的情况"，并给出重新运行的恢复建议；②**已入库旧文件**（快照里已有它——`existing_file_failures`）：追加相对温和的`ℹ️`提示，说明"沿用了已有的旧版本chunk，不是内容缺失，只是本次没能更新到最新版本"。快照读取本身异常（`None`）时保守地把全部失败文件都当作"可能是全新文件"处理，避免因为判断失败反而漏报。`--reset`模式不受影响（继续沿用上一行已有的专属"未完整成功"警告，不需要这层区分，因为`--reset`下任何失败文件当前状态都是"完全没有"） | 本地装真实`chromadb`（独立venv）+mock`rag_service._embed_texts`端到端验证三个场景：①非`--reset`模式下，一个全新文件（collection中此前无该文件`source`记录）embedding失败，另一个已入库旧文件embedding成功——确认结尾在"✨完成"之后追加醒目`⚠️`警告并精确点名该全新文件，且未被误归类为"已入库旧文件"提示；②非`--reset`模式下，一个已经入库成功过的旧文件之后embedding失败——确认追加的是温和`ℹ️`提示，不包含"内容目前完全缺失"字样，与场景①的醒目警告互不混淆；③无任何文件失败的正常场景——确认输出中不出现任何"embedding 失败"相关字样，提示逻辑不误报。三场景断言全部通过。`python3 -m py_compile ingest_knowledge.py`通过 |
| 2026-08-03（新功能：`analyze_bazi()` 新增 `force_refresh` 参数，支撑设置面板"轻量刷新AI深析"） | 用户需要一个能测试后端优化效果（RAG知识库更新/prompt改动等）的方式，不用每次都注册新账号或换八字才能看到变化——同一八字命中前端localStorage+后端文件缓存两层，重复请求 `/analyze-bazi` 永远拿到旧结果。完整方案见 `~/.claude/plans/iterative-dreaming-starlight.md`。`analyze_bazi(bazi_data, gender='男', birth_year=0, force_refresh=False)` 新增 `force_refresh` 形参，`force_refresh=True` 时跳过 `_cache_read()`（文件缓存读取）直接走完整六步生成流程；`_cache_write()` 覆盖写语义本就如此，不需要额外改动，生成结果照常覆盖同一哈希对应的缓存文件。联动改动：`main.py::AnalyzeRequest` 新增 `force_refresh: bool = False` 字段并透传；`js/bazi-analysis.js::getAnalysis()` 新增第三参数 `{forceRefresh}` 同步跳过前端 localStorage 命中判断和 in-flight 复用判断、请求体带上 `force_refresh` 字段。不传该参数时（现有 `main-new.js`/`analysis.js` 两参数调用点）行为与改动前完全一致 | mock测试通过：mock `_cache_read`/`_cache_write`/六个 `_stepN` 函数，验证 `force_refresh=False`（默认）命中缓存、`_cache_read` 恰好调用1次；`force_refresh=True` 时 `_cache_read` 调用0次、完整走六步生成、`_cache_write` 调用1次覆盖写。`python3 -m py_compile gemini_analysis.py main.py` 通过。未做真实 `GEMINI_API_KEY` 端到端验证——只验证了缓存跳过这一控制流分支，六步生成本身逻辑未改动 |

---

## 七、整体优化路线图

### 短期优化（可立即执行）
- [ ] 测试并记录 Nano Banana Pro 生成图质量
- [ ] 测试 Gemini 提示词增强后的效果
- [ ] 补充缺失的神煞（目前只有26个，传统有百余个）
- [ ] 优化空亡的视觉表现描述
- [ ] 生产环境验证 gemini_analysis.py 模型链修复是否解决"AI深析"兜底文案问题
- [ ] 生产环境用真实API Key验证六步RAG流水线：六步字段齐全、Step3-6并行发起确实比严格串行更快、RAG检索片段确实影响了输出内容
- [ ] 运行一次 `ingest_knowledge.py`（配置真实 `GEMINI_API_KEY`）把Phase A两份摘要真正写入生产环境的ChromaDB持久盘

### 中期优化
- [ ] 为不同日主定制专属 Gemini 提示词
- [ ] 根据用户反馈调整各档五行的视觉密度
- [ ] 增加季节/时辰对岛屿光线的影响
- [ ] Phase B：knowledge-curator子agent完成九本古籍的OCR提取+标签化整理，扩充RAG知识库覆盖面

### 长期优化
- [ ] 收集用户评分，建立提示词A/B测试机制
- [ ] 允许用户手动选择岛屿风格（仙侠/国风/赛博）
- [ ] 支持岛屿局部重生成（如只改换神煞物件）

---

## 八、文件对照表

| 文件路径 | 作用 | 人工可调整 |
|---------|------|----------|
| `island_service/bazi_prompt.py` | 规则引擎，八字→描述映射 | ✅ 直接编辑字典 |
| `island_service/gemini_enhance.py` | Gemini 提示词增强系统提示词，模型链见 `ENHANCE_MODEL_CHAIN` | ✅ 修改 system_instruction |
| `island_service/gemini_analysis.py` | Gemini AI命盘深度解读，六步命理框架流水线，模型链见 `ANALYSIS_MODEL_CHAIN` | ✅ 修改各 `_stepN_xxx_sync()` 的 prompt 模板 |
| `island_service/rag_service.py` | RAG知识库检索服务（ChromaDB + 手动Gemini embedding），六步流水线各步调用 `query()` | ✅ 修改检索逻辑/collection名 |
| `island_service/ingest_knowledge.py` | 知识库注入脚本（本地手动运行，切块+embedding+写入ChromaDB） | ✅ 修改切块规则 |
| `island_service/knowledge_base/bazi/*.md` | RAG知识来源，标签化古籍/断语摘要（Phase A仅2份，Phase B由knowledge-curator子agent扩充） | ✅ 新增/编辑 `.md` 文件后需重跑 `ingest_knowledge.py` |
| `island_service/gemini_image.py` | Nano Banana Pro 图像生成，含附加样式提示 | ✅ 修改 enhanced_prompt |
| `island_service/tripo_client.py` | TripoAI 3D转换参数 | ✅ 修改 face_limit 等参数 |
| `island_service/main.py` | 流水线控制，含兜底逻辑 | ⚠️ 修改需谨慎 |
| `render.yaml` | 后端部署配置（模型名等环境变量） | ✅ 修改环境变量 |
