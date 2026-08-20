-- TimeWeb Cloud (текущий деплой) не читает vercel.json — крон-задачи,
-- описанные там (renew/send-scheduled), нигде реально не вызываются.
-- Заводим отправку запланированных рассылок через pg_cron + pg_net —
-- Postgres сам раз в 5 минут дёргает наш собственный эндпоинт.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-scheduled-campaigns',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://minedump-pushsaas-9112.twc1.net/api/cron/send-scheduled?key=275daef82a006a6441610ea4f34124177c2f27c1756927ade1eaf76b0fe82d6a'
  );
  $$
);
