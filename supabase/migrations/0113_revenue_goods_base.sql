-- База выручки: товары без доставки, со скидками (items_price магазина). Доставку
-- и саму скидку не храним: по позициям хранится цена уже со скидкой.
-- Состав заказа (items) нужен для истории покупок контакта; item_history — изменения
-- позиций при правках заказа (например, цена выросла после снятия скидки).
alter table public.order_attributions add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.order_attributions add column if not exists item_history jsonb not null default '[]'::jsonb;
-- статус заказа в магазине (название статуса, который видит клиент) и история его смен
alter table public.order_attributions add column if not exists custom_status text;
alter table public.order_attributions add column if not exists status_history jsonb not null default '[]'::jsonb;

-- уже записанные заказы: выручка и состав по последнему вебхуку магазина
update public.order_attributions o
   set revenue = x.items_price
  from (
    select distinct on (project_id, request_body ->> 'number')
           project_id,
           request_body ->> 'number' as num,
           (request_body ->> 'items_price')::numeric as items_price
      from public.api_call_log
     where endpoint = 'attribute'
       and request_body ->> 'items_price' ~ '^[0-9]+(\.[0-9]+)?$'
     order by project_id, request_body ->> 'number', id desc
  ) x
 where o.project_id = x.project_id
   and o.order_number = x.num;

update public.order_attributions o
   set items = x.items
  from (
    select distinct on (project_id, request_body ->> 'number')
           project_id,
           request_body ->> 'number' as num,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'line_id', l ->> 'id',
                     'product_id', l ->> 'product_id',
                     'variant_id', l ->> 'variant_id',
                     'sku', l ->> 'sku',
                     'title', l ->> 'title',
                     'quantity', coalesce((l ->> 'quantity')::numeric, 1),
                     'price', coalesce((l ->> 'sale_price')::numeric, 0),
                     'sum', coalesce((l ->> 'total_price')::numeric, 0))
                   order by l ->> 'id'), '[]'::jsonb)
              from jsonb_array_elements(request_body -> 'order_lines') l) as items
      from public.api_call_log
     where endpoint = 'attribute'
       and jsonb_typeof(request_body -> 'order_lines') = 'array'
     order by project_id, request_body ->> 'number', id desc
  ) x
 where o.project_id = x.project_id
   and o.order_number = x.num;

-- название статуса заказа в магазине по последнему вебхуку
update public.order_attributions o
   set custom_status = x.title
  from (
    select distinct on (project_id, request_body ->> 'number')
           project_id,
           request_body ->> 'number' as num,
           nullif(request_body -> 'custom_status' ->> 'title', '') as title
      from public.api_call_log
     where endpoint = 'attribute'
     order by project_id, request_body ->> 'number', id desc
  ) x
 where o.project_id = x.project_id
   and o.order_number = x.num;
