-- Канал сработки — раньше не хранился отдельной колонкой (только внутри
-- detail jsonb у welcome), из-за чего раздел «Рассылки» показывал ВСЕ
-- автоматизации как push (см. campaigns/page.tsx automationRows), даже
-- sms/email welcome. Событийные автоматизации всегда push.
alter table public.automation_log add column if not exists channel text;
