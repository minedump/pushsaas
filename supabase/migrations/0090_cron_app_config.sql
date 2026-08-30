-- Пять внутренних pg_cron-заданий (0031/0057/0058/0063/0085) дёргают наш же
-- HTTP-эндпоинт с адресом и CRON_SECRET, зашитыми буквально в текст команды.
-- Это ломается при любом другом окружении с той же схемой — self-hosted
-- докер-стенд (см. docker-compose.yml) или локальный тест дёргали бы боевой
-- домен своим же секретом. Заводим таблицу конфигурации, из которой команды
-- читают адрес/секрет каждый тик, и переписываем существующие задания на неё —
-- значения сидируются те же, что были захардкожены, так что для боевой базы
-- это no-op (тот же URL и секрет, просто через косвенную ссылку).
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

insert into public.app_config (key, value) values
  ('base_url', 'https://minedump-pushsaas-9112.twc1.net'),
  ('cron_secret', '275daef82a006a6441610ea4f34124177c2f27c1756927ade1eaf76b0fe82d6a')
on conflict (key) do nothing;

do $$
declare
  j record;
  endpoints jsonb := '{
    "send-scheduled-campaigns": "/api/cron/send-scheduled",
    "run-campaign-jobs": "/api/cron/run-campaign-jobs",
    "run-automations": "/api/cron/run-automations",
    "refresh-product-feeds": "/api/cron/refresh-product-feeds",
    "run-recurring": "/api/cron/run-recurring"
  }'::jsonb;
begin
  for j in select jobid, jobname from cron.job where jobname in (select jsonb_object_keys(endpoints))
  loop
    perform cron.alter_job(
      j.jobid,
      command => format(
        $cmd$select net.http_get(
          url := (select value from public.app_config where key = 'base_url')
            || %L
            || '?key='
            || (select value from public.app_config where key = 'cron_secret')
        );$cmd$,
        endpoints ->> j.jobname
      )
    );
  end loop;
end $$;
