-- Доступность канала для МАРКЕТИНГОВЫХ рассылок — отдельно от
-- phone_verified_at/email_verified_at (тот флаг доказывает владение
-- номером/почтой для входа по коду, не согласие на рассылки). Телефон/email
-- попадают в identities через вход или через обогащение (вебхук заказа,
-- identify) без всякого согласия на маркетинг — эти колонки остаются null,
-- пока контакт явно не активирован через /api/v1/contacts или импорт CSV.
alter table public.identities add column if not exists sms_marketing_active_at timestamptz;
alter table public.identities add column if not exists email_marketing_active_at timestamptz;
