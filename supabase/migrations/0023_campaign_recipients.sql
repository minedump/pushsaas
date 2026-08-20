-- Пер-контактный статус отправки — раньше campaigns хранил только агрегаты
-- (delivered_count/failed_count), нельзя было посмотреть, кому конкретно
-- ушло/не ушло. contact — телефон/email для sms/email, id подписчика (см.
-- subscribers) для push — устройство не имеет отдельного контакта.
create table public.campaign_recipients (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  channel     text not null check (channel in ('push','sms','email')),
  contact     text not null,
  status      text not null check (status in ('delivered','failed')),
  created_at  timestamptz not null default now()
);
create index idx_campaign_recipients_campaign on public.campaign_recipients(campaign_id);

-- писать может только service_role (сам сендер) — как push_events, для
-- пользователя только select через RLS.
alter table public.campaign_recipients enable row level security;
create policy campaign_recipients_select on public.campaign_recipients
  for select using (
    exists (select 1 from public.projects p
            where p.id = campaign_recipients.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );
