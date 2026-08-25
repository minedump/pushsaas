-- Багфикс, найденный живым тестом: ON CONFLICT в ingest_event указывал
-- предикат "where status = 'pending'", а реальный частичный уникальный
-- индекс (0043_welcome_multichannel.sql) — "where status = 'pending' and
-- subscriber_id is not null". Postgres требует ТОЧНОГО совпадения предиката
-- с индексом, иначе ON CONFLICT падает с 42P10 "no unique or exclusion
-- constraint matching". Событийные автоматизации с delay>0 были из-за этого
-- сломаны с момента 0043 — просто раньше не было реальных event-автоматизаций,
-- чтобы это заметить.
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
      insert into public.automation_jobs (project_id, automation_id, subscriber_id, fire_at, payload)
      values (p_project_id, a.id, p_subscriber_id, now() + make_interval(mins => a.delay_minutes), coalesce(p_payload, '{}'::jsonb))
      on conflict (automation_id, subscriber_id) where status = 'pending' and subscriber_id is not null
      do update set fire_at = excluded.fire_at, payload = excluded.payload, updated_at = now();
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
