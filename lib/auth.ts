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
export async function assertProjectAccess(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, user: null };

  const { data } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!data) return { ok: false as const, status: 403, user };
  return { ok: true as const, status: 200, user };
}
