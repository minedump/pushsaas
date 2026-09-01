-- Security-аудит нашёл: app_config (хранит cron_secret) и rate_limit_hits
-- никогда не получали `enable row level security`. PostgREST по умолчанию
-- открывает public-таблицы anon/authenticated ролям без явного запрета —
-- значит cron_secret был читаем любым держателем публичного anon-ключа
-- через GET {SUPABASE_URL}/rest/v1/app_config, а rate_limit_hits — читаем/
-- писаем, позволяя как читать чужие IP, так и стирать свои же хиты в обход
-- лимитов (lib/ratelimit.ts). Оба сервисных, без клиентских политик — как
-- у otp_requests/oidc_auth_sessions/oidc_clients (см. 0002/0026/0042):
-- RLS без единой policy = anon/authenticated получают ноль доступа,
-- service_role по-прежнему видит всё (роль создаётся с bypassrls, см.
-- scripts/migrate.mjs).
alter table public.app_config enable row level security;
alter table public.rate_limit_hits enable row level security;
