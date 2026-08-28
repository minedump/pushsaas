-- Заблокированный проект (is_active=false — billing или превышение лимита
-- подписчиков, см. 0088) не должен уметь отправлять вообще ничего, даже
-- если на балансе ещё остался несгораемый пакет. До этой миграции
-- spend_pushes проверял только числовой баланс — ни один из крон-путей
-- (run-automations/run-campaign-jobs/run-recurring/send-scheduled) не
-- проверял is_active сам, так что заблокированный проект продолжал тратить
-- пакетный остаток через автоматизации/расписания в обход блокировки.
-- Правим в одном месте (spend_pushes — единственная точка входа отправки),
-- а не в каждом из четырёх крон-роутов по отдельности.
create or replace function public.spend_pushes(p_project_id uuid, p_count integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_tariff int;
  v_pkg    int;
  v_active boolean;
  v_from_tariff int;
  v_from_pkg int;
begin
  if p_count <= 0 then
    return true;
  end if;

  select tariff_pushes_remaining, package_pushes_remaining, is_active
    into v_tariff, v_pkg, v_active
    from public.projects
    where id = p_project_id
    for update;

  if not coalesce(v_active, false) then
    return false;  -- заблокирован — баланс не проверяем и не трогаем
  end if;

  if v_tariff + v_pkg < p_count then
    return false;  -- not enough balance; caller must not send
  end if;

  v_from_tariff := least(v_tariff, p_count);
  v_from_pkg    := p_count - v_from_tariff;

  update public.projects
    set tariff_pushes_remaining  = tariff_pushes_remaining  - v_from_tariff,
        package_pushes_remaining = package_pushes_remaining - v_from_pkg
    where id = p_project_id;

  return true;
end;
$$;
