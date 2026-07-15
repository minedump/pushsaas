import { NextResponse } from "next/server";
import { getOidcContext, publicJwk, oidcLog } from "@/lib/oidc";

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  const oidc = await getOidcContext(projectId);
  if (!oidc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const jwk = await publicJwk(oidc);
    oidcLog("jwks", { projectId, ua: req.headers.get("user-agent") || "", ok: true });
    return NextResponse.json({ keys: [jwk] });
  } catch (e) {
    oidcLog("jwks:error", { projectId, message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
