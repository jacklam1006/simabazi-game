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
[步骤 2] Gemini 3.5 Flash 深度分析（gemini_enhance.py）
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

## 三、步骤2：Gemini 3.5 Flash 系统提示词 — gemini_enhance.py

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

---

## 五、步骤4：TripoAI 3D转换 — tripo_client.py

### 模型信息
- **模型ID**：`P1-20260311`（TripoAI当前最新模型）
- **主路径**：image-to-3D（Gemini图像 → 3D）
- **兜底路径**：text-to-3D（直接用提示词 → 3D，Gemini失败时自动切换）
- **超时设置**：150秒（约2.5分钟）

### 转换质量参数

| 参数 | 当前值 | 作用 |
|------|--------|------|
| `face_limit` | 15000 | 模型面数，越高越精细 |
| `texture` | True | 保留材质贴图 |

### 如何优化3D质量
- **提高精细度**：将 `face_limit` 从 15000 提高到 30000（成本加倍）
- **提高轮廓质量**：优化 Nano Banana Pro 生成图的边缘清晰度（见步骤3）

---

## 六、整体优化路线图

### 短期优化（可立即执行）
- [ ] 测试并记录 Nano Banana Pro 生成图质量
- [ ] 测试 Gemini 3.5 Flash 增强后的提示词效果
- [ ] 补充缺失的神煞（目前只有26个，传统有百余个）
- [ ] 优化空亡的视觉表现描述

### 中期优化
- [ ] 为不同日主定制专属 Gemini 3.5 Flash 提示词
- [ ] 根据用户反馈调整各档五行的视觉密度
- [ ] 增加季节/时辰对岛屿光线的影响

### 长期优化
- [ ] 收集用户评分，建立提示词A/B测试机制
- [ ] 允许用户手动选择岛屿风格（仙侠/国风/赛博）
- [ ] 支持岛屿局部重生成（如只改换神煞物件）

---

## 七、文件对照表

| 文件路径 | 作用 | 人工可调整 |
|---------|------|----------|
| `island_service/bazi_prompt.py` | 规则引擎，八字→描述映射 | ✅ 直接编辑字典 |
| `island_service/gemini_enhance.py` | Gemini 3.5 Flash 系统提示词 | ✅ 修改 system_instruction |
| `island_service/gemini_image.py` | Nano Banana Pro 图像生成，含附加样式提示 | ✅ 修改 enhanced_prompt |
| `island_service/tripo_client.py` | TripoAI 3D转换参数 | ✅ 修改 face_limit 等参数 |
| `island_service/main.py` | 流水线控制，含兜底逻辑 | ⚠️ 修改需谨慎 |
| `render.yaml` | 后端部署配置（模型名等环境变量） | ✅ 修改环境变量 |
