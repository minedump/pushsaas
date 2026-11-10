-- Состав заказа: цена и сумма по позициям после скидки заказа (full_sale_price, full_total_price),
-- а не до неё. Пересчёт уже записанных заказов по последнему вебхуку магазина.
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
                     'price', coalesce((l ->> 'full_sale_price')::numeric, (l ->> 'sale_price')::numeric, 0),
                     'sum', coalesce((l ->> 'full_total_price')::numeric, (l ->> 'total_price')::numeric, 0))
                   order by l ->> 'id'), '[]'::jsonb)
              from jsonb_array_elements(request_body -> 'order_lines') l) as items
      from public.api_call_log
     where endpoint = 'attribute'
       and jsonb_typeof(request_body -> 'order_lines') = 'array'
     order by project_id, request_body ->> 'number', id desc
  ) x
 where o.project_id = x.project_id
   and o.order_number = x.num;
