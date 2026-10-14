-- Итог проверки шага подключения (projects.setup_checks) пишется одним
-- атомарным UPDATE. Раньше роут читал весь jsonb и записывал его целиком, и
-- три одновременные проверки (по шагу на каждую) затирали результаты друг
-- друга: каждый запрос стартовал со старой копии.
create or replace function public.set_setup_check(p_project uuid, p_step text, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_step not in ('sw', 'snippet', 'manifest') then
    raise exception 'unknown setup step: %', p_step;
  end if;
  update public.projects
     set setup_checks = jsonb_set(
           coalesce(setup_checks, '{}'::jsonb),
           array[p_step],
           jsonb_build_object(
             'ok', p_ok,
             'checked_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ),
           true
         )
   where id = p_project;
end;
$$;

revoke all on function public.set_setup_check(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_setup_check(uuid, text, boolean) to service_role;
