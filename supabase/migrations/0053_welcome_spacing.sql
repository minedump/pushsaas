-- Защита от наложения ("smart sending") — не слать welcome-сообщение, если
-- контакту на этот канал уже что-то уходило (кампания, событийная
-- автоматизация, другая welcome-цепочка) внутри окна. Проверяется по ЛЮБОМУ
-- источнику (welcome-vs-всё), не только по другим welcome-сообщениям.
alter table public.automations add column if not exists spacing_enabled boolean not null default false;
alter table public.automations add column if not exists spacing_minutes integer;

-- Контакт в том же формате, что и campaign_recipients.contact (subscriber_id
-- для push, телефон/email для sms/email) — единый ключ для сверки окна
-- наложения между обеими таблицами.
alter table public.automation_log add column if not exists contact text;
create index if not exists idx_automation_log_contact on public.automation_log(project_id, channel, contact, created_at desc);
create index if not exists idx_campaign_recipients_contact on public.campaign_recipients(project_id, channel, contact, created_at desc);
