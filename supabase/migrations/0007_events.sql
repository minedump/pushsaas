-- =====================================================================
--  Event-driven automations (abandoned cart & co).
--  Model: event stream + delayed jobs with cancellation.
--    · ingest_event() logs the event and, for each enabled 'event' automation,
--      schedules a job (debounced) on trigger / cancels pending jobs on cancel.
--    · a cron drains due jobs and sends the push (Node sendOneOff).
-- =====================================================================

-- allow the new automation type
alter table public.automations drop constraint automations_type_check;
alter table public.automations add constraint automations_type_check
  check (type in ('welcome','abandoned_cart','custom','event'));

-- ---- raw event stream (also doubles as a funnel/analytics source) ----
create table public.events (
  id            bigint generated always as identity primary key,
  project_id    uuid not null references public.projects(id) on delete cascade,
  subscriber_id uuid references public.subscribers(id) on delete cascade,
  name          text not null,
  payload       jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index idx_events_lookup on public.events(project_id, subscriber_id, name, created_at desc);

-- ---- delayed job queue ----
create table public.automation_jobs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  fire_at       timestamptz not null,
  status        text not null default 'pending' check (status in ('pending','sent','canceled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- one PENDING job per (automation, subscriber) — lets a repeat trigger debounce
create unique index uq_pending_job on public.automation_jobs(automation_id, subscriber_id) where status = 'pending';
create index idx_jobs_due on public.automation_jobs(fire_at) where status = 'pending';

-- ---- RLS: owner/admin read only; all writes go through service_role ----
alter table public.events enable row level security;
alter table public.automation_jobs enable row level security;

create policy events_select on public.events
  for select using (exists (select 1 from public.projects p
    where p.id = events.project_id and (p.owner_id = auth.uid() or public.is_admin())));

create policy jobs_select on public.automation_jobs
  for select using (exists (select 1 from public.projects p
    where p.id = automation_jobs.project_id and (p.owner_id = auth.uid() or public.is_admin())));

-- ---------------------------------------------------------------------
--  ingest_event — the whole schedule/cancel logic in one atomic call.
--  Called by the ingest route via service_role.
-- ---------------------------------------------------------------------
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

  -- no device -> nothing to schedule (still logged above for analytics)
  if p_subscriber_id is null then
    return;
  end if;

  for a in
    select id, coalesce(delay_minutes, 0) as delay_minutes, config
    from public.automations
    where project_id = p_project_id and type = 'event' and is_enabled = true
  loop
    -- trigger event -> (re)schedule the job, resetting the countdown
    if a.config->>'trigger_event' = p_name then
      insert into public.automation_jobs (project_id, automation_id, subscriber_id, fire_at)
      values (p_project_id, a.id, p_subscriber_id, now() + make_interval(mins => a.delay_minutes))
      on conflict (automation_id, subscriber_id) where status = 'pending'
      do update set fire_at = excluded.fire_at, updated_at = now();
    end if;

    -- cancel event -> drop any pending job for this device+automation
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

grant execute on function public.ingest_event(uuid, uuid, text, jsonb) to service_role;
