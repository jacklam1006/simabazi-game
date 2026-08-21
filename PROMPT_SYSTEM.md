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

### 修改记录
| 日期 | 修改内容 | 效果 |
|------|---------|------|
| 2026-08-13 | 抽取 `STYLE_ANCHOR` 命名常量（此前"STYLE REQUIREMENTS: low-poly geometric style like premium mobile game art..."这段文本只内联写在 `generate_island_prompt()` 结尾一处）。`generate_island_prompt()` 原地改用该常量，不改变输出内容，纯重构。同时新增离线批量资产生成脚本 `island_service/generate_wuxing_assets.py`（第四阶段"五行维护系统"3D资产生产流程，本次只完成脚本编写+`--dry-run`审阅，尚未实际调用付费API生成资产），该脚本引用同一个 `STYLE_ANCHOR` 常量拼装"五行维护"装饰物孤立取景提示词，避免岛屿主体与装饰物两处各自维护一份重复的风格描述文本、以后互相走偏 | 已验证（`generate_island_prompt()` 重构后经本地对比确认输出文本与改动前完全一致；`generate_wuxing_assets.py --dry-run` 已实际跑通，人工审阅31条prompt文本内容通过。用户后续在自己电脑上用真实 `GEMINI_API_KEY`/`TRIPO_API_KEY` 完整跑完 `--sample`+全量生成，详见下面两行记录） |
| 2026-08-13（总agent复查`--dry-run`输出后发现并打回修复：孤立物件取景与岛屿场景描述自相矛盾） | 上一行`STYLE_ANCHOR`把 `generate_island_prompt()` 结尾整段文本原样抽出，其中混了两类不同性质的内容——①跨场景通用的风格语言（低多边形/无写实渲染/中式神话美学/从上方打光）；②专属"完整浮岛取景"的场景描述（"floating island with rocky underside, dark starry background with subtle nebula"本身就是在描述一整个地形/场景物体）。`generate_wuxing_assets.py` 的"孤立小装饰物"提示词原样整段复用了这个常量，导致每条prompt同时出现"ISOLATED OBJECT SHOT: ...no ground plane and no other objects or scenery of any kind..."（要求干净孤立、绝无场景）与"floating island with rocky underside..."（本身是在要求画一整个浮岛场景）两句互相打架的指令，容易让生成模型把装饰物画成"长在一座小浮岛上"，破坏3D提取所需要的清晰轮廓。修复：`bazi_prompt.py`把 `STYLE_ANCHOR` 拆成三个不互相依赖拼接顺序的私有拼图块（`_STYLE_GENERIC`/`_STYLE_LIGHTING`/`_STYLE_ISLAND_SCENE`），分别组装出两个用途不同的公开常量——`STYLE_ANCHOR`（完整岛屿专用，内容与拆分前逐字节完全一致，`generate_island_prompt()`不受影响）+ `STYLE_ANCHOR_CORE`（跨场景通用，含"从上方打光"、不含任何岛屿场景描述）。`generate_wuxing_assets.py` 改为只引用 `STYLE_ANCHOR_CORE`，不再引用完整版 `STYLE_ANCHOR` | 已验证（已用脚本核对 `STYLE_ANCHOR` 与拆分前原始文本逐字符相等、`generate_island_prompt()` 输出长度/结尾内容不变；`STYLE_ANCHOR_CORE` 已确认不含"floating island"/"nebula"字样；`--dry-run` 31条prompt逐条确认"floating island"出现次数为0、"no ground plane and no other objects"仍在全部31条中各出现1次，矛盾已消除。用户后续用真实API跑完`--sample`，7个GLB全部成功生成，临时Three.js查看器目视确认孤立物件风格正常、未出现"装饰物长在小浮岛上"这类矛盾产物） |
| 2026-08-13（用户真实跑完`--sample`目视复查后打回修复：nourish方向t3档反而比t1更茂盛，三档区分度不够） | 用户在自己电脑上用真实 `GEMINI_API_KEY`/`TRIPO_API_KEY` 跑完 `--sample`（木行6个组合+`shrine_generic`共7个GLB全部成功生成），临时用Three.js查看器目视核验后发现：木行nourish方向的`wood_nourish_t3`（亟待，理应最需要关注）反而比`wood_nourish_t1`（安泰）叶片更多更蓬松，完全没有"需要打理"的视觉信号；restrain方向（藤蔓/荆棘）三档区分度当时判断还可以，不需要大改，但因为二者共用同一份`TIER_MODIFIER`文本，改nourish不能连带把restrain已经不错的效果改坏。根因：原`TIER_MODIFIER`每一档只写"不能出现死亡/枯萎/恐怖意象"这条禁止清单，没有给出"那应该长什么样"的具体正面描述，AI对着"嫩芽"这种本体意象就是生机勃勃的物件，容易把"不能画得像要死"过度理解成"那就继续往健康了画"。修复：放弃nourish/restrain共用一份`TIER_MODIFIER`的设计，拆成`TIER_MODIFIER_NOURISH`（档位轴="是否被悉心照料"，越差越"蔫"：叶片低垂、颜色转暗、变得单薄稀疏）/`TIER_MODIFIER_RESTRAIN`（档位轴="是否被修剪收敛"，越差越"野"：向外蔓延更远、轮廓更密更乱），每档在保留"不能出现死亡/腐烂/阴森意象"这条红线的同时，都新增一句该档位具体该长什么样的正面描述，不再只靠"禁止清单"倒逼AI自己猜。`build_prompt()`相应按`direction`查表选用对应字典。`shrine_generic`提示词未改动（已用脚本核对与改动前逐字节一致），不重新生成，节省预算 | 已执行（`--dry-run`重新跑过，31条prompt逐条核对；木行nourish/restrain共6条新文本经总agent+用户审阅确认达到"给出具体描述而非只说不能怎样"的要求后，用户用`--only=木:nourish --force`+`--only=木:restrain --force`两次调用真实重新生成了对应6个GLB，目视复核确认三档区分度问题已解决。此后用户执行全量生成补齐其余五行，最终磁盘上共25个真实GLB（5个五行×2方向×3档中的4个五行共24个 + `shrine_generic`1个）——**水行6个组合（`water_nourish/restrain_t1~t3`）因TripoAI账户额度耗尽未能生成，用户主动决定暂不补齐（非bug，见下方 `tripo_client.py` 章节2026-08-14条目的额度耗尽根因记录）**。**⚠️2026-08-22更新：水行6个GLB已由用户改用TripoAI Studio网页界面手动生成补齐（不是本脚本`--only`跑出来的），压缩+接入详见`claude-docs/已知问题与修复记录.md`2026-08-22条目——不要再对这6个组合执行本脚本的`--only=水:...`（会白白消耗额度重新生成一遍已经有的资产）） |
| 2026-08-14（qa-reviewer复查真实全量生成过程后打回修复：2个CONFIRMED安全网缺失+2个PLAUSIBLE） | 上一行记录的"水行6个组合额度耗尽"真实事故复查后发现两处更严重的隐患：**CONFIRMED 1**——`generate_one()`调用顺序是先付费调`gemini_image.generate_island_image()`出图、再调`tripo_client.submit_image_to_3d()`，而`except Exception`兜底+`_run_batch()`无条件`continue`会让额度耗尽后剩余每个组合都先白烧一次Gemini出图费用才在Tripo阶段失败——真实全量跑时水行6个组合就是这样被逐个扣费的；`tripo_client.TripoInsufficientCreditError`（前一轮刚加的独立异常类型）在本脚本里完全没人识别消费（grep零匹配）。**CONFIRMED 2**——`--help`/`-h`、拼错的`--dryrun`（少连字符）、`--only 木:nourish`（`=`打成空格）这几种情况会静默落进最后的全量付费生成`else`分支，对一个反复强调"务必先--dry-run"的付费脚本是最容易出事的漏洞。**PLAUSIBLE 3**——断点续跑"已存在则跳过"只判断`size>1024字节`，不校验GLB有效性，且直接`write_bytes`不是原子操作，中途Ctrl-C或下载被截断会在磁盘留下残缺文件、之后每次续跑都被误判为"已完成"永久跳过。修复：①`generate_one()`捕获`TripoInsufficientCreditError`后显式`raise`重新抛出（不再被吞进`'fail'`），`_run_batch()`新增`try/except`识别该异常，命中后打印剩余未执行组合数并立即`break`整批，不再继续烧钱；②CLI入口新增`--help`/`-h`打印`__doc__`用法说明后`sys.exit(0)`，**首次修复**在`else`全量分支前新增了参数校验（后来证明位置有误，见下一行订正）；③新增`_is_valid_glb()`校验文件开头4字节magic bytes是否为`b'glTF'`（不止size），断点续跑跳过判断改用此函数；下载到的`glb_bytes`在写入前也做同样的magic bytes校验，不合法直接判`'fail'`不写盘；写入方式改为先写`.tmp`临时文件再`os.replace()`原子替换，避免进程中断留下半成品。PLAUSIBLE 4：同批一并修正了上面三行历史记录"效果"列的过期表述（原写"待测试"/"留待用户审核"，但`--sample`/全量生成/木行区分度修复均已真实执行完毕），并补充了水行6个组合缺失是用户主动决定、非bug的说明 | 用mock覆盖4类场景全部通过：①mock一次TripoAI额度耗尽（第1个组合提交即抛`TripoInsufficientCreditError`），确认批次仅消耗1次Gemini调用+1次Tripo提交调用后立即`break`，后续3个组合完全未触发任何API调用；②实测CLI真实调用`--help`/`-h`（打印`__doc__`后`exit(0)`）、`--dryrun`拼写错误（打印"无法识别的参数"+用法说明后`exit(2)`）、`--only 木:nourish`不带`=`（同样正确报错`exit(2)`），三种情况均确认零API调用、不落入全量分支；③构造一个"NOTGLTF"开头、2027字节（超过1024字节旧阈值会被误判为完成）的伪造残缺文件，确认`_is_valid_glb()`正确判定为无效、`generate_one()`不跳过而是重新走完整生成流程并用mock返回的合法`glTF`字节正确覆盖写入；④额外验证下载阶段返回被截断的非法字节（不以`glTF`开头）时，`generate_one()`正确返回`'fail'`且不在目标路径写入任何文件、不留`.tmp`残留。`python3 -m py_compile island_service/generate_wuxing_assets.py`通过 |
| 2026-08-14（qa-reviewer第二轮复查揪出上一行CONFIRMED 2的修复位置本身有误，第三轮复查修复后确认彻底清空） | 上一行CONFIRMED 2的修复把校验塞进了`else`全量分支**内部**，但真正的漏洞场景是"合法动作flag（`--sample`/`--only=xxx`）与拼错flag混用"——这种情况下`elif '--sample' in args`这类membership判断本身依然为真，会直接跳进对应分支的生成逻辑，完全绕开塞在`else`里的校验（`--sample --dryrun --force`会直接付费生成7个组合，`--only=水:nourish --dryrun`会直接付费生成3个组合）。修复：把`KNOWN_FLAGS = {'--force','--dry-run','--sample','--help','-h'}`白名单校验挪到**所有分支判断之前**统一执行一次（不含`--only=xxx`前缀的token都判定为未知参数），不管最终要走哪个分支，只要参数列表里混入无法识别的token就直接`sys.exit(2)`，不再区分"落在哪个分支内部"。顺手处理2个此前记的PLAUSIBLE：`--only=`空值现在也走`sys.exit(2)`（原本是`return`，退出码0，容易被shell脚本/CI误判成功）；额度熔断卡在`shrine_generic`这一项时失败清单的标签，改用新增的共享辅助函数`_label_for(wx, direction, tier)`（与`generate_one()`内部逻辑一致），不再拼出`shrine_None_tNone`这种乱码 | qa-reviewer第三轮复查独立搭建mock网络调用计数器（真实子进程运行、真实退出码，不是读代码推测），对24组参数组合逐一实测：上一轮3个漏判场景（`--sample --dryrun --force`/`--only=水:nourish --dryrun`/`--sample --force --typo`）+qa-reviewer自己新戳的15组边界case（`--Force`大小写不一致、`-only=木:nourish`少连字符、重复`--force`、纯符号参数等）全部确认零API调用+`exit(2)`；合法组合（`--sample --force`/`--only=木:nourish --force`/零参数全量/`--dry-run`）确认未被误伤，依然正确派发到对应分支；额外用磁盘文件数量+mtime交叉核对，确认整个验证过程全程未触碰真实`assets/decorations/wuxing/`目录下已有的25个文件。`python3 -m py_compile`通过。至此该脚本经过总agent 2轮人工审图+qa-reviewer 4轮复查，代码层面CONFIRMED发现清零 |
| 2026-08-16 | 配合`js/bazi-engine.js::_interactions()`从3类地支关系（冲/合/三合）扩展到完整8类（新增三会/三刑/自刑/害/破），`generate_island_prompt()`首次用上此前完全没进入主岛提示词的`tenGods`（十神）/`interactions`（地支关系）/`favorable`（喜用神）三类数据，做"画龙点睛"式精简增强（不逐项全列，避免提示词膨胀稀释视觉指令密度）：①新增`_ten_god_dominant_line()`——统计四柱十神主导类别（印枭/比劫/食伤/财星/官杀5类，新增`TEN_GOD_CATEGORY`/`TEN_GOD_VISUAL`字典），只在存在唯一主导类别（某类别出现次数≥2且严格多于其余类别）时才输出一句`CHART TENDENCY`视觉修饰，平局/无重复类别时不输出（保证确定性，不做任意选择）；②新增`_interaction_dynamics_line()`——按优先级"三会（气最集中）>三刑/自刑（内在张力）>冲（现有代码此前完全没用上interactions里的冲）"从命中的关系类型里只挑最有代表性的一类，输出一句`TERRAIN DYNAMICS`地形动态暗示（新增`INTERACTION_VISUAL`字典），不逐条列出全部命中关系；③新增`_favorable_emphasis_line()`——喜用神对应五行加一句`FAVORABLE ELEMENT EMPHASIS`整体基调强化，对`favorable`字段做防御性类型处理（历史上出现过"应为数组却存成字符串"的反向bug，这里做的是相反方向的防御：字符串直接用，意外传入list/tuple时取第一个元素，其余类型忽略不报错）。三行都是可选追加，数据缺失/不满足条件时返回空字符串，不影响老存档（无`tenGods`/`interactions`/`favorable`字段）的现有输出。`generate_tripo_short_prompt()`未改动。顺手修正了文件底部`__main__`测试夹具里的一个既存小bug：`kongwang`样例数据此前误写成逐柱dict（`{'year':[...], 'month':[...],...}`），与`js/bazi-engine.js::_calcKongwang()`真实返回的"整盘唯一一对扁平数组"（如`['戌','亥']`，取自日柱旬空）结构不一致，`generate_island_prompt()`主逻辑一直是按数组正确处理的，只是这份测试夹具数据形状本身错了，join()会拼出"year, month, day, hour"这种无意义文本而非真实地支——只影响手动跑`python3 bazi_prompt.py`时的自测可读性，不影响生产调用路径（生产路径始终由`main.py`传入真实`BaziEngine.calculate()`产出的数组） | 已验证（`python3 -m py_compile island_service/bazi_prompt.py`通过；用真实`js/bazi-engine.js::BaziEngine._interactions(['巳','午','午','未'])`跑出的结果作为`interactions`样例数据（不是手写编的），确认`__main__`测试样例跑出的提示词里`CHART TENDENCY (官杀主导)`/`TERRAIN DYNAMICS`（命中三会，优先于同时存在的自刑）/`FAVORABLE ELEMENT EMPHASIS (WATER)`三行均正确追加、位置在SHENSHA块之后/void_note之前、读起来自然不啰嗦；另用最小字段的旧格式样例数据（无`tenGods`/`interactions`/`favorable`/`kongwang`为空数组）验证不报错、三行均不出现，向后兼容确认无回归） |
| 2026-08-16（qa-reviewer复查上一行改动后打回修复：`_favorable_emphasis_line()`措辞与五行占比0%自相矛盾） | 喜用神在命理定义上经常就是命盘里占比最低甚至为0%的那个五行（身弱命局取生我同我两条（印+比劫），中和命局直接取占比最低的一行，见`js/bazi-engine.js::_favorable()`）——这不是边界情况而是常态。原措辞"the {label} elements described above should feel slightly more vivid, abundant, and pronounced than the rest of the island"预设了"上文已经描述过这个元素的实体、且数量不算少"，占比0%时FIVE ELEMENTS LANDSCAPE那行已明确写"completely dry, cracked earth, no water at all"，两句话直接矛盾，会把互相打架的指令一起喂给`gemini_enhance.py`（其强规则要求"保留所有已列出的具体元素描述"，矛盾指令会被原样保留传下去），大概率生成不该有水却有水的岛，违背"岛屿如实反映五行分布"这条产品核心原则，PROMPT_SYSTEM.md:113记录过2026-08-13同类矛盾被打回的先例。修复（改措辞而非按占比设阈值分支，避免引入新的阈值调参负担）：改为不预设数量基础的写法——"{label} is this chart's most beneficial element. Even if {label} is sparse or nearly absent elsewhere on the island, let at least one small trace of it — a glint, a droplet, a thread of color — survive somewhere, feeling unusually clear and luminous, like a quiet point of hope rather than an afterthought."，无论该五行在上文占比是0%还是很高都不再自相矛盾。顺手给`_ten_god_dominant_line()`补上跟`_favorable_emphasis_line()`同款的`isinstance(ten_gods, dict)`类型防御（此前`tenGods`若传入非dict会直接`AttributeError`） | 已验证（`python3 -m py_compile island_service/bazi_prompt.py`通过；复用`__main__`测试夹具，`favorable='水'`对应`wuxing`里`水:0`即0%占比，实测`generate_island_prompt()`输出确认`FAVORABLE ELEMENT EMPHASIS`一行不再出现"described above"这类预设已大量存在的措辞，与同时出现的"WATER (0%): completely dry, cracked earth, no water at all"不再矛盾） |

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
| 2026-08-14（真实全量生成时复现的误导性报错，用户排查后打回修复） | `generate_wuxing_assets.py`全量生成时，水行6个组合在TripoAI提交阶段全部失败，但报出的是`TripoAuthError`"鉴权失败，怀疑TRIPO_API_KEY无效/过期/被吊销/未配置"——而TripoAI原始响应实际是`{'code': 2010, 'message': "You don't have enough credit to create this task", 'suggestion': 'Please purchase more credit'}`，是账户**额度耗尽**，跟Key是否有效完全是两回事。根因：此前`is_auth_error`判定规则里"HTTP status in (401,403) 即视为鉴权失败"过于粗粒度，TripoAI对"额度不足"这类错误在HTTP层也会用401/403返回，导致额度问题被误判成鉴权问题，浪费了用户重新核实Key的排查时间。修复：`_parse_tripo_response()`新增`TripoInsufficientCreditError`独立异常类型，判定逻辑（`_CREDIT_ERROR_CODES=(2010,)`+`_CREDIT_ERROR_HINTS`关键词兜底）排在鉴权判定**之前**，命中额度不足特征后不再继续走鉴权判定，避免被状态码规则抢先误判；未识别的其它错误仍走原有的通用`RuntimeError`兜底，不需要穷举TripoAI全部错误码。`TripoInsufficientCreditError`是`RuntimeError`子类，`upload_image()`里已有的`except (TripoAuthError, RuntimeError)`+`type(parse_err)(...)`重新包装逻辑无需改动即可正确覆盖新异常类型 | 用mock `requests.Response`覆盖4个场景全部通过：①`{code:2010, message含credit}`+HTTP 403（真实复现的组合）正确判定为`TripoInsufficientCreditError`而非`TripoAuthError`；②真正的鉴权失败（`message`含"invalid API key"）仍正确判定为`TripoAuthError`；③未识别的其它错误（HTTP 500，code:999）仍正确判定为通用`RuntimeError`；④正常成功响应（code:0）不受影响，`_parse_tripo_response()`正常返回。纯错误信息文案修正，不涉及业务逻辑，未做真实TripoAI API端到端验证 |

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
    ↓ Step1+2输出作为Step2b+Step3-6+四柱详解+神煞详解+命盘特点详解的共享上下文
