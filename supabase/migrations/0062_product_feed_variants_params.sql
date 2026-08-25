-- Товарный фид: группировка вариантов (group_id — YML группирует размеры/
-- цвета одного товара), кастомные атрибуты (<param name="…">…</param> +
-- горстка стандартных полей YML), несколько категорий на товар (YML
-- допускает несколько <categoryId> у одного оффера — реальный фид
-- (yuliawave.com) это подтверждает). category (singular) заменяется на
-- categories (массив) — данных, зависящих от старой колонки, нет (кеш,
-- не источник истины).
alter table public.product_feed_items add column if not exists group_id text;
alter table public.product_feed_items add column if not exists old_price numeric;
alter table public.product_feed_items add column if not exists params jsonb not null default '{}';
alter table public.product_feed_items add column if not exists categories text[];
alter table public.product_feed_items drop column if exists category;
create index if not exists idx_product_feed_group on public.product_feed_items(project_id, group_id) where group_id is not null;

-- date из <yml_catalog date="…"> — сверяем перед полным разбором: фид не
-- обновился с прошлого раза, тяжёлую часть (разбор + upsert тысяч офферов)
-- можно пропустить.
alter table public.projects add column if not exists product_feed_source_date text;
