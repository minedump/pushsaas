# Маршрутизатор Supabase-совместимых путей с конфигом внутри образа.
#
# Непривилегированный вариант образа: мастер-процесс работает от uid 101,
# а не от root. Порт 8000 непривилегированный, поэтому менять конфиг не нужно.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY gateway.conf /etc/nginx/conf.d/default.conf
