-- Согласия при регистрации владельца (app/login/page.tsx) — обработка
-- персональных данных и политика конфиденциальности обязательны, рассылки —
-- опционально. Храним МОМЕНТ согласия (timestamptz), а не просто флаг:
-- для 152-ФЗ важно не только «согласился ли», но и когда именно. NULL —
-- согласия не было (в т.ч. у всех аккаунтов, созданных до этой миграции).
alter table public.profiles
  add column consent_personal_data_at  timestamptz,
  add column consent_privacy_policy_at timestamptz,
  add column consent_marketing_at      timestamptz;

-- Те же обязательные два берём из signUp options.data (как full_name в
-- 0083) — это просто "когда пользователь нажал галочку", не право доступа,
-- в отличие от role его безопасно доверять метаданным. Форма на клиенте
-- не даёт отправить регистрацию без обязательных галочек, но на всякий
-- случай не завязываем на это NOT NULL — не хотим, чтобы обход клиентской
-- валидации ломал саму регистрацию (тем более что "не заполнено" уже
-- полностью законно означает "не мигрированный старый аккаунт").
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, consent_personal_data_at, consent_privacy_policy_at, consent_marketing_at)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    'client',
    case when new.raw_user_meta_data->>'consent_personal_data' = 'true' then now() end,
    case when new.raw_user_meta_data->>'consent_privacy_policy' = 'true' then now() end,
    case when new.raw_user_meta_data->>'consent_marketing' = 'true' then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
