-- Четвёртый тип автоматизации — «Повторяющиеся»: рассылка одного шаблона
-- сегменту по календарному расписанию (еженедельно/ежемесячно от даты/
-- N-я неделя месяца), а не по активности контакта или вебхуку. Настройки
-- канала/каскада/сегмента/окна отправки/защиты от наложения — те же
-- колонки, что уже использует welcome/event; расписание — в config (тот же
-- принцип, что у event.trigger_event и custom-спеки, см. 0007/0065).

alter table public.automations drop constraint automations_type_check;
alter table public.automations add constraint automations_type_check
  check (type in ('welcome', 'abandoned_cart', 'custom', 'event', 'recurring'));

-- Следующее время срабатывания — считается при создании/правке и после
-- каждого тика (см. app/api/cron/run-recurring), чтобы cron мог одним
-- индексированным запросом найти все автоматизации, которым пора сработать,
-- не пересчитывая расписание каждой строки на каждый тик.
alter table public.automations add column if not exists next_fire_at timestamptz;
alter table public.automations add column if not exists last_fired_at timestamptz;
create index if not exists idx_automations_next_fire on public.automations(next_fire_at) where type = 'recurring' and is_enabled;

alter table public.automation_log drop constraint automation_log_source_check;
alter table public.automation_log add constraint automation_log_source_check
  check (source in ('event', 'api', 'webhook', 'welcome', 'recurring'));
