-- Telegram ID контакта (числовой идентификатор пользователя Telegram): системное поле контакта,
-- как часовой пояс и ClientID Метрики. Нужен для будущей рассылки в Telegram и для сопоставления
-- контакта с данными из других систем. Заполняется импортом файла, вебхуками магазина (по соответствию
-- полей в Настройках), API и вручную в карточке контакта.
alter table public.identities add column if not exists telegram_id text;

create index if not exists identities_project_telegram_id_idx
  on public.identities (project_id, telegram_id)
  where telegram_id is not null;