Step2b 十神详解（命盘实际出现的十神组合逐一详解）─┐
Step3 事业与财富深度剖析（财官印组合）─┤
Step4 婚恋与感情世界（日支夫妻宫+异性星）─┤ asyncio.gather 并行发起
Step5 健康与潜在风险提示（五行偏弱+地支相冲）─┤（互不依赖，只依赖Step1+2）
Step6 大运与流年运势推演（当前大运+2026丙午流年）─┤
四柱详解（年/月/日/时逐柱大白话译文+藏干+针对本命盘的意义）─┤
神煞详解（命盘实际出现的每个神煞逐一详解，条数不固定）─┤
命盘特点详解（Step1已有3条优势+3条注意事项逐条展开为详细说明）─┘
```

**2026-08-03 新增 Step2b「十神详解」**：跟Step2「定格局与找用神」角度不同、互补而
非重复——Step2从格局/用神策略角度给人生方向指导，Step2b更聚焦"十神"这个维度本身，
说明命盘里实际出现的十神组合具体对应怎样的性格特质/行为模式/人生课题。只依赖
Step1+2的结果，因此跟Step3-6同一依赖层级、加入同一个 `asyncio.gather` 并行批次，
不单独占用一个串行阶段（否则会多出一整段串行耗时）。字段名 `step2b_shishen`——
故意不占用 `step3`~`step6` 这几个已被前端/缓存依赖的字段名，只新增一个新字段。

**2026-08-04 新增「四柱详解」`step_pillars_detail` + 「神煞详解」`step_shensha_detail`**：
响应"点击岛屿命柱/神煞标签弹出的详情内容太单薄（几十字静态短句），要改成AI动态生成、
分类清晰、不懂八字的人也能读懂"的需求，供前端 `js/analysis.js::buildPillarPanel()`/
`buildShenshaPanel()` 消费（原有静态字典兜底内容完整保留，AI结果未就绪/未传入时
自动回退，不报错不空白）。同样只依赖Step1+2，加入既有 `asyncio.gather` 并行批次。
- **四柱详解**一次调用覆盖全部四柱（不拆成4次调用——四柱需要互相衔接语气+共享同一
  份命盘上下文，拆开会四倍化RAG+网络开销）。每柱三个大白话分类小节：`plain_meaning`
  （干支+纳音翻译成大白话）、`hidden_stems`（地支藏干是什么、"表面看到的/底层藏着
  的倾向"，用 `_build_context()` 里透传的前端 `hiddenStems`/`nayin` 真实数据，不
  编造）、`role_in_this_chart`（结合这张命盘真实十神/身强弱/五行喜忌的针对性判断，
  不是"年柱代表祖辈根基"这种通用套话）。日柱 `role_in_this_chart` 额外允许侧重
  "配偶宫"角色。
- **神煞详解**一次调用覆盖 `ctx['shensha']` 里全部现存神煞（同理不拆分调用），条数
  按命盘实际神煞数走（实测均值11个、10%-90%分位数7-15个、极端范围1-21个）。每条
  `name`/`nature`（吉/凶/中性）/`concept`（40-60字）/`personal_impact`（60-90字）/
  `advice`（40-60字），单条控制在150-220字量级（不是本文件其它步骤narrative
  350-650字那个量级——多条堆叠会撑爆输出预算，也不适合侧边抽屉面板逐条阅读）。
  命盘无神煞时直接返回空数组，不打无意义的Gemini请求（**这不是纯理论边界**——
  2026-08-11穷举全部518,400组合法四柱后找到了真实存在的零神煞命盘：己巳己巳
  己巳己巳，对应真实公历生日1989-05-09巳时，详见下方JSON结构说明里`no_shensha`
  标记字段的由来）。
- **失败隔离**：这两步是本次改动里*唯二*带独立失败隔离的并行任务
  （`_step_pillars_detail_safe()`/`_step_shensha_detail_safe()` 内部捕获
  `GeminiCallError` 返回空dict）——因为是"点击标签才会看到"的补充细节而非六/七步
  核心叙事主体，不应该因为一次调用失败拖垮整条 `analyze_bazi()` 请求；其余5个既有
  并行步骤保持原有"任一失败则整体失败"行为不变。
- **`max_tokens`**：四柱详解复用Step2已验证的 `7168`；神煞详解因数量不定、极端场景
  （20+条）内容量远超本文件其它任何单步预算，单独设为 `16384`（约为其它步骤共用的
  MAX_TOKENS加倍重试封顶值8192的2倍）——这会让 `_call_gemini()` 内部"同模型加倍
  预算重试"判断（`budget<8192`）对本步骤失效（初始budget已大于8192），实际重试
  策略从"同模型加倍重试1次+换模型"变为"2个候选模型各尝试1次"，是已知的既有共用
  逻辑在大budget场景下的自然结果，不是bug，具体推导见 `gemini_analysis.py::
  _step_shensha_detail_sync()` 上方大段注释。评估后判断**不需要**连带上调90s单次
  HTTP超时/550s前端超时——90s是`requests.post`物理超时，预算大小不改变这个硬上限，
  且并行批次里"最慢任务决定阶段耗时"的模型下，神煞详解的最坏路径（2模型×1次×90s=
  180s）反而比其它步骤的360s更短；典型场景（7-15条）所需生成量远小于21条的
  worst-case估算，具体推导过程见 `js/bazi-analysis.js::AI_ANALYSIS_TIMEOUT_MS`
  定义处对应注释。
- **落盘前结构校验**：`_sanitize_pillars_detail()`/`_sanitize_shensha_detail()`——
  内容是文本不是数字，不适合像六维打分字段那样兜底默认值，改为"跳过式降级"：
  字段不全的柱子/名称对不上命盘真实神煞列表（防模型幻觉）的条目直接从结果中剔除，
  只影响这一小块内容缺失，不影响其它柱子/条目和整条报告。
- **前端渲染**：`buildPillarPanel(col, baziData, pillarAiDetail)`/
  `buildShenshaPanel(name, baziData, shenshaAiDetail)` 新增第三个可选参数（AI内容
  切片，`undefined`时完全走原有静态路径），函数本身依然是同步的、不在内部发起网络
  请求——由调用方负责拿到AI结果后传入（下一轮 `user-system` 领域负责接线main-new.js
  的调用点）。
- **顺手修复**：`js/analysis.js::ssDesc()` 补上"孤辰"这一条静态兜底描述（此前
  `js/tutorial.js::SS_DESC` 有这一条、`analysis.js` 没有，命中孤辰神煞时走的是
  通用兜底文案"孤辰神煞，影响命运走向"，两处内容不一致）。

**2026-08-11 新增「命盘特点详解」`step_traits_detail`**：响应"3D岛屿命盘特点标注"
第一阶段需求，把Step1已生成的3条`strengths`（性格优势短句）+3条`cautions`（注意
事项短句，各≤30字）逐条展开成详细说明，供前端 `js/island-annotate.js` 新增的
✅/⚠️锚点点击后、`js/analysis.js::buildTraitPanel()` 渲染详情。同样只依赖
Step1+2，加入既有 `asyncio.gather` 并行批次，用 `_step_traits_detail_safe()` 做
独立失败隔离（同四柱/神煞详解）。
- **严格3+3按index一一对应展开**，不允许AI改写原句/增删/换序；Step1若未按要求
  恰好产出3+3条，直接短路返回空dict，不做部分对齐或强行补全——这是刻意的设计
  例外：跟四柱/神煞详解允许"部分完整"（跳过式降级）不同，这里没有"部分可用"的
  中间态，如果只对齐2/3条就落盘，前端按index配对`summary`+`detail`时会出现错位，
  比完全没有detail（优雅降级回退summary本身）更糟。落盘前 `_sanitize_traits_
  detail()` 同样按"3+3全齐或整体判定为空"取舍，`_cache_read()` 新增第五道校验
  `_traits_detail_valid()` 也是同一口径（要求恰好3条，不是"非空"）。
- **核心措辞约束**（用户明确强调、优先级高于任何未来变现设计）：展开说明必须
  忠实于命理逻辑本身推导出的结论（十神/五行/身强弱等真实推导依据），如实反映
  这条优势/注意事项在命盘里的真实权重，绝不能为了让内容显得更严重/更需要处理
  而夸大问题、制造焦虑感，也不能使用任何带货/营销式的措辞——延续本项目AI人设
  一贯坚持的"去掉水晶推荐/会员营销话术"原则（见 `PERSONA_SYSTEM` 附近注释），
  诊断内容与后续可能挂载的商业化展示（游戏币兑换实体水晶等，第二阶段范围）是
  完全独立的两层，不应互相渗透。cautions额外要求一句具体可执行的化解/调整建议
  （不要空泛的"多注意"）。
- **`max_tokens=7168`**：直接复用Step2已验证的量级，不新造未经验证的数字——本
  步骤内容量约6条×80-120字≈480-720字，比pillars详解同量级或更小，远小于shensha
  详解最坏场景。
- **缓存版本v5→v6**：`js/bazi-analysis.js::LS_PREFIX` 从 `bazi_ai_v5_` 升级为
  `bazi_ai_v6_`，`_lsGet()`/`seedCache()` 同步新增 `_traitsDetailValid()`（与
  后端同一套"3+3全齐"判定粒度，两处共用同一份判断逻辑）。

每一步内部：① 用该步骤专属的数据（如日主、十神组合、财官印星、日支等）拼一句
检索query → ② 调 `rag_service.query("bazi", query)` 检索知识库，拿到原文片段
（查不到就是空字符串，正常继续，见下方"RAG检索契约"）→ ③ 把命盘核心资料 + 检索
片段 + 该步骤专属输出格式要求拼成完整prompt → ④ 调用 `_call_gemini()`（复用原有
的模型链+MAX_TOKENS重试机制，全六步共用同一套）→ ⑤ 解析成dict。

**输出JSON结构**（替换原来的 `day_master_reading`/`four_pillars`/`six_dimensions`/
`year_advice`；2026-08-03 内容深度扩充后追加 `step2b_shishen` + Step1新增
`strengths`/`cautions`；2026-08-04 再给 Step2~Step6 各自追加一个0-100数值化打分
字段，供前端总览Tab渲染"六维雷达图"；2026-08-04 又追加 `step_pillars_detail`/
`step_shensha_detail` 两个新步骤，供前端命柱/神煞点击面板渲染AI详解；2026-08-11
再追加 `step_traits_detail`，把Step1的`strengths`/`cautions`短句逐条展开成详细
说明，其余字段名不变）：
```json
{
  "step1_foundation":       { "title": "...", "narrative": "...", "wuxing_note": "...", "strengths": [...], "cautions": [...] },
  "step2_pattern_yongshen": { "title": "...", "pattern": "...", "yongshen": [...], "narrative": "...", "pattern_score": 0-100 },
  "step2b_shishen":         { "title": "...", "narrative": "...", "shishen_items": [{"name": "...", "meaning": "..."}] },
  "step3_career_wealth":    { "title": "...", "narrative": "...", "career_directions": [...], "career_score": 0-100, "wealth_score": 0-100 },
  "step4_relationship":     { "title": "...", "narrative": "...", "partner_traits": "...", "key_periods": [...], "relationship_score": 0-100 },
  "step5_health":           { "title": "...", "narrative": "...", "watch_points": [...], "health_score": 0-100 },
  "step6_dayun_liunian":    { "title": "...", "narrative": "...", "current_year_action": "...", "fortune_score": 0-100 },
  "step_pillars_detail":    { "year": {"plain_meaning":"...","hidden_stems":"...","role_in_this_chart":"..."}, "month": {...}, "day": {...}, "hour": {...} },
  "step_shensha_detail":    { "shensha_items": [{"name":"...","nature":"吉/凶/中性","concept":"...","personal_impact":"...","advice":"..."}], "no_shensha": true /* 仅命盘真实无神煞时出现，见下方说明 */ },
  "step_traits_detail":     { "strengths_detail": ["...", "...", "..."], "cautions_detail": ["...", "...", "..."] } /* 恰好3+3条，一一对应Step1的strengths/cautions，见下方说明 */,
  "keywords": ["...", "...", "...", "...", "..."]
}
```
⚠️ `step_pillars_detail`/`step_shensha_detail` 落盘的内容可能是**部分完整**的（见上方
"落盘前结构校验"说明，`_sanitize_*` 会跳过式丢弃字段不全/幻觉出的条目而不是让整条
请求失败）——`step_pillars_detail` 可能不含全部4个柱子键，`step_shensha_detail.
shensha_items` 的条数可能少于命盘实际神煞数。`_cache_read()` 的校验判定为**非空即
有效**（`step_pillars_detail` 只要非空dict、`step_shensha_detail.shensha_items`
只要非空数组即判定命中），不要求完全齐全（跟六个打分字段那种"必须全部合法"的校验
粒度刻意不同）——**2026-08-04 qa-reviewer复查返工**：初版校验粒度定得比这更严格
（pillars要求4个柱子键全部存在），导致缺一根柱子就永远无法命中缓存、每次都重新
触发整条七步流水线（CONFIRMED 2）；同时`shensha_items`初版只要求"是数组"，导致
步骤彻底失败时的空数组`[]`被永久当作有效缓存（CONFIRMED 1）。返工后统一为
"非空即有效"。**2026-08-11 qa-reviewer第四轮复查再次返工**：2026-08-04返工时的判断"未引入额外
失败标记字段"已经不成立——返工后穷举验证发现零神煞命盘真实存在（己巳己巳己巳
己巳，1989-05-09巳时），"空数组一律判定无效"这个规则会让这张命盘每次打开都
永久重跑整条流水线。修复为引入`no_shensha`（bool）显式标记字段：`_sanitize_
shensha_detail()`只以它收到的`ctx['shensha']`（命盘真实神煞列表）是否为空作为
唯一判据设置这个标记（不信任模型输出/上游data里的任何自称"无神煞"的字段，
防止模型幻觉伪造），`_shensha_detail_valid()`判定条件改为"`shensha_items`非空
**或**`no_shensha`为`True`"两者之一即有效；步骤彻底失败时的空数组`[]`不带这个
标记，仍然判定无效、允许下次重试（不影响此前CONFIRMED 1的修复效果）。`js/
bazi-analysis.js::_shenshaDetailValid()`前端镜像同一逻辑。详见
`gemini_analysis.py::_sanitize_shensha_detail()`/`_shensha_detail_valid()`
docstring。
`step_traits_detail`**落盘**（写）的校验粒度刻意不采用上面`step_pillars_detail`/
`step_shensha_detail`的"部分完整也算命中"取舍——它落盘的要么是完整的`strengths_
detail`/`cautions_detail`各恰好3条，要么整个字段是空dict（`_sanitize_traits_
detail()`按"3+3全齐或整体判定为空"处理，这条不变量未变、仍然保留），理由见上方
"新增「命盘特点详解」"小节：固定3+3按index一一对应，没有"部分可用"的中间态。
**但缓存命中（读）的校验粒度2026-08-11 qa-reviewer复查PLAUSIBLE后同日已放宽**：
`_traits_detail_valid()`/前端`_traitsDetailValid()`不再重复验证"是否恰好3+3"，
改为只检查`step_traits_detail`这个key是否存在——因为`_sanitize_traits_detail()`
已经把"3+3全齐或整体为空"这条不变量在写入前彻底把关死，读取时再验一遍条数
只是对同一不变量的重复检查、不提供额外防护，代价却是把Step1的`strengths`/
`cautions`prompt没有强制"必须恰好3条"（不像本步骤自己的prompt有这条约束）导致
的偶发2/4条短路结果，跟真正需要重试的失败一视同仁，拖累整份含其它7个步骤正常
数据的分析结果被判定整体未命中、触发不必要的8-9次Gemini调用重新生成。刻意的
取舍：`step_traits_detail`一旦落盘为`{}`不会再有自愈重试路径（跟命柱/神煞详解
"总失败仍会在下次请求触发重试"不同）——权衡后接受，因为它是点击3D岛屿✅/⚠️
锚点才会看到的补充细节，前端`buildTraitPanel()`拿到`{}`时本就优雅降级回退展示
`trait.summary`（Step1原句）本身，不留空白不报错，完整推导见
`gemini_analysis.py::_traits_detail_valid()`上方注释。
六个打分字段（`pattern_score`/`career_score`/`wealth_score`/`relationship_score`/
`health_score`/`fortune_score`）不是新增的判断维度，是给该步骤已有的narrative定性
判断追加一致的量化打分——六者共用同一段措辞模板 `_score_field_instruction()`
（三段式锚点参考0-30/30-70/70-100 + 强制"必须和narrative判断一致" + 强制"不要都
往50分附近凑，要有区分度"），`health_score` 额外要求措辞用"需要留意"而不是"差"这类
带评判色彩的词（健康是提醒不是道德判断）。前端 `js/analysis.js::_populateAiContent()`
提取这六个字段渲染"六维雷达图"，六个字段必须**全部**为合法数字才渲染真实图表，
缺一个就展示"评分数据暂不完整"的明确兜底态（不会卡在loading骨架屏），详见该文件
对应注释。

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
- **maxOutputTokens**：2026-07-29六步重构后不再是单一全局值，各步骤按自身JSON输出量传入具体预算，仍保留遇到
  `finishReason=MAX_TOKENS` 且文本为空/被截断时对同一模型自动加倍预算重试一次（封顶8192），仍失败才换下一个候选
  模型的机制，全部步骤共用同一套 `_call_gemini()`。**2026-08-04当前值**：Step1=5632（2026-08-03为4096，
  narrative/wuxing_note再加长后按增幅比例上调）、Step2=7168（2026-08-03为5120，narrative加长+新增
  `pattern_score`字段后按增幅比例上调）、Step2b=4096（未改动）、Step3/4/5/6=4096（未改动——本轮只新增
  各步一两个数值化打分字段，narrative字数不变，内容量增幅可忽略不计）、**四柱详解=7168**（与Step2同量级，
  复用已验证值）、**神煞详解=16384**（唯一超出8192重试封顶值的步骤，理由与副作用见上方"新增「四柱详解」
  「神煞详解」"小节与 `gemini_analysis.py::_step_shensha_detail_sync()` 代码注释）
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
| 2026-08-03（内容深度扩充：六步全部加长 + 新增Step2b「十神详解」+ Step1新增优势/短板 + 缓存版本v2→v3） | 用户反馈"AI深析报告内容太薄"——六步narrative目标此前只有150-220字/步，`max_tokens`早有2048-2560预算却从未被用满，纯属prompt设计保守，不是token撞墙。**内容扩充**：六步narrative目标全部大致翻倍（Step1 380-450字、Step2 350-420字、Step3/4/6 380-450字、Step5 350-420字，具体见对应 `_stepN_xxx_sync()` 函数）；career_directions（3→4条，各≤35字）、key_periods（2→3条，各≤35字）、watch_points（3→4条，各≤35字）等要点列表同步扩容；partner_traits（60-90→130-170字）、wuxing_note（50-80→110-150字）、current_year_action（40-60→90-130字）同步加长。**新增Step1 `strengths`/`cautions`两个数组字段**（各3条，≤30字/条）：从narrative拆解出的可扫读性格优势/短板要点，跟narrative连贯叙述互补不重复。**新增Step2b「十神详解」步骤**（`_step2b_shishen_sync`/`_step2b_shishen`，字段名`step2b_shishen`）：只依赖ctx+step1+step2，与Step3-6同一依赖层级，加入既有 `asyncio.gather` 并行批次（不新增串行阶段）；聚焦"十神"维度本身，结合`ctx['ten_gods_str']`真实数据逐一详解命盘中实际出现的十神组合，跟Step2策略视角互补不重复；`shishen_items`数组条数不固定，按命盘实际出现的十神种类走。**max_tokens按比例调大**：Step1 2048→4096、Step2 2560→5120、Step2b（新增）4096、Step3/4/5/6 2048→4096。**`_call_gemini_once`单次HTTP超时50s→90s**：输出字数翻倍后单次生成耗时明显变长，50s更容易触发MAX_TOKENS/超时重试拖慢整体响应。**联动`js/bazi-analysis.js`**：`AI_ANALYSIS_TIMEOUT_MS`注释里的耗时预算推导（单次Gemini调用超时值、单步/单阶段最坏耗时）需按新的90s重新推导，具体新值与推导过程见该文件对应位置注释。**缓存失效**：`_cache_read()`命中判定加严为同时要求`step1_foundation`与`step2b_shishen`两个字段都存在，否则视为旧版"薄"缓存、当作未命中重新生成覆盖；前端`LS_PREFIX`同步从`bazi_ai_v2_`升级为`bazi_ai_v3_`（见`js/bazi-analysis.js`），双重保证老用户不会命中新结构不兼容的旧缓存。**渲染层**`js/analysis.js::_populateAiContent()`同步新增Step1 `strengths`/`cautions`两个要点列表渲染、AI深析Tab新增`step2b_shishen`对应`report-section`（渲染`narrative`+`shishen_items`列表）；`_showAiFallback()`兜底逻辑未改动，新字段不存在时不渲染对应模块，不报错不空白 | mock覆盖`_call_gemini`+`rag_service.query`跑通一次完整`analyze_bazi()`：确认返回dict含`step2b_shishen`键、`step1_foundation`含`strengths`/`cautions`键，且`_parse_json()`正常解析各步prompt返回的mock JSON；额外验证`_cache_read()`新校验条件——只含`step1_foundation`不含`step2b_shishen`的旧结构缓存文件被正确判定为未命中，同时含两字段的新结构缓存文件正确命中。`python3 -m py_compile gemini_analysis.py`、`node --check js/analysis.js`、`node --check js/bazi-analysis.js`全部通过。**未做真实`GEMINI_API_KEY`端到端验证**——扩容后的prompt字数要求是否会让模型更容易输出格式错误的JSON、90s超时是否足够覆盖真实生成耗时，均需部署后用真实请求观察 |
| 2026-08-03（qa-reviewer复查修复：seedCache绕过v3缓存失效 + 超时注释推导订正 + 十神prompt数量措辞订正） | qa-reviewer对上一行"内容深度扩充"改动复查真实diff发现1个CONFIRMED+2个PLAUSIBLE，逐条修复：①**CONFIRMED**——`js/bazi-analysis.js::seedCache()`（供`main-new.js`加载已存档岛屿时把`islands.ai_analysis`种入本地缓存）没有做任何结构校验，老用户存档是v2时代旧结构（无`step2b_shishen`），登录后会被原样种进新的`bazi_ai_v3_`前缀key，导致`getAnalysis()`命中本地缓存直接返回旧版薄内容、请求根本不会打到后端，v2→v3缓存版本升级设计在这条路径上完全失效。修复：`seedCache()`新增`if (!analysis.step2b_shishen) return;`拒绝写入老结构；`_lsGet()`读取时同步加一道相同校验作为双保险（读到老结构当作未命中）。②`AI_ANALYSIS_TIMEOUT_MS`推导注释订正：明确标注`ANALYSIS_MODEL_CHAIN`当前实际长度为2（非"至少2个"），并说明设置`GEMINI_ANALYSIS_MODEL`环境变量会使链长变为3、届时最坏上限从1125s变为约1665s（当前注释按链长=2的默认状态推导，不覆盖override场景）；"235秒余量"表述订正为"最多覆盖3个串行阶段中2个阶段各命中一次MAX_TOKENS重试（额外开销180s），不覆盖3个阶段全部命中一次重试的场景（额外开销270s会超出余量触发超时）"，此前"覆盖某一步命中一次重试"的表述夸大了实际覆盖范围。③`gemini_analysis.py::_step2b_shishen_sync()`的prompt订正："shishen_items数组条数按命盘实际出现的十神种类走（通常3-5个）"改为明确说明`tenGods`只由年/月/时三柱天干计算（日柱固定为"日主"不计入），一个命盘最多3种十神、重复时更少，只有1-2种时就只输出1-2条，绝不为凑数量虚构命盘中不存在的十神——原措辞与`js/bazi-engine.js`实际数据能力矛盾，命理测算类产品让AI编造命盘不存在信息是最忌讳的问题 | `node --check js/bazi-analysis.js`、`python3 -m py_compile gemini_analysis.py`均通过。`seedCache()`修复用两个场景人工核对逻辑：传入不含`step2b_shishen`的老结构对象→函数在写入前直接return，不调用`_lsSet`；传入含`step2b_shishen`的新结构对象→正常走到`_lsSet(hash, analysis)`写入`bazi_ai_v3_`前缀key，函数对外签名/调用方式（`main-new.js`调用点）未改动。超时注释与十神prompt措辞订正属于纯文档/描述性改动，不影响运行时行为，无需额外功能测试 |
| 2026-08-04（Step1/Step2再加长 + 新增六维打分字段 + 总览Tab新增三个纯SVG图表 + 缓存版本v3→v4） | 用户用过AI深析报告后提两个新要求（已用AskUserQuestion确认设计方案）：①Step1/Step2内容再加长一点；②总览Tab新增五行强弱雷达图、身强身弱仪表盘、六维主题雷达图三个纯SVG可视化图表（不引入图表库/CDN，字符串拼接内联SVG，跟`js/analysis.js`既有HTML拼接写法一致）。**内容加长**：`gemini_analysis.py`Step1 narrative 380-450→550-650字、wuxing_note 110-150→160-200字；Step2 narrative 350-420→500-600字；Step3-6 narrative字数不变。**新增六维打分字段**（非新判断维度，是给Step2~6已有narrative定性判断追加一致的量化打分，供前端渲染六维雷达图）：Step2新增`pattern_score`（格局层次）、Step3新增`career_score`（事业运）+`wealth_score`（财运）、Step4新增`relationship_score`（婚姻情感运）、Step5新增`health_score`（健康运，措辞刻意避免"差"等评判性用词，改用"需要留意"）、Step6新增`fortune_score`（大运+今年流年综合运势）。六者共用新增的`_score_field_instruction()`措辞模板：三段式锚点参考（0-30/30-70/70-100）+ 强制"必须与narrative判断一致"+ 强制"不要都往50分凑、要有区分度"三条要求。**max_tokens**：Step1 4096→5632、Step2 5120→7168（按内容量增幅30-40%比例上调），Step3-6因只新增一两个数字字段、narrative字数不变，保持4096不变。**超时未改动**：`_call_gemini_once`单次HTTP超时（90s）与前端`AI_ANALYSIS_TIMEOUT_MS`（550s）本轮均未调整——评估后判断本轮只有Step1/Step2两步内容增幅约30-45%（不同于2026-08-03那轮六步全部翻倍），现有超时预算余量足够覆盖，具体推导见`js/bazi-analysis.js`对应注释与已知问题记录同日期条目。**前端三个图表**（`js/analysis.js`）：新增通用`_radarSvg(axes, opts)`供五行雷达图（5轴，数据来自规则引擎`d.wuxing`，按占比归一化，轴标签带具体百分比数字，原有横向条形图保留在下方作精确数值参考）与六维雷达图（6轴，数据来自AI异步结果）共用；新增`_strengthGaugeHtml(strength)`身强身弱仪表盘（0-30身弱/30-50中和/50-100身强，阈值对齐`buildReport()`里`strengthText`既有判断阈值，而不是另定一套——`strength`存在"数字/字符串类别"两种历史形态，数字时画指针+具体分数，非数字时只显示类别文字+"精确数值不可用"提示，不画假指针），放在总览Tab"命局摘要"块内；六维雷达图`buildReport()`先渲染占位骨架屏（固定id`#r-sixdim-radar`），`_populateAiContent()`拿到AI结果后原地替换——6个打分字段必须**全部**为合法数字才渲染真实图表，缺一个展示"评分数据暂不完整"兜底终态；`_showAiFallback()`（AI深析整体失败/超时场景，此时`_populateAiContent()`根本不会被调用）同步补上对`#r-sixdim-radar`的兜底态处理，避免骨架屏永久卡死不出终态。**缓存版本v3→v4**：`js/bazi-analysis.js::LS_PREFIX`从`bazi_ai_v3_`升级为`bazi_ai_v4_`；`gemini_analysis.py::_cache_read()`新增第三道校验`'fortune_score' in data.get('step6_dayun_liunian', {})`（选`fortune_score`做canary，因六个新增打分字段要么全部生成成功要么整体不落盘，任选其一等价，选它只是字面上最不易与历史字段混淆）；`js/bazi-analysis.js::seedCache()`/`_lsGet()`同步补上`typeof analysis.step6_dayun_liunian?.fortune_score !== 'number'`校验（与上一轮"只加固step2b_shishen就漏了这次新增字段"的CONFIRMED教训对齐，这次两个函数在同一次改动里就补齐，不留给下一轮qa发现） | `python3 -m py_compile gemini_analysis.py`通过；mock`_call_gemini`跑通六个`_stepN_xxx_sync()`，断言各步prompt文本含预期新字数要求（Step1含"550-650"/"160-200"，Step2含"500-600"/`pattern_score`）与新增打分字段名（Step3含`career_score`/`wealth_score`，Step4含`relationship_score`，Step5含`health_score`且含"差"字样仅出现在"不要用差"的告诫句里，Step6含`fortune_score`），并断言各步实际传入的`max_tokens`与设计值一致；`_cache_read()`用真实文件缓存验证老v3结构（有`step2b_shishen`无`fortune_score`）判定未命中、新v4结构（含`fortune_score`）判定命中。`node --check js/analysis.js js/bazi-analysis.js`通过；用jsdom驱动真实`buildReport()`+模拟`BaziAnalysis.getAnalysis()`不同resolve值，验证：数字`strength`渲染指针+具体分数、字符串`strength`（如'身强'）不画假指针+显示"精确数值不可用"；五行雷达图轴标签含百分比数字且下方条形图仍保留；六维雷达图初始为"AI 评分生成中"骨架屏，AI数据6项齐全时替换为真实雷达图svg，缺任意一项（如`wealth_score`缺失）或AI整体失败（analysis为null，走`_showAiFallback`路径）时均正确展示"评分数据暂不完整"终态而非卡死骨架屏，分数为`0`的边界值正确按合法数字处理（不被误判为缺失）；`seedCache()`/`_lsGet()`用真实`_hash()`验证老v3结构对象被拒绝写入localStorage（0条记录）、新v4结构正确写入`bazi_ai_v4_`前缀key且能被`getAnalysis()`命中（不发起fetch），手动移除已缓存记录里的`fortune_score`字段后`getAnalysis()`正确判定未命中转而请求后端。**未做真实浏览器/`GEMINI_API_KEY`端到端验证**——无computer-use/chrome MCP工具权限，本轮验证止于jsdom模拟DOM环境+mock数据，真实视觉效果（SVG在实际报告弹窗宽度下的排布、移动端适配）与扩容后prompt在真实Gemini调用下的分数区分度、JSON格式稳定性均需部署后人工/qa-reviewer实测确认 |
| 2026-08-04（qa-reviewer复查上一行三个SVG图表，3个CONFIRMED+5个PLAUSIBLE逐条修复） | qa-reviewer复查发现：①身强身弱仪表盘的"数字strength画指针"分支是死代码（`bazi-engine.js::_strength()`实际只返回字符串三分类，全项目从未产出数字strength，生产环境仪表盘从未画出过指针）；②`_cache_read()`的六维打分canary只查`fortune_score`一个字段"是否存在"，前提"六字段要么全部生成要么整体不落盘"不成立（`_parse_json()`只做语法解析不校验字段齐全），模型漏一个字段会被当作有效缓存永久返回，前端六维雷达图永久卡"评分数据暂不完整"；且后端用`in`、前端用`typeof`两种口径不一致，字符串分数会导致两端判断相反；③五行强弱雷达图按"占总分百分比"归一化，五项合计恒约100（均值20），多边形恒定挤在外圈20%-45%区间，强弱悬殊的数据画出来也是小扁形。另有5个PLAUSIBLE（区分度要求在并行架构下机制上不生效、超时注释"放大到130s"的错误推导、Step2 max_tokens重试余量表述不准、_isValidScore缺0-100范围校验，1个明确不用改） | **C1**：`bazi-engine.js::_strength()`改为返回`{category, score}`，新增`strengthScore`字段（0-100，`score100=50+(score/total)*50`，`total=assist+print+consume`是`_calcWuxing()`权重方案下恒等于10.75的结构性常量，非经验估值），不改变`strength`字符串字段本身语义/阈值。`js/analysis.js::_strengthGaugeHtml(strength, strengthScore)`改双参数，数值存在时画真实指针，区间分界线（≈47.67/52.33）与引擎内部±0.5阈值同一映射公式换算保持自洽；不存在时保留静态兜底。修复数值文字被viewBox裁切（barY 24→36，H 62→74）。**C2**：新增`_SCORE_FIELD_PATHS`常量驱动`analyze_bazi()`落盘前`_validate_score_fields()`类型校验+兜底50分（选择"给默认值"而非"整体重试"：六维打分非报告主体内容，重试5个并行调用成本不划算）与`_cache_read()`的`_score_fields_valid()`（`isinstance`类型校验替代`in`存在性判断，与前端`typeof`口径对齐）双重保险；前端`_lsGet()`/`seedCache()`不需要改动，后端修复后"六字段要么全合法要么都不合法"这个不变式变成真实保证。**C3**：`_wuxingRadarHtml()`改为按组内最大值归一化画半径，`_radarSvg()`新增可选`labelValue`字段让标签仍显示真实百分比、与画图半径解耦。**P1**：`_score_field_instruction()`删除机制上不可能生效的"跨维度区分度"要求。**P2**：`AI_ANALYSIS_TIMEOUT_MS`推导注释改为"硬上限不变（90s是`requests.post`物理超时不可能被突破）、期望耗时上升"的正确逻辑。**P3**：如实说明Step2 max_tokens从7168→8192的重试余量已从+60%变薄到+14%。**P5**：`_isValidScore()`新增0-100范围校验 | 用真实`lunar-javascript`+`BaziEngine.calculate()`跑6912个随机生日验证`strengthScore`恒在0-100内；`score=0.5`/`-0.5`精确映射到52/48分（落在三分类阈值边界）；`strength`字符串分类与按`strengthScore`反推类别一致率94.48%（不一致部分100%可归因于`delingOk`这个不体现在`score`数值里的已知架构性差异）。C2用真实文件缓存构造"六字段齐全"/"缺一个"/"字符串类型"/"bool类型"四个场景验证`_cache_read()`命中判定符合预期。C3用qa截图给出的悬殊数据（木38.5/火22.1/土15.3/金9.2/水6.4）人工核算最大值归一化后（100/57/40/24/17）能明显撑开。`node --check js/bazi-engine.js js/analysis.js js/bazi-analysis.js`、`python3 -m py_compile gemini_analysis.py`全部通过。**未做真实浏览器截图复核**（无computer-use/chrome MCP权限），三处修复的最终像素级视觉效果需部署后人工/下一轮qa-reviewer确认 |
| 2026-08-04（qa-reviewer第三轮复查发现2个新CONFIRMED——真实算法bug而非display层bug，用户明确要求算法本身一并修正） | qa-reviewer实测发现`bazi-engine.js::_strength()`内部"我克"表`SHENGW`与"克我"表`KE`逐字相同（复制粘贴遗留bug），导致身强/中和/身弱三分类判断本身被污染（不只是上一轮新增的仪表盘数值层）；`gemini_analysis.py::_is_valid_score()`只校验类型不校验范围/有限值，与前端`js/analysis.js::_isValidScore()`口径不一致，模型返回越界分数/NaN/Infinity会被后端判定缓存命中、永久落盘，前端范围校验拒绝渲染，六维雷达图永久卡死——与上一轮CONFIRMED 2同构故障 | **算法修复**：新增4个共享静态常量`BaziEngine.WX_SHENG_BY`/`WX_SHENG`/`WX_KE`/`WX_KE_BY`（生我/我生/我克/克我）作为`_strength()`与`_favorable()`唯一权威定义，两处不再各自定义一份容易不同步的局部变量；`SHENGW`改为正确的`WX_KE`值`{木:'土',火:'金',土:'水',金:'木',水:'火'}`（原值`{木:'金',火:'水',土:'木',金:'火',水:'土'}`与"克我"表完全相同，是bug本体）。`_strengthGaugeHtml`按用户要求保留现有的每命盘实时计算`total`逻辑，不改回写死10.75常量（更稳健）。**score范围校验**：`_is_valid_score()`补上`math.isfinite(v) and 0 <= v <= 100`（新增`import math`），与前端口径完全对齐。**前端加固**：`js/bazi-analysis.js`新增导出`isValidScore()`+内部`_allScoreFieldsValid()`（六字段类型+范围全合法才算完整），`_lsGet()`/`seedCache()`从单字段`typeof`检查改用它；`js/analysis.js::_isValidScore()`改为委托调用`window.BaziAnalysis.isValidScore()`（`index.html`里`bazi-analysis.js`先于`analysis.js`加载），两文件不再各自维护一份独立实现 | 用真实`lunar-javascript`+`BaziEngine.calculate()`（Node vm加载真实源码，非mock）跑1950-2025跨度32832组真实四柱：`assist+print+consume`总和修复后在全部样本中恒为唯一值`10.75`；三分类结果修复前后**20.27%（6656/32832）发生变化**；`_favorable()`三字段（favorable/unfavorable/favorable2）修复前后不一致数同为6656（100%与分类变化数一致，因`_favorable()`是`strength`分类的纯函数）——`_favorable()`本身局部表定义未受`assist/print/consume`中间变量污染，但通过`strength`入参被间接污染。score校验用105/-20/NaN/Infinity/`"87"`/`True`/50/0/100共9个输入验证符合预期；前端`isValidScore()`用Node vm加载真实源码验证与Python版结果一致，构造含1个越界分数的完整analysis对象调用`seedCache()`确认未被写入localStorage。`node --check js/bazi-engine.js js/analysis.js js/bazi-analysis.js`、`python3 -m py_compile gemini_analysis.py`全部通过。**数据一致性**：这次只改计算逻辑，Supabase历史存档的`strength`判定结果不会被自动重算，用户需主动触发"完全重新生成"或修改出生信息才会用新逻辑，已记录进已知问题日志避免误判。**未做真实浏览器/`GEMINI_API_KEY`端到端验证** |
| 2026-08-04（qa-reviewer第四轮终审：订正上一行"委托调用`window.BaziAnalysis`"失实描述） | 上一行称`js/analysis.js::_isValidScore()`委托`window.BaziAnalysis.isValidScore()`，但classic script顶层`const BaziAnalysis`不会挂到`window`上（与本文档已记录的`CONFIG`同款教训），委托分支实际从未触发，是死代码 | 改用裸标识符`typeof BaziAnalysis !== 'undefined'`（本文件其它委托逻辑本就是这个写法），不新增`window.BaziAnalysis = BaziAnalysis` | `node --check js/analysis.js`通过。详见`claude-docs/已知问题与修复记录.md`同日期对应行 |
| 2026-08-04（新功能：点击岛屿命柱/神煞标签的详情内容改为AI动态生成——新增Step「四柱详解」`step_pillars_detail`+「神煞详解」`step_shensha_detail`，缓存版本v4→v5） | 用户反馈点击命柱/神煞标签弹出的详情面板内容太单薄（`getDmDesc`/`ssDesc`/`nayinDesc`静态字典各条仅十几到几十字），要求改为AI动态生成、分类清晰、不懂八字的人也能读懂。完整设计见本章节上方"新增「四柱详解」「神煞详解」"小节 | **后端**：`gemini_analysis.py`新增两个并行步骤（`_step_pillars_detail_safe`/`_step_shensha_detail_safe`，只依赖ctx+step1+step2，加入既有`asyncio.gather`批次，不新增串行阶段）。`_build_context()`新增透传前端已算好的`nayin`/`hiddenStems`（含每个藏干自身的十神）两个确定性数据字段，避免四柱详解步骤编造藏干信息。四柱详解一次调用覆盖4柱（`plain_meaning`/`hidden_stems`/`role_in_this_chart`三个大白话分类小节，日柱额外侧重配偶宫），`max_tokens=7168`；神煞详解一次调用覆盖`ctx['shensha']`全部现存神煞（`name`/`nature`/`concept`/`personal_impact`/`advice`，单条150-220字量级），`max_tokens=16384`（唯一超出8192重试封顶值的步骤，副作用与不连带上调90s/550s超时的推导见代码注释）。这两步是本次改动里*唯二*带独立失败隔离的并行任务（内部捕获`GeminiCallError`返回空dict，不拖垮整条请求）。落盘前用`_sanitize_pillars_detail()`/`_sanitize_shensha_detail()`做"跳过式降级"结构校验（字段不全的柱子/名称对不上命盘真实神煞列表的条目直接剔除，不是整体重新生成）。缓存v4→v5：`_cache_read()`新增第四道校验，两个新字段都单独查"存在性+容器类型正确"（不要求4个柱子/N条神煞内容全部齐全——理由见`_pillars_detail_valid()`/`_shensha_detail_valid()`docstring，与六维打分字段"必须全部合法"的校验粒度刻意不同）。**前端**：`js/bazi-analysis.js::LS_PREFIX`从`bazi_ai_v4_`升级为`bazi_ai_v5_`，`_lsGet()`/`seedCache()`新增`_pillarsDetailValid()`/`_shenshaDetailValid()`两道校验（与后端同一套粒度取舍，均单独校验、不共用canary）。`js/analysis.js::buildPillarPanel(col, baziData, pillarAiDetail)`/`buildShenshaPanel(name, baziData, shenshaAiDetail)`新增第三个可选参数，传入AI切片时渲染新分类小节（复用既有`section()`/`insight()`/`badge()`辅助函数，不引入新样式），不传/undefined时【完全保留】原有静态字典兜底内容，函数本身仍是同步的、不发起网络请求。**顺手修复**：`ssDesc()`补上`js/tutorial.js::SS_DESC`已有但`analysis.js`缺失的"孤辰"描述，两处内容不再不一致（`js/tutorial.js`本身未改动，留给下一轮`user-system`领域接线UI时同步确认）。**字段名说明**：需求文档本身对神煞详解数组字段名有两种表述（JSON schema明确写`shensha_items`，另两处验证/调用示例误写成`shishen_items`）——最终统一采用`shensha_items`（语义对应"神煞"，避免与Step2b既有的`step2b_shishen.shishen_items`——十神条目数组——同名混淆），前后端/文档已全部对齐这一名称，未出现两端不一致 | 后端：mock `_call_gemini`+`rag_service.query`跑通`analyze_bazi()`，验证0/3/18/21个神煞四种场景下`step_pillars_detail`四键齐全、`step_shensha_detail.shensha_items`条数与`ctx['shensha']`长度精确一致，0个神煞时确认未发起对应Gemini调用（短路优化生效）；`_cache_read()`验证老结构（无两个新字段）判定未命中、新结构判定命中；构造四柱详解步骤强制抛`GeminiCallError`的场景，验证整条`analyze_bazi()`仍成功返回（`step_pillars_detail`为空dict，其余六步/神煞详解正常生成），确认失败隔离生效。前端：Node vm加载真实`analysis.js`/`bazi-analysis.js`源码（非mock），验证`buildPillarPanel`/`buildShenshaPanel`传AI切片/不传/传null三种输入均不报错且内容符合预期（含日柱AI内容含"配偶宫"字样、孤辰不再走通用兜底文案）；验证`seedCache()`对老v4结构、`step_pillars_detail`缺一个柱子键、`shensha_items`非数组三种场景均正确拒绝写入，对完整v5结构正确写入`bazi_ai_v5_`前缀key，对`shensha_items`为空数组（命盘无神煞的合法状态）正确接受写入**（订正，2026-08-11：本判定已于同日晚些时候的返工反转为"空数组一律判定无效"，又在2026-08-11 qa-reviewer第三轮复查后改为"空数组+`no_shensha`显式标记才有效"，详见下方2026-08-04返工行与2026-08-11对应行）**。`node --check js/analysis.js js/bazi-analysis.js`、`python3 -m py_compile gemini_analysis.py`全部通过。**未做真实`GEMINI_API_KEY`端到端验证**——扩容后的四柱/神煞详解prompt在真实Gemini调用下的JSON格式稳定性、`max_tokens=16384`是否真的被API接受（未验证`gemini-flash-latest`/`gemini-3.6-flash`实际maxOutputTokens上限）、神煞详解在极端神煞数量场景下的真实生成耗时，均需部署后实测确认；前端UI视觉效果（新分类小节在移动端侧边抽屉面板里的排布）需下一轮`user-system`领域接线main-new.js调用点后一并验证 |
| 2026-08-04（qa-reviewer复查上一行「四柱详解/神煞详解」，mock实测发现2个CONFIRMED+2个PLAUSIBLE，逐条修复） | qa-reviewer实测发现上一行的缓存校验粒度设计有误，两个方向各出一个CONFIRMED：①神煞详解彻底失败（safe wrapper返回`{}`）经`_sanitize_shensha_detail()`转成`{'shensha_items': []}`后，初版`_shensha_detail_valid()`只查"是list"就判定有效，实测`CACHE HIT after shensha failure?: True`——彻底失败的空结果被永久当作有效缓存，无自愈路径；②四柱详解反过来，`_sanitize_pillars_detail()`允许跳过式丢弃不完整柱子，但初版`_pillars_detail_valid()`要求4个柱子键全部存在，实测`CACHE HIT with 3/4 pillars?: False`——缺一根柱子就永远无法命中，每次都重新触发整条七步+两个新步骤的流水线（12次Gemini调用），复刻了`_cache_read()`自己警告过要避免的"不能要求完全齐全"反面模式。另有2个PLAUSIBLE：P2——`js/analysis.js`的AI内容分支守卫只判断"容器是否为真值对象"不判断"是否有实际内容"，传入`{}`会渲染出比静态兜底更空的空壳；P3——"孤辰"上一行只对齐了描述文案，吉凶分类仍分叉（`SHENSHA_WARN`当时未包含"孤辰"），"驿马"/"七杀"/"官符"/"丧门"同样存在`analysis.js`与`tutorial.js`两处分类不一致 | **统一设计**：区分"整个步骤彻底失败"（safe wrapper捕获异常返回`{}`）与"步骤成功但内容不完整"（sanitizer跳过式筛掉部分/全部不合规条目），校验只关心前者。`_pillars_detail_valid()`改为只要求`step_pillars_detail`是**非空**dict（不要求4个柱子键全部存在）；`_shensha_detail_valid()`改为要求`shensha_items`是**非空**数组（空数组一律判定无效）——刻意保守：空数组既可能是"命盘真的零神煞"也可能是"步骤失败"，两者数据形态上无法区分，权衡后**未引入**跨safe wrapper/sanitize/cache_read三层的失败标记元数据（理由：实测极端范围神煞数量最少也有1个，"真零神煞"场景经验概率为0，为消除一个概率接近0的false negative新增跨层结构不划算）——**订正（2026-08-11同日晚些时候qa-reviewer第三轮复查证伪，见下一行）**：这个"经验概率为0"的判断是错的，见下一行修复。`js/bazi-analysis.js::_pillarsDetailValid()`/`_shenshaDetailValid()`同步改成一致判定逻辑。**P2**：`buildPillarPanel()`/`buildShenshaPanel()`守卫加固为检查至少一个内容字段非空（前者`plain_meaning`/`hidden_stems`/`role_in_this_chart`三选一，后者`concept`/`personal_impact`/`advice`三选一）才走AI渲染分支，否则走静态兜底。**P3**：`js/analysis.js::SHENSHA_WARN`补入"孤辰"、`SHENSHA_GOOD`移出"驿马"（传统孤辰偏中性偏凶主孤独判定凶更贴近传统定性，驿马传统主变动吉凶随命局搭配非单纯吉神判定中性）；`js/tutorial.js::isWarn`补入"七杀/官符/丧门"（`analysis.js`一侧原判定正确，是`tutorial.js`缺了这三条）——两处最终分类完全对齐。缓存版本号未变（仍是v5，本轮只改判定逻辑不改数据结构） | Python：真实文件缓存端到端验证——3/4柱子完整v5结构写入后`_cache_read()`返回非`None`（此前是`None`）；`shensha_items`为空数组的v5结构写入后`_cache_read()`返回`None`（此前是命中）；15/21条合规神煞场景`_shensha_detail_valid()`判定有效。`python3 -m py_compile island_service/gemini_analysis.py`通过。前端：Node vm加载真实`bazi-analysis.js`源码，`seedCache()`+`getAnalysis()`验证3/4柱子场景本地缓存命中（不发起网络请求）、`shensha_items`为空数组场景`seedCache()`正确拒绝写入。Node vm加载真实`analysis.js`源码验证：`buildPillarPanel(col, baziData, {})`/`buildShenshaPanel(name, baziData, {})`零内容对象正确落到静态兜底路径，完整AI内容对象仍正常走AI渲染分支，`undefined`/缺失柱子场景不报错仍走静态兜底；"孤辰"传入完整AI切片后徽章渲染"⚠ 凶煞"，"驿马"不传AI切片时徽章渲染"◈ 中性"，与`js/tutorial.js`新分类一致。`node --check js/analysis.js js/bazi-analysis.js js/tutorial.js`全部通过。**未做真实浏览器/`GEMINI_API_KEY`端到端验证**——止于Node vm+构造数据验证，详见 `claude-docs/已知问题与修复记录.md` 同日期对应条目 |
| 2026-08-11（qa-reviewer第三轮复查「四柱详解/神煞详解」缓存策略，发现1个CONFIRMED——"零神煞"命盘会永久卡在每次打开都重跑整条AI流水线，逐条修复） | qa-reviewer没有停留在理论推测，而是用`js/bazi-engine.js`真实的`_shensha()`函数逐条模拟，穷举了全部518,400组合法四柱组合，找到了具体存在的1组零神煞命盘：四柱己巳己巳己巳己巳（对应真实公历生日1989年5月9日巳时，另有1929年同月日同时段），逐条手算34颗神煞规则复核过，证伪了上一行"真零神煞场景经验概率为0"的判断。触发链路：`ctx['shensha']==[]`→神煞详解短路返回`{'shensha_items': []}`（不发起Gemini调用，这张命盘本来就没有神煞是合法结果）→落盘→下次`_cache_read()`被上一轮`_shensha_detail_valid()`（要求数组非空）判定无效→cache MISS→重跑Step1+Step2+5个并行步骤+四柱详解共8-9次Gemini调用→生成结果神煞详解仍是空数组（这张命盘本就没有神煞，符合预期）→继续MISS，永久循环无自愈路径，`force_refresh`同样逃不掉；前端`_lsGet()`/`seedCache()`同理永远拒绝命中 | 给"真的零神煞"加一个显式标记位，跟"生成失败导致的空数组"区分开：`gemini_analysis.py::_sanitize_shensha_detail()`新增`no_shensha`标记——权威判据是**这个函数收到的`ctx`**（不信任`data`里可能携带的任何标记，因为可能来自不可信的模型输出），`ctx['shensha']`（规则引擎真实数据）为空时结果加`no_shensha=True`；`ctx['shensha']`为空时`_step_shensha_detail_sync()`根本不会发起Gemini调用（短路分支本身就不可能失败），所以"真零神煞"与"生成失败"两种空数组来源在ctx层面互斥、无歧义，同时该短路分支自身也顺手返回`{'shensha_items': [], 'no_shensha': True}`保持语义自洽。`_shensha_detail_valid()`判定条件放宽为"`shensha_items`非空数组 或 `no_shensha`显式为`True`"两者之一满足即有效。`js/bazi-analysis.js::_shenshaDetailValid()`同一次改动里同步做一模一样的改动（历史教训：`_computeHash`两处独立实现同一算法不同步的坑，这次不重蹈）。**UI侧核对**：`js/analysis.js::buildShenshaPanel(name, baziData, shenshaAiDetail)`按现有架构只对命盘里真实存在的神煞名渲染面板（岛屿标签本身只在`ctx['shensha']`非空的具体神煞上生成），零神煞命盘没有任何神煞标签可点，理论上到不了这个渲染路径，确认新增的`no_shensha`标记不会引发异常渲染，未改动`analysis.js` | Python：mock`ctx['shensha']==[]`场景验证`_step_shensha_detail_sync()`短路返回值含`no_shensha: True`，`_sanitize_shensha_detail()`保留该标记，`_shensha_detail_valid()`判定`True`（不再MISS）；mock"生成失败导致的空数组"场景（`_sanitize_shensha_detail({}, ctx)`，ctx非空）验证仍判定`False`（确认未把这个场景意外放行）；正常非空`shensha_items`场景判定`True`。真实文件缓存端到端验证：含`no_shensha: True`的完整v5结构写入后`_cache_read()`返回非`None`（此前是`None`）；不含该标记的空数组结构写入后`_cache_read()`仍返回`None`（确认失败场景未被误放行）。`python3 -m py_compile island_service/gemini_analysis.py`通过。前端：Node vm加载真实`bazi-analysis.js`源码（非mock），同样三个场景（`no_shensha: true`→有效、无标记空数组→无效、正常非空→有效）验证`_shenshaDetailValid()`与后端判定完全一致；`seedCache()`+`_lsGet()`端到端验证`no_shensha`场景正确写入并命中本地缓存、无标记空数组场景正确拒绝写入。`node --check js/bazi-analysis.js`通过。**未做真实`GEMINI_API_KEY`端到端验证**——止于mock+构造数据验证，真实Gemini对这张具体命盘（1989-05-09巳时）的调用行为需部署后实测确认；前端仍未接线传入AI切片（`main-new.js`调用`buildShenshaPanel`时未传第三参数，是既有P2，见已知问题记录），本次改动对线上用户暂无可见变化 |
| 2026-08-11（已知问题日志第22条修复：`no_shensha`标记的判据从"拍平后的解析结果为空"收紧为"payload里`shensha`/`shenshe`键确实存在且解析后为空"） | qa-reviewer第四轮复查发现：上一行`_sanitize_shensha_detail()`以`ctx['shensha']`（`_flatten_shensha(bazi_data)`拍平后的结果）为空作为"真零神煞"的唯一判据，但`_flatten_shensha()`对"payload完全没有`shensha`/`shenshe`这两个键"与"两个键都存在但解析出来就是空"两种情况返回值完全相同（都是`[]`），今天网页端`js/bazi-engine.js::calculate()`必定同时输出这两个字段所以不触发，但面向未来可能字段少传/改名的调用方（例如尚未启动的iOS原生端，见`CLAUDE.md`产品路线）会导致真实神煞被永久误判为"没有" | 新增`_shensha_keys_present(bazi_data)`辅助函数，只判断`'shenshe' in bazi_data or 'shensha' in bazi_data`这一"键本身是否存在"的布尔值，不涉及解析结果；`_build_context()`新增`ctx['shensha_keys_present']`字段透传这份信息（此前`ctx`只保留拍平后的列表，丢失了这个信息）；`_sanitize_shensha_detail(data, ctx)`收紧判定条件——只有`valid_names`为空**且**`ctx['shensha_keys_present']`为真时才打`no_shensha=True`标记，键本身缺失时不打标记，落盘结果既不满足`shensha_items`非空也不满足`no_shensha`为真，会被`_shensha_detail_valid()`判定为无效缓存、走生成失败/数据缺失分支允许重试。`js/bazi-analysis.js::_shenshaDetailValid()`确认只读取后端已生成结果里的`no_shensha`标记本身，不涉及"键是否存在"的判断逻辑，无需同步改动 | 本地脚本调用真实`_build_context()`/`_sanitize_shensha_detail()`对比两种场景：场景A（`bazi_data`完全不含`shensha`/`shenshe`键）——`shensha_keys_present=False`，`_sanitize_shensha_detail({}, ctx)`结果`{'shensha_items': []}`（无`no_shensha`），`_shensha_detail_valid()`判定`False`（无效，允许重试）；场景B（`bazi_data`含`shenshe: []`，键存在但解析为空，模拟真实零神煞命盘）——`shensha_keys_present=True`，结果`{'shensha_items': [], 'no_shensha': True}`，`_shensha_detail_valid()`判定`True`（有效缓存）——两种情况按预期区分开。`python3 -m py_compile island_service/gemini_analysis.py`通过。**未做真实`GEMINI_API_KEY`端到端验证**，本轮止于纯控制流验证；详见`claude-docs/已知问题与修复记录.md`第22条 |
| 2026-08-11（新增「命盘特点详解」`step_traits_detail`——"3D岛屿命盘特点标注"第一阶段后端部分，缓存版本v5→v6） | 响应"把AI深析Step1已生成的3条`strengths`+3条`cautions`短句（≤30字）做成3D岛屿上可点击的✅/⚠️标注，点击后展示详细说明"需求。完整设计见本章节上方"新增「命盘特点详解」`step_traits_detail`"小节。新增`_step_traits_detail_sync()`/`_step_traits_detail()`/`_step_traits_detail_safe()`（只依赖ctx+step1+step2，加入既有`asyncio.gather`并行批次，独立失败隔离，与四柱/神煞详解同一模式）：把Step1原句逐条展开成80-120字说明（十神/五行/身强弱等推导依据+具体生活表现），cautions额外要求一句具体可执行的化解建议；prompt明确写入"如实反映真实命理逻辑，不夸大、不制造焦虑、不使用营销话术"的措辞约束（延续本项目AI人设一贯坚持的"去掉水晶推荐/会员营销话术"原则，诊断内容与后续可能的商业化展示完全分离）。**核心设计取舍**：与四柱/神煞详解"部分完整也算命中"不同，这里刻意要求"3+3全齐或整体判定为空"——Step1若未按要求恰好产出3+3条直接短路返回`{}`不做部分对齐；落盘前`_sanitize_traits_detail()`同样"全齐或整体丢弃"；`_cache_read()`新增第五道校验`_traits_detail_valid()`要求两个数组都恰好3条（不是"非空"）。`max_tokens=7168`直接复用Step2已验证量级，不新造未经验证的数字。`analyze_bazi()`落盘结果新增`step_traits_detail`字段。**前端**：`js/bazi-analysis.js::LS_PREFIX`从`bazi_ai_v5_`升级为`bazi_ai_v6_`，`_lsGet()`/`seedCache()`新增`_traitsDetailValid()`（与后端同一套"3+3全齐"判定粒度，两处共用同一份判断逻辑，不重蹈`_computeHash`两处独立实现同一算法不同步的坑）。`js/analysis.js`新增`buildTraitPanel(zoneKey, baziData, trait)`（`trait: {kind, idx, summary, detail?}`），复用`badge()`/`section()`/`insight()`，`detail`缺失时优雅降级回退展示`summary`本身，不留空白不报错；本阶段不含"兑换/推荐商品"内容（第二阶段范围）。3D标注（`js/island-annotate.js`新增`TRAIT_LAYOUT`/`attachTraits()`）与接线（`js/main-new.js::_openZonePanel`扩展第三参数、顺带修复pillar/shensha AI详解此前从未真正接线的缺口）由其它领域子agent并行实现，不在本次改动范围 | `python3 -m py_compile island_service/gemini_analysis.py`、`node --check js/analysis.js js/bazi-analysis.js`全部通过。逻辑验证（mock覆盖，未做真实`GEMINI_API_KEY`端到端）：①正常场景——mock`step1={strengths:[3条],cautions:[3条]}`+mock`_call_gemini`返回合规3+3 JSON，验证`_step_traits_detail_sync()`正常返回、`_sanitize_traits_detail()`原样保留；②短路场景——mock`step1.strengths`只有2条，验证`_step_traits_detail_sync()`直接返回`{}`且**不发起**`_call_gemini`调用；③AI输出条数不对齐降级场景——mock`_call_gemini`返回`strengths_detail`只有2条的畸形JSON，验证`_sanitize_traits_detail()`整体丢弃返回`{}`而不是部分保留；④缓存版本升级场景——构造只含v5结构（无`step_traits_detail`）的字典，验证Python侧`_traits_detail_valid()`返回`False`（`_cache_read()`判定未命中）、JS侧`_traitsDetailValid()`同样返回`false`（`_lsGet()`/`seedCache()`拒绝命中/写入），确认老v5版本localStorage缓存不会被误判为v6有效缓存、不会读到`undefined`；⑤`buildTraitPanel()`人工核对`trait.detail`存在/缺失两种输入均正常渲染、不留空白。**待测试**——未做真实`GEMINI_API_KEY`端到端验证，扩容后的traits详解prompt在真实Gemini调用下的JSON格式稳定性、"3+3全齐"要求是否会导致比四柱/神煞详解更高的整体丢弃率，均需部署后实测确认；3D标注/main-new.js接线部分由并行子agent实现，接口contract是否对得上需qa-reviewer基于全部并行改动的真实diff一并复查 |
| 2026-08-11（qa-reviewer复查上一行「命盘特点详解」缓存校验，PLAUSIBLE非阻塞——放宽`_traits_detail_valid()`避免一个补充细节字段的偶发短路拖累整份缓存重新生成） | qa-reviewer指出上一行"`_cache_read()`第五道校验`_traits_detail_valid()`要求`strengths_detail`/`cautions_detail`都恰好3条"与`_sanitize_traits_detail()`落盘前已经把"3+3全齐或整体为空"这条不变量彻底把关死（写入值只可能是`{}`或恰好3+3合法数据，没有第三种形态）存在重复校验：`_traits_detail_valid()`重新验一遍条数，效果上完全等价于验证"是否非空"，没有额外防护收益。代价在于它选中的失败信号太宽泛——Step1的`strengths`/`cautions`prompt模板（`_step1_foundation_sync()`）只在示例JSON里给了3个占位符，不像本步骤自己的prompt那样显式要求"必须恰好3条，不多不少"，模型偶发返回2条或4条时`_step_traits_detail_sync()`短路返回`{}`（这不是`GeminiCallError`那种已被`_step_traits_detail_safe()`独立捕获隔离的瞬时失败，是"合法请求成功、只是内容形状对不上"的确定性结果），但当前校验把这种情况和总失败一视同仁判定`False`，拖累`_cache_read()`把**整份**含其它7个步骤正常数据的分析结果当作未命中，触发全部8-9次Gemini调用重新生成——跟本文件此前记录过的"缺一根柱子/零神煞"两次同类反面模式（详见2026-08-04/2026-08-11上方两行）是同一个问题在新字段上的复现，只是诱因不同（这次是Step1 prompt缺一条"必须恰好N条"的强约束，不是`GeminiCallError`） | `island_service/gemini_analysis.py::_traits_detail_valid()`改为只检查`step_traits_detail`这个key是否存在于结果dict里（不检查值的内容/长度）——`analyze_bazi()`落盘前无条件写入这个key（值可能是`{}`也可能是合法3+3数据），用它做canary等价于"整条流水线本身是否成功跑完"，内容层面的合法性完全交给已经证明正确、且**保持不变**的`_sanitize_traits_detail()`把关。`js/bazi-analysis.js::_traitsDetailValid()`同一次改动里做一模一样的放宽（历史教训：`_computeHash`两处独立实现同一算法不同步的坑，两端在同一次改动里一起改，不分两轮）。缓存版本号未变（仍是v6，本轮只改判定逻辑不改数据结构，老v6缓存文件/localStorage条目无需失效重新生成）。**刻意的取舍（不是疏漏）**：`step_traits_detail`一旦落盘为`{}`不会再有自愈重试路径（跟命柱/神煞详解"总失败仍会在下次请求触发重试"不同）——权衡后接受，因为这是点击3D岛屿✅/⚠️锚点才会看到的补充细节，前端`buildTraitPanel()`拿到`{}`时本就优雅降级回退展示`trait.summary`（Step1原句）本身，不留空白不报错；为了一个大概率不会因为重试而改善（Step1输出形状偶发漂移是模型自身prompt遵循度问题，不是网络类瞬时故障）的字段去牺牲其它7个已经生成正确的步骤重新烧一遍Gemini配额，得不偿失 | Python：构造"Step1返回2条strengths"场景验证`_step_traits_detail_sync()`短路返回`{}`、`_sanitize_traits_detail({})`结果仍为`{}`；构造含此`{}`traits_detail、但其它7个步骤字段均合法的完整analysis字典，验证`_traits_detail_valid()`新逻辑判定`True`（此前判定`False`）、完整`_cache_read()`判定链（`step1_foundation`+`step2b_shishen`+`_score_fields_valid`+`_pillars_detail_valid`+`_shensha_detail_valid`+`_traits_detail_valid`）整体判定为命中；构造老v5结构（完全不含`step_traits_detail`键）验证仍正确判定未命中，缓存版本升级保护未被破坏。`python3 -m py_compile island_service/gemini_analysis.py`通过。前端：Node vm加载真实`js/bazi-analysis.js`源码（非mock），构造两条不同八字分别`seedCache()`——A：完整3+3 traits_detail；B：`{}` traits_detail+其它7步正常数据——验证B场景`seedCache()`此前会拒绝写入、现在正确写入本地缓存，`getAnalysis()`后续调用命中本地缓存（不发起网络请求）且其它步骤数据（`fortune_score`/`step_pillars_detail`等）完整可读；老v5结构（缺`step_traits_detail`键）场景验证`seedCache()`仍正确拒绝写入。`node --check js/bazi-analysis.js`通过 |
| 2026-08-12（订正上方2026-08-11行末尾"接线（`main-new.js::_openZonePanel`扩展第三参数……）"的描述——推送main前才发现main并行合入了另一功能，两者在`_openZonePanel()`同一区域产生真实代码冲突，接口在合并时发生了变化） | main此前并行提交了`f310ab9`（教程UI打通AI详情面板），恰好也重构了`_openZonePanel()`同一区域。cherry-pick到最新main时产生真实代码冲突，总agent手动合并——`extra`最终落在**第四参数**（`_openZonePanel(zoneKey, baziData, force, extra)`），不是上方记录写的"第三参数"；第三位被main原有的`force`（教程"查看完整详解"绕开guard用）占用。`js/island-annotate.js`trait标签点击调用点同步改为`window.onIslandZoneClick(zoneKey, baziData, false, extra)`四参数写法。另外`js/main-new.js::_applyAiAnalysis()`合并后只保留"挂载3D trait标注"这一个职责，不再缓存四柱/神煞详解——main的新架构让`_openZonePanel()`每次打开面板都直接按需调`BaziAnalysis.getAnalysis()`，原本为此设的`_lastAiPillarsDetail`/`_lastAiShenshaDetail`两个模块变量判定为死代码已删除 | 无新代码改动，纯文档订正。qa-reviewer基于真实diff+真实浏览器/Playwright验证三条调用路径（教程3参数/普通点击2参数/trait标签4参数）均符合预期，`_lastAiPillarsDetail`/`_lastAiShenshaDetail`全项目grep确认零残留引用，确认"可以推送"。详见`claude-docs/已知问题与修复记录.md`同日期对应条目 |
| 2026-08-13（第三阶段"五行维护系统"第一批：新增判定层`js/wuxing-issues.js`+`gemini_analysis.py::step_wuxing_maintenance`+`bazi_prompt.py::DAY_MASTER_CORE_ZH`，缓存版本v6→v7，取代第一阶段✅/⚠️浮动图标标注） | 用户反馈前两阶段的✅/⚠️图标标注太"贴片化"、岛屿模型本身不反映命盘问题，要求改为岛屿地形本身具象化呈现喜用神/忌神状态，需要"经营维护"。完整方案见`/Users/linyu/.claude/plans/structured-nibbling-duckling.md`第三阶段部分。本次范围限定"判定逻辑+AI具象化叙事+接口contract"，3D场景挂载/时间劣化/拖拽维护/真实3D资产留到后续独立子阶段 | **判定层**（新文件`js/wuxing-issues.js`）：`WuxingIssues.deriveIssues(baziData)`基于`js/bazi-engine.js::_favorable()`已有的`favorable`/`favorable2`（→`direction:'nourish'`）/`unfavorable`（→`direction:'restrain'`）+ `wuxing`占比，复用`bazi_prompt.py::wuxing_level()`已验证的`0.35/0.20/0.06`分档阈值算`severity`（0-2，nourish方向占比越低越高、restrain方向占比越高越高）。中性五行不产生条目，条目数通常2-3条不强求固定。**⚠️唯一被有意设计成两处独立实现同一算法的地方**：`gemini_analysis.py::_derive_wuxing_issues(ctx)`是Python侧逐字对齐的复刻（供AI叙事prompt+缓存校验使用），两文件顶部/函数上方均有大段注释互相引用对方路径、明确要求同步改动，理由是前端3D场景需要浏览器端零延迟判定、Python侧需要独立喂给Gemini，不能共用一次网络往返。**AI叙事层**（`gemini_analysis.py`新增`_step_wuxing_maintenance_sync()`）：跟四柱/神煞/命盘特点详解同一模式（只依赖ctx+step1+step2+issues，加入既有`asyncio.gather`并行批次，`_step_wuxing_maintenance_safe()`独立失败隔离，复用`max_tokens=7168`）。核心约束——**同一五行方向在不同日主下必须讲出不同意象角度**，不能用通用命理术语堆砌套话，prompt里显式给出"甲木缺水扣松根灌溉/壬水木弱或水旺扣江河堤岸"这类示例说明"角度要扣住日主本体"的要求（不是让AI照抄示例）。为此`bazi_prompt.py`新增`DAY_MASTER_CORE_ZH`（10个日主的中文意象摘要，独立于已有纯英文`DAY_MASTER_CORE`——后者专供TripoAI图像提示词，直接塞进中文叙事prompt会导致模型音译/语言混杂）。输出schema每条issue对应`{wx, direction, title(8-14字), narrative(60-100字), action_hint(20-30字，内部参考不直接展示)}`，措辞约束延续本项目AI人设一贯原则（如实反映命理逻辑真实权重，不为后续商业化展示夸大问题/制造焦虑/带货措辞）。落盘前`_sanitize_wuxing_maintenance()`按`(wx,direction)`配对提取合法条目，允许"部分成功"（跟`_sanitize_traits_detail()`"3+3全合法或整体为空"不同，因为每条issue自带唯一标识可精确配对）。**缓存v6→v7**：`_cache_read()`新增第六道校验`_wuxing_maintenance_valid()`——判定粒度是"条目数与`_derive_wuxing_issues()`当次算出的条目数完全一致"（不是照搬其它几个"非空/key存在"的宽松模式），因为这是本文件目前唯一一个期望条目数不依赖AI输出、可在读缓存当下独立重算的字段，理由与已考虑过的边界情况见该函数上方大段注释。`js/bazi-analysis.js::LS_PREFIX`从`bazi_ai_v6_`升级为`bazi_ai_v7_`，`_lsGet()`/`seedCache()`新增`_wuxingMaintenanceValid()`同一套判定粒度。`js/analysis.js`新增`buildMaintenancePanel(zoneKey, baziData, issue)`（复用`badge()`/`section()`/`insight()`，`direction==='nourish'`用`insight(...,'good')`、`'restrain'`用`insight(...,'warn')`视觉语言，展示title+narrative，预留兑换区块占位供后续`products.js`接线），加入模块导出对象 | mock测试验证AI叙事"不死板"要求：同一个`{wx:'水', direction:'nourish'}`输入分别用甲木/壬水日主`ctx`跑`_step_wuxing_maintenance_sync()`（mock `_call_gemini`），确认prompt文本里两个不同日主各自的`DAY_MASTER_CORE_ZH`摘要被正确喂入、且prompt包含"不能用通用套话"的显式约束文本。判定逻辑：用真实`BaziEngine.calculate()`（Node vm加载真实源码）跑多个不同日主/身强身弱命盘，验证`WuxingIssues.deriveIssues()`产出条目数/方向符合命理预期（身强命局忌印比劫、身弱命局喜印比劫），且Python侧`_derive_wuxing_issues()`对同一批命盘产出完全一致的结果（wx/direction/severity逐条比对）。`node --check js/wuxing-issues.js js/bazi-analysis.js js/analysis.js`、`python3 -m py_compile island_service/gemini_analysis.py island_service/bazi_prompt.py`全部通过。**待测试**——未做真实`GEMINI_API_KEY`端到端验证，扩容后的prompt在真实Gemini调用下的JSON格式稳定性、"日主意象角度差异化"效果的真实生成质量需部署后实测确认；3D场景挂载（`js/wuxing-scene.js`）/`main.js`接线/`products.js`签名重构由其它领域子agent并行实现，接口contract是否对得上需qa-reviewer基于全部并行改动的真实diff一并复查 |
| 2026-08-13（qa-reviewer复查上一行「五行维护叙事」，1个CONFIRMED+2个PLAUSIBLE，逐条修复） | **CONFIRMED**——qa-reviewer实跑验证：上一行`_wuxing_maintenance_valid()`"条目数必须与`_derive_wuxing_issues()`当次算出的条目数完全一致"这个设计，复现了`_traits_detail_valid()`第一版"恰好3+3"被打回的同一个坑，且影响面更大。真实故障链路：9个并行Gemini调用里只要`_step_wuxing_maintenance`这一个撞上429/5xx（被`_step_wuxing_maintenance_safe()`独立捕获返回`{}`）、或模型漏写/改写了某条wx/direction，`step_wuxing_maintenance`就会落盘成`[]`或短列表——此后每次请求都判定未命中、重跑全部9次Gemini调用（分钟级+真实费用），触发点不止"点开这个字段自己对应的3D装饰物"：`_openZonePanel()`里点开任意`pillar_`/`shensha_`面板都会调`getAnalysis()`，等于用户每点一次命柱/神煞面板就可能触发一次完整9步流水线重跑。另发现一个连带的前端"白写"问题：`js/bazi-analysis.js::getAnalysis()`拿到后端结果后无条件`_lsSet()`写入localStorage（不经过`_wuxingMaintenanceValid()`校验，这是该文件对所有analysis字段写入路径的既有通用模式），精确匹配校验下"AI只漏1条"这类部分成功结果会被写入却永远读不回。**PLAUSIBLE 1**：`js/analysis.js::buildMaintenancePanel()`里的中文文案（💧/✂️徽标、zone-subtitle、"命理解读"小节标题、2条narrative兜底文案）全部硬编码，`js/i18n.js`里新增的`wxmaint.*`中英文key从未被引用。**PLAUSIBLE 2**：`Analysis.redeemTraitProduct()`注释具有误导性——该函数调用`Products.redeem(productId, {kind,idx,...})`，但`Products.redeem()`签名已改为解构`{wx,direction,...}`，这条路径目前完全不可达（只有已停用的`trait_`系统会生成调用它的onclick），注释却只说"保留"，容易让未来会话误以为它还能正常工作 | **CONFIRMED修复**：彻底放弃"条目数精确匹配"这个设计目标，`_wuxing_maintenance_valid(data)`改为与`_pillars_detail_valid()`/`_shensha_detail_valid()`完全同一套"非空list即有效"判定粒度（不再需要`expected_count`参数）；相应地`_cache_read()`签名简化回`_cache_read(h)`，`analyze_bazi()`里`ctx`/`wuxing_issues`的构建时机改回原来的"缓存未命中后才构建"（不再需要提前构建给`_cache_read()`用）。`js/bazi-analysis.js::_wuxingMaintenanceValid()`同一次改动里做一模一样的放宽，`_lsGet()`/`seedCache()`调用点相应去掉不再需要的`baziData`参数；"白写"问题作为放宽的直接结果自然消失（部分成功结果写入后也能正常读回），未额外改`_lsSet()`本身——该函数不做写入前校验是本文件对pillars/shensha/traits等字段的既有统一设计，自愈完全依赖读时校验，不为这一个字段破例。两边判定粒度改动细节与完整故障链路复述均写进了`_wuxing_maintenance_valid()`（Python）/`_wuxingMaintenanceValid()`（JS）上方大段注释，以及本文件顶部docstring对应日期条目，供未来会话直接查阅不必重新推导。**PLAUSIBLE 1修复**：`js/analysis.js`新增模块级`_t(key,vars)`/`_isZh()`两个i18n查表辅助（与`js/products.js`/`js/main-new.js`已有同名helper同款写法），`buildMaintenancePanel()`内全部硬编码文案改为`_t()`查表；`js/i18n.js`补齐6个此前缺失的key（`wxmaint.section_title`/`wxmaint.subtitle_ai`/`wxmaint.title_fallback_nourish`/`wxmaint.title_fallback_restrain`/`wxmaint.fallback_nourish`/`wxmaint.fallback_restrain`，中英对称）；wx本身（木火土金水单字）与AI生成的title/narrative内容一样不做逐字英译，与`buildTraitPanel()`等既有函数只翻译UI chrome、不翻译命理术语本身的既有取舍保持一致，未新增五行名翻译体系。**PLAUSIBLE 2修复**：不修复`redeemTraitProduct()`本身（不值得为已停用的trait系统resurrect兼容性），在函数上方补一段明确注释说明它已经因为`Products.redeem()`签名变更而完全不可用、是"保留但已失效的死代码"，避免未来会话被误导 | **CONFIRMED验证**：复现qa给出的完全相同的失败链路——`sanitize({})`→`[]`、`sanitize(AI漏2条)`→1条——确认`_wuxing_maintenance_valid({'step_wuxing_maintenance':[]})`仍正确判定`False`（真失败仍自愈重试）、`_wuxing_maintenance_valid({'step_wuxing_maintenance':<1条部分结果>})`现在正确判定`True`（不再触发级联重跑）。真实文件缓存端到端验证：`_cache_read()`对"AI只生成了3条issue里的1条"场景现在返回非`None`（此前是`None`，会触发完整9步重新生成），对`[]`真失败场景仍返回`None`，对不含`step_wuxing_maintenance`键的pre-v7旧缓存仍返回`None`。前端：Node vm加载真实`bazi-analysis.js`源码（非mock），构造"1/3条部分成功"场景`seedCache()`后`getAnalysis()`确认命中本地缓存、`fetch`零调用（验证"白写"问题已随主修复自然消失）；构造`[]`真失败场景验证`getAnalysis()`正确判定缓存无效、发起后端请求。`node --check js/bazi-analysis.js`、`python3 -m py_compile island_service/gemini_analysis.py`通过。**PLAUSIBLE 1验证**：Node vm加载真实`i18n.js`+`analysis.js`源码，分别用`Lang.setLang('zh')`/`Lang.setLang('en')`调用`buildMaintenancePanel()`（issue无title/narrative走兜底文案路径），人工核对输出HTML中文/英文版本文案均正确来自`Lang.t()`查表结果，且wx单字（如"水"）在两种语言下均保持原样不被误翻译；`node --check js/analysis.js js/i18n.js`通过。**PLAUSIBLE 2验证**：纯注释改动，无行为变化，`node --check js/analysis.js`通过；`grep`确认`trait_`zoneKey分支在`main-new.js`里除`_openZonePanel`内部这一条兜底分支外，全项目没有任何代码路径会生成`trait_`前缀的zoneKey点击事件（`attachTraits()`已停用），佐证注释里"完全不可达"的判断成立 |
| 2026-08-18（qa-reviewer复查「天干合」新增，1个CONFIRMED命理事实性错误修复） | `js/bazi-engine.js`新增`_ganHe()`（天干五合，2026-08-18同日新增）后，`interactions`数组混入了`type:'天干合'`条目；`gemini_analysis.py::_build_context()`此前把`interactions`不分类型统一拼进`interaction_str`，而`_shared_chart_block()`/Step5健康prompt都把这个字符串贴上"地支刑冲合害"/"地支相冲情况"标签喂给AI——天干合是天干层面的关系，被贴上"地支"标签会让AI在生成的性格/健康解读文字里说出"你的地支甲己合土"这类命理事实性错误（qa-reviewer实测约27.1%命盘会真实触发，即存在相邻天干合的命例）| `_build_context()`按`type=='天干合'`把`interactions`拆成两个独立集合：`interaction_descs`/`interaction_str`只保留地支类（冲/合/三合/三会/三刑/自刑/害/破），保持原变量名与"地支XX"两处标签的准确性；新增`gan_he_descs`/`gan_he_str`单独承载天干合（空时兜底"命局天干无相邻五合"，不再用"地支无明显XX"这种不准确的通用兜底覆盖天干层面的情况）。`_shared_chart_block()`新增一行准确标注"天干五合（仅限相邻两干...）"，让天干合信息真正喂给AI（不是简单丢弃——2026-08-18新增天干合本就是为了让它在3D装饰和AI分析里都有意义）。顺手处理3个PLAUSIBLE：①`js/user-journey.js`报告面板"四、地支刑冲合"标题改为"四、命局刑冲合害（含天干五合）"，不再暗示该分区只含地支关系；②`js/bazi-engine.js::_interactions()`主pairwise循环里遗留的手写`const key=[a,b].sort().join('')`改为调用已提升的`BaziEngine._pairKey()`静态方法（`pairKey(a,b)`），堵上"同一key生成逻辑被复制成多份"的风险口子；③`bazi_prompt.py::__main__`测试夹具的`interactions`样例补上真实引擎会输出的`pillars`字段，此前注释声称"真实跑出来的结果"但缺了这个字段，与当前`_interactions()`实际输出格式不一致 | 用真实构造的"年干甲合月干己+年支子冲月支午"命盘跑`_build_context()`+`_shared_chart_block()`：断言`interaction_str`（`'年支子 冲 月支午（情绪起伏·感情不稳）'`）不含"甲"字、`gan_he_str`正确捕获`'年干甲 合 月干己（化土）'`，渲染出的命盘核心资料文本块里"地支刑冲合害"与"天干五合"两行分别只包含对应层面的信息，无交叉污染。P2用隔离对照测试验证：把当前文件`const key=pairKey(a,b)`还原成原始内联表达式作为对照组，穷举12支×12支×12支×12支共20736种四支组合调用`_interactions()`，`pairKey()`版本与原始内联版本逐条JSON深度比对**0处不一致**。P3用`node -e`实测`BaziEngine._interactions(['巳','午','午','未'])`真实输出，逐字段核对新补的`pillars`值完全一致。`node --check js/bazi-engine.js js/user-journey.js`、`python3 -m py_compile island_service/gemini_analysis.py island_service/bazi_prompt.py`全部通过。未做真实`GEMINI_API_KEY`端到端验证——只验证了prompt文本组装层面天干合已被正确分流标注，真实Gemini模型拿到这条新增"天干五合"信息后是否会在narrative里恰当引用，需部署后实测确认 |
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
