-- Доп. фильтр аудитории push-рассылки по платформе устройства (iOS/Android/
-- Desktop), рядом с сегментом по тегам и контактами. Пусто = без фильтра,
-- все платформы — тот же принцип "пусто = всем", что и у segment_tags.
alter table public.campaigns add column if not exists platforms text[] not null default '{}';
