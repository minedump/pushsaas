-- Обобщаем шаблоны с "только email" до всех трёх каналов (push/sms/email),
-- добавляем папки для организации и автора/дату создания — тот же
-- канал-дискриминатор, что уже есть у campaigns.

create table public.template_folders (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create index idx_template_folders_project on public.template_folders(project_id);

alter table public.template_folders enable row level security;
create policy template_folders_rw on public.template_folders for all using (
  exists (select 1 from public.projects p where p.id = template_folders.project_id and (p.owner_id = auth.uid() or public.is_admin()))
) with check (
  exists (select 1 from public.projects p where p.id = template_folders.project_id and (p.owner_id = auth.uid() or public.is_admin()))
);

alter table public.email_templates rename to templates;

alter table public.templates add column if not exists channel text not null default 'email' check (channel in ('push', 'sms', 'email'));
alter table public.templates add column if not exists folder_id uuid references public.template_folders(id) on delete set null;
alter table public.templates add column if not exists title text;       -- push: заголовок уведомления
alter table public.templates add column if not exists body text;       -- push: текст уведомления / sms: текст сообщения
alter table public.templates add column if not exists url text;        -- push: ссылка клика
alter table public.templates add column if not exists icon_url text;   -- push
alter table public.templates add column if not exists image_url text;  -- push
alter table public.templates add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();
alter table public.templates alter column html drop not null;          -- html обязателен только для email, не для push/sms

create index if not exists idx_templates_folder on public.templates(folder_id);

-- Разовые данные конкретного вызова API (например номер заказа, сумма) для
-- подстановки в шаблон через {key} — отдельно от subscribers.attributes,
-- т.к. это не атрибуты подписчика, а параметры именно этой отправки.
alter table public.campaigns add column if not exists template_data jsonb;
