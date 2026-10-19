-- Подписи отправителя (SMS-отправитель, Email-отправитель) хранятся в
-- oidc_clients.config, но «Подключения» работают и без входа по телефону.
-- Запись без client_id и kid — «заготовка»: в ней только подписи, вход по
-- телефону не настроен (см. ensureOidcClient, когда вход включают позже).
alter table public.oidc_clients alter column client_id drop not null;
alter table public.oidc_clients alter column kid drop not null;
