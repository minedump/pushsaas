-- "Новые товары" (N новых в фиде) нуждаются в моменте первого появления
-- товара — updated_at для этого не подходит: refreshProductFeed проставляет
-- его ВСЕМ товарам при каждом обновлении фида (весь фид перезаписывается
-- разом), так что почти все строки имеют одинаковый updated_at. Столбец не
-- попадает в upsert из refreshProductFeed (payload строки его не содержит) —
-- поэтому на INSERT используется DEFAULT now(), а на повторном UPDATE
-- (существующий товар) значение не трогается.
alter table public.product_feed_items add column if not exists first_seen_at timestamptz not null default now();
create index if not exists idx_product_feed_first_seen on public.product_feed_items(project_id, first_seen_at desc);
