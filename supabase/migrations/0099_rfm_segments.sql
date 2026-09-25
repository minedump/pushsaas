-- RFM-теги на identities.tags (rfm:champions / rfm:loyal / rfm:at_risk /
-- rfm:new / rfm:sleeping / rfm:regular), см. app/api/cron/recompute-rfm.
-- rfm_computed_at — то же честное планирование, что и product_feed_updated_at
-- у refresh-product-feeds (см. миграцию 0059 и app/api/cron/refresh-product-feeds):
-- кто давнее пересчитан, тот первый в очереди на следующем тике.
alter table public.projects add column if not exists rfm_computed_at timestamptz;

select cron.schedule(
  'recompute-rfm-segments',
  '0 */6 * * *',
  $$
  select net.http_get(
    url := (select value from public.app_config where key = 'base_url')
      || '/api/cron/recompute-rfm'
      || '?key='
      || (select value from public.app_config where key = 'cron_secret'),
    timeout_milliseconds := 55000
  );
  $$
);
