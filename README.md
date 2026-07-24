# 司马八字 · 游戏化3D沙盒 v2

## 项目概述
将八字玄学游戏化，用 3D 沙盒场景可视化用户命盘。全球市场定位。

## 技术栈
- **3D 渲染**：Three.js r128（CDN）
- **后端**：`simabazi-api`（FastAPI，Render 部署）
- **数据库**：Supabase
- **部署**：Vercel（自动部署，推送即上线）

## 文件结构
```
simabazi-game/
├── index.html          ← 主入口
├── vercel.json         ← Vercel 部署配置
├── js/
│   ├── config.js       ← 全局配置（颜色/API地址/功能开关）
│   ├── scene-builder.js← Three.js 场景构建
│   ← annotation.js    ← 可点击标注系统
│   ├── user-journey.js ← 五步用户旅程
│   └── main.js         ← 入口，串联所有模块
├── models/
│   ├── wuxing/         ← 五行 3D 模型（.glb）
│   ├── dizhi/          ← 十二地支动物模型
│   ├── shenshe/        ← 神煞符号模型
│   └── scene/          ← 场景基底（地形/天空）
└── assets/
    ├── fonts/          ← 字体文件
    └── images/         ← 图片资源
```

## 开发阶段
- **阶段0** ✅：项目骨架搭建 + GitHub + Vercel 自动部署
- **阶段1** ⏳：3D 素材制作（五行/神煞/场景）
- **阶段2** ⏳：根据八字动态生成场景
- **阶段3** ⏳：完整用户旅程 + 留存设计
- **阶段4** ⏳：社交分享 + 多人联机

## 本地预览
直接用浏览器打开 `index.html`，或用 VS Code Live Server。
