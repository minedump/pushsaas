import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOidcContext, parseClientAuth, sha256, signIdToken, buildClaims, oidcLog } from "@/lib/oidc";

// Token endpoint: authorization_code -> { id_token, access_token }.
// InSales аутентифицируется client_secret_basic (Rack::OAuth2) — стенд 2026-07-12.
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  const oidc = await getOidcContext(projectId);
  const ua = req.headers.get("user-agent") || "";
  if (!oidc || !oidc.isEnabled) {
    oidcLog("token", { projectId, ua, outcome: "invalid_client:not_configured" });
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  const body = new URLSearchParams(await req.text());
  const creds = parseClientAuth(req, body);
  const authVia = (req.headers.get("authorization") || "").startsWith("Basic ") ? "basic" : "post";
  if (creds.id !== oidc.clientId || sha256(creds.secret) !== oidc.clientSecretHash) {
    oidcLog("token", { projectId, ua, authVia, outcome: "invalid_client:bad_creds" });
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }
  if (body.get("grant_type") !== "authorization_code" || !body.get("code")) {
    oidcLog("token", { projectId, ua, authVia, outcome: "unsupported_grant_type" });
    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("oidc_auth_sessions")
    .select("id, identity_id, nonce, redirect_uri, status, expires_at")
    .eq("project_id", projectId)
    .eq("code_hash", sha256(body.get("code")!))
    .maybeSingle();

  if (!session || session.status !== "code_issued" || new Date(session.expires_at) < new Date()) {
    oidcLog("token", {
      projectId, ua, authVia, outcome: "invalid_grant",
      reason: !session ? "no_session_for_code" : session.status !== "code_issued" ? `status:${session.status}` : "expired",
    });
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }
  const sentRedirect = body.get("redirect_uri");
  if (sentRedirect && sentRedirect !== session.redirect_uri) {
    oidcLog("token", { projectId, ua, authVia, outcome: "invalid_grant:redirect_mismatch" });
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  const { data: identity } = await admin
    .from("identities")
    .select("id, phone, name, email, email_verified_at")
    .eq("id", session.identity_id!)
    .single();
  if (!identity) {
    oidcLog("token", { projectId, ua, authVia, outcome: "invalid_grant:no_identity" });
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  const accessToken = crypto.randomBytes(32).toString("hex");
  await admin
    .from("oidc_auth_sessions")
    .update({
      status: "consumed",
      code_hash: null,
      access_token_hash: sha256(accessToken),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // жизнь access token
    })
    .eq("id", session.id);

  const idToken = await signIdToken(oidc, buildClaims({ ...identity, emailVerified: !!identity.email_verified_at }), session.nonce);
  oidcLog("token", { projectId, ua, authVia, outcome: "ok", hasEmail: !!identity.email });

  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "openid profile phone email",
    id_token: idToken,
  });
}
