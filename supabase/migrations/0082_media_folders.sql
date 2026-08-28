-- Папки для библиотеки изображений (см. migration 0081) — та же модель,
-- что и у папок шаблонов (template_folders, migration 0030): плоский список
-- папок на проект, файл лежит максимум в одной (или ни в одной).
create table public.media_folders (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create index idx_media_folders_project on public.media_folders(project_id);

alter table public.media_folders enable row level security;
create policy media_folders_rw on public.media_folders for all using (
  exists (select 1 from public.projects p where p.id = media_folders.project_id and (p.owner_id = auth.uid() or public.is_admin()))
) with check (
  exists (select 1 from public.projects p where p.id = media_folders.project_id and (p.owner_id = auth.uid() or public.is_admin()))
);

alter table public.media_assets add column if not exists folder_id uuid references public.media_folders(id) on delete set null;
