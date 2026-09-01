# Маршрутизатор Supabase-совместимых путей с конфигом внутри образа.
#
# Непривилегированный вариант образа: мастер-процесс работает от uid 101,
# а не от root. Порт 8000 непривилегированный, поэтому менять конфиг не нужно.
# Пин по digest, не по мутабельному тегу (security-аудит 2026-09-01) —
# nginx-unprivileged:1.27-alpine, свежий на момент фикса. Обновлять сознательно:
# docker pull nginxinc/nginx-unprivileged:1.27-alpine && docker inspect --format='{{index .RepoDigests 0}}' nginxinc/nginx-unprivileged:1.27-alpine
FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0
COPY gateway.conf /etc/nginx/conf.d/default.conf
