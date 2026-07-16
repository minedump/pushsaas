-- =====================================================================
--  0015 — Чистка мёртвых колонок.
--
--  identities.verification_source (миграция 0010) была заведена под аудит
--  старой identify()-без-OTP логики ("insales_session" — доверие
--  авторизованной сессии InSales без реального кода), которую убрали ещё
--  в этой же сессии работ (см. задачу «Убрать require_phone_verification
--  из каскада и настроек»). Нигде не читается и не пишется — удаляем.
--
--  subscribers.user_agent и subscribers.last_seen (миграция 0001) —
--  писались один раз при подписке и больше никогда не читались и не
--  обновлялись (last_seen фактически значил "время первой подписки", а не
--  "последний визит" — таким и не пользовались). Удаляем обе.
-- =====================================================================

alter table public.identities drop column if exists verification_source;
alter table public.subscribers drop column if exists user_agent;
alter table public.subscribers drop column if exists last_seen;
