-- Имя при регистрации (см. app/login/page.tsx — передаётся через
-- supabase.auth.signUp options.data.full_name, тот же путь, что и раньше
-- игнорировался для role — но full_name не даёт прав, в отличие от role,
-- поэтому его безопасно брать из meta данных без риска самоповышения.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', 'client')
  on conflict (id) do nothing;
  return new;
end;
$$;
