-- =====================================================================
--  0013 — Единый каскад: телефон и email как равноправные, независимые
--  ключи входа.
--
--  До сих пор identities.phone был NOT NULL — телефон был единственным
--  ключом, email лишь СОПУТСТВОВАЛ ему (известен из вебхука заказа, но НЕ
--  проверялся независимо). Теперь каскад определяет стартовый ключ по
--  channel_order (email первым в порядке → спрашиваем почту; иначе —
--  телефон), с симметричным фолбэком на другой ключ, если первый исчерпан
--  без успеха (см. app/oidc/[projectId]/auth/route.ts). Какой бы ключ ни
--  подтвердился кодом — он и пишется в identities с *_verified_at; второй
--  остаётся как был (нет флоу, который просит подтвердить оба сразу).
--
--  oidc_auth_sessions.verifying_key — какой ключ подтверждает ТЕКУЩИЙ
--  otp_id этой сессии ('phone' | 'email'), чтобы resend/verify не гадали
--  по тому, какие поля сессии заполнены (при фолбэке заполнены оба).
--
--  Заодно фикс реального бага: otp_requests.channel никогда не разрешал
--  значение 'email', хотя lib/otp.sendOtp вставляет именно его при
--  успехе email-канала — INSERT падал на CHECK constraint.
-- =====================================================================

alter table public.otp_requests drop constraint if exists otp_requests_channel_check;
alter table public.otp_requests add constraint otp_requests_channel_check
  check (channel in ('push','email','telegram','sms'));

alter table public.otp_requests alter column phone drop not null;
alter table public.otp_requests add column if not exists email text;
alter table public.otp_requests add constraint otp_requests_has_key
  check (phone is not null or email is not null);

create index if not exists idx_otp_email_time on public.otp_requests(project_id, email, created_at);

alter table public.identities alter column phone drop not null;
alter table public.identities add column if not exists email_verified_at timestamptz;
alter table public.identities add constraint identities_has_key
  check (phone is not null or email is not null);

-- один email — одна identity в проекте. Обычный unique (не partial index):
-- Postgres не считает NULL = NULL, так что несколько identities с email is
-- null (обычные, телефонные) продолжают спокойно сосуществовать — как уже
-- работает unique(project_id, phone). Обычный constraint (не partial index)
-- нужен ещё и потому, что upsert(onConflict:"project_id,email") в auth/route.ts
-- генерирует ON CONFLICT (project_id,email) без WHERE — partial-индекс под
-- такой ON CONFLICT не подошёл бы как arbiter.
alter table public.identities add constraint identities_email_uniq unique (project_id, email);

alter table public.oidc_auth_sessions add column if not exists verifying_key text
  check (verifying_key in ('phone','email'));
