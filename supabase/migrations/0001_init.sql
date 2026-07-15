-- =====================================================================
--  Web Push SaaS — initial schema
--  Architecture ported 1:1 from TryVice patterns:
--    · profiles.role (client | admin) + is_admin() SECURITY DEFINER
--    · multi-tenant via projects.owner_id -> auth.users
--    · two-balance billing (tariff burns, package never burns)
--    · superadmin RPCs granted to `authenticated` with in-function is_admin()
--    · all other balance mutations restricted to service_role
--  Billing metric here = SENT PUSHES (1 push to 1 subscriber = 1 unit).
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
--  PROFILES
-- ---------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'client' check (role in ('client','admin')),
  created_at timestamptz not null default now()
);

-- role is NEVER taken from signUp metadata — always forced to 'client'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'client')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Single source of truth for "who is admin". SECURITY DEFINER so the
-- inner read of profiles bypasses RLS and can't recurse into its own policy.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------
--  TARIFFS  (global catalog, superadmin CRUD)
-- ---------------------------------------------------------------------
create table public.tariffs (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  price_rub         numeric(10,2) not null default 0,
  monthly_push_limit integer not null default 0,   -- pushes credited per period
  subscriber_limit  integer,                        -- optional cap; null = unlimited
  is_public         boolean not null default true,  -- shown in client picker
  is_system         boolean not null default false, -- the free "Старт"; undeletable
  sort              integer not null default 0,
  created_at        timestamptz not null default now()
);

-- The free system tariff new projects start on. One row, protected below.
insert into public.tariffs (name, price_rub, monthly_push_limit, subscriber_limit, is_public, is_system, sort)
values ('Старт', 0, 1000, 500, true, true, 0);

-- Block deletion of the system tariff at the DB level (UI also disables it).
create or replace function public.protect_system_tariff()
returns trigger
language plpgsql
as $$
begin
  if old.is_system then
    raise exception 'Системный тариф удалить нельзя';
  end if;
  return old;
end;
$$;

create trigger trg_protect_system_tariff
  before delete on public.tariffs
  for each row execute function public.protect_system_tariff();

-- ---------------------------------------------------------------------
--  PROJECTS  (tenant = one client site; was `shops`)
-- ---------------------------------------------------------------------
create table public.projects (
  id                       uuid primary key default gen_random_uuid(),
  owner_id                 uuid references auth.users(id) on delete set null,
  name                     text not null,
  domain                   text,                    -- client's site host (for SW/subscribe)
  vapid_public_key         text,                    -- public key is safe to expose
  tariff_id                uuid references public.tariffs(id),
  tariff_pushes_remaining  integer not null default 0,  -- burns on block/renew
  package_pushes_remaining integer not null default 0,  -- never burns
  remaining_pushes         integer generated always as
                             (tariff_pushes_remaining + package_pushes_remaining) stored,
  is_active                boolean not null default true,
  current_period_end       timestamptz,
  renewal_attempts         integer not null default 0,
  created_at               timestamptz not null default now()
);

create index idx_projects_owner on public.projects(owner_id);

-- Sensitive material — private VAPID key + CloudPayments recurring token.
-- Kept in a separate table so RLS can hide it from clients entirely;
-- only service_role (the sender/cron) and is_admin() may read it.
create table public.project_secrets (
  project_id        uuid primary key references public.projects(id) on delete cascade,
  vapid_private_key text,
  cp_card_token     text
);

