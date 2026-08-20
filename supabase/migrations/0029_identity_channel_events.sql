-- История включения/выключения SMS/Email-рассылок по identity (кто и когда
-- дал/отозвал согласие) — аналог push_events, но на уровне контакта, а не
-- устройства: одна identity может стоять за несколькими subscribers.
create table public.identity_channel_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  identity_id uuid references public.identities(id) on delete set null,
  channel text not null check (channel in ('sms', 'email')),
  active boolean not null,
  contact text,
  created_at timestamptz not null default now()
);
create index idx_identity_channel_events_project on public.identity_channel_events(project_id, created_at desc);

alter table public.identity_channel_events enable row level security;
create policy identity_channel_events_select on public.identity_channel_events for select
  using (project_id in (select id from public.projects where owner_id = auth.uid()) or public.is_admin());
