import { NextResponse } from "next/server";
import { getOidcContext, issuerFor } from "@/lib/oidc";

// /.well-known/openid-configuration (rewrite в next.config.mjs)
// Без логирования успешных обращений — InSales дёргает discovery очень часто
// (кэшируется на 5 минут, см. заголовок ниже), логи на каждый хит только шумят.
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  const oidc = await getOidcContext(projectId);
  if (!oidc || !oidc.isEnabled) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const issuer = issuerFor(projectId);
  return NextResponse.json(
    {
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
    },
    // Содержимое меняется только при перевыпуске секрета/смене домена —
    // кэшируемо. В логах видно, что InSales дёргает discovery по многу раз
    // подряд без кэша; это должно срезать часть лишних round-trip'ов.
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } }
  );
}
