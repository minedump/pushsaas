-- Событийные автоматизации поднимаются до уровня приветственных (канал,
-- шаблон, приоритет, сегмент, окно отправки, защита от наложения — все эти
-- колонки на automations уже есть, добавлены для welcome, event их просто
-- не использовал). Тут — то немногое, чего действительно не хватало.

-- Снимок payload события НА МОМЕНТ постановки задания — раньше рендер брал
-- данные из subscribers.attributes (общий, мутируемый следующими событиями
-- того же устройства между постановкой и реальной отправкой — окно
-- отправки/защита от наложения теперь могут отложить отправку надолго,
-- поэтому эта гонка стала реальной проблемой, не теоретической). ingest_event
-- обновлён ниже — пишет payload прямо в задание.
alter table public.automation_jobs add column if not exists payload jsonb;

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

  -- rolling profile: latest event data wins per key (не трогаем — Liquid
  -- welcome-цепочек и любой другой контент по устройству продолжает читать
  -- отсюда).
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
      on conflict (automation_id, subscriber_id) where status = 'pending'
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

-- Товарный фид (YML/Яндекс.Маркет — тот же формат, что штатный экспорт
-- InSales) — периодически перечитывается в кеш product_feed_items и
-- используется как источник контекста (название/цена/картинка/ссылка) для
-- событийных рассылок про товары (брошенная корзина/избранное/просмотр).
alter table public.projects add column if not exists product_feed_url text;
alter table public.projects add column if not exists product_feed_updated_at timestamptz;
alter table public.projects add column if not exists product_feed_item_count integer not null default 0;
alter table public.projects add column if not exists product_feed_error text;

create table public.product_feed_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  external_id text not null, -- offer id из фида — то же значение, что мерчант шлёт в sendera.event() как product_id
  name        text not null,
  price       numeric,
  image_url   text,
  url         text,
  category    text,
  updated_at  timestamptz not null default now()
);
create unique index uq_product_feed_item on public.product_feed_items(project_id, external_id);
create index idx_product_feed_project on public.product_feed_items(project_id);

alter table public.product_feed_items enable row level security;
create policy product_feed_items_select on public.product_feed_items
  for select using (
    exists (select 1 from public.projects p
            where p.id = product_feed_items.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );
