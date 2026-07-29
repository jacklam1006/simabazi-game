# 司马八字 · AI 提示词系统库
> 版本：v1.0 | 最后更新：2026-07-26  
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
    八字数据 → JSON结构化命理解读（日主/命格/四柱/六维度/流年）
    独立于图像流水线，供前端"AI深析"标签页展示
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

---

## 六、并行分支：Gemini AI 命盘深度解读 — gemini_analysis.py

### 作用
独立于"八字→图像→3D"主流水线的分支：直接把八字数据（四柱、日主、五行、喜用神、神煞、大运）
组装成结构化中文提示词，要求 Gemini 输出严格 JSON（日主解读/命格/四柱解读/事业财富感情健康成长精神六维度/流年建议/关键词），
供前端命盘报告"AI深析"标签页展示。有文件级永久缓存（相同八字+性别只调用一次）。

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
- **maxOutputTokens**：默认从 2200 提高到 4096，且遇到 `finishReason=MAX_TOKENS` 且文本为空时，会对同一模型自动
  加倍预算重试一次（封顶8192），仍失败才换下一个候选模型
- **防御性解析**：`_extract_text()` 显式检查响应结构（candidates是否为空、是否被安全过滤器/版权检测拦截、
  finishReason），拿不到有效文本时返回明确原因，不再让裸取字段的异常一路冒泡成语义不明的 JSONDecodeError；
  `analyze_bazi()` 返回的 `error` 字段现在会直接说明"哪个模型、什么原因"失败，不用再靠猜

### 如何优化解读质量
- 调整六维度/四柱/流年的字数要求：直接改 `prompt` 模板里的字数提示
- 想要更简洁：降低 `maxOutputTokens` 默认值，同时相应缩短 prompt 里各字段要求的字数
- 切换到确认可用的更强模型：设置环境变量 `GEMINI_ANALYSIS_MODEL` 即可，无需改代码

### 修改记录
| 日期 | 修改内容 | 效果 |
|------|---------|------|
| 2026-07-27 | 从 `gemini-2.0-flash` 改为 `gemini-3.5-flash` | 未验证即上线，实际导致生产环境AI深析持续报错 |
| 2026-07-29 | 改为模型优先级链（`gemini-flash-latest` → `gemini-2.5-flash` → `gemini-2.0-flash`，支持环境变量强制指定）+ `maxOutputTokens` 2200→4096并支持MAX_TOKENS自动加倍重试 + `_extract_text()` 显式诊断响应结构 | 待测试（生产环境需配置真实 `GEMINI_API_KEY` 后实测；本地已用mock覆盖模型链切换/MAX_TOKENS重试/安全过滤诊断/无Key泄露等控制流路径） |
| 2026-07-29（二次修复） | qa-reviewer复查发现三个问题并修复：①`RequestException`（网络超时/连接失败）的`str(e)`会内嵌含真实key的完整URL，经`analyze_bazi()`的`error`字段一路传到前端HTTP响应体导致Key泄漏——新增`_redact()`在所有可能字符串化异常的地方脱敏；②MAX_TOKENS截断时若candidate文本非空（如部分JSON），旧逻辑会当作"成功"返回、跳出重试循环后才在`_parse_json`失败且不再重试——`_extract_text()`新增返回`finish_reason`，`_call_gemini_once`对非空文本仍检查`finishReason==MAX_TOKENS`并抛出可重试错误；③`generationConfig`补充`thinkingConfig.thinkingBudget=0`（仅思考型模型，`gemini-2.0-flash`等非思考模型不附加以免400），关闭思考token消耗以缓解"HTTP 200但candidate为空"的根本原因 | 待测试（本地无真实`GEMINI_API_KEY`仍无法端到端验证；已用mock+真实`requests.exceptions.ConnectTimeout`复现场景补充11个单元测试，断言异常/日志中不含真实key字符串、MAX_TOKENS部分文本触发加倍预算重试与模型回退、thinkingConfig按模型区分生成，全部通过） |
| 2026-07-29（第三轮修复） | 总agent对生产 `/analyze-bazi` 实测拿到确凿报错：`[gemini-flash-latest] HTTP 400 INVALID_ARGUMENT`；`[gemini-2.5-flash] HTTP 404 NOT_FOUND`（已不再对新用户开放）；`[gemini-2.0-flash] HTTP 404 NOT_FOUND`（已下线）。根因：`gemini-2.5-flash`/`gemini-2.0-flash`均已被Google正式下线；`gemini-flash-latest`别名现指向Gemini 3.x系列（如`gemini-3.6-flash`，2026-07-21发布），3.x系列已把数值型`thinkingConfig.thinkingBudget`换成字符串枚举`thinkingConfig.thinkingLevel`（minimal/low/medium/high），旧格式字段被3.x模型拒绝返回400。修复：`ANALYSIS_MODEL_CHAIN`移除已下线的`gemini-2.5-flash`/`gemini-2.0-flash`，改为`gemini-flash-latest` → `gemini-3.6-flash`；`_build_generation_config`改用`thinkingConfig: {thinkingLevel: "minimal"}`；`_NON_THINKING_MODELS`例外名单保留机制但清空（链中模型均为3.x，默认都支持thinkingConfig，若未来加入不支持的模型可放回此名单跳过） | 待测试（总agent将直接对生产端点发起真实请求验证是否返回有效analysis，本轮未做本地mock测试，交由部署后实测确认） |

---

## 七、整体优化路线图

### 短期优化（可立即执行）
- [ ] 测试并记录 Nano Banana Pro 生成图质量
- [ ] 测试 Gemini 提示词增强后的效果
- [ ] 补充缺失的神煞（目前只有26个，传统有百余个）
- [ ] 优化空亡的视觉表现描述
- [ ] 生产环境验证 gemini_analysis.py 模型链修复是否解决"AI深析"兜底文案问题

### 中期优化
- [ ] 为不同日主定制专属 Gemini 提示词
- [ ] 根据用户反馈调整各档五行的视觉密度
- [ ] 增加季节/时辰对岛屿光线的影响

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
| `island_service/gemini_analysis.py` | Gemini AI命盘深度解读，模型链见 `ANALYSIS_MODEL_CHAIN` | ✅ 修改 prompt 模板 |
| `island_service/gemini_image.py` | Nano Banana Pro 图像生成，含附加样式提示 | ✅ 修改 enhanced_prompt |
| `island_service/tripo_client.py` | TripoAI 3D转换参数 | ✅ 修改 face_limit 等参数 |
| `island_service/main.py` | 流水线控制，含兜底逻辑 | ⚠️ 修改需谨慎 |
| `render.yaml` | 后端部署配置（模型名等环境变量） | ✅ 修改环境变量 |
