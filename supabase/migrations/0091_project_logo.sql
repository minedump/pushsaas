-- Логотип проекта — показывается по центру на экране входа (app/oidc/[projectId]/auth/route.ts).
-- Отдельная колонка, а не manifest_config: там уже лежат растеризованные
-- PWA-иконки (скруглённые, с подложкой под maskable) — не то же самое, что
-- чистый логотип для страницы входа.
alter table public.projects
  add column if not exists logo_url text;
