-- Вкладка «API» в Журнале переходит с куцего curated detail (например
-- {"action":"create","channel":"push"}) на полное сырое тело запроса и
-- ответа — то же самое "посмотреть, что реально пришло/ушло", что уже есть
-- в карточке подписчика для контекста рассылки (RawContextModal). detail
-- оставляем как есть (не трогаем старые строки, просто больше не пишем
-- туда) — не роняем то, что могло на него полагаться.
alter table public.api_call_log add column if not exists request_body jsonb not null default '{}';
alter table public.api_call_log add column if not exists response_body jsonb not null default '{}';
-- HTTP-статус ответа — источник правды для ok (200-299) и краткого "код
-- ошибки" в таблице журнала без открытия попапа с телом.
alter table public.api_call_log add column if not exists status_code smallint;
