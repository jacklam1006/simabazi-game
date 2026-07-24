#!/bin/bash
# 司马八字 v2 · 一次性 Git 初始化脚本
# 使用方法：在 Terminal 中 cd 到 simabazi-game 文件夹，然后运行 bash setup.sh

set -e

echo "🎮 司马八字 v2 · Git 初始化"
echo "================================"

cd "$(dirname "$0")"

# 配置 git 身份
git config user.email "ngoliangfong@gmail.com"
git config user.name "Jack Lam"

# 初始化
git init
git branch -M main

# 首次提交
git add .
git commit -m "feat: 初始化 simabazi-game 项目骨架"

echo ""
echo "✅ 本地 Git 初始化完成！"
echo ""
echo "下一步：在 GitHub 创建仓库后，运行以下命令推送："
echo ""
echo "  git remote add origin https://github.com/jacklam1006/simabazi-game.git"
echo "  git push -u origin main"
echo ""
echo "然后在 vercel.com 连接该仓库，自动部署即可完成。"
