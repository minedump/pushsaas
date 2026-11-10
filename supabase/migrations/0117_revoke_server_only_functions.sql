-- Серверные функции не должны вызываться из браузера.
-- По умолчанию Supabase отдаёт право EXECUTE на функции схемы public ролям anon и authenticated,
-- а значит любой, у кого есть публичный ключ anon, мог вызвать их через /rest/v1/rpc/<имя>.
-- Часть из них SECURITY DEFINER и не проверяет, кто вызывает: например, block_project(uuid)
-- отключала любой проект по его id. Все эти функции приложение вызывает только от имени
-- service_role (createAdminClient), поэтому у anon, authenticated и public право забираем.
--
-- Остаются доступными функции, на которые опираются политики RLS и интерфейс:
-- can_access_project, is_admin, transfer_project_ownership (проверяет вызывающего сама).
do $$
declare
  fn text;
  sig regprocedure;
begin
  foreach fn in array array[
    -- остатки тарифов и оплаты (тарифы удалены в 0110, приложение их не вызывает)
    'public.block_project(uuid)',
    'public.renew_fail(uuid)',
    'public.renew_success(uuid, integer, timestamptz, numeric)',
    'public.unsubscribe_project(uuid)',
    'public._apply_tariff(uuid, uuid, integer, boolean)',
    'public.apply_paid_tariff(uuid, uuid, integer, timestamptz, numeric, text, text)',
    'public.admin_activate_tariff(uuid, uuid, integer)',
    'public.admin_grant_bonus(uuid, integer, text)',
    'public.credit_package(uuid, integer, numeric, text)',
    'public.spend_pushes(uuid, integer)',
    'public.refund_pushes(uuid, integer)',
    'public.enforce_subscriber_limit(uuid)',
    -- функции, которые вызывают серверные маршруты
    'public.apply_sms_delivery_status(uuid, text, text, boolean, boolean)',
    'public.increment_campaign_opened(uuid)',
    'public.increment_campaign_unsubscribed(uuid)',
    'public.ingest_event(uuid, uuid, text, jsonb)',
    'public.set_setup_check(uuid, text, boolean)',
    'public.audit_event(uuid, text, text, text, text, jsonb)',
    'public.start_oidc_session(uuid, text, text, text, integer, integer)'
  ]
  loop
    sig := to_regprocedure(fn);
    if sig is null then
      raise notice 'функции % нет, пропускаем', fn;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end $$;
