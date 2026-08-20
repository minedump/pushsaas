-- =====================================================================
--  0020 — Исправление модели Haskimail: аккаунт использует ОДИН server
--  token, а транзакционный/рассылочный трафик разделяется полем
--  MessageStream (числовой ID канала) в самом запросе на отправку —
--  см. https://haskimail.ru/developer, curl-пример там же.
--
--  0019 предполагала отдельный токен под рассылки (haskimail_broadcast_token)
--  — это было неверно по факту устройства API Haskimail. Колонка никогда не
--  заполнялась (проверено), безопасно удаляется.
-- =====================================================================

alter table public.project_secrets drop column if exists haskimail_broadcast_token;
alter table public.project_secrets add column if not exists haskimail_marketing_stream text;
