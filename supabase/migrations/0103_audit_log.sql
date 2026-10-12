-- Журнал действий пользователей бэкофиса: кто, что и когда создал, изменил,
-- удалил, какие настройки сменил. Хранится 3 месяца (чистка внизу).
--
-- Пишется триггерами на таблицах, поэтому покрывает и правки из браузера
-- (supabase-js под JWT пользователя), и серверные роуты. Автор определяется
-- так (audit_context):
--   * запрос с JWT роли authenticated — автор из claims.sub;
--   * запрос service_role — автор и источник приходят заголовками
--     x-audit-actor / x-audit-source (их ставит createAdminClient в роуте,
--     см. lib/auditContext.ts). Заголовкам верим только для service_role,
--     обычный пользователь подделать их не может;
--   * всё остальное (cron, системные записи, SQL) — source = 'system', такие
--     записи в журнал не попадают: счётчики рассылок, расписание и прочие
--     служебные обновления — это шум.
--
-- project_id без внешнего ключа: запись об удалении проекта должна пережить
-- сам проект, а каскадное удаление не должно ломаться на вставке в журнал.
create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  project_id   uuid,
  actor_id     uuid,
  actor_email  text,
  actor_name   text,
  source       text not null default 'ui',   -- ui | api | import | system
  entity       text not null,                -- template, campaign, project, member, ...
  entity_id    text,
  entity_name  text,                         -- снимок названия: читается и после удаления
  action       text not null,                -- create | update | delete | send | export | ...
  changes      jsonb,                        -- {поле: {old, new}}, только изменённые
  created_at   timestamptz not null default now()
);

create index if not exists idx_audit_log_project_time on public.audit_log (project_id, created_at desc);
create index if not exists idx_audit_log_entity on public.audit_log (project_id, entity, entity_id, created_at desc);
create index if not exists idx_audit_log_created on public.audit_log (created_at);

alter table public.audit_log enable row level security;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select using (project_id is not null and public.can_access_project(project_id));

-- Писать и править журнал с клиента нельзя никому: только триггеры и
-- security definer функции ниже.
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

-- ---------------------------------------------------------------------
--  Кто делает запрос
-- ---------------------------------------------------------------------
create or replace function public.audit_context(out o_actor uuid, out o_source text)
language plpgsql
stable
as $$
declare
  claims jsonb;
  hdr    jsonb;
  r      text;
