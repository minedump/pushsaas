-- Отклонённые вызовы вебхуков магазина (неверный ключ, пустое тело и т.п.).
-- В api_call_log их не записать: у такого вызова нет проекта. Нужны, чтобы видеть,
-- что магазин стучится, но его не пускают, и почему. Ключ целиком не храним, только
-- подсказку (начало и длину). Строки старше 14 дней удаляются при записи новых.
create table if not exists public.webhook_rejects (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  endpoint    text not null,
  status_code smallint not null,
  reason      text not null,
  key_hint    text,
  method      text,
  body        text
);
create index if not exists idx_webhook_rejects_created on public.webhook_rejects (created_at desc);

-- только сервисная роль: пользователи проектов эту таблицу не видят
alter table public.webhook_rejects enable row level security;
revoke all on public.webhook_rejects from anon, authenticated;
