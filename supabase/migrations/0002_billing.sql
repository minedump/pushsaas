-- =====================================================================
--  Billing (CloudPayments) — server-side credit/renewal RPCs.
--  Called ONLY from trusted server code (webhook / cron) via service_role.
--  Balance mechanics mirror TryVice: tariff burns, package never burns,
--  tariff-switch carries the unused remainder into package, 3 renewal retries.
-- =====================================================================

-- existing helpers need to be callable by the service_role sender/cron
grant execute on function public._apply_tariff(uuid, uuid, integer, boolean) to service_role;
grant execute on function public.block_project(uuid)                        to service_role;
grant execute on function public.spend_pushes(uuid, integer)                to service_role;
grant execute on function public.refund_pushes(uuid, integer)               to service_role;

-- Apply a PAID tariff (from the payment webhook): carry-over unused remainder
-- into package (only on a real tariff change), overwrite tariff balance, set the
-- billing period, optionally store the recurring card token, and log it.
create or replace function public.apply_paid_tariff(
  p_project_id uuid,
  p_tariff_id  uuid,
  p_pushes     integer,
  p_period_end timestamptz,
  p_amount     numeric,
  p_type       text,
  p_token      text
) returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public._apply_tariff(p_project_id, p_tariff_id, p_pushes, false);

  update public.projects
    set current_period_end = p_period_end
    where id = p_project_id;

  if p_token is not null and p_token <> '' then
    insert into public.project_secrets (project_id, cp_card_token)
    values (p_project_id, p_token)
    on conflict (project_id) do update set cp_card_token = excluded.cp_card_token;
  end if;

  insert into public.transactions (project_id, type, amount_rub, pushes, description)
  values (p_project_id, p_type, p_amount, p_pushes, 'Оплата тарифа');
end;
$$;

-- Credit a one-off package (non-burning) from a package purchase.
create or replace function public.credit_package(
  p_project_id uuid, p_pushes integer, p_amount numeric, p_description text
) returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.projects
    set package_pushes_remaining = package_pushes_remaining + p_pushes
    where id = p_project_id;

  insert into public.transactions (project_id, type, amount_rub, pushes, description)
  values (p_project_id, 'package_purchase', p_amount, p_pushes, coalesce(p_description, 'Покупка пакета'));
end;
$$;

-- Successful auto-renewal: full limit (overwrite, same tariff -> no carry),
-- advance the period, reset the retry counter, ensure unblocked.
create or replace function public.renew_success(
  p_project_id uuid, p_pushes integer, p_period_end timestamptz, p_amount numeric
) returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.projects
    set tariff_pushes_remaining = p_pushes,
        current_period_end = p_period_end,
        renewal_attempts = 0,
        is_active = true
    where id = p_project_id;

  insert into public.transactions (project_id, type, amount_rub, pushes, description)
  values (p_project_id, 'tariff_renewal', p_amount, p_pushes, 'Автопродление тарифа');
end;
$$;

-- Failed renewal attempt: bump counter; on the 3rd failure block + burn tariff.
-- Returns true if the project was blocked by this call.
create or replace function public.renew_fail(p_project_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_attempts int;
begin
  update public.projects
    set renewal_attempts = renewal_attempts + 1
    where id = p_project_id
    returning renewal_attempts into v_attempts;

  if v_attempts >= 3 then
    perform public.block_project(p_project_id);   -- is_active=false + burn tariff
    update public.projects set renewal_attempts = 0 where id = p_project_id;
    return true;
  end if;
  return false;
end;
$$;

grant execute on function public.apply_paid_tariff(uuid, uuid, integer, timestamptz, numeric, text, text) to service_role;
grant execute on function public.credit_package(uuid, integer, numeric, text) to service_role;
grant execute on function public.renew_success(uuid, integer, timestamptz, numeric) to service_role;
grant execute on function public.renew_fail(uuid) to service_role;
