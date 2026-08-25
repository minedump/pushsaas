-- Драйн пер-получательских заданий кампаний с окном отправки/защитой от
-- наложения (см. migration 0056, lib/sender.ts enqueueWindowedCampaign) —
-- тот же приём, что и send-scheduled-campaigns (0031): pg_cron + pg_net,
-- Postgres сам раз в минуту дёргает наш собственный эндпоинт.
select cron.schedule(
  'run-campaign-jobs',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://minedump-pushsaas-9112.twc1.net/api/cron/run-campaign-jobs?key=275daef82a006a6441610ea4f34124177c2f27c1756927ade1eaf76b0fe82d6a'
  );
  $$
);
