-- =====================================================================
--  (1) Per-subscriber rolling attributes — every event merges its payload
--      into subscribers.attributes; used to template push title/body/url.
--  (2) automation_log — unified activity log for event / api / webhook fires.
-- =====================================================================

alter table public.subscribers add column if not exists attributes jsonb not null default '{}';

-- redefine ingest_event to also merge the payload into the device's attributes
create or replace function public.ingest_event(
  p_project_id uuid, p_subscriber_id uuid, p_name text, p_payload jsonb
) returns void
language plpgsql
security definer set search_path = public
as $$
declare
  a record;
begin
  insert into public.events (project_id, subscriber_id, name, payload)
  values (p_project_id, p_subscriber_id, p_name, coalesce(p_payload, '{}'::jsonb));

  if p_subscriber_id is null then
    return;
  end if;

  -- rolling profile: latest event data wins per key
  if p_payload is not null and p_payload <> '{}'::jsonb then
    update public.subscribers
      set attributes = attributes || p_payload
      where id = p_subscriber_id;
  end if;

  for a in
    select id, coalesce(delay_minutes, 0) as delay_minutes, config
    from public.automations
    where project_id = p_project_id and type = 'event' and is_enabled = true
  loop
    if a.config->>'trigger_event' = p_name then
      insert into public.automation_jobs (project_id, automation_id, subscriber_id, fire_at)
      values (p_project_id, a.id, p_subscriber_id, now() + make_interval(mins => a.delay_minutes))
      on conflict (automation_id, subscriber_id) where status = 'pending'
      do update set fire_at = excluded.fire_at, updated_at = now();
    end if;

    if exists (
      select 1 from jsonb_array_elements_text(coalesce(a.config->'cancel_events', '[]'::jsonb)) ev
      where ev = p_name
    ) then
      update public.automation_jobs
        set status = 'canceled', updated_at = now()
        where automation_id = a.id and subscriber_id = p_subscriber_id and status = 'pending';
    end if;
  end loop;
end;
$$;

-- ---- unified automation activity log ----
create table public.automation_log (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  source        text not null check (source in ('event','api','webhook','welcome')),
  automation_id uuid references public.automations(id) on delete set null,
  subscriber_id uuid references public.subscribers(id) on delete set null,
  title         text,
  status        text not null check (status in ('sent','failed','skipped')),
  recipients    integer not null default 1,
  detail        jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index idx_autolog_project on public.automation_log(project_id, created_at desc);

alter table public.automation_log enable row level security;
create policy autolog_select on public.automation_log
  for select using (exists (select 1 from public.projects p
    where p.id = automation_log.project_id and (p.owner_id = auth.uid() or public.is_admin())));
