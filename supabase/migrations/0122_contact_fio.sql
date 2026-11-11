-- Фамилия, имя и отчество контакта отдельными полями.
-- name остаётся: это «Имя Фамилия», как его собирал вебхук магазина, и его по-прежнему подставляют
-- в тексты как {{ name }}. Отдельные поля: {{ first_name }}, {{ last_name }}, {{ middle_name }}.
alter table public.identities add column if not exists first_name text;
alter table public.identities add column if not exists last_name text;
alter table public.identities add column if not exists middle_name text;

-- Разбор уже сохранённых имён: одно слово это имя, два слова это «Имя Фамилия». Всё остальное (три слова и
-- больше, непонятный порядок) не трогаем: пусть остаётся в name до ручной правки.
update public.identities
set first_name = (regexp_split_to_array(btrim(name), '\s+'))[1],
    last_name = case when array_length(regexp_split_to_array(btrim(name), '\s+'), 1) = 2 then (regexp_split_to_array(btrim(name), '\s+'))[2] end
where name is not null
  and btrim(name) <> ''
  and first_name is null
  and last_name is null
  and array_length(regexp_split_to_array(btrim(name), '\s+'), 1) <= 2;
