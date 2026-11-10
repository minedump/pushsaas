-- Вебхук клиентов: соответствие доп. полей клиента магазина полям контакта.
-- Список вида [{"handle": "birthday", "key": "birthday"}]: handle — имя поля в
-- магазине (или его id), key — доп. поле контакта у нас (существующее или новое,
-- создаётся при первой записи значения).
alter table public.projects add column if not exists client_field_map jsonb not null default '[]'::jsonb;

-- Откуда пришла смена согласия (webhook — вебхук магазина); у правок из интерфейса пусто.
alter table public.identity_channel_events add column if not exists source text;
