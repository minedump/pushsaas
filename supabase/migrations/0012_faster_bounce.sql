-- =====================================================================
--  Ускорение опознавательного отскока: меньше круговых обращений к БД.
--  (1) session + identify-тикет создаются одним вызовом вместо двух inserts.
--  (2) /api/public/link: select+update link_tickets сведены к одному
--      atomic update...returning (заодно закрывает гонку двойного потребления).
-- =====================================================================

create or replace function public.start_oidc_session(
  p_project_id uuid,
  p_redirect_uri text,
  p_state text,
  p_nonce text,
  p_session_ttl_seconds integer,
  p_ticket_ttl_seconds integer
) returns table(session_id uuid, ticket_id uuid)
language plpgsql
security definer set search_path = public
as $$
declare
  v_session_id uuid;
  v_ticket_id uuid;
begin
  insert into public.oidc_auth_sessions (project_id, redirect_uri, state, nonce, expires_at)
  values (p_project_id, p_redirect_uri, p_state, p_nonce, now() + make_interval(secs => p_session_ttl_seconds))
  returning id into v_session_id;

  insert into public.link_tickets (project_id, identity_id, session_id, expires_at)
  values (p_project_id, null, v_session_id, now() + make_interval(secs => p_ticket_ttl_seconds))
  returning id into v_ticket_id;

  return query select v_session_id, v_ticket_id;
end;
$$;

grant execute on function public.start_oidc_session(uuid, text, text, text, integer, integer) to service_role;
revoke execute on function public.start_oidc_session(uuid, text, text, text, integer, integer) from public;
