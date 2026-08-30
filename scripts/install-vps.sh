#!/usr/bin/env bash
# Развёртывание SENDERA на чистой Ubuntu. Запускать от root:
#
#   bash install-vps.sh
#
# Скрипт ставит докер, забирает готовый образ приложения (собран на стороне
# GitHub, см. .github/workflows/docker-build.yml) и поднимает остальные
# сервисы. Файл настроек .env должен лежать рядом с проектом — скрипт это
# проверит.
set -euo pipefail

DIR=/opt/sendera

echo "==> проверяю докер"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# С адресов российского хостинга Docker Hub быстро упирается в лимит
# анонимных загрузок и отвечает отказом. Зеркала снимают это ограничение.
if [ ! -f /etc/docker/daemon.json ]; then
  echo "==> прописываю зеркала реестра образов"
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": [
    "https://dockerhub.timeweb.cloud",
    "https://mirror.gcr.io"
  ]
}
JSON
  systemctl restart docker
  sleep 3
fi
docker --version
docker compose version

echo "==> проверяю настройки"
cd "$DIR"
if [ ! -f .env ]; then
  echo "нет файла $DIR/.env — положите его туда и запустите скрипт снова" >&2
  exit 1
fi
for v in APP_DOMAIN APP_BASE_URL APP_IMAGE POSTGRES_PASSWORD JWT_SECRET NEXT_PUBLIC_SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT CRON_SECRET UNSUBSCRIBE_SECRET; do
  grep -q "^$v=." .env || { echo "в .env не заполнено: $v" >&2; exit 1; }
done

# ghcr.io — приватный пакет: авторизуемся токеном с правом read:packages
# (GHCR_TOKEN в .env, не в самом compose — секрет не должен попасть в образ)
if grep -q "^GHCR_TOKEN=." .env; then
  echo "==> вход в ghcr.io"
  GHCR_USER=$(grep '^GHCR_USER=' .env | cut -d= -f2)
  GHCR_TOKEN=$(grep '^GHCR_TOKEN=' .env | cut -d= -f2)
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
fi

echo "==> забираю готовый образ приложения"
docker compose -f docker-compose.yml -f docker-compose.vps.yml pull app

echo "==> поднимаю сервисы (первая сборка gateway/caddy — пара минут)"
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d

echo "==> жду готовности приложения"
for i in $(seq 1 60); do
  if docker compose -f docker-compose.yml -f docker-compose.vps.yml logs app 2>/dev/null | grep -q "Ready in"; then
    echo "приложение запустилось"
    break
  fi
  [ "$i" = 60 ] && echo "приложение не поднялось за 5 минут — смотрите логи" >&2
  sleep 5
done

echo "==> состояние"
docker compose -f docker-compose.yml -f docker-compose.vps.yml ps
echo
echo "==> расписание воркеров"
docker compose -f docker-compose.yml -f docker-compose.vps.yml exec -T db \
  psql -U postgres -d postgres -tAc "select jobname from cron.job order by jobname" 2>/dev/null || true
echo
echo "готово. Сертификат выпускается автоматически при первом обращении по домену."
