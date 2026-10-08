-- A double-submit on "Create project" (e.g. two rapid clicks landing before
-- the client's busy-state re-render) could insert two identical projects
-- for the same owner+domain with nothing to stop it. Block that at the
-- database level, the only place that's actually race-proof.
create unique index if not exists idx_projects_owner_domain_unique
  on public.projects (owner_id, domain)
  where domain is not null;
