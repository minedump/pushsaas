-- Откуда пришёл отклонённый вызов вебхука: источник ключа, user-agent, адрес отправителя.
alter table public.webhook_rejects add column if not exists meta text;
