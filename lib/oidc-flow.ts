import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { oidcLog } from "@/lib/oidc";

// Выпуск authorization code + редирект обратно к RP (InSales).
// Вызывается из /oidc/[id]/auth (без отскока) и /oidc/[id]/continue (после).
export async function issueCodeAndRedirect(sessionId: string): Promise<Response> {
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("oidc_auth_sessions")
    .select("id, redirect_uri, state, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.status !== "verified") {
    return new Response("Сессия входа истекла — вернитесь в магазин и попробуйте снова.", { status: 400 });
  }

  const code = crypto.randomBytes(32).toString("hex");
  await admin
    .from("oidc_auth_sessions")
    .update({
      code_hash: crypto.createHash("sha256").update(code).digest("hex"),
      status: "code_issued",
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    .eq("id", sessionId);

  const target = new URL(session.redirect_uri);
  target.searchParams.set("code", code);
  if (session.state) target.searchParams.set("state", session.state);
  oidcLog("auth:code_issued", { sessionId, redirectHost: target.hostname });
  return Response.redirect(target.toString(), 302);
}
