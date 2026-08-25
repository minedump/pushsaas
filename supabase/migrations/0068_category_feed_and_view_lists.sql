-- Категории фида — параллельно product_feed_items (0059/0062): кеш
-- id->атрибуты, обновляется вместе с товарами в refreshProductFeed (см.
-- lib/productFeed.ts, читает тот же <categories>-блок YML, что раньше только
-- использовался для подписи product.categories именами). Позволяет
-- category_id/category_ids из трекинга резолвиться в полноценный объект
-- ({{ category }}/{{ categories }}) тем же способом, что и товары
-- (resolveCategoryContext — зеркало resolveProductContext).
create table public.product_feed_categories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  external_id text not null,
  name text not null,
  parent_id text,
  updated_at timestamptz not null default now()
);
create unique index uq_product_feed_category on public.product_feed_categories(project_id, external_id);
create index idx_product_feed_categories_project on public.product_feed_categories(project_id);
alter table public.product_feed_categories enable row level security;
create policy product_feed_categories_select on public.product_feed_categories
  for select using (
    exists (select 1 from public.projects p
            where p.id = product_feed_categories.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );

-- «Просмотрено» — третий list_type рядом с favorite/cart (0066): копится на
-- product_viewed/category_viewed (см. ingest_event ниже), пока «Событийная»
-- автоматизация с настройкой «Очищать список после отправки» не заберёт его
-- целиком и не очистит (см. consumeViewedProductIds/consumeViewedCategoryIds
-- в lib/identity.ts, используется в run-automations) — следующий цикл
-- просмотров начинается с нуля, вместо повторной отправки того же набора.
alter table public.identity_product_lists drop constraint if exists identity_product_lists_list_type_check;
alter table public.identity_product_lists add constraint identity_product_lists_list_type_check
  check (list_type in ('favorite', 'cart', 'viewed'));

create table public.identity_category_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  identity_id uuid not null references public.identities(id) on delete cascade,
  category_id text not null,
  list_type text not null check (list_type in ('viewed')),
  created_at timestamptz not null default now(),
  unique (identity_id, category_id, list_type)
);
create index idx_category_lists_identity on public.identity_category_lists(identity_id);
alter table public.identity_category_lists enable row level security;

-- Расширяет ingest_event (0066): product_viewed/category_viewed теперь тоже
-- копят per-identity список (list_type='viewed'), симметрично
-- favorite/cart. category_viewed принимает и одиночный category_id, и массив
-- category_ids — та же гибкость, что у product_id/product_ids в
-- resolveProductContext.
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

  if p_name in ('favorite_added', 'favorite_removed', 'cart_updated', 'product_viewed', 'category_viewed') then
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
