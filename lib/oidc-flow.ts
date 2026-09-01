import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Выпуск authorization code + редирект обратно к RP (InSales).
// Вызывается из /oidc/[id]/auth (без отскока) и /oidc/[id]/continue (после).
// projectId скопирован в лукап сессии для консистентности с loadSession/
// otp-status (см. security-аудит 2026-09-01) — sid и так непредсказуем и
// подписан HMAC, но каждый лукап сессии в остальном флоу скопирован по
// project_id, и этот не должен быть исключением.
export async function issueCodeAndRedirect(projectId: string, sessionId: string): Promise<Response> {
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("oidc_auth_sessions")
    .select("id, redirect_uri, state, status")
    .eq("id", sessionId)
    .eq("project_id", projectId)
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
  return Response.redirect(target.toString(), 302);
}
