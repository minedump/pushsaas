-- Каскадные приветственные карточки (channel_templates на несколько каналов)
-- могли отправляться повторно: сработавшая задача automation_jobs почти
-- сразу помечается status='sent' (см. run-automations claim), а частичные
-- уникальные индексы uq_pending_job_identity/uq_pending_job_subscriber
-- (0043) защищают только "одна pending-задача за раз" — как только первая
-- обработалась, ничто не мешало fireWelcomeAutomations при активации ДРУГОГО
-- канала снова найти ту же каскадную карточку кандидатом и завести вторую
-- задачу тому же контакту (двойная отправка при последовательной активации
-- каналов, а не только при одновременной).
--
-- Постоянный дедуп "эта карточка уже сработала этому контакту" — навсегда,
-- вне зависимости от статуса задачи и от того, какой канал триггерит.
-- Только для welcome (recurring намеренно шлётся повторно по расписанию,
-- event — по каждому новому событию; их это не касается).
create table if not exists public.automation_welcome_fired (
  automation_id uuid not null references public.automations(id) on delete cascade,
  identity_id uuid not null references public.identities(id) on delete cascade,
  fired_at timestamptz not null default now(),
  primary key (automation_id, identity_id)
);

alter table public.automation_welcome_fired enable row level security;
