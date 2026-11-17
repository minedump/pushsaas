-- Опрос статусов SMS-рассылок у Bytehand и SMSC (см. app/api/cron/sync-sms-status): раз в две минуты Postgres
-- дёргает наш эндпоинт. Адрес и секрет берутся из app_config, как у остальных кронов (миграция 0090).
select cron.unschedule('sync-sms-status') where exists (select 1 from cron.job where jobname = 'sync-sms-status');
select cron.schedule(
  'sync-sms-status',
  '*/2 * * * *',
  $$
  select net.http_get(
    url := (select value from public.app_config where key = 'base_url')
      || '/api/cron/sync-sms-status'
      || '?key='
      || (select value from public.app_config where key = 'cron_secret'),
    timeout_milliseconds := 55000
  );
  $$
);
