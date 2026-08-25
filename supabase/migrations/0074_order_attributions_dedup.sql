-- InSales обычно шлёт отдельные вебхуки на создание заказа И на смену
-- статуса — мерчант может законно навесить оба события на один и тот же
-- адрес атрибуции (см. Настройки → Атрибуция заказов). Без дедупа это
-- считало бы выручку заказа несколько раз (по разу на каждое срабатывание).
-- Уникальность по (project_id, order_number) — NULL order_number не
-- участвует в проверке (стандартное поведение unique index в Postgres),
-- поэтому заказы без номера продолжают просто вставляться как раньше.
create unique index if not exists uq_order_attr_project_order
  on public.order_attributions(project_id, order_number)
  where order_number is not null;
