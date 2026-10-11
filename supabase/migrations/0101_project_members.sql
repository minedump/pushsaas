-- Доступ к проекту для нескольких людей. Владелец остаётся в projects.owner_id
-- (на нём биллинг и список клиентов), а Админы проекта лежат здесь. Оба уровня
-- видят и меняют всё в проекте; удалить проект может только владелец (проверка
-- в роуте /api/admin/projects/delete). Роль «admin» здесь — это Админ проекта,
-- не путать с администратором платформы (profiles.role = 'admin', is_admin()).
create table if not exists public.project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'admin' check (role in ('admin')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (project_id, user_id)
);
create index if not exists idx_project_members_user on public.project_members(user_id);

alter table public.project_members enable row level security;

-- Единая проверка «есть ли у текущего пользователя доступ к проекту».
-- security definer, чтобы не упираться в RLS самих projects/project_members.
create or replace function public.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid())
    or exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = auth.uid());
$$;
grant execute on function public.can_access_project(uuid) to authenticated;

-- Участников видят все, у кого есть доступ к проекту. Записи создаются и
-- удаляются только серверными роутами (service role), политик на запись нет.
drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
  for select using (public.can_access_project(project_id));

-- projects
alter policy projects_select on public.projects using (public.can_access_project(id));
alter policy projects_update on public.projects using (public.can_access_project(id));

-- таблицы с прямым project_id
alter policy api_call_log_select on public.api_call_log using (public.can_access_project(project_id));
alter policy api_keys_rw on public.api_keys using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
alter policy jobs_select on public.automation_jobs using (public.can_access_project(project_id));
alter policy autolog_select on public.automation_log using (public.can_access_project(project_id));
alter policy automations_rw on public.automations using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
alter policy campaign_jobs_select on public.campaign_jobs using (public.can_access_project(project_id));
alter policy campaign_recipients_select on public.campaign_recipients using (public.can_access_project(project_id));
alter policy campaigns_rw on public.campaigns using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
alter policy events_select on public.events using (public.can_access_project(project_id));
alter policy identities_rw on public.identities using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
alter policy identity_channel_events_select on public.identity_channel_events using (public.can_access_project(project_id));
alter policy identity_field_changes_select on public.identity_field_changes using (public.can_access_project(project_id));
alter policy media_assets_rw on public.media_assets using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
alter policy media_folders_rw on public.media_folders using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
alter policy oidc_clients_select on public.oidc_clients using (public.can_access_project(project_id));
alter policy order_attributions_select on public.order_attributions using (public.can_access_project(project_id));
alter policy otp_requests_select on public.otp_requests using (public.can_access_project(project_id));
alter policy product_feed_categories_select on public.product_feed_categories using (public.can_access_project(project_id));
alter policy product_feed_collections_select on public.product_feed_collections using (public.can_access_project(project_id));
alter policy product_feed_items_select on public.product_feed_items using (public.can_access_project(project_id));
alter policy push_events_select on public.push_events using (public.can_access_project(project_id));
alter policy subscribers_rw on public.subscribers using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
alter policy template_folders_rw on public.template_folders using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
alter policy email_templates_rw on public.templates using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
alter policy transactions_select on public.transactions using (public.can_access_project(project_id));

-- связка через identities
alter policy identity_devices_select on public.identity_devices using (
  exists (select 1 from public.identities i where i.id = identity_devices.identity_id and public.can_access_project(i.project_id))
);

-- отписка от тарифа: те же права, что у остального проекта (владелец или Админ)
create or replace function public.unsubscribe_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sys uuid;
begin
  if not public.can_access_project(p_project_id) then
    raise exception 'Недостаточно прав';
  end if;

  select id into v_sys from public.tariffs where is_system order by sort limit 1;

  update public.projects
    set package_pushes_remaining = package_pushes_remaining + tariff_pushes_remaining,
        tariff_pushes_remaining = 0,
        tariff_id = v_sys,
        current_period_end = null,
        is_active = true,
        renewal_attempts = 0
    where id = p_project_id;

  update public.project_secrets set cp_card_token = null where project_id = p_project_id;
end;
$$;
