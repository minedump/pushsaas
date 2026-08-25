-- Приветственные сообщения: per-канал вкл/выкл (быстро отключить все
-- welcome конкретного канала, не трогая каждое сообщение по отдельности) и
-- выбор провайдера для sms/email — тот же принцип, что «Каскад отправки
-- кода» в Авторизации, но независимо от него (там про вход по коду, здесь —
-- про рассылку).
alter table public.projects add column if not exists welcome_channel_enabled jsonb not null default '{"push":true,"sms":true,"email":true}';
alter table public.projects add column if not exists welcome_channel_provider jsonb not null default '{}';
