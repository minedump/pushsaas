-- Последние флажки подписки клиента магазина (subscribe — email, поле SMS) по контакту:
-- {"email": true, "sms": false}. Нужны, чтобы отличить настоящую отписку (флажок был
-- включён и стал выключенным) от нового гостевого клиента магазина, у которого галочки
-- просто не отмечены: второе согласие контакта не снимает.
alter table public.identities add column if not exists insales_flags jsonb not null default '{}'::jsonb;
