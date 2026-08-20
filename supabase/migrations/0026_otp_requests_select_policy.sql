-- otp_requests получил `enable row level security` в 0003_identity_oidc.sql,
-- но ни одной policy к нему так и не добавили — без явного select владелец
-- проекта не видел вообще ни одной строки (RLS по умолчанию блокирует всё,
-- кроме service_role). Нужно для раздела «Кампании» — вход по коду теперь
-- тоже отображается там как транзакционные сообщения. Тот же паттерн, что у
-- push_events_select/campaign_recipients_select — только чтение.
create policy otp_requests_select on public.otp_requests
  for select using (
    exists (select 1 from public.projects p
            where p.id = otp_requests.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );
