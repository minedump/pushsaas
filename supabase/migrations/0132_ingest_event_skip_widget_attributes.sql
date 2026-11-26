-- Атрибуты устройства копят поля из payload каждого события сайта (для подстановок в рассылках).
-- События виджетов (widget_notify_*, widget_install_*) туда тоже писали свои служебные поля:
-- via, view, auto, ms, result, mode, platform — их нужно не записывать и вычистить.
-- Функция та же, что в 0070, изменено только условие слияния payload с атрибутами.

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
  v_category_id text;
  v_list_name text;
begin
  insert into public.events (project_id, subscriber_id, name, payload)
  values (p_project_id, p_subscriber_id, p_name, coalesce(p_payload, '{}'::jsonb));

  if p_subscriber_id is null then
    return;
  end if;

  -- Служебные события виджетов (widget_*) — аналитика показа окон и кнопок, а не данные посетителя:
  -- их поля (via, view, ms, result, platform…) в атрибуты устройства не пишем, иначе они попадают
  -- в подстановки текстов рассылок.
  if p_payload is not null and p_payload <> '{}'::jsonb and p_name not like 'widget\_%' then
    update public.subscribers
      set attributes = attributes || p_payload
      where id = p_subscriber_id;
  end if;

  -- identity нужен и для списков ниже, и для авто-очистки по «отменяющему»
  -- событию дальше по функции — резолвим один раз здесь, а не только для
  -- заранее известного набора имён (заранее неизвестно, не оно ли окажется
  -- cancel_events у какой-нибудь автоматизации).
  select identity_id into v_identity_id
  from public.identity_devices
  where subscriber_id = p_subscriber_id
  limit 1;

  if v_identity_id is not null then
    if p_name = 'cart_updated' then
      delete from public.identity_product_lists
      where identity_id = v_identity_id and list_type = 'cart'
        and product_id not in (select jsonb_array_elements_text(coalesce(p_payload->'product_ids', '[]'::jsonb)));
      insert into public.identity_product_lists (project_id, identity_id, product_id, list_type)
      select p_project_id, v_identity_id, val, 'cart'
      from jsonb_array_elements_text(coalesce(p_payload->'product_ids', '[]'::jsonb)) val
      on conflict (identity_id, product_id, list_type) do nothing;

    elsif p_name = 'favorite_updated' then
      delete from public.identity_product_lists
      where identity_id = v_identity_id and list_type = 'favorite'
        and product_id not in (select jsonb_array_elements_text(coalesce(p_payload->'product_ids', '[]'::jsonb)));
      insert into public.identity_product_lists (project_id, identity_id, product_id, list_type)
      select p_project_id, v_identity_id, val, 'favorite'
      from jsonb_array_elements_text(coalesce(p_payload->'product_ids', '[]'::jsonb)) val
      on conflict (identity_id, product_id, list_type) do nothing;

    elsif p_name = 'product_viewed' then
      v_product_id := p_payload->>'product_id';
      if v_product_id is not null then
        insert into public.identity_product_lists (project_id, identity_id, product_id, list_type)
        values (p_project_id, v_identity_id, v_product_id, 'viewed')
        on conflict (identity_id, product_id, list_type) do nothing;
      end if;

    elsif p_name = 'category_viewed' then
      v_category_id := p_payload->>'category_id';
      if v_category_id is not null then
        insert into public.identity_category_lists (project_id, identity_id, category_id, list_type)
        values (p_project_id, v_identity_id, v_category_id, 'viewed')
        on conflict (identity_id, category_id, list_type) do nothing;
      end if;
      if p_payload ? 'category_ids' then
        insert into public.identity_category_lists (project_id, identity_id, category_id, list_type)
        select p_project_id, v_identity_id, val, 'viewed'
        from jsonb_array_elements_text(coalesce(p_payload->'category_ids', '[]'::jsonb)) val
        on conflict (identity_id, category_id, list_type) do nothing;
      end if;

    elsif right(p_name, 6) = '_added' and length(p_name) > 6 then
      v_list_name := left(p_name, length(p_name) - 6);
      v_product_id := p_payload->>'product_id';
      if v_product_id is not null and v_list_name not in ('cart', 'favorite', 'viewed') then
        insert into public.identity_product_lists (project_id, identity_id, product_id, list_type)
        values (p_project_id, v_identity_id, v_product_id, v_list_name)
        on conflict (identity_id, product_id, list_type) do nothing;
      end if;

    elsif right(p_name, 8) = '_removed' and length(p_name) > 8 then
      v_list_name := left(p_name, length(p_name) - 8);
      v_product_id := p_payload->>'product_id';
      if v_product_id is not null and v_list_name not in ('cart', 'favorite', 'viewed') then
        delete from public.identity_product_lists
        where identity_id = v_identity_id and product_id = v_product_id and list_type = v_list_name;
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

      if v_identity_id is not null then
        if a.config->>'trigger_event' = 'cart_updated' then
          delete from public.identity_product_lists where identity_id = v_identity_id and list_type = 'cart';
        elsif a.config->>'trigger_event' = 'favorite_updated' then
          delete from public.identity_product_lists where identity_id = v_identity_id and list_type = 'favorite';
        end if;
      end if;
    end if;
  end loop;
end;
$$;

-- Уже накопившееся: эти ключи в атрибуты писали только события виджетов.
update public.subscribers
set attributes = attributes - array['via', 'view', 'auto', 'ms', 'result', 'mode', 'platform']
where attributes ?| array['via', 'view', 'auto', 'ms', 'result', 'mode', 'platform'];
