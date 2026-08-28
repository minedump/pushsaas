-- Аналитика виджетов (раздел «Аналитика») считает показ/клик/закрытие по
-- project_id + name + created_at за период, без фильтра по subscriber_id —
-- существующий индекс (project_id, subscriber_id, name, created_at) для
-- такого запроса неудобен (subscriber_id стоит раньше name). Отдельный
-- индекс под этот конкретный шаблон запроса.
create index if not exists idx_events_by_name on public.events(project_id, name, created_at desc);
