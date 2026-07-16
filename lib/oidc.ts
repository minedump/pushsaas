import crypto from "crypto";
import { SignJWT, importPKCS8, exportJWK } from "jose";
import { createAdminClient } from "@/lib/supabase/admin";

// OIDC-провайдер для входа покупателя InSales (и любого OIDC RP).
// Мультитенантность: issuer на проект — {APP_URL}/oidc/{projectId}.
// Находки стенда (2026-07-12): InSales требует userinfo_endpoint; принимает
// ID Token с одним phone_number (без email); token-auth = client_secret_basic.

export function issuerFor(projectId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  return `${base}/oidc/${projectId}`;
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// Структурные логи OIDC-флоу в проде — без секретов (код/токены/полный
// телефон никогда не попадают в лог). Нужны, чтобы разбирать перебои на
// стороне InSales (fetch discovery → тишина) по vercel logs без гадания.
export function oidcLog(tag: string, data: Record<string, unknown>) {
  console.log(`[oidc:${tag}]`, JSON.stringify(data));
}

// HMAC-подпись служебных параметров (continue-редирект после отскока).
// Ключ — секрет платформы; выделенная переменная с fallback на service key.
function hmacKey(): string {
  return process.env.OIDC_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "dev-secret";
}

export function signParam(value: string): string {
  return crypto.createHmac("sha256", hmacKey()).update(value).digest("hex").slice(0, 32);
}

export function verifyParam(value: string, sig: string): boolean {
  const expected = signParam(value);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export type OidcContext = {
  projectId: string;
  clientId: string;
  kid: string;
  isEnabled: boolean;
  config: {
    channels?: { push?: boolean; email?: boolean; telegram?: boolean; sms?: boolean };
    channel_order?: string[];
    sms_sender?: string;
    email_from?: string;
    hide_native_login_button?: boolean;
    auth_button_text?: string | null;
    auth_button_icon?: string | null;
    auth_button_color?: string | null;
    auth_button_size?: "s" | "m" | "l" | "xl" | null;
    auth_button_rounded?: boolean;
  };
  privateKeyPem: string;
  clientSecretHash: string;
  projectDomain: string | null;
};

export async function getOidcContext(projectId: string): Promise<OidcContext | null> {
  const admin = createAdminClient();
  const [{ data: client }, { data: secrets }, { data: project }] = await Promise.all([
    admin.from("oidc_clients").select("client_id, kid, is_enabled, config").eq("project_id", projectId).maybeSingle(),
    admin
      .from("project_secrets")
      .select("oidc_private_key_pem, oidc_client_secret_hash")
      .eq("project_id", projectId)
      .maybeSingle(),
    admin.from("projects").select("domain, is_active").eq("id", projectId).maybeSingle(),
  ]);
  if (!client || !secrets?.oidc_private_key_pem || !secrets?.oidc_client_secret_hash || !project?.is_active) return null;
  return {
    projectId,
    clientId: client.client_id,
    kid: client.kid,
    isEnabled: client.is_enabled,
    config: client.config || {},
    privateKeyPem: secrets.oidc_private_key_pem,
    clientSecretHash: secrets.oidc_client_secret_hash,
    projectDomain: project.domain || null,
  };
}

// Создаёт OIDC-конфигурацию проекта (или перевыпускает секрет).
// Возвращает client_secret в открытом виде — показывается владельцу ОДИН раз.
export async function ensureOidcClient(
  projectId: string,
  opts: { regenerateSecret?: boolean } = {}
): Promise<{ clientId: string; clientSecret: string | null }> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("oidc_clients")
    .select("client_id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (existing && !opts.regenerateSecret) return { clientId: existing.client_id, clientSecret: null };

  const clientSecret = "psss_" + crypto.randomBytes(24).toString("hex");

  if (existing) {
    await admin
      .from("project_secrets")
      .update({ oidc_client_secret_hash: sha256(clientSecret) })
      .eq("project_id", projectId);
    return { clientId: existing.client_id, clientSecret };
  }

  const clientId = "pss_" + crypto.randomBytes(6).toString("hex");
  const kid = "k" + crypto.randomBytes(4).toString("hex");
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  await admin.from("oidc_clients").insert({ project_id: projectId, client_id: clientId, kid });
  await admin
    .from("project_secrets")
    .upsert(
      { project_id: projectId, oidc_private_key_pem: pem, oidc_client_secret_hash: sha256(clientSecret) },
      { onConflict: "project_id" }
    );

  return { clientId, clientSecret };
}

export async function publicJwk(ctx: OidcContext) {
  // jose@6 по умолчанию импортирует non-extractable CryptoKey — exportJWK на
  // таком падает. Нужен именно extractable:true, раз собираемся его экспортировать.
  const key = await importPKCS8(ctx.privateKeyPem, "RS256", { extractable: true });
  const jwk = await exportJWK(key);
  return { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig", kid: ctx.kid };
}

export type IdentityClaims = {
  sub: string;
  phone_number?: string;
  phone_number_verified?: boolean;
  name?: string;
  email?: string;
  email_verified?: boolean;
};

// Отдаём в claims РОВНО тот ключ, что подтверждён кодом — никогда оба:
// флоу входа просит подтвердить либо телефон, либо email за один раз,
// никогда оба сразу, так что второе поле на identity (если оно вообще
// есть — например, email из вебхука заказа рядом с подтверждённым
// телефоном) остаётся непроверенным и в токен не идёт.
export function buildClaims(identity: {
  id: string;
  phone: string | null;
  name: string | null;
  email: string | null;
  emailVerified?: boolean;
}): IdentityClaims {
  return {
    sub: identity.id,
    ...(identity.phone ? { phone_number: "+" + identity.phone, phone_number_verified: true } : {}),
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.email && identity.emailVerified ? { email: identity.email, email_verified: true } : {}),
  };
}

export async function signIdToken(
  ctx: OidcContext,
  claims: IdentityClaims,
  nonce: string | null
): Promise<string> {
  const key = await importPKCS8(ctx.privateKeyPem, "RS256");
  return new SignJWT({ ...claims, ...(nonce ? { nonce } : {}) })
    .setProtectedHeader({ alg: "RS256", kid: ctx.kid, typ: "JWT" })
    .setIssuer(issuerFor(ctx.projectId))
    .setAudience(ctx.clientId)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

// Разбор клиентских кредов token-запроса: client_secret_basic или client_secret_post.
export function parseClientAuth(req: Request, body: URLSearchParams): { id: string; secret: string } {
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Basic ")) {
    const [id, secret] = Buffer.from(h.slice(6), "base64").toString().split(":");
    return { id: decodeURIComponent(id || ""), secret: decodeURIComponent(secret || "") };
  }
  return { id: body.get("client_id") || "", secret: body.get("client_secret") || "" };
}
