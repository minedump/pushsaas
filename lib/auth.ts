import { createClient } from "@/lib/supabase/server";

// Returns the authenticated user or null (for API-route self-checks, TryVice §8).
export async function getSessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// Verifies the current user owns (or admins) the project, reusing the RLS
// policy on `projects` rather than re-implementing the check by hand:
// if the user's own session-scoped query can't see the row, they can't act on it.
//
// getUser() and the projects select both run off the same request-scoped
// session cookie and don't depend on each other's result — run them in
// parallel instead of sequentially (getUser() alone does a real network
// round-trip to Supabase Auth to validate the JWT, ~0.3-1s; doubling that
// by awaiting it before the projects query was the single biggest chunk of
// latency in every route that calls this, not just this one call site).
export async function assertProjectAccess(projectId: string) {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    { data },
  ] = await Promise.all([supabase.auth.getUser(), supabase.from("projects").select("id").eq("id", projectId).maybeSingle()]);
  if (!user) return { ok: false as const, status: 401, user: null };
  if (!data) return { ok: false as const, status: 403, user };
  return { ok: true as const, status: 200, user };
}
