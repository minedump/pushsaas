-- Библиотека изображений проекта — для использования в HTML писем и т.п.
-- (баннеры, лого, картинки для верстки), не завязана на конкретный шаблон
-- или рассылку. Файлы лежат в Storage-бакете project-assets (тот же, что
-- уже используется под PWA-иконки, см. lib/manifest.ts), под префиксом
-- media/<projectId>/... — просто отдельная запись метаданных, чтобы можно
-- было показать галерею с датой/автором и без обхода самого бакета.
create table public.media_assets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  url         text not null,
  path        text not null,
  size        bigint not null,
  mime_type   text not null,
  width       int,
  height      int,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null
);
create index idx_media_assets_project on public.media_assets(project_id);

alter table public.media_assets enable row level security;
create policy media_assets_rw on public.media_assets for all
  using (project_id in (select id from public.projects where owner_id = auth.uid()) or public.is_admin())
  with check (project_id in (select id from public.projects where owner_id = auth.uid()) or public.is_admin());
