-- Журнал действий: при удалении проекта каскадные удаления дочерних строк
-- (шаблоны, участники и т.д.) не должны попадать в журнал отдельными записями.
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity  text := tg_argv[0];
  v_ignore  text[] := string_to_array(coalesce(tg_argv[1], ''), ',');
  ctx       record;
  v_row     jsonb;
  v_project uuid;
  v_id      text;
  v_name    text;
  v_action  text;
  v_changes jsonb;
begin
  -- каскады (удаление проекта, SET NULL при удалении папки) — не действия человека
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if current_setting('app.audit_skip', true) = 'on' then
    return null;
  end if;

  select * into ctx from public.audit_context();
  if ctx.o_actor is null and ctx.o_source = 'system' then
    return null;
  end if;

  v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_project := (case when tg_table_name = 'projects' then v_row ->> 'id' else v_row ->> 'project_id' end)::uuid;
  -- Каскад при удалении проекта: родитель уже удалён, дочерние строки в журнал не пишем
  -- (pg_trigger_depth() для этого ненадёжен). Сам факт удаления проекта пишет триггер на projects.
  if tg_op = 'DELETE' and tg_table_name <> 'projects' and v_project is not null
     and not exists (select 1 from public.projects where id = v_project) then
    return null;
  end if;

  v_id := coalesce(v_row ->> 'id', v_row ->> 'client_id');

  if tg_table_name = 'project_members' then
    v_id := v_row ->> 'user_id';
    select email into v_name from public.profiles where id = (v_row ->> 'user_id')::uuid;
  elsif tg_table_name = 'oidc_clients' then
    v_name := 'Вход через OIDC';
  else
    v_name := coalesce(
      nullif(v_row ->> 'internal_title', ''), nullif(v_row ->> 'name', ''),
      nullif(v_row ->> 'title', ''), nullif(v_row ->> 'type', '')
    );
  end if;

  v_action := case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end;

  if tg_op = 'UPDATE' then
    v_changes := public.audit_diff(to_jsonb(old), to_jsonb(new), v_ignore, tg_table_name);
    if v_changes = '{}'::jsonb then
      -- Отправка кампании человеком: сам статус sending/sent в diff не попадает
      -- (его ставит рассылка), поэтому фиксируем её отдельным событием.
      if tg_table_name = 'campaigns'
         and new.status in ('sending', 'sent')
         and old.status not in ('sending', 'sent', 'failed') then
        v_action := 'send';
        v_changes := jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', new.status));
      else
        return null;
      end if;
    end if;
  end if;

  perform public.audit_write(v_project, v_entity, v_id, v_name, v_action, v_changes, ctx.o_actor, ctx.o_source);
  return null;
end;
$$;
