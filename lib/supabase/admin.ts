import { createClient } from "@supabase/supabase-js";

// Service-role client — BYPASSES RLS. Use ONLY in trusted server code
// (senders, cron, webhooks). Never import into anything shipped to the browser.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
