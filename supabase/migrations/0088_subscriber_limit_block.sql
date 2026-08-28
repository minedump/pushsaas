-- Лимит подписчиков по тарифу (tariffs.subscriber_limit) — до этой миграции
-- поле только показывалось в UI ("до N подписчиков"), никак не проверялось.
-- Работает для ЛЮБОГО тарифа с непустым subscriber_limit (не только «Старт»).
-- Отдельная, самостоятельная причина блокировки, не связанная с балансом
-- пушей — исчерпание пушей НЕ блокирует проект (см. 0002_billing.sql/
-- spend_pushes), а превышение лимита подписчиков блокирует. Просто
-- is_active=false, баланс тарифа не трогаем (это не billing-неудача).

-- Тот же принцип подсчёта "один подписчик — одна строка", что и на странице
-- Подписчики (app/admin/projects/[id]/subscribers/page.tsx): контакт с
-- устройством считается один раз независимо от числа устройств, анонимные
-- устройства без привязанного контакта считаются отдельно, контакты совсем
-- без устройств (ручное добавление / CSV-импорт) — тоже отдельно.
create or replace function public.count_project_subscribers(p_project_id uuid)
returns integer
language sql
stable
as $$
  select
    (select count(distinct idv.identity_id)
       from public.identity_devices idv
       join public.subscribers s on s.id = idv.subscriber_id
      where s.project_id = p_project_id)
    +
    (select count(*)
       from public.subscribers s
      where s.project_id = p_project_id
        and not exists (select 1 from public.identity_devices idv2 where idv2.subscriber_id = s.id))
    +
    (select count(*)
       from public.identities i
      where i.project_id = p_project_id
        and not exists (select 1 from public.identity_devices idv3 where idv3.identity_id = i.id));
$$;

-- Блокирует проект, если у его текущего тарифа задан subscriber_limit и
-- фактическое число подписчиков его превысило. Тариф без лимита
-- (subscriber_limit is null) ничего не проверяет. Не разблокирует обратно
-- сам — как и остальные причины блокировки (билинг), выход требует явного
-- действия (смена тарифа/оплата), а не автоматического отката при удалении
-- части подписчиков.
create or replace function public.enforce_subscriber_limit(p_project_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_limit int;
  v_count int;
begin
  select t.subscriber_limit into v_limit
    from public.projects p
    join public.tariffs t on t.id = p.tariff_id
    where p.id = p_project_id;

  if v_limit is null then
    return;
  end if;

  v_count := public.count_project_subscribers(p_project_id);

  if v_count > v_limit then
    update public.projects set is_active = false where id = p_project_id and is_active = true;
  end if;
end;
$$;

create or replace function public.trg_enforce_subscriber_limit_subscribers()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.enforce_subscriber_limit(new.project_id);
  return new;
end;
$$;

create or replace function public.trg_enforce_subscriber_limit_identities()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.enforce_subscriber_limit(new.project_id);
  return new;
end;
$$;

drop trigger if exists trg_subscriber_limit_on_subscribers on public.subscribers;
create trigger trg_subscriber_limit_on_subscribers
  after insert on public.subscribers
  for each row execute function public.trg_enforce_subscriber_limit_subscribers();

drop trigger if exists trg_subscriber_limit_on_identities on public.identities;
create trigger trg_subscriber_limit_on_identities
  after insert on public.identities
  for each row execute function public.trg_enforce_subscriber_limit_identities();

grant execute on function public.count_project_subscribers(uuid) to service_role, authenticated;
grant execute on function public.enforce_subscriber_limit(uuid) to service_role;
