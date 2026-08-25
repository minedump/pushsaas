-- Общий журнал изменений данных контакта (имя/телефон/email/внешний ID/
-- теги/доп. поля) — то же место, что «История согласий» на карточке
-- подписчика (identity_channel_events, миграция 0029), но для ЛЮБОГО поля,
-- не только SMS/Email-согласия. Пишется при любой правке identities:
-- вручную (updateContact/upsertContact), массовыми действиями (tag_add/
-- tag_remove), CSV-импортом.
create table public.identity_field_changes (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  identity_id uuid references public.identities(id) on delete set null,
  field text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index idx_identity_field_changes_identity on public.identity_field_changes(identity_id, created_at desc);
