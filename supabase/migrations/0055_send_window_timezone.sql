-- Окно отправки welcome-сообщений (день недели + диапазон времени), с
-- переключателем "по часовому поясу подписчика".
alter table public.automations add column if not exists send_window_enabled boolean not null default false;
alter table public.automations add column if not exists send_days smallint[]; -- 0=Вс..6=Сб (Date.getDay), null/{} = все дни
alter table public.automations add column if not exists send_time_from time;
alter table public.automations add column if not exists send_time_to time;
alter table public.automations add column if not exists send_window_subscriber_tz boolean not null default false;

-- Часовой пояс проекта — базовый (когда окно НЕ по часовому поясу
-- подписчика, или пояс подписчика неизвестен). Дефолт под русскоязычный рынок.
alter table public.projects add column if not exists timezone text not null default 'Europe/Moscow';

-- Часовой пояс подписчика — сохраняется трекинг-кодом (виджетом) через
-- Intl.DateTimeFormat().resolvedOptions().timeZone при подписке; на identity
-- копируется при identify() с уже привязанного устройства (см. lib/identity.ts).
alter table public.subscribers add column if not exists timezone text;
alter table public.identities add column if not exists timezone text;
