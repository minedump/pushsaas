-- Вход по телефону (OIDC): приложение создаётся вместе с проектом, токен приложения виден всегда,
-- каналы каскада по умолчанию выключены, кнопка входа скрывается, когда вход выключен.

-- 1. Токен приложения (client_secret) хранится открыто, чтобы его можно было показывать всегда
--    (рядом с остальными токенами подключений). Хэш для проверки остаётся как был.
--    У приложений, созданных до этой миграции, открытого значения нет: для них токен нужно выпустить заново.
alter table project_secrets add column if not exists oidc_client_secret text;

-- 2. Каналы каскада: раньше при отсутствии настройки считались включёнными, теперь выключены.
--    Чтобы не поменять поведение уже работающего входа, явно записываем текущие значения у включённых
--    приложений, а у выключенных ставим все каналы в «выкл».
update oidc_clients set config = jsonb_set(
  config, '{channels}',
  case when is_enabled
    then jsonb_build_object('push', true, 'email', true, 'telegram', true, 'sms', true) || coalesce(config -> 'channels', '{}'::jsonb)
    else jsonb_build_object('push', false, 'email', false, 'telegram', false, 'sms', false)
  end
)
where client_id is not null;

-- 3. Настройка «скрыть кнопку входа» убрана: кнопка скрывается, когда вход выключен
update oidc_clients set config = config - 'hide_native_login_button' where config ? 'hide_native_login_button';
