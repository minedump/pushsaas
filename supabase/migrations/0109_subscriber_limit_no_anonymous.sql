-- Лимит подписчиков тарифа не считает анонимные записи: устройство без
-- push-подписки (endpoint пустой) и без привязанного контакта заводится
-- виджетами и событиями на сайте (см. /api/public/register-device) и
-- подписчиком не является. Контакт, у которого есть такое устройство, как и
-- раньше считается один раз, контакты без устройств — тоже (миграция 0088).
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
        and s.endpoint is not null
        and not exists (select 1 from public.identity_devices idv2 where idv2.subscriber_id = s.id))
    +
    (select count(*)
       from public.identities i
      where i.project_id = p_project_id
        and not exists (select 1 from public.identity_devices idv3 where idv3.identity_id = i.id));
$$;
