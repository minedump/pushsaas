-- Товарные фиды не меняются поминутно — раз в 6 часов достаточно, в отличие
-- от отправочных кронов (send-scheduled/run-automations/run-campaign-jobs),
-- которым нужна частота раз в минуту.
select cron.schedule(
  'refresh-product-feeds',
  '0 */6 * * *',
  $$
  select net.http_get(
    url := 'https://minedump-pushsaas-9112.twc1.net/api/cron/refresh-product-feeds?key=275daef82a006a6441610ea4f34124177c2f27c1756927ade1eaf76b0fe82d6a'
  );
  $$
);
