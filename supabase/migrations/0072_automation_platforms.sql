-- Тот же фильтр push-аудитории по платформе устройства, что уже есть у
-- ручных рассылок (campaigns.platforms, migration 0038), теперь и у
-- приветственных автоматизаций — welcome-отправка идёт по одному конкретному
-- устройству (см. sendWelcomeNow в lib/sender.ts), поэтому здесь это не
-- фильтр аудитории, а простая проверка "платформа этого устройства входит в
-- разрешённые" перед отправкой. Пусто = без фильтра, все платформы — тот же
-- принцип, что и у campaigns.platforms.
alter table public.automations add column if not exists platforms text[] not null default '{}';
