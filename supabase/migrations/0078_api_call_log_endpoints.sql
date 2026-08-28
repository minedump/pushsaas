-- api_call_log.endpoint check constraint was never widened when
-- /api/v1/send → /api/v1/campaigns and /api/v1/contacts → /api/v1/subscribers
-- were renamed (see lib/apiLog.ts) — every logApiCall("campaigns"/"templates"/
-- "subscribers") call has been silently failing the insert ever since (it's
-- best-effort, so the API responses themselves were unaffected, only the
-- «Вебхуки/API» journal tab stayed empty for these calls). Also adding
-- "automations" here for the new /api/v1/automations CRUD. Old values kept
-- in the allowed set so any pre-existing 'send'/'contacts' rows stay valid.
alter table public.api_call_log drop constraint if exists api_call_log_endpoint_check;
alter table public.api_call_log add constraint api_call_log_endpoint_check
  check (endpoint in ('send','attribute','contacts','campaigns','templates','subscribers','automations'));
