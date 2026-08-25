-- Драйн automation_jobs (отложенные welcome-сообщения + событийные
-- автоматизации, брошенная корзина и т.п.) — тот же приём pg_cron + pg_net,
-- что и у send-scheduled-campaigns (0031) и run-campaign-jobs (0057). Раньше
-- этот эндпоинт рассчитывал на внешний cron-job.org (см. комментарий в
-- app/api/cron/run-automations/route.ts) — настроен не был, отложенные
-- отправки не уходили.
select cron.schedule(
  'run-automations',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://minedump-pushsaas-9112.twc1.net/api/cron/run-automations?key=275daef82a006a6441610ea4f34124177c2f27c1756927ade1eaf76b0fe82d6a'
  );
  $$
);
