-- Атрибуты мерчанта о КОНТАКТЕ (например, loyalty_tier из CRM) — отдельно от
-- subscribers.attributes, который остаётся поведенческими/событийными
-- данными КОНКРЕТНОГО устройства (корзина, последний просмотр) и работает
-- даже для анонимных подписчиков без identity вообще (см. /api/public/event,
-- lib/sender.ts dispatchCampaign — оба ключуются строго по subscriber_id,
-- без identity). CSV-импорт/экспорт клиентов (см. /api/admin/subscribers/
-- export|import) теперь пишет произвольные колонки сюда, а не на устройство.
alter table public.identities add column if not exists attributes jsonb not null default '{}'::jsonb;
