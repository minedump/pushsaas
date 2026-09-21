-- Разделение прав API-ключа — на каждый ключ можно выдать только нужные
-- разделы вместо полного доступа (см. lib/apikey.ts, app/api/v1/*).
-- Разделы = те же 4 группы, что уже в документации (lib/apiSpec.ts
-- API_GROUPS): campaigns/templates/subscribers/automations.
--
-- Дефолт — все 4 сразу, а не пустой массив: у ключей, созданных до этой
-- миграции, поведение не меняется (был единственный уровень доступа —
-- весь проект), и в форме создания ключа тоже стартуем со всех галочек
-- включённых, отключение — осознанное действие.
alter table public.api_keys
  add column if not exists scopes text[] not null default array['campaigns', 'templates', 'subscribers', 'automations'];
