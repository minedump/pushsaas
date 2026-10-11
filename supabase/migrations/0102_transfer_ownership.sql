-- Передача проекта новому владельцу. owner_id заморожен триггером (любой
-- UPDATE возвращает старое значение), поэтому смена владельца идёт только
-- через эту функцию: она включает разрешающий флаг на время одной транзакции,
-- меняет владельца и делает прежнего владельца Админом проекта.
create or replace function public.freeze_owner_id()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.owner_transfer', true) = 'on' then
    return new;
  end if;
  new.owner_id := old.owner_id;
  return new;
end;
$$;

create or replace function public.transfer_project_ownership(p_project_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
begin
  select owner_id into v_old from public.projects where id = p_project_id for update;
  if v_old is null then
    raise exception 'Проект не найден';
  end if;
  if v_old is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Передать проект может только владелец';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_new_owner
  ) then
    raise exception 'Новым владельцем может стать только Админ проекта';
  end if;

  perform set_config('app.owner_transfer', 'on', true);
  update public.projects set owner_id = p_new_owner where id = p_project_id;
  perform set_config('app.owner_transfer', 'off', true);

  delete from public.project_members where project_id = p_project_id and user_id = p_new_owner;
  insert into public.project_members (project_id, user_id, role, invited_by)
  values (p_project_id, v_old, 'admin', p_new_owner)
  on conflict (project_id, user_id) do nothing;
end;
$$;

revoke all on function public.transfer_project_ownership(uuid, uuid) from public;
grant execute on function public.transfer_project_ownership(uuid, uuid) to authenticated;
