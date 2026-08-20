-- Классификация кампании: транзакционная/маркетинговая (влияет на выбор
-- потока у Haskimail — haskimail_transactional_stream vs
-- haskimail_marketing_stream, и в перспективе на необходимость вставки
-- отписки) + кто инициировал отправку. Инициатор специально всего два
-- значения на уровне campaigns — 'manual' (составлено в админке) и 'api'
-- (пришло через /api/v1/send или /api/v1/trigger, включая автоматизации,
-- срабатывающие по вебхуку); событийные/welcome-автоматизации кампанию
-- вообще не создают (см. lib/sender.sendOneOff), поэтому третий и четвёртый
-- инициатор ("Автоматизация", "Авторизация") в разделе «Кампании»
-- вычисляются на чтении из automation_log/otp_requests, не из этой таблицы.
alter table public.campaigns add column if not exists type text not null default 'marketing' check (type in ('transactional','marketing'));
alter table public.campaigns add column if not exists initiator text not null default 'manual' check (initiator in ('manual','api'));
