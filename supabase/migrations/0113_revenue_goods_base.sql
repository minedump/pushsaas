-- База выручки: товары без доставки, со скидками (items_price магазина). Так считаются
-- выручка рассылок, аналитика, карточка контакта и процент за привлечённые заказы.
-- Сумма заказа с доставкой остаётся справочно в total_price.
alter table public.order_attributions add column if not exists total_price numeric(12,2);

-- до этой миграции revenue хранил сумму с доставкой
update public.order_attributions set total_price = revenue where total_price is null;

-- пересчёт уже записанных заказов по последнему вебхуку магазина (items_price)
update public.order_attributions o
   set revenue = x.items
  from (
    select distinct on (project_id, request_body ->> 'number')
           project_id,
           request_body ->> 'number' as num,
           (request_body ->> 'items_price')::numeric as items
      from public.api_call_log
     where endpoint = 'attribute'
       and request_body ->> 'items_price' ~ '^[0-9]+(\.[0-9]+)?$'
     order by project_id, request_body ->> 'number', id desc
  ) x
 where o.project_id = x.project_id
   and o.order_number = x.num
   and o.revenue = o.total_price;