begin
  o_source := 'system';
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    claims := null;
  end;
  r := claims ->> 'role';

  if r = 'authenticated' then
    begin
      o_actor := nullif(claims ->> 'sub', '')::uuid;
    exception when others then
      o_actor := null;
    end;
    o_source := 'ui';
  elsif r = 'service_role' then
    begin
      hdr := nullif(current_setting('request.headers', true), '')::jsonb;
    exception when others then
      hdr := null;
    end;
    begin
      o_actor := nullif(hdr ->> 'x-audit-actor', '')::uuid;
    exception when others then
      o_actor := null;
    end;
    o_source := coalesce(
      nullif(hdr ->> 'x-audit-source', ''),
      case when o_actor is not null then 'ui' else 'system' end
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------
--  Запись и diff
-- ---------------------------------------------------------------------
create or replace function public.audit_write(
  p_project uuid, p_entity text, p_entity_id text, p_name text,
  p_action text, p_changes jsonb, p_actor uuid, p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name  text;
begin
  if p_actor is not null then
    select email, full_name into v_email, v_name from public.profiles where id = p_actor;
  end if;
  insert into public.audit_log (project_id, actor_id, actor_email, actor_name, source,
                                entity, entity_id, entity_name, action, changes)
  values (p_project, p_actor, v_email, v_name, p_source,
          p_entity, p_entity_id, p_name, p_action, p_changes);
end;
$$;

-- Длинные значения (HTML письма, большие конфиги) не дублируем в журнале —
-- только отметка, что поле менялось.
create or replace function public.audit_val(v jsonb)
returns jsonb
language sql
immutable
as $$
  select case when v is null then null
              when length(v::text) > 300 then jsonb_build_object('long', true)
              else v end;
$$;

-- Сравнение одного значения; конфиги-объекты (widget_config, manifest_config)
-- раскладываем по ключам до 3 уровней, чтобы видеть «widget_config.button.text»,
-- а не «весь конфиг изменён».
create or replace function public.audit_cmp(p_path text, o jsonb, n jsonb, p_depth int)
returns jsonb
language plpgsql
immutable
as $$
declare
  res jsonb := '{}'::jsonb;
  sk  text;
  os  jsonb;
  ns  jsonb;
begin
  if o is not distinct from n then
    return res;
  end if;
  if p_depth < 3 and (jsonb_typeof(o) = 'object' or jsonb_typeof(n) = 'object') then
    os := case when jsonb_typeof(o) = 'object' then o else '{}'::jsonb end;
    ns := case when jsonb_typeof(n) = 'object' then n else '{}'::jsonb end;
    for sk in
      select x from (select jsonb_object_keys(os) as x union select jsonb_object_keys(ns)) s
    loop
      res := res || public.audit_cmp(p_path || '.' || sk, os -> sk, ns -> sk, p_depth + 1);
    end loop;
    return res;
  end if;
  return jsonb_build_object(p_path, jsonb_build_object('old', public.audit_val(o), 'new', public.audit_val(n)));
end;
$$;

create or replace function public.audit_diff(p_old jsonb, p_new jsonb, p_ignore text[], p_table text)
returns jsonb
language plpgsql
immutable
as $$
declare
  res jsonb := '{}'::jsonb;
  k   text;
  o   jsonb;
  n   jsonb;
begin
  for k in select jsonb_object_keys(p_new) loop
    if k = any (p_ignore) or k in ('created_at', 'updated_at', 'key_hash') then
      continue;
    end if;
    -- sending/sent/failed ставит сама отправка, а не человек.
    if p_table = 'campaigns' and k = 'status' and p_new ->> 'status' in ('sending', 'sent', 'failed') then
      continue;
    end if;
    o := p_old -> k;
    n := p_new -> k;
    if o is not distinct from n then
      continue;
    end if;

    res := res || public.audit_cmp(k, o, n, 0);
  end loop;
  return res;
end;
$$;

-- Универсальный триггер: аргументы — имя сущности и список игнорируемых колонок.
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity  text := tg_argv[0];
  v_ignore  text[] := string_to_array(coalesce(tg_argv[1], ''), ',');
  ctx       record;
  v_row     jsonb;
  v_project uuid;
  v_id      text;
  v_name    text;
  v_action  text;
  v_changes jsonb;
begin
  -- каскады (удаление проекта, SET NULL при удалении папки) — не действия человека
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if current_setting('app.audit_skip', true) = 'on' then
    return null;
  end if;

  select * into ctx from public.audit_context();
  if ctx.o_actor is null and ctx.o_source = 'system' then
    return null;
  end if;

  v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_project := (case when tg_table_name = 'projects' then v_row ->> 'id' else v_row ->> 'project_id' end)::uuid;
  v_id := coalesce(v_row ->> 'id', v_row ->> 'client_id');

  if tg_table_name = 'project_members' then
    v_id := v_row ->> 'user_id';
    select email into v_name from public.profiles where id = (v_row ->> 'user_id')::uuid;
  elsif tg_table_name = 'oidc_clients' then
    v_name := 'Вход через OIDC';
  else
    v_name := coalesce(
      nullif(v_row ->> 'internal_title', ''), nullif(v_row ->> 'name', ''),
      nullif(v_row ->> 'title', ''), nullif(v_row ->> 'type', '')
    );
  end if;

  v_action := case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end;

  if tg_op = 'UPDATE' then
    v_changes := public.audit_diff(to_jsonb(old), to_jsonb(new), v_ignore, tg_table_name);
    if v_changes = '{}'::jsonb then
      -- Отправка кампании человеком: сам статус sending/sent в diff не попадает
      -- (его ставит рассылка), поэтому фиксируем её отдельным событием.
      if tg_table_name = 'campaigns'
         and new.status in ('sending', 'sent')
         and old.status not in ('sending', 'sent', 'failed') then
        v_action := 'send';
        v_changes := jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', new.status));
      else
        return null;
      end if;
    end if;
  end if;

  perform public.audit_write(v_project, v_entity, v_id, v_name, v_action, v_changes, ctx.o_actor, ctx.o_source);
  return null;
end;
$$;

-- Явные события для действий без строки в таблице (отправка кампании,
-- экспорт, массовые операции). Вызывает только серверный код.
create or replace function public.audit_event(
  p_project uuid, p_entity text, p_entity_id text, p_name text,
  p_action text, p_changes jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
begin
  select * into ctx from public.audit_context();
  perform public.audit_write(p_project, p_entity, p_entity_id, p_name, p_action, p_changes, ctx.o_actor, ctx.o_source);
end;
$$;
revoke all on function public.audit_event(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.audit_event(uuid, text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------
--  Триггеры
-- ---------------------------------------------------------------------
drop trigger if exists trg_audit on public.projects;
create trigger trg_audit after insert or update or delete on public.projects
  for each row execute function public.audit_row(
    'project',
    'tariff_pushes_remaining,package_pushes_remaining,remaining_pushes,renewal_attempts,product_feed_updated_at,product_feed_item_count,product_feed_error,product_feed_source_date,rfm_computed_at,setup_checks'
  );

drop trigger if exists trg_audit on public.templates;
create trigger trg_audit after insert or update or delete on public.templates
  for each row execute function public.audit_row('template', '');

drop trigger if exists trg_audit on public.template_folders;
create trigger trg_audit after insert or update or delete on public.template_folders
  for each row execute function public.audit_row('template_folder', '');

drop trigger if exists trg_audit on public.campaigns;
create trigger trg_audit after insert or update or delete on public.campaigns
  for each row execute function public.audit_row(
    'campaign',
    'sent_count,delivered_count,failed_count,clicked_count,opened_count,unsubscribed_count,error,sent_at'
  );

drop trigger if exists trg_audit on public.automations;
create trigger trg_audit after insert or update or delete on public.automations
  for each row execute function public.audit_row('automation', 'next_fire_at,last_fired_at');

drop trigger if exists trg_audit on public.api_keys;
create trigger trg_audit after insert or update or delete on public.api_keys
  for each row execute function public.audit_row('api_key', 'last_used_at');

drop trigger if exists trg_audit on public.oidc_clients;
create trigger trg_audit after insert or update or delete on public.oidc_clients
  for each row execute function public.audit_row('oidc', '');

drop trigger if exists trg_audit on public.media_assets;
create trigger trg_audit after insert or update or delete on public.media_assets
  for each row execute function public.audit_row('media', '');

drop trigger if exists trg_audit on public.media_folders;
create trigger trg_audit after insert or update or delete on public.media_folders
  for each row execute function public.audit_row('media_folder', '');

drop trigger if exists trg_audit on public.project_members;
create trigger trg_audit after insert or update or delete on public.project_members
  for each row execute function public.audit_row('member', '');

-- ---------------------------------------------------------------------
--  Передача владения: одна запись вместо россыпи (смена owner_id + два
--  изменения списка участников).
-- ---------------------------------------------------------------------
create or replace function public.transfer_project_ownership(p_project_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old   uuid;
  v_pname text;
  v_nname text;
  ctx     record;
begin
  select owner_id, name into v_old, v_pname from public.projects where id = p_project_id for update;
  if v_old is null then
    raise exception 'Проект не найден';
  end if;
  if v_old is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Передать проект может только владелец';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_new_owner
  ) then
    raise exception 'Новым владельцем может стать только Админ проекта';
  end if;

  perform set_config('app.audit_skip', 'on', true);
  perform set_config('app.owner_transfer', 'on', true);
  update public.projects set owner_id = p_new_owner where id = p_project_id;
  perform set_config('app.owner_transfer', 'off', true);

  delete from public.project_members where project_id = p_project_id and user_id = p_new_owner;
  insert into public.project_members (project_id, user_id, role, invited_by)
  values (p_project_id, v_old, 'admin', p_new_owner)
  on conflict (project_id, user_id) do nothing;
  perform set_config('app.audit_skip', 'off', true);

  select email into v_nname from public.profiles where id = p_new_owner;
  select * into ctx from public.audit_context();
  perform public.audit_write(
    p_project_id, 'member', p_new_owner::text, v_nname, 'transfer',
    jsonb_build_object('owner', jsonb_build_object('old', v_old, 'new', p_new_owner)),
    ctx.o_actor, ctx.o_source
  );
end;
$$;

-- ---------------------------------------------------------------------
--  Правки полей контакта получают автора (identity_field_changes, 0041).
--  Система (импорт по API, веб-хуки) остаётся без автора.
-- ---------------------------------------------------------------------
alter table public.identity_field_changes add column if not exists actor_id uuid;
alter table public.identity_field_changes add column if not exists source text;

create or replace function public.identity_field_changes_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx record;
begin
  select * into ctx from public.audit_context();
  new.actor_id := ctx.o_actor;
  new.source := ctx.o_source;
  return new;
end;
$$;

drop trigger if exists trg_identity_field_changes_actor on public.identity_field_changes;
create trigger trg_identity_field_changes_actor before insert on public.identity_field_changes
  for each row execute function public.identity_field_changes_actor();

-- ---------------------------------------------------------------------
--  Начальное заполнение: «создан» там, где автор уже известен.
-- ---------------------------------------------------------------------
insert into public.audit_log (project_id, actor_id, actor_email, actor_name, source, entity, entity_id, entity_name, action, created_at)
select t.project_id, t.created_by, p.email, p.full_name, 'ui', 'template', t.id::text, t.name, 'create', t.created_at
from public.templates t join public.profiles p on p.id = t.created_by
where t.created_at > now() - interval '3 months';

insert into public.audit_log (project_id, actor_id, actor_email, actor_name, source, entity, entity_id, entity_name, action, created_at)
select c.project_id, c.created_by, p.email, p.full_name, 'ui', 'campaign', c.id::text, coalesce(c.internal_title, c.title), 'create', c.created_at
from public.campaigns c join public.profiles p on p.id = c.created_by
where c.created_at > now() - interval '3 months';

insert into public.audit_log (project_id, actor_id, actor_email, actor_name, source, entity, entity_id, entity_name, action, created_at)
select m.project_id, m.created_by, p.email, p.full_name, 'ui', 'media', m.id::text, m.name, 'create', m.created_at
from public.media_assets m join public.profiles p on p.id = m.created_by
where m.created_at > now() - interval '3 months';

-- ---------------------------------------------------------------------
--  Хранение 3 месяца
-- ---------------------------------------------------------------------
select cron.schedule(
  'purge-audit-log',
  '17 3 * * *',
  $$delete from public.audit_log where created_at < now() - interval '3 months'$$
);
