-- Расширяем push_events.type для событий жизненного цикла подписки — раньше
-- только доставка/клик пуша, теперь и сама подписка/пауза/отвал устройства.
-- Нужно для вкладки «События подписчиков» в Журнале.
alter table public.push_events drop constraint if exists push_events_type_check;
alter table public.push_events add constraint push_events_type_check
  check (type in ('delivered','failed','clicked','subscribed','paused','resumed','dead'));
