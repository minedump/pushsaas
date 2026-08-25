-- identity_field_changes (0041) забыла включить RLS-политику чтения — из-за
-- этого карточка подписчика (RLS-клиент, не admin) видела ноль строк, хотя
-- запись через admin-клиент отрабатывала нормально. Тот же паттерн, что и у
-- identity_channel_events (0029).
alter table public.identity_field_changes enable row level security;
create policy identity_field_changes_select on public.identity_field_changes for select
  using (project_id in (select id from public.projects where owner_id = auth.uid()) or public.is_admin());
