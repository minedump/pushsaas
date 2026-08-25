-- Обновление товарного фида — было раз в 6 часов, нужно раз в 15 минут (сам
-- refreshProductFeed внутри пропускает тяжёлый разбор, если <yml_catalog
-- date="…"> не изменился — частый опрос не значит частый полный пересчёт).
select cron.unschedule('refresh-product-feeds');
select cron.schedule(
  'refresh-product-feeds',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://minedump-pushsaas-9112.twc1.net/api/cron/refresh-product-feeds?key=275daef82a006a6441610ea4f34124177c2f27c1756927ade1eaf76b0fe82d6a'
  );
  $$
);
