#!/usr/bin/env bash
set -euo pipefail
cd /opt/masshtablab
PORT=47310
if ! command -v docker >/dev/null 2>&1; then
  echo "[1/4] Установка Docker..."
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
if [ ! -f .env ]; then
  echo "[2/4] Создание .env..."
  SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/')
  PG=$(head -c 24 /dev/urandom | base64 | tr -d '\n=+/')
  printf 'JWT_SECRET=%s\nPOSTGRES_PASSWORD=%s\nWEB_PORT=%s\nCOOKIE_SECURE=0\nMAX_UPLOAD_MB=50\nMOBILE_KEY=\n' "$SECRET" "$PG" "$PORT" > .env
  chmod 600 .env
else
  echo "[2/4] .env уже есть, оставляю как есть"
fi
echo "[3/4] Сборка и запуск контейнеров (первый раз 5-10 минут)..."
OLD=$(docker ps -aq --filter "label=com.docker.compose.project=scalelab")
if [ -n "$OLD" ]; then
  echo "Останавливаю старую версию (проект scalelab)..."
  docker rm -f $OLD >/dev/null
fi
docker compose build --no-cache web
docker compose up -d --build --force-recreate
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow ${PORT}/tcp >/dev/null
fi
echo "[4/4] Проверка..."
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/m/health" >/dev/null 2>&1; then
    echo "OK: сервис отвечает на порту ${PORT}"
    echo "Заголовок страницы: $(curl -fsS "http://127.0.0.1:${PORT}/" | grep -o '<title>[^<]*</title>')"
    docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    exit 0
  fi
  sleep 3
done
echo "Сервис не ответил за 2 минуты. Логи: docker compose -f /opt/masshtablab/docker-compose.yml logs --tail 80"
exit 1
