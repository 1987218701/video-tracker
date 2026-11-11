#!/usr/bin/env bash
# Media Tracker 单机部署（源码构建模式）：无域名、仅自己使用、全新空数据库
# 用法：在服务器的项目目录中执行 bash deploy.sh（需能直接调用 docker）
# 若使用 GHCR 预构建镜像，请改用：git pull && docker compose pull && docker compose up -d
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

if ! docker compose version >/dev/null 2>&1; then
  echo "[x] 需要 Docker Compose v2；若当前用户无权调用 docker，请改用 sudo bash deploy.sh" >&2
  exit 1
fi

grep -q 'BIND_IP' docker-compose.yml || {
  echo "[x] 代码版本过旧（缺少 BIND_IP），请先更新代码" >&2
  exit 1
}

HOST_PORT="${HOST_PORT:-5000}"
TZ_OFFSET_HOURS="${TZ_OFFSET_HOURS:-8}"

if [ -f .env ]; then
  echo "[*] .env 已存在，保留现有配置"
  grep -q '^BIND_IP=' .env || echo 'BIND_IP=127.0.0.1' >> .env
  grep -q '^SECRET_KEY=' .env || echo '[!] .env 未设置 SECRET_KEY，当前使用占位值，建议补上'
else
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 32)"
  else
    SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  cat > .env <<EOF
SECRET_KEY=$SECRET
BIND_IP=127.0.0.1
HOST_PORT=$HOST_PORT
TZ_OFFSET_HOURS=$TZ_OFFSET_HOURS
EOF
  chmod 600 .env
  if [ -n "${SUDO_USER:-}" ]; then
    chown "$SUDO_USER":"$SUDO_USER" .env 2>/dev/null || true
  fi
  echo "[*] 已生成 .env（随机 SECRET_KEY，权限 600）"
fi

echo "[*] 校验配置并构建启动 ..."
docker compose config >/dev/null
docker compose up -d --build

echo "[*] 等待服务就绪 ..."
ok=0
for _ in $(seq 1 30); do
  if docker compose exec -T video-tracker python -c \
      "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=2)" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "[x] 健康检查失败，请查看日志：docker compose logs -f" >&2
  exit 1
fi

echo
echo "[OK] 部署完成，容器状态："
docker compose ps
echo
echo "在自己电脑上建立隧道（保持这个窗口开着）："
echo "  ssh -L ${HOST_PORT}:127.0.0.1:${HOST_PORT} <用户名>@<服务器IP>"
echo "然后浏览器打开 http://127.0.0.1:${HOST_PORT}"
echo
echo "常用命令："
echo "  查看日志   docker compose logs -f"
echo "  重启/停止  docker compose restart / stop"
echo "  更新代码后 docker compose up -d --build"
echo '  备份数据   docker cp video-tracker:/data/tracker.db ~/backup-$(date +%F).db'
echo "  切勿执行   docker compose down -v（会连数据卷一起删除）"
