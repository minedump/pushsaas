import { NextResponse } from "next/server";
import { getOidcContext, issuerFor, oidcLog } from "@/lib/oidc";

// /.well-known/openid-configuration (rewrite в next.config.mjs)
export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  const oidc = await getOidcContext(projectId);
  oidcLog("discovery", { projectId, found: !!oidc, ua: req.headers.get("user-agent") || "" });
  if (!oidc || !oidc.isEnabled) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const issuer = issuerFor(projectId);
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    // ОБЯЗАТЕЛЕН для InSales (Ruby openid_connect падает без него) — находка стенда
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    grant_types_supported: ["authorization_code"],
    scopes_supported: ["openid", "profile", "email", "phone"],
    claims_supported: [
      "iss", "sub", "aud", "exp", "iat", "nonce",
      "phone_number", "phone_number_verified", "name", "email", "email_verified",
    ],
  });
}
