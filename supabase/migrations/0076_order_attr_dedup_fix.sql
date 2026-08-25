-- 0074's index was PARTIAL (where order_number is not null) — harmless on
-- its own, but Supabase's .upsert(..., { onConflict: "project_id,order_number" })
-- generates a plain ON CONFLICT (project_id, order_number) with no WHERE
-- clause, which Postgres refuses to match against a partial index. A
-- standard (non-partial) unique index already excludes NULL from conflict
-- checks on its own (NULLs never compare equal to each other in a btree
-- unique index), so the WHERE clause was unnecessary — replace it.
drop index if exists public.uq_order_attr_project_order;
create unique index if not exists uq_order_attr_project_order
  on public.order_attributions(project_id, order_number);
