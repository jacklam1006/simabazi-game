#!/bin/bash
# 司马八字 — 本地开发服务器
cd "$(dirname "$0")"

echo "==============================="
echo "  司马八字 本地开发服务器"
echo "==============================="
echo ""

# 检查 live-server 是否安装
if ! command -v live-server &> /dev/null; then
    echo "正在安装 live-server..."
    npm install -g live-server
fi

echo "启动中... 浏览器将自动打开 http://localhost:3000"
echo "提示：在 Chrome DevTools → Application → Service Workers 勾选 'Update on reload'"
echo ""
echo "按 Ctrl+C 停止服务器"
echo ""

live-server --port=3000 --no-browser --ignore="island_service,*.py,*.md,*.command"
