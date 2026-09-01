# Веб-сервер с автоматическим HTTPS. Конфиг лежит внутри образа: так его
# не нужно монтировать с диска, и образ остаётся самодостаточным.
# Пин по digest, не по мутабельному тегу (security-аудит 2026-09-01) —
# caddy:2-alpine, свежий на момент фикса. Обновлять сознательно:
# docker pull caddy:2-alpine && docker inspect --format='{{index .RepoDigests 0}}' caddy:2-alpine
FROM caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
COPY Caddyfile /etc/caddy/Caddyfile
