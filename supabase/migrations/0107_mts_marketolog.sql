-- МТС Маркетолог (REST API по токену): SMS-провайдер рядом с Bytehand и SMSC.
--
-- project_secrets.mts_token       — токен подключения API (кабинет МТС → Интеграции → API).
-- project_secrets.mts_callback_key — секрет в адресе, на который МТС присылает статусы
--                                    доставки (у запросов МТС нет подписи, поэтому ключ
--                                    в адресе — единственная защита, как у вебхука заказов).
-- campaign_recipients.provider_message_id — id сообщения у провайдера: по нему статус
--                                    доставки от МТС находит получателя рассылки.
-- campaign_recipients.provider_status / provider_status_at — последний статус от
--                                    провайдера (Delivered, NotDelivered и т.п.).
alter table public.project_secrets add column if not exists mts_token text;
alter table public.project_secrets add column if not exists mts_callback_key text;
create unique index if not exists idx_project_secrets_mts_callback_key
  on public.project_secrets (mts_callback_key) where mts_callback_key is not null;

alter table public.campaign_recipients add column if not exists provider_message_id text;
alter table public.campaign_recipients add column if not exists provider_status text;
alter table public.campaign_recipients add column if not exists provider_status_at timestamptz;
create index if not exists idx_campaign_recipients_provider_msg
  on public.campaign_recipients (project_id, provider_message_id) where provider_message_id is not null;

-- Применяет статус доставки от провайдера к получателю рассылки. Один атомарный
-- вызов: получатель блокируется, счётчики кампании меняются в той же транзакции.
-- Сейчас «доставлено» у SMS-рассылки означает «принято провайдером», поэтому
-- окончательный провал (NotSent/NotDelivered) переводит получателя в failed и
-- пересчитывает счётчики: один раз, повторный статус ничего не меняет.
-- Возвращает true, если получатель с таким id найден.
create or replace function public.apply_sms_delivery_status(
  p_project uuid,
  p_message_id text,
  p_status text,
  p_final_failed boolean
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select id, campaign_id, status into r
    from public.campaign_recipients
   where project_id = p_project and provider_message_id = p_message_id
   for update;
  if not found then
    return false;
  end if;

  update public.campaign_recipients
     set provider_status = left(p_status, 40), provider_status_at = now()
   where id = r.id;

  if p_final_failed and r.status = 'delivered' then
    update public.campaign_recipients set status = 'failed' where id = r.id;
    update public.campaigns
       set delivered_count = greatest(coalesce(delivered_count, 0) - 1, 0),
           failed_count = coalesce(failed_count, 0) + 1
     where id = r.campaign_id;
  end if;
  return true;
end;
$$;

revoke all on function public.apply_sms_delivery_status(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.apply_sms_delivery_status(uuid, text, text, boolean) to service_role;
