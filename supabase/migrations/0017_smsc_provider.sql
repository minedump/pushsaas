-- =====================================================================
--  0017 — SMSC.ru как ещё один провайдер для SMS/Telegram/Email.
--
--  Один аккаунт SMSC обслуживает все три канала через один и тот же
--  send.php/status.php — поэтому один набор ключей (login+password), а не
--  отдельные секреты на канал, как у Bytehand/Telegram Gateway/Haskimail.
--  Какой провайдер активен для канала — в oidc_clients.config.providers
--  (jsonb, без миграции), дефолт — прежние провайдеры (ничего не ломается).
--
--  otp_requests.provider — каким провайдером ушёл КОНКРЕТНЫЙ код, отдельно
--  от channel (типа канала). Нужно, чтобы проверка статуса доставки
--  (otp-status/route.ts) знала, чей API дёргать, даже если админ успеет
--  сменить провайдера в настройках между отправкой кода и проверкой статуса.
-- =====================================================================

alter table public.project_secrets add column if not exists smsc_login text;
alter table public.project_secrets add column if not exists smsc_password text;

alter table public.otp_requests add column if not exists provider text;
