-- Приветственные автоматизации становятся многоканальными и на основе
-- шаблонов (раздел «Шаблоны»), и их можно заводить несколько штук —
-- по одной на каждую комбинацию канал+задержка+шаблон.
alter table public.automations add column if not exists channel text not null default 'push' check (channel in ('push','sms','email'));
alter table public.automations add column if not exists template_id uuid references public.templates(id) on delete set null;

-- automation_jobs раньше был только push-очередью (subscriber_id обязателен).
-- SMS/Email welcome триггерится на уровне КОНТАКТА (identities), не
-- устройства — добавляем identity_id, снимаем not null с subscriber_id,
-- требуем хотя бы одну из двух целей.
alter table public.automation_jobs add column if not exists identity_id uuid references public.identities(id) on delete cascade;
alter table public.automation_jobs alter column subscriber_id drop not null;
alter table public.automation_jobs add constraint automation_jobs_target_check
  check (subscriber_id is not null or identity_id is not null);

-- Дедуп «одна pending-задача на автоматизацию+получателя» — раньше был один
-- индекс по subscriber_id (not null всегда); теперь два частичных индекса,
-- по одному на каждый тип цели.
drop index if exists uq_pending_job;
create unique index uq_pending_job_subscriber on public.automation_jobs(automation_id, subscriber_id)
  where status = 'pending' and subscriber_id is not null;
create unique index uq_pending_job_identity on public.automation_jobs(automation_id, identity_id)
  where status = 'pending' and identity_id is not null;
