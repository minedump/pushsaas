-- Идентификаторы Метрики и доп. поля заказа.
--
-- 1. У контакта может быть несколько ClientID Метрики (по одному на браузер или устройство),
--    поэтому это список: identities.ym_client_ids. На самом устройстве по-прежнему один id
--    (subscribers.attributes.ym_client_id).
-- 2. Соответствие полей вебхука заказа: [{handle, key}] — поле заказа или клиента в магазине →
--    поле заказа у нас (или системное поле контакта: timezone, ym_client_id).
-- 3. Значения доп. полей, сохранённые в заказе.

alter table public.identities add column if not exists ym_client_ids text[] not null default '{}';
create index if not exists idx_identities_ym_client_ids on public.identities using gin (ym_client_ids);

-- поиск устройства по ClientID (импорт по id Метрики)
create index if not exists idx_subscribers_ym_client_id on public.subscribers ((attributes ->> 'ym_client_id')) where attributes ? 'ym_client_id';

alter table public.projects add column if not exists order_field_map jsonb not null default '[]'::jsonb;
alter table public.order_attributions add column if not exists attributes jsonb not null default '{}'::jsonb;

-- уже известные id устройств переносим на привязанные контакты
update public.identities i
set ym_client_ids = sub.ids
from (
  select d.identity_id, array_agg(distinct s.attributes ->> 'ym_client_id') as ids
  from public.identity_devices d
  join public.subscribers s on s.id = d.subscriber_id
  where s.attributes ? 'ym_client_id' and coalesce(s.attributes ->> 'ym_client_id', '') <> ''
  group by d.identity_id
) sub
where i.id = sub.identity_id;
