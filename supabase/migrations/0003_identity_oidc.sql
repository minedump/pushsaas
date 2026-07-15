-- =====================================================================
--  0003 — Identity layer + OIDC provider + OTP cascade
--  Вход покупателя InSales через нашу прослойку (OpenID Connect):
--    · identities — человек (телефон) внутри проекта
--    · identity_devices — связки «человек ↔ push-устройство»
--    · subscribers.device_token_hash — паспорт устройства (виджет)
--    · otp_requests — коды подтверждения (push → telegram → sms)
--    · oidc_auth_sessions — сессии логина + authorization codes
--    · link_tickets — одноразовые тикеты привязки устройства (отскок)
--    · oidc_clients — публичная OIDC-конфигурация проекта
--    · project_secrets.* — приватный RSA-ключ, client_secret, токены каналов
--  Проверено на стенде (2026-07-12): InSales принимает ID Token только с
--  phone_number (без email); userinfo_endpoint ОБЯЗАТЕЛЕН.
-- =====================================================================

-- ---------------------------------------------------------------------
--  SUBSCRIBERS: паспорт устройства
--  device_token выдаётся виджету при подписке (хранится у него в
--  localStorage), у нас — только sha256. Ротация endpoint браузером
--  обновляет ту же строку по токену.
-- ---------------------------------------------------------------------
alter table public.subscribers
  add column if not exists device_token_hash text unique;

-- ---------------------------------------------------------------------
--  IDENTITIES  (человек = подтверждённый телефон внутри проекта)
-- ---------------------------------------------------------------------
create table public.identities (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  phone             text not null,               -- только цифры E.164, без '+'
  phone_verified_at timestamptz,
  name              text,
  email             text,
  insales_client_id text,                        -- из вебхука client/create
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (project_id, phone)
);

create index idx_identities_project on public.identities(project_id);
create index idx_identities_insales on public.identities(project_id, insales_client_id);

-- ---------------------------------------------------------------------
--  IDENTITY_DEVICES  (телефон ↔ устройства; many-to-many на будущее,
--  фактически many devices per identity)
-- ---------------------------------------------------------------------
create table public.identity_devices (
  identity_id   uuid not null references public.identities(id) on delete cascade,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  primary key (identity_id, subscriber_id)
);

create index idx_identity_devices_sub on public.identity_devices(subscriber_id);

-- ---------------------------------------------------------------------
--  OTP_REQUESTS  (одноразовые коды; канал = push | telegram | sms)
-- ---------------------------------------------------------------------
create table public.otp_requests (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  phone       text not null,
  code_hash   text not null,                     -- sha256(code + otp id)
  channel     text not null check (channel in ('push','telegram','sms')),
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- rate limit: N отправок на телефон за окно
create index idx_otp_phone_time on public.otp_requests(project_id, phone, created_at);

-- ---------------------------------------------------------------------
--  OIDC_AUTH_SESSIONS  (одна попытка входа: параметры RP → OTP →
--  authorization code → обмен на токен)
-- ---------------------------------------------------------------------
create table public.oidc_auth_sessions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  redirect_uri text not null,
  state        text,
  nonce        text,
  phone        text,
  identity_id  uuid references public.identities(id) on delete set null,
  otp_id       uuid references public.otp_requests(id) on delete set null,
  status       text not null default 'pending'
                 check (status in ('pending','verified','code_issued','consumed')),
  code_hash    text unique,                      -- sha256 authorization code, одноразовый
  access_token_hash text unique,                 -- sha256 access token (для /userinfo)
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

create index idx_oidc_sessions_project on public.oidc_auth_sessions(project_id, created_at);

-- ---------------------------------------------------------------------
--  LINK_TICKETS  (одноразовый тикет привязки: страница входа -> отскок
--  на магазин -> виджет предъявляет device_token + тикет)
-- ---------------------------------------------------------------------
create table public.link_tickets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  identity_id uuid not null references public.identities(id) on delete cascade,
  session_id  uuid references public.oidc_auth_sessions(id) on delete cascade,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  OIDC_CLIENTS  (публичная конфигурация OIDC на проект; секреты — в
--  project_secrets, клиенту не видны)
--  config: { channels: {push,telegram,sms}, sms_sender, require_name }
-- ---------------------------------------------------------------------
create table public.oidc_clients (
  project_id uuid primary key references public.projects(id) on delete cascade,
  client_id  text not null unique,
  kid        text not null,
  is_enabled boolean not null default true,
  config     jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.project_secrets
  add column if not exists oidc_private_key_pem     text,
  add column if not exists oidc_client_secret_hash  text,
  add column if not exists telegram_gateway_token   text,
  add column if not exists bytehand_service_key     text;

-- =====================================================================
--  RLS — по образцу 0001: owner через project_id, admin через is_admin().
--  Таблицы флоу (otp, sessions, tickets) — только service_role: политик
--  нет вообще, RLS включён => authenticated не видит ничего.
-- =====================================================================
alter table public.identities         enable row level security;
alter table public.identity_devices   enable row level security;
alter table public.otp_requests       enable row level security;
alter table public.oidc_auth_sessions enable row level security;
alter table public.link_tickets       enable row level security;
alter table public.oidc_clients       enable row level security;

-- identities: владелец проекта видит и редактирует (имя/почта), удаление — тоже
create policy identities_rw on public.identities
  for all using (
    exists (select 1 from public.projects p
            where p.id = identities.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  ) with check (
    exists (select 1 from public.projects p
            where p.id = identities.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );

-- identity_devices: владелец читает (какие устройства у человека); мутации — service_role
create policy identity_devices_select on public.identity_devices
  for select using (
    exists (select 1 from public.identities i
            join public.projects p on p.id = i.project_id
            where i.id = identity_devices.identity_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );

-- oidc_clients: владелец читает конфигурацию (client_id, kid, config)
create policy oidc_clients_select on public.oidc_clients
  for select using (
    exists (select 1 from public.projects p
            where p.id = oidc_clients.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );
