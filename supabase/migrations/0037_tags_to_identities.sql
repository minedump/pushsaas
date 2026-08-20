-- Теги переезжают с устройства (subscribers) на контакт (identities) —
-- один человек может иметь несколько push-устройств (телефон+десктоп),
-- сегмент должен относиться к человеку, а не к конкретному браузеру.
-- Анонимные устройства (без привязанной identity — вход по коду не
-- проходили) после переноса тегов иметь не могут: их некуда сохранять.
alter table public.identities add column if not exists tags text[] not null default '{}';

-- Перенос данных: объединение тегов со всех устройств identity (человек с
-- двумя устройствами и разными тегами должен остаться в обоих сегментах).
update public.identities i
set tags = coalesce((
  select array_agg(distinct t)
  from public.identity_devices idv
  join public.subscribers s on s.id = idv.subscriber_id
  cross join lateral unnest(s.tags) as t
  where idv.identity_id = i.id
), '{}'::text[]);

create index if not exists idx_identities_tags on public.identities using gin (tags);

alter table public.subscribers drop column if exists tags;
