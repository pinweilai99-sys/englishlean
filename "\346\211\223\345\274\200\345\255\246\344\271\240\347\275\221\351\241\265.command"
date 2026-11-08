#!/bin/zsh
# 英语乐园 · 双击启动脚本（macOS）
# 作用：在本地起一个静态服务器并自动打开学习页面
# 用法：双击本文件即可；关闭时在弹出的终端窗口按 Ctrl+C 或直接关窗

# 优先使用带缓存版本的构建产物 docs/（与线上完全一致）；不存在则回退项目根
if [ -d "$(dirname "$0")/docs" ]; then
  cd "$(dirname "$0")/docs" || exit 1
else
  cd "$(dirname "$0")" || exit 1
fi

PORT=8899

echo "🐶 英语乐园正在启动…"
echo "   目录: $(pwd)"
echo "   端口: $PORT"

# 找一个空闲端口（8899 被占用时自动 +1）
while lsof -i ":$PORT" >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

OPEN_URL="http://localhost:$PORT/index.html"

# 先起服务器（后台），再打开浏览器
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!

# 等服务器就绪（最多 5 秒）
for i in {1..10}; do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html"; then
    break
  fi
  sleep 0.5
done

open "$OPEN_URL" 2>/dev/null || echo "请手动在浏览器打开: $OPEN_URL"

echo ""
echo "✅ 已在浏览器打开: $OPEN_URL"
echo "   学习进度保存在本机浏览器中，直接关闭网页即可。"
echo "   关闭本窗口即可停止服务器。"
echo ""

# 前台等待，保持服务器运行；Ctrl+C 退出并清理
trap "kill $SERVER_PID 2>/dev/null; echo '服务器已停止，学习愉快！'" EXIT
wait $SERVER_PID
