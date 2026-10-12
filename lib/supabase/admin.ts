import { createClient } from "@supabase/supabase-js";
import { currentAudit } from "@/lib/auditContext";

// Service-role client — BYPASSES RLS. Use ONLY in trusted server code
// (senders, cron, webhooks). Never import into anything shipped to the browser.
//
// Если роут заранее вызвал auditAs(...), правки через этот клиент попадут в
// журнал действий с автором (см. lib/auditContext.ts); без него они считаются
// системными и в журнал не пишутся.
export function createAdminClient() {
  const audit = currentAudit();
  const headers: Record<string, string> = {};
  if (audit) {
    headers["x-audit-source"] = audit.source;
    if (audit.actor) headers["x-audit-actor"] = audit.actor;
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false }, global: { headers } }
  );
}
