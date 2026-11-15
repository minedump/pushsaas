import crypto from "crypto";
import { SignJWT, importPKCS8, exportJWK } from "jose";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveLoginStyle, type LoginStyleConfig } from "@/lib/login-style";

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

// HMAC-подпись служебных параметров (sid/sig сессии входа, continue-редирект,
// device-recognition кука). Раньше при отсутствии OIDC_STATE_SECRET тихо
// падали на SUPABASE_SERVICE_ROLE_KEY (переиспользование ключа не по
// назначению — service key даёт полный обход RLS) либо на захардкоженный
// "dev-secret" (публичный литерал прямо в исходниках). Секьюрити-аудит
// (2026-09-01): оба fallback'а убраны — без переменной подписывать нечем,
// падаем сразу и явно, а не молча слабым ключом.
function hmacKey(): string {
  const key = process.env.OIDC_STATE_SECRET;
  if (!key) throw new Error("OIDC_STATE_SECRET не задан — им подписываются sid/sig сессии входа и device-recognition кука");
  return key;
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
    auth_button_text?: string | null;
    auth_button_icon?: string | null;
    auth_button_color?: string | null;
    auth_button_size?: "s" | "m" | "l" | "xl" | null;
    auth_button_rounded?: boolean;
    // куда вернуть покупателя, если ни один способ получить код не сработал (адрес на сайте проекта или путь вида /page/x)
    auth_failed_url?: string | null;
  };
  privateKeyPem: string;
  clientSecretHash: string;
  projectDomain: string | null;
  logoUrl: string | null;
  // иконки вкладки браузера: фавиконы проекта (manifest_config), без них — логотип проекта
  favicons: { ico: string | null; png96: string | null; apple: string | null };
  loginStyle: LoginStyleConfig;
};

// Адрес возврата при неудачном входе. Вернуть можно только на сайт самого проекта (его домен или поддомен):
// иначе настройка стала бы открытым перенаправлением на чужие сайты.
function hostOnProjectDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith("." + d);
}

// Проверка и приведение введённого в настройках адреса. Пустое значение = стандартная страница входа магазина.
export function normalizeAuthFailedUrl(raw: unknown, domain: string | null): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { ok: true, value: null };
  if (!domain) return { ok: false, error: "Сначала укажите домен сайта в настройках проекта" };
  // путь внутри сайта: /page/avtorizatsiya-po-parolyu
  if (s.startsWith("/") && !s.startsWith("//") && !/[\s\\]/.test(s)) return { ok: true, value: s };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "Введите полный адрес страницы, например https://" + domain + "/page/login" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Адрес должен начинаться с https://" };
  if (u.username || u.password) return { ok: false, error: "Адрес не должен содержать логин и пароль" };
  if (!hostOnProjectDomain(u.hostname, domain)) return { ok: false, error: `Страница должна быть на сайте проекта (${domain})` };
  return { ok: true, value: u.toString() };
}

// Куда фактически вернуть покупателя. Домен мог смениться после сохранения настройки, поэтому адрес проверяем заново:
// не прошёл проверку — стандартная страница входа магазина.
export function authFailedTarget(domain: string, stored: string | null | undefined): string {
  const fallback = `https://${domain}/client_account/session/new?pss_auth_failed=1`;
  const n = normalizeAuthFailedUrl(stored, domain);
  if (!n.ok || !n.value) return fallback;
  return n.value.startsWith("/") ? `https://${domain}${n.value}` : n.value;
}

export async function getOidcContext(projectId: string): Promise<OidcContext | null> {
  const admin = createAdminClient();
  const [{ data: client }, { data: secrets }, { data: project }] = await Promise.all([
    admin.from("oidc_clients").select("client_id, kid, is_enabled, config").eq("project_id", projectId).maybeSingle(),
    admin
      .from("project_secrets")
      .select("oidc_private_key_pem, oidc_client_secret_hash")
      .eq("project_id", projectId)
      .maybeSingle(),
    admin.from("projects").select("domain, is_active, logo_url, manifest_config").eq("id", projectId).maybeSingle(),
  ]);
  if (!client?.client_id || !client.kid || !secrets?.oidc_private_key_pem || !secrets?.oidc_client_secret_hash || !project?.is_active) return null;
  return {
    projectId,
    clientId: client.client_id,
    kid: client.kid,
    isEnabled: client.is_enabled,
    config: client.config || {},
    privateKeyPem: secrets.oidc_private_key_pem,
    clientSecretHash: secrets.oidc_client_secret_hash,
    projectDomain: project.domain || null,
    logoUrl: project.logo_url || null,
    favicons: {
      ico: (project.manifest_config as { icons?: { ico?: string } } | null)?.icons?.ico || null,
      png96: (project.manifest_config as { icons?: { f96?: string } } | null)?.icons?.f96 || null,
      apple: (project.manifest_config as { icons?: { apple?: string } } | null)?.icons?.apple || null,
    },
    loginStyle: resolveLoginStyle(client.config?.login_style),
  };
}

// Создаёт OIDC-конфигурацию проекта (или перевыпускает токен приложения).
// Токен (client_secret) хранится открыто в project_secrets.oidc_client_secret и всегда виден владельцу,
// для проверки при входе по-прежнему используется его хэш.
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

  // запись без client_id — заготовка с одними подписями отправителя (миграция 0108)
  if (existing?.client_id && !opts.regenerateSecret) return { clientId: existing.client_id, clientSecret: null };

  const clientSecret = "psss_" + crypto.randomBytes(24).toString("hex");

  if (existing?.client_id) {
    await admin
      .from("project_secrets")
      .update({ oidc_client_secret_hash: sha256(clientSecret), oidc_client_secret: clientSecret })
      .eq("project_id", projectId);
    return { clientId: existing.client_id, clientSecret };
  }

  const clientId = "pss_" + crypto.randomBytes(6).toString("hex");
  const kid = "k" + crypto.randomBytes(4).toString("hex");
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  // is_enabled: false явно — вход не должен стать доступен покупателям, пока
  // админ не настроит хотя бы один рабочий канал и не включит его сам
  // (см. «Статус входа» в AuthSettings.tsx и проверку в /api/admin/oidc/settings).
  // Все каналы каскада по умолчанию выключены, как и сам вход
  const offChannels = { push: false, email: false, telegram: false, sms: false };
  if (existing) {
    const { data: cur } = await admin.from("oidc_clients").select("config").eq("project_id", projectId).maybeSingle();
    await admin
      .from("oidc_clients")
      .update({ client_id: clientId, kid, is_enabled: false, config: { ...(cur?.config || {}), channels: offChannels } })
      .eq("project_id", projectId);
  } else {
    await admin.from("oidc_clients").insert({ project_id: projectId, client_id: clientId, kid, is_enabled: false, config: { channels: offChannels } });
  }
  await admin
    .from("project_secrets")
    .upsert(
      { project_id: projectId, oidc_private_key_pem: pem, oidc_client_secret_hash: sha256(clientSecret), oidc_client_secret: clientSecret },
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
  given_name?: string;
  family_name?: string;
  middle_name?: string;
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
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  email: string | null;
  emailVerified?: boolean;
}): IdentityClaims {
  return {
    sub: identity.id,
    ...(identity.phone ? { phone_number: "+" + identity.phone, phone_number_verified: true } : {}),
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.first_name ? { given_name: identity.first_name } : {}),
    ...(identity.last_name ? { family_name: identity.last_name } : {}),
    ...(identity.middle_name ? { middle_name: identity.middle_name } : {}),
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
