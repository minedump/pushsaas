-- refresh-product-feeds теперь сам умеет останавливаться на полпути и
-- честно отвечать частичным результатом (см. TIME_BUDGET_MS=50s в
-- app/api/cron/refresh-product-feeds/route.ts), но net.http_get по
-- умолчанию ждёт ответ всего timeout_milliseconds=5000 (дефолт pg_net) —
-- Postgres перестаёт слушать задолго до того, как сервер реально закончит
-- прогон. Запрос от этого не ломается (net.http_get асинхронный, сервер
-- продолжает работать и после того, как pg_net прекратил ждать), но
-- реальный результат через net._http_response так не увидеть.
--
-- Поднимаем timeout только у этого одного задания — до 55с, с небольшим
-- запасом над прикладным бюджетом в 50с, но всё ещё под maxDuration=60
-- самого роута. Остальные кроны (рассылки/автоматизации) лёгкие и быстрые,
-- их не трогаем.
do $$
declare
  j record;
begin
  for j in select jobid from cron.job where jobname = 'refresh-product-feeds'
  loop
    perform cron.alter_job(
      j.jobid,
      command => $cmd$select net.http_get(
        url := (select value from public.app_config where key = 'base_url')
          || '/api/cron/refresh-product-feeds'
          || '?key='
          || (select value from public.app_config where key = 'cron_secret'),
        timeout_milliseconds := 55000
      );$cmd$
    );
  end loop;
end $$;
