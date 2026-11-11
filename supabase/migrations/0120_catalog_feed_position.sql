-- Порядок вариантов в фиде: «первый вариант» товара берётся по нему (подстановка товара в рассылку по id товара).
-- Заполняется при каждом разборе фида; у записей по заказам пусто.
alter table public.product_feed_items add column if not exists feed_position integer;
