-- Аналитика окон отправки: флаг «не учитывать в аналитике» у контакта (наши тестовые контакты)
-- и дополнительные данные в строке получателя рассылки, которые нужны для честного сравнения
-- окон: ссылка на контакт, снимок аудитории на момент отправки, число кликов.

-- 1. Контакт можно исключить из аналитики. Рассылка ему по-прежнему уходит, просто его клики
-- и доставки не попадают в «Лучшее время для отправки», CTR и подобные расчёты по получателям.
alter table identities add column if not exists exclude_from_analytics boolean not null default false;
create index if not exists idx_identities_excluded on identities (project_id) where exclude_from_analytics;

-- 2. Строка получателя: контакт, снимок аудитории, клики
alter table campaign_recipients add column if not exists identity_id uuid references identities(id) on delete set null;
-- Что мы знали о получателе в момент отправки (теги, сумма покупок, город, часовой пояс): по нему
-- потом сравниваем окна с похожей аудиторией. У строк до этой миграции снимок восстановлен по
-- текущему состоянию контакта и помечен backfilled = true.
alter table campaign_recipients add column if not exists audience_snapshot jsonb;
-- Первый клик уже хранится в clicked_at; здесь все клики и время последнего.
alter table campaign_recipients add column if not exists click_count integer not null default 0;
alter table campaign_recipients add column if not exists last_clicked_at timestamptz;

create index if not exists idx_campaign_recipients_identity on campaign_recipients (identity_id) where identity_id is not null;
create index if not exists idx_campaign_recipients_project_channel_time on campaign_recipients (project_id, channel, created_at desc);

-- 3. Восстановление связи с контактом у уже отправленных строк
update campaign_recipients r set identity_id = i.id
from identities i
where r.identity_id is null and r.channel = 'sms' and i.project_id = r.project_id and i.phone = r.contact;

update campaign_recipients r set identity_id = i.id
from identities i
where r.identity_id is null and r.channel = 'email' and i.project_id = r.project_id and lower(i.email) = lower(r.contact);

update campaign_recipients r set identity_id = d.identity_id
from (select distinct on (subscriber_id) subscriber_id, identity_id from identity_devices order by subscriber_id, created_at) d
where r.identity_id is null and r.channel = 'push' and r.contact = d.subscriber_id::text;

update campaign_recipients r set
  audience_snapshot = jsonb_strip_nulls(jsonb_build_object(
    'tags', i.tags,
    'purchases_sum', i.attributes ->> 'purchases_sum',
    'city', i.attributes ->> 'city',
    'timezone', i.timezone,
    'backfilled', true
  ))
from identities i
where r.identity_id = i.id and r.audience_snapshot is null;

update campaign_recipients set click_count = 1, last_clicked_at = clicked_at where clicked_at is not null and click_count = 0;

-- 4. Клик: первый фиксируется в clicked_at, каждый увеличивает счётчик (одним запросом, без гонок)
create or replace function record_recipient_click(p_campaign uuid, p_token text, p_subscriber text)
returns void language sql security definer set search_path = public as $$
  update campaign_recipients set
    clicked_at = coalesce(clicked_at, now()),
    last_clicked_at = now(),
    click_count = click_count + 1
  where campaign_id = p_campaign
    and (
      (p_token is not null and token = p_token)
      or (p_token is null and p_subscriber is not null and channel = 'push' and contact = p_subscriber)
    );
$$;
revoke all on function record_recipient_click(uuid, text, text) from public, anon, authenticated;
grant execute on function record_recipient_click(uuid, text, text) to service_role;
