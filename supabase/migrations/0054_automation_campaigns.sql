-- Welcome/событийные автоматизации теперь тоже заводят campaigns-строку на
-- каждую отправку (см. lib/sender.sendOneOff/sendWelcomeNow) — тот же приём,
-- что и у транзакционных вебхук-триггеров (createAndDispatch), чтобы клик
-- трекался и заказ/выручка (order_attributions) атрибуировались так же, как
-- у обычных рассылок. initiator='automation' — новое допустимое значение.
alter table public.campaigns drop constraint if exists campaigns_initiator_check;
alter table public.campaigns add constraint campaigns_initiator_check check (initiator in ('manual', 'api', 'automation'));

-- Ссылка от строки automation_log на реально созданную кампанию (когда
-- отправка дошла до реальной попытки send) — «Рассылки» использует её,
-- чтобы не задваивать: строки с campaign_id уже отражены через campaigns,
-- остаются в automationRows только те, что не дошли до отправки (skipped).
alter table public.automation_log add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;
