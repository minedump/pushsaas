-- =====================================================================
--  0004 — Опознавательный отскок в начале входа
--  Страница входа узнаёт push-устройство браузера ДО отправки кода:
--    · link_tickets.identity_id теперь nullable — «identify»-тикет
--      (без identity) заполняет сессии device_subscriber_id
--    · oidc_auth_sessions.device_subscriber_id — устройство браузера,
--      с которого идёт вход
--  Это позволяет входить ТОЛЬКО через push (без Telegram/SMS):
--    новый телефон + подписанное устройство = код push-ем на него же;
--    существующий телефон = код только на уже привязанные устройства.
-- =====================================================================

alter table public.link_tickets
  alter column identity_id drop not null;

alter table public.oidc_auth_sessions
  add column if not exists device_subscriber_id uuid
    references public.subscribers(id) on delete set null;