-- owner_id is set once at creation and frozen thereafter (defends against
-- app bugs that might resend the field on update of someone else's project).
create or replace function public.freeze_owner_id()
returns trigger
language plpgsql
as $$
begin
  new.owner_id := old.owner_id;
  return new;
end;
$$;

create trigger trg_freeze_owner_id
  before update on public.projects
  for each row execute function public.freeze_owner_id();

-- New project starts on the system tariff; its starter pushes go into the
-- PACKAGE balance (non-burning), exactly like TryVice new-shop defaults.
create or replace function public.handle_new_project_defaults()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_tariff public.tariffs;
begin
  select * into v_tariff from public.tariffs where is_system order by sort limit 1;
  if new.tariff_id is null then
    new.tariff_id := v_tariff.id;
  end if;
  -- starter allowance is non-burning
  new.package_pushes_remaining := coalesce(new.package_pushes_remaining, 0) + coalesce(v_tariff.monthly_push_limit, 0);
  new.tariff_pushes_remaining := 0;
  new.is_active := true;
  return new;
end;
$$;

create trigger trg_new_project_defaults
  before insert on public.projects
  for each row execute function public.handle_new_project_defaults();

-- ---------------------------------------------------------------------
--  SUBSCRIBERS  (push subscriptions)
-- ---------------------------------------------------------------------
create table public.subscribers (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  platform   text not null default 'unknown' check (platform in ('ios','android','desktop','unknown')),
  user_agent text,
  tags       text[] not null default '{}',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create index idx_subscribers_project on public.subscribers(project_id);
create index idx_subscribers_tags on public.subscribers using gin(tags);

-- ---------------------------------------------------------------------
--  CAMPAIGNS  (a push send / broadcast)
-- ---------------------------------------------------------------------
create table public.campaigns (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  title           text not null,
  body            text not null,
  icon_url        text,
  image_url       text,
  click_url       text,
  status          text not null default 'draft'
                    check (status in ('draft','scheduled','sending','sent','failed','canceled')),
  segment_tags    text[] not null default '{}',   -- empty = whole audience
  scheduled_at    timestamptz,
  sent_at         timestamptz,
  sent_count      integer not null default 0,
  delivered_count integer not null default 0,
  failed_count    integer not null default 0,
  clicked_count   integer not null default 0,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index idx_campaigns_project on public.campaigns(project_id);
create index idx_campaigns_scheduled on public.campaigns(status, scheduled_at)
  where status = 'scheduled';

-- ---------------------------------------------------------------------
--  AUTOMATIONS  (welcome / abandoned-cart / custom triggers)
-- ---------------------------------------------------------------------
create table public.automations (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  type         text not null check (type in ('welcome','abandoned_cart','custom')),
  is_enabled   boolean not null default false,
  delay_minutes integer not null default 0,
  title        text,
  body         text,
  click_url    text,
  config       jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index idx_automations_project on public.automations(project_id);

-- ---------------------------------------------------------------------
--  PUSH EVENTS  (delivery / click tracking for stats)
-- ---------------------------------------------------------------------
create table public.push_events (
  id            bigint generated always as identity primary key,
  project_id    uuid not null references public.projects(id) on delete cascade,
  campaign_id   uuid references public.campaigns(id) on delete cascade,
  subscriber_id uuid references public.subscribers(id) on delete set null,
  type          text not null check (type in ('delivered','failed','clicked')),
  created_at    timestamptz not null default now()
);

create index idx_push_events_campaign on public.push_events(campaign_id);
create index idx_push_events_project_time on public.push_events(project_id, created_at);

-- ---------------------------------------------------------------------
--  TRANSACTIONS  (billing history / audit)
-- ---------------------------------------------------------------------
create table public.transactions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  type         text not null check (type in
                 ('tariff_purchase','tariff_renewal','package_purchase',
                  'manual_tariff','manual_bonus','refund')),
  amount_rub   numeric(10,2) not null default 0,
  pushes       integer not null default 0,      -- units credited by this op
  description  text,
  performed_by uuid references auth.users(id) on delete set null,  -- admin, if manual
  created_at   timestamptz not null default now()
);

create index idx_transactions_project on public.transactions(project_id, created_at);

-- ---------------------------------------------------------------------
--  API KEYS  (client-facing REST access)
-- ---------------------------------------------------------------------
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null,
  key_prefix   text not null,        -- shown in UI (e.g. "wpk_ab12…")
  key_hash     text not null,        -- sha256 of full key; full key shown once
  is_active    boolean not null default true,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

create index idx_api_keys_project on public.api_keys(project_id);

-- ---------------------------------------------------------------------
--  PLATFORM SETTINGS  (single row)
-- ---------------------------------------------------------------------
create table public.platform_settings (
  id         integer primary key default 1 check (id = 1),
  settings   jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (1);

-- =====================================================================
--  BALANCE MUTATION FUNCTIONS
-- =====================================================================

-- Atomic spend: reserve N pushes under a row lock, tariff first then package.
-- Returns true if fully covered. Called by the sender (service_role only).
create or replace function public.spend_pushes(p_project_id uuid, p_count integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_tariff int;
  v_pkg    int;
  v_from_tariff int;
  v_from_pkg int;
begin
  if p_count <= 0 then
    return true;
  end if;

  select tariff_pushes_remaining, package_pushes_remaining
    into v_tariff, v_pkg
    from public.projects
    where id = p_project_id
    for update;

  if v_tariff + v_pkg < p_count then
    return false;  -- not enough balance; caller must not send
  end if;

  v_from_tariff := least(v_tariff, p_count);
  v_from_pkg    := p_count - v_from_tariff;

  update public.projects
    set tariff_pushes_remaining  = tariff_pushes_remaining  - v_from_tariff,
        package_pushes_remaining = package_pushes_remaining - v_from_pkg
    where id = p_project_id;

  return true;
end;
$$;

-- Refund reserved-but-unsent pushes (e.g. subset failed pre-flight).
-- Refunds into package (non-burning) — mirrors "slot returned" semantics.
create or replace function public.refund_pushes(p_project_id uuid, p_count integer)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_count > 0 then
    update public.projects
      set package_pushes_remaining = package_pushes_remaining + p_count
      where id = p_project_id;
  end if;
end;
$$;

-- Change/activate a tariff. Carries any UNUSED tariff remainder into the
-- package balance BEFORE overwriting (only when the tariff actually changes),
-- exactly like TryVice. p_pushes = amount to credit to the new tariff balance.
create or replace function public._apply_tariff(
  p_project_id uuid, p_tariff_id uuid, p_pushes integer, p_clear_card boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_cur_tariff uuid;
  v_cur_remaining int;
begin
  select tariff_id, tariff_pushes_remaining
    into v_cur_tariff, v_cur_remaining
    from public.projects where id = p_project_id for update;

  -- carry-over only on a real tariff change, not a plain renewal
  if v_cur_tariff is distinct from p_tariff_id and v_cur_remaining > 0 then
    update public.projects
      set package_pushes_remaining = package_pushes_remaining + v_cur_remaining
      where id = p_project_id;
  end if;

  update public.projects
    set tariff_id = p_tariff_id,
        tariff_pushes_remaining = p_pushes,   -- overwrite, not add
        is_active = true,
        renewal_attempts = 0
    where id = p_project_id;

  if p_clear_card then
    update public.project_secrets set cp_card_token = null where project_id = p_project_id;
  end if;
end;
$$;

-- Block a project: deactivate + burn the tariff remainder. Package untouched.
create or replace function public.block_project(p_project_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.projects
    set is_active = false,
        tariff_pushes_remaining = 0
    where id = p_project_id;
end;
$$;

-- Owner self-unsubscribe: back to system tariff, carry BOTH balances into
-- package, clear card + period, guarantee unblocked.
create or replace function public.unsubscribe_project(p_project_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_sys uuid;
  v_owner uuid;
begin
  select owner_id into v_owner from public.projects where id = p_project_id;
  if v_owner is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Недостаточно прав';
  end if;

  select id into v_sys from public.tariffs where is_system order by sort limit 1;

  update public.projects
    set package_pushes_remaining = package_pushes_remaining + tariff_pushes_remaining,
        tariff_pushes_remaining = 0,
        tariff_id = v_sys,
        current_period_end = null,
        is_active = true,
        renewal_attempts = 0
    where id = p_project_id;

  update public.project_secrets set cp_card_token = null where project_id = p_project_id;
end;
$$;

-- ---- Superadmin-callable RPCs (self-check is_admin, granted to authenticated) ----

create or replace function public.admin_activate_tariff(
  p_project_id uuid, p_tariff_id uuid, p_pushes integer)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Только для администратора';
  end if;
  perform public._apply_tariff(p_project_id, p_tariff_id, p_pushes, true);
  insert into public.transactions (project_id, type, amount_rub, pushes, description, performed_by)
  values (p_project_id, 'manual_tariff', 0, p_pushes, 'Ручная активация тарифа', auth.uid());
end;
$$;

create or replace function public.admin_grant_bonus(
  p_project_id uuid, p_pushes integer, p_description text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Только для администратора';
  end if;
  update public.projects
    set package_pushes_remaining = package_pushes_remaining + p_pushes
    where id = p_project_id;
  insert into public.transactions (project_id, type, amount_rub, pushes, description, performed_by)
  values (p_project_id, 'manual_bonus', 0, p_pushes, coalesce(p_description,'Бонусное начисление'), auth.uid());
end;
$$;

-- =====================================================================
--  ROW LEVEL SECURITY
--    owner path: owner_id = auth.uid()  (or via project_id FK chain)
--    admin path: is_admin()
-- =====================================================================
alter table public.profiles         enable row level security;
alter table public.tariffs          enable row level security;
alter table public.projects         enable row level security;
alter table public.project_secrets  enable row level security;
alter table public.subscribers      enable row level security;
alter table public.campaigns        enable row level security;
alter table public.automations      enable row level security;
alter table public.push_events      enable row level security;
alter table public.transactions     enable row level security;
alter table public.api_keys         enable row level security;
alter table public.platform_settings enable row level security;

-- profiles: own row, or admin sees all
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid() or public.is_admin());

-- tariffs: everyone reads public ones (+ admin reads all); admin full CRUD
create policy tariffs_read on public.tariffs
  for select using (is_public or public.is_admin());
create policy tariffs_admin_insert on public.tariffs
  for insert with check (public.is_admin());
create policy tariffs_admin_update on public.tariffs
  for update using (public.is_admin());
create policy tariffs_admin_delete on public.tariffs
  for delete using (public.is_admin());

-- projects: own or admin
create policy projects_select on public.projects
  for select using (owner_id = auth.uid() or public.is_admin());
create policy projects_insert on public.projects
  for insert with check (owner_id = auth.uid());
create policy projects_update on public.projects
  for update using (owner_id = auth.uid() or public.is_admin());

-- project_secrets: NEVER exposed to clients — admin only (service_role bypasses RLS)
create policy secrets_admin_all on public.project_secrets
  for all using (public.is_admin()) with check (public.is_admin());

-- helper predicate: does auth.uid own this project?
-- (inlined per-table below to keep policies self-contained)

-- subscribers: via owning project (or admin)
create policy subscribers_rw on public.subscribers
  for all using (
    exists (select 1 from public.projects p
            where p.id = subscribers.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  ) with check (
    exists (select 1 from public.projects p
            where p.id = subscribers.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );

-- campaigns
create policy campaigns_rw on public.campaigns
  for all using (
    exists (select 1 from public.projects p
            where p.id = campaigns.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  ) with check (
    exists (select 1 from public.projects p
            where p.id = campaigns.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );

-- automations
create policy automations_rw on public.automations
  for all using (
    exists (select 1 from public.projects p
            where p.id = automations.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  ) with check (
    exists (select 1 from public.projects p
            where p.id = automations.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );

-- push_events: read-only for owner/admin (writes come from service_role sender)
create policy push_events_select on public.push_events
  for select using (
    exists (select 1 from public.projects p
            where p.id = push_events.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );

-- transactions: read-only for owner/admin (writes via RPC/service_role)
create policy transactions_select on public.transactions
  for select using (
    exists (select 1 from public.projects p
            where p.id = transactions.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );

-- api_keys: owner/admin (hash only; full key returned once by API route)
create policy api_keys_rw on public.api_keys
  for all using (
    exists (select 1 from public.projects p
            where p.id = api_keys.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  ) with check (
    exists (select 1 from public.projects p
            where p.id = api_keys.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );

-- platform_settings: admin only
create policy platform_settings_admin on public.platform_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
--  GRANTS: superadmin RPCs + self-unsubscribe callable from the browser.
--  Everything else that mutates balances stays service_role-only.
-- =====================================================================
grant execute on function public.admin_activate_tariff(uuid, uuid, integer) to authenticated;
grant execute on function public.admin_grant_bonus(uuid, integer, text)     to authenticated;
grant execute on function public.unsubscribe_project(uuid)                  to authenticated;
grant execute on function public.is_admin()                                 to authenticated, anon;

-- spend/refund/apply/block are intentionally NOT granted to authenticated.
revoke execute on function public.spend_pushes(uuid, integer)   from public;
revoke execute on function public.refund_pushes(uuid, integer)  from public;
revoke execute on function public._apply_tariff(uuid, uuid, integer, boolean) from public;
revoke execute on function public.block_project(uuid)           from public;
