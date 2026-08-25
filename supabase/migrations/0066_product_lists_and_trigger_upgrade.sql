-- Список товаров у контакта (избранное/корзина) — копим сами из клиентских
-- событий favorite_added/favorite_removed/cart_updated (см. ingest_event
-- ниже), чтобы вебхук-триггеры «цена снижена»/«товар в наличии» могли найти,
-- кому из подписчиков конкретный товар вообще интересен, и разослать только
-- им (см. lib/identity.ts resolveIdentitiesForProduct). Если товара ни у
-- кого в списке нет — запрос вернёт пусто, письмо не сформируется вообще:
-- это и есть требуемая логика "нет данных в контексте — нет отправки".
create table if not exists public.identity_product_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  identity_id uuid not null references public.identities(id) on delete cascade,
  product_id text not null,
  list_type text not null check (list_type in ('favorite', 'cart')),
  created_at timestamptz not null default now(),
  unique (identity_id, product_id, list_type)
);
create index if not exists idx_product_lists_product on public.identity_product_lists(project_id, product_id, list_type);
create index if not exists idx_product_lists_identity on public.identity_product_lists(identity_id);
alter table public.identity_product_lists enable row level security;

-- Расширяет ingest_event (см. 0061_fix_ingest_event_conflict.sql): помимо
-- существующей логики (лог события + постановка/отмена automation_jobs),
-- теперь ещё поддерживает избранное/корзину как персистентный список per-
-- identity. identity резолвится best-effort через identity_devices — без
-- привязки к identity (анонимный push) список вести не из чего, тихо
-- пропускаем (тот же принцип, что и везде в проекте при отсутствии identity).
-- cart_updated — это СНИМОК текущей корзины (payload.product_ids), поэтому
-- каждый раз полностью замещает список: то, чего нет в новом наборе,
-- удаляется — отдельного события "товар убран из корзины" не нужно.
create or replace function public.ingest_event(
  p_project_id uuid, p_subscriber_id uuid, p_name text, p_payload jsonb
) returns void
language plpgsql
security definer set search_path = public
as $$
declare
  a record;
  v_identity_id uuid;
  v_product_id text;
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

  if p_name in ('favorite_added', 'favorite_removed', 'cart_updated') then
    select identity_id into v_identity_id
    from public.identity_devices
    where subscriber_id = p_subscriber_id
    limit 1;

    if v_identity_id is not null then
      if p_name = 'favorite_added' then
        v_product_id := p_payload->>'product_id';
        if v_product_id is not null then
          insert into public.identity_product_lists (project_id, identity_id, product_id, list_type)
          values (p_project_id, v_identity_id, v_product_id, 'favorite')
          on conflict (identity_id, product_id, list_type) do nothing;
        end if;
      elsif p_name = 'favorite_removed' then
        v_product_id := p_payload->>'product_id';
        if v_product_id is not null then
          delete from public.identity_product_lists
          where identity_id = v_identity_id and product_id = v_product_id and list_type = 'favorite';
        end if;
      elsif p_name = 'cart_updated' then
        delete from public.identity_product_lists
        where identity_id = v_identity_id and list_type = 'cart'
          and product_id not in (select jsonb_array_elements_text(coalesce(p_payload->'product_ids', '[]'::jsonb)));
        insert into public.identity_product_lists (project_id, identity_id, product_id, list_type)
        select p_project_id, v_identity_id, val, 'cart'
        from jsonb_array_elements_text(coalesce(p_payload->'product_ids', '[]'::jsonb)) val
        on conflict (identity_id, product_id, list_type) do nothing;
      end if;
    end if;
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
