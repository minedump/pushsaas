-- Окно отправки + защита от наложения теперь и для обычных рассылок
-- (кампаний), не только для welcome-автоматизаций — те же поля, что на
-- automations (см. 0053/0055), опциональные (по умолчанию выключены,
-- поведение кампаний без изменений).
alter table public.campaigns add column if not exists send_window_enabled boolean not null default false;
alter table public.campaigns add column if not exists send_days smallint[]; -- 0=Вс..6=Сб, null/{} = все дни
alter table public.campaigns add column if not exists send_time_from time;
alter table public.campaigns add column if not exists send_time_to time;
alter table public.campaigns add column if not exists send_window_subscriber_tz boolean not null default false;
alter table public.campaigns add column if not exists spacing_enabled boolean not null default false;
alter table public.campaigns add column if not exists spacing_minutes integer;

-- Пер-получательские задания для кампаний с включённым окном/защитой —
-- аналог automation_jobs, но для кампаний: одна кампания превращается в N
-- заданий (по получателю), у каждого свой fire_at (посчитанный по его
-- часовому поясу, если включено). Драйнится отдельным кроном
-- (run-campaign-jobs), тем же принципом переноса, что и у welcome
-- (lib/sender.ts rescheduleWelcome) — если к моменту fire_at условие снова не
-- выполняется, задание переносится дальше, а не проваливается.
create table public.campaign_jobs (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  channel     text not null check (channel in ('push','sms','email')),
  subscriber_id uuid references public.subscribers(id) on delete cascade, -- push
  contact     text, -- sms/email: телефон/email резолвленного получателя
  status      text not null default 'pending' check (status in ('pending','sent','failed')),
  fire_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_campaign_jobs_due on public.campaign_jobs(status, fire_at) where status = 'pending';
create index idx_campaign_jobs_campaign on public.campaign_jobs(campaign_id);

alter table public.campaign_jobs enable row level security;
create policy campaign_jobs_select on public.campaign_jobs
  for select using (
    exists (select 1 from public.projects p
            where p.id = campaign_jobs.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );
