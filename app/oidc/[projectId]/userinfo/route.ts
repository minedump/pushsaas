import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256, buildClaims, oidcLog } from "@/lib/oidc";

// Userinfo endpoint — ОБЯЗАТЕЛЕН: Ruby-клиент InSales вызывает его безусловно
// после валидации ID Token (без него — 500 на их стороне; находка стенда).
async function handle(req: Request, projectId: string, bodyToken?: string) {
  const ua = req.headers.get("user-agent") || "";
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const token = bearer || bodyToken || "";
  if (!token) {
    oidcLog("userinfo", { projectId, ua, outcome: "no_token" });
    return unauthorized();
  }

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("oidc_auth_sessions")
    .select("identity_id, expires_at, status")
    .eq("project_id", projectId)
    .eq("access_token_hash", sha256(token))
    .maybeSingle();
  if (!session || session.status !== "consumed" || new Date(session.expires_at) < new Date()) {
    oidcLog("userinfo", { projectId, ua, outcome: "invalid_token" });
    return unauthorized();
  }

  const { data: identity } = await admin
    .from("identities")
    .select("id, phone, name, email")
    .eq("id", session.identity_id!)
    .single();
  if (!identity) {
    oidcLog("userinfo", { projectId, ua, outcome: "no_identity" });
    return unauthorized();
  }

  oidcLog("userinfo", { projectId, ua, outcome: "ok" });
  return NextResponse.json(buildClaims(identity));
}

function unauthorized() {
  return NextResponse.json(
    { error: "invalid_token" },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' } }
  );
}

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  return handle(req, projectId);
}

export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  const body = new URLSearchParams(await req.text().catch(() => ""));
  return handle(req, projectId, body.get("access_token") || undefined);
}
