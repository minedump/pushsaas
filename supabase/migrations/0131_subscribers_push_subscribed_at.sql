-- Когда устройство включило push. created_at для этого не годится: с миграции 0071 строка устройства
-- появляется при первом визите (анонимно, без push), а подписка может случиться через неделю —
-- дашборд считал такую подписку днём первого визита.
alter table public.subscribers add column if not exists push_subscribed_at timestamptz;

-- Ставится сам, когда у устройства появляется endpoint (новая строка с push или анонимная строка,
-- получившая push). Смена endpoint браузером (ротация) дату не трогает.
create or replace function public.subscribers_set_push_subscribed_at() returns trigger
language plpgsql as $$
begin
  if new.endpoint is not null and (tg_op = 'INSERT' or old.endpoint is null) then
    new.push_subscribed_at := coalesce(case when tg_op = 'INSERT' then new.push_subscribed_at end, now());
  end if;
  return new;
end;
$$;

drop trigger if exists subscribers_push_subscribed_at on public.subscribers;
create trigger subscribers_push_subscribed_at
  before insert or update of endpoint on public.subscribers
  for each row execute function public.subscribers_set_push_subscribed_at();

-- Прошлые подписки: время из события подписки виджета, если оно есть, иначе created_at.
update public.subscribers s
set push_subscribed_at = coalesce(
  (select min(e.created_at) from public.events e
    where e.subscriber_id = s.id
      and (e.name in ('widget_button_subscribed', 'widget_prompt_subscribed')
           or (e.name = 'widget_notify_result' and e.payload->>'result' = 'granted'))),
  s.created_at)
where s.endpoint is not null and s.push_subscribed_at is null;

create index if not exists subscribers_project_push_subscribed_at_idx
  on public.subscribers (project_id, push_subscribed_at)
  where endpoint is not null;
