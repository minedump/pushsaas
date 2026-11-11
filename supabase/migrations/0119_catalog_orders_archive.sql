-- Единый каталог товаров: фид и заказы кладут товары в одну таблицу product_feed_items.
--
-- · external_id — id варианта (в фиде id оффера, в заказе variant_id), group_id — id товара
--   (в фиде group_id оффера, в заказе product_id).
-- · source: 'feed' — запись пришла из фида, 'order' — заведена по заказу и пока неполная:
--   название, артикул, штрихкод, ID. Как только вариант появляется в фиде, фид перезаписывает
--   всё (название, артикул, цену, категории, картинку) и источник становится 'feed'.
-- · Товар, пропавший из фида, не удаляется: available = false, stock = 0, archived_at = момент
--   пропажи. Вернулся в фид — снова доступен.
-- · stock — остаток, если фид его отдаёт; available — «в наличии» (null: неизвестно, например
--   у записи по заказу).

alter table public.product_feed_items add column if not exists sku text;
alter table public.product_feed_items add column if not exists barcode text;
alter table public.product_feed_items add column if not exists available boolean;
alter table public.product_feed_items add column if not exists stock integer;
alter table public.product_feed_items add column if not exists source text not null default 'feed';
alter table public.product_feed_items add column if not exists archived_at timestamptz;
alter table public.product_feed_items add column if not exists feed_seen_at timestamptz;
alter table public.product_feed_items add column if not exists last_order_at timestamptz;

update public.product_feed_items set feed_seen_at = updated_at where feed_seen_at is null and source = 'feed';

create index if not exists idx_product_feed_sku on public.product_feed_items (project_id, sku) where sku is not null;
create index if not exists idx_product_feed_source on public.product_feed_items (project_id, source);

-- Товары из уже полученных заказов: по одной записи на вариант, название и артикул берём из самого
-- свежего заказа. Записи, которые уже есть (из фида), не трогаем.
insert into public.product_feed_items (project_id, external_id, group_id, name, sku, barcode, source, last_order_at)
select distinct on (o.project_id, x ->> 'variant_id')
  o.project_id,
  x ->> 'variant_id',
  nullif(x ->> 'product_id', ''),
  left(coalesce(nullif(x ->> 'title', ''), 'Товар'), 300),
  nullif(x ->> 'sku', ''),
  nullif(x ->> 'barcode', ''),
  'order',
  coalesce(o.ordered_at, o.created_at)
from public.order_attributions o, jsonb_array_elements(o.items) x
where coalesce(x ->> 'variant_id', '') <> ''
order by o.project_id, x ->> 'variant_id', coalesce(o.ordered_at, o.created_at) desc
on conflict (project_id, external_id) do nothing;
