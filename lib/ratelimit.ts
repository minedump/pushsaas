import { createAdminClient } from "@/lib/supabase/admin";

// Sliding-window rate limit backed by a table (same technique as otp_requests'
// send cooldown) — works across serverless instances without external state.
// Returns true if the call is allowed (and records the hit); false if over limit.
export async function checkRateLimit(key: string, windowMs: number, max: number): Promise<boolean> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await admin
    .from("rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("key", key)
    .gte("created_at", since);
  if ((count || 0) >= max) return false;
  await admin.from("rate_limit_hits").insert({ key });
  return true;
}
