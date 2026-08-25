-- Сегмент по тегам для приветственного сообщения — та же логика, что у
-- обычных рассылок (segment_tags на campaigns): пусто = всем контактам
-- канала, иначе только тем, чьи identities.tags пересекаются со списком.
alter table public.automations add column if not exists segment_tags text[];
