-- Приветственная цепочка (все welcome-автоматизации канала) должна
-- запускаться максимум ОДИН раз на контакт+канал, а не при каждом
-- повторном включении согласия (выкл→вкл→выкл→вкл). Push это уже
-- гарантирует естественно (welcome триггерится в момент создания НОВОГО
-- устройства, повторная подписка того же endpoint обновляет existing-строку
-- и не считается новой) — маркер нужен только SMS/Email, где триггер живёт
-- на identities, а согласие можно включать/выключать многократно.
alter table public.identities add column if not exists sms_welcomed_at timestamptz;
alter table public.identities add column if not exists email_welcomed_at timestamptz;
