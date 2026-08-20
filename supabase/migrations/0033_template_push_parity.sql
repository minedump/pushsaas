-- Push-шаблоны получают те же поля, что и push-кампании: значок (badge) для
-- статус-бара и кнопки действий (rich push) — раньше были только у кампаний,
-- у шаблонов их нельзя было ни задать, ни увидеть.
alter table public.templates add column if not exists badge_url text;
alter table public.templates add column if not exists actions jsonb;
