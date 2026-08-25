-- Убрали отдельный вкл/выкл всей функции приоритета каналов — порядок
-- (welcome_channel_priority) теперь в силе всегда, «включить» относится к
-- каждому приветственному сообщению отдельно (automations.is_enabled), не к
-- функции приоритизации в целом.
alter table public.projects drop column if exists welcome_priority_enabled;
