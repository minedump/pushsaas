-- Позволяет пометить содержимое автоматизации как транзакционное (сервисное
-- уведомление — например, трек-номер заказа), тем же смыслом, что и
-- campaigns.type='transactional': не требует {{ unsubscribe_url }} в письме
-- и не проверяет согласие получателя на маркетинг по каналу (identities.
-- sms_marketing_active_at/email_marketing_active_at, subscribers.paused).
-- Отдельная колонка, а не значение внутри jsonb config — применимо ко всем
-- трём типам автоматизации (welcome/event/custom), и не пересекается по
-- смыслу с уже занятым config.transactional (это флаг режима получателя
-- "по телефону", а не про транзакционность содержимого).
alter table public.automations add column if not exists is_transactional boolean not null default false;
