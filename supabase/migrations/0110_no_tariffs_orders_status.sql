-- 1. Тарифы и лимиты сняты: клиенты работают за процент от привлечённых заказов,
--    остаётся только ручная блокировка проекта (projects.is_active).
--    Таблицы тарифов и балансов не удаляем (история), но они больше ничего не
--    ограничивают: отправка проверяет только is_active.
create or replace function public.spend_pushes(p_project_id uuid, p_count integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_active boolean;
begin
  if p_count <= 0 then
    return true;
  end if;
  select is_active into v_active from public.projects where id = p_project_id;
  return coalesce(v_active, false);
end;
$$;

-- возврат за неудачные отправки больше ничего не пополняет
create or replace function public.refund_pushes(p_project_id uuid, p_count integer)
returns void
language plpgsql
security definer set search_path = public
as $$ begin null; end; $$;

-- лимит подписчиков не блокирует проект
drop trigger if exists trg_subscriber_limit_on_subscribers on public.subscribers;
drop trigger if exists trg_subscriber_limit_on_identities on public.identities;
create or replace function public.enforce_subscriber_limit(p_project_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$ begin null; end; $$;

-- Проекты, которые успела заблокировать старая проверка лимита, не трогаем
-- автоматически: блокировка теперь только ручная.

-- 2. Заказы: настоящая дата заказа и статусы из вебхука магазина.
--    created_at — время первого вебхука, а не заказа: при загрузке старых заказов
--    давность (R в RFM), аналитика и карточка контакта считались от дня загрузки.
alter table public.order_attributions
  add column if not exists ordered_at timestamptz,
  add column if not exists financial_status text,
  add column if not exists fulfillment_status text,
  add column if not exists is_cancelled boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_order_attr_project_ordered on public.order_attributions (project_id, ordered_at desc);

-- уже записанные заказы: дата заказа = дата записи, пока вебхук не пришлёт настоящую
update public.order_attributions set ordered_at = created_at where ordered_at is null;

-- 3. SMS: подтверждённая оператором доставка. status='delivered' у получателя
--    означает «принято провайдером» (так у всех каналов); настоящее подтверждение
--    от МТС (статус «доставлено») фиксируем отдельно: delivered_at у получателя и
--    confirmed_count у рассылки.
alter table public.campaign_recipients add column if not exists delivered_at timestamptz;
alter table public.campaigns add column if not exists confirmed_count integer not null default 0;

drop function if exists public.apply_sms_delivery_status(uuid, text, text, boolean);
create or replace function public.apply_sms_delivery_status(
  p_project uuid,
  p_message_id text,
  p_status text,
  p_final_failed boolean,
  p_delivered boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select id, campaign_id, status, delivered_at into r
    from public.campaign_recipients
   where project_id = p_project and provider_message_id = p_message_id
   for update;
  if not found then
    return false;
  end if;

  update public.campaign_recipients
     set provider_status = left(p_status, 40), provider_status_at = now()
   where id = r.id;

  if p_delivered and r.delivered_at is null and r.status = 'delivered' then
    update public.campaign_recipients set delivered_at = now() where id = r.id;
    update public.campaigns set confirmed_count = coalesce(confirmed_count, 0) + 1 where id = r.campaign_id;
  end if;

  if p_final_failed and r.status = 'delivered' then
    update public.campaign_recipients set status = 'failed' where id = r.id;
    update public.campaigns
       set delivered_count = greatest(coalesce(delivered_count, 0) - 1, 0),
           failed_count = coalesce(failed_count, 0) + 1,
           confirmed_count = case when r.delivered_at is not null then greatest(coalesce(confirmed_count, 0) - 1, 0) else confirmed_count end
     where id = r.campaign_id;
  end if;
  return true;
end;
$$;

revoke all on function public.apply_sms_delivery_status(uuid, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.apply_sms_delivery_status(uuid, text, text, boolean, boolean) to service_role;

-- 4. Вебхук клиентов: согласие на SMS живёт в доп. поле клиента магазина.
--    Здесь хранится его handle (имя поля в магазине); пусто — SMS из вебхука не трогаем.
alter table public.projects add column if not exists client_sms_field text;
