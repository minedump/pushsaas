-- =====================================================================
--  V2 batch: paused flag, rate limiting, order attribution, rich push,
--  email OTP channel storage.
-- =====================================================================

-- (1) paused vs dead(410): separate flags. is_active = device still valid
-- (browser-level unsubscribe/410 sets it false). paused = merchant paused
-- this subscriber on request; independently excludes from sends.
alter table public.subscribers add column if not exists paused boolean not null default false;

-- (9) generic sliding-window rate limiting (same technique as otp_requests:
-- count rows in the window, insert a hit). Works across serverless instances.
create table if not exists public.rate_limit_hits (
  id bigint generated always as identity primary key,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_rate_limit_hits on public.rate_limit_hits(key, created_at desc);

-- (A) order attribution: settings on the project + a table of attributed orders.
alter table public.projects add column if not exists attribution_enabled boolean not null default false;
alter table public.projects add column if not exists attribution_cookie_name text not null default 'pss_attr';
alter table public.projects add column if not exists attribution_window_days integer not null default 7;
alter table public.projects add column if not exists attribution_cookie_path text;      -- путь к куке в теле вебхука заказа (TBD форматом клиента)
alter table public.projects add column if not exists attribution_order_id_path text not null default 'number';
alter table public.projects add column if not exists attribution_revenue_path text not null default 'total_price';

create table if not exists public.order_attributions (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  campaign_id   uuid references public.campaigns(id) on delete set null,
  subscriber_id uuid references public.subscribers(id) on delete set null,
  order_number  text,
  revenue       numeric(12,2) not null default 0,
  raw_cookie    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_order_attr_project on public.order_attributions(project_id, created_at desc);
create index if not exists idx_order_attr_campaign on public.order_attributions(campaign_id);

alter table public.order_attributions enable row level security;
create policy order_attributions_select on public.order_attributions
  for select using (exists (select 1 from public.projects p
    where p.id = order_attributions.project_id and (p.owner_id = auth.uid() or public.is_admin())));

-- (B) rich push: up to N action buttons on a campaign. [{ "title": "...", "url": "..." }]
alter table public.campaigns add column if not exists actions jsonb not null default '[]';

-- (C) email OTP channel: Resend API key alongside telegram/bytehand secrets.
alter table public.project_secrets add column if not exists resend_api_key text;
