-- =====================================================================
--  (1) Haskimail email channel (replaces the earlier Resend prototype —
--      never wired to real customers, safe to drop in place).
--  (2) Instant-identify (skip-OTP) linking: audit column for identities.
-- =====================================================================

alter table public.project_secrets add column if not exists haskimail_server_token text;

-- Аудит: каким путём подтверждён телефон — обычным кодом ('otp') или через
-- доверие авторизованной сессии InSales ('insales_session', см. /api/public/identify).
-- Не влияет на логику доступа — та по-прежнему смотрит только на phone_verified_at.
alter table public.identities add column if not exists verification_source text;
