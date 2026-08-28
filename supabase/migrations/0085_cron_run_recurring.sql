-- Тик «Повторяющихся» автоматизаций (см. app/api/cron/run-recurring) — тот
-- же приём pg_cron + pg_net, что и у остальных app/api/cron/* (0031/0057/
-- 0058/0063). Раз в 5 минут — расписание всё равно в целых минутах,
-- ежеминутная точность (как у run-automations, там нужна ради delay) не нужна.
select cron.schedule(
  'run-recurring',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://minedump-pushsaas-9112.twc1.net/api/cron/run-recurring?key=275daef82a006a6441610ea4f34124177c2f27c1756927ade1eaf76b0fe82d6a'
  );
  $$
);
