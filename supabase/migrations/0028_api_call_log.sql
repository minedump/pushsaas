-- Лог вызовов публичного API (/api/v1/send, /api/v1/attribute,
-- /api/v1/contacts) — /api/v1/trigger сюда не входит, он уже логируется в
-- automation_log. Нужно для вкладки «Вебхуки/API» в Журнале — раньше эти
-- вызовы не оставляли никакого следа, кроме побочного эффекта (отправка/
-- атрибуция/контакт), так что понять "а вызвал ли меня вообще мерчант" было
-- нечем.
create table public.api_call_log (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  endpoint   text not null check (endpoint in ('send','attribute','contacts')),
  ok         boolean not null,
  error      text,
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index idx_api_call_log_project on public.api_call_log(project_id, created_at desc);

alter table public.api_call_log enable row level security;
create policy api_call_log_select on public.api_call_log for select using (
  exists (select 1 from public.projects p where p.id = api_call_log.project_id and (p.owner_id = auth.uid() or public.is_admin()))
);
