-- Коллекции — отдельный раздел YML-фида (Яндекс.Директ,
-- https://yandex.ru/support/direct/ru/feeds/requirements-yml#collections):
-- тематическая подборка товаров с картинкой(-ами)/ссылкой/описанием, для
-- карточек в письме (не иерархия, как categories, — offer может входить
-- сразу в несколько). Кеш параллельно product_feed_categories, тот же
-- принцип (см. lib/productFeed.ts — parseCollections/resolveCollectionContext).
create table public.product_feed_collections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  external_id text not null,
  name text not null,
  description text,
  url text,
  image_url text,
  images text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create unique index uq_product_feed_collection on public.product_feed_collections(project_id, external_id);
create index idx_product_feed_collections_project on public.product_feed_collections(project_id);
alter table public.product_feed_collections enable row level security;
create policy product_feed_collections_select on public.product_feed_collections
  for select using (
    exists (select 1 from public.projects p
            where p.id = product_feed_collections.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );

-- Имена коллекций товара (offer -> <collectionId>*), симметрично уже
-- существующему product_feed_items.categories.
alter table public.product_feed_items add column if not exists collections text[] not null default '{}';
