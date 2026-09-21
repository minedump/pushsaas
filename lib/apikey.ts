import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { API_SCOPES, type ApiScope } from "@/lib/apiScopes";

export { API_SCOPES, type ApiScope };

// Generate a new key. The raw value is shown to the user ONCE; we store only
// its sha256 hash + a visible prefix.
export function generateApiKey() {
  const raw = "wpk_" + crypto.randomBytes(24).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 12);
  return { raw, hash, prefix };
}

export function hashApiKey(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// Pull the raw API key from any supported place:
//   · Authorization: Bearer <key>
//   · Authorization: Basic base64(<key>:<anything>)   — key in the URL creds
//   · X-Api-Key: <key>
//   · ?key=<key>                                       — for webhooks
export function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  if (auth.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
      const user = decoded.split(":")[0];
      if (user) return user;
    } catch {
      /* ignore */
    }
  }
  const header = req.headers.get("x-api-key");
  if (header) return header.trim();
  try {
    const q = new URL(req.url).searchParams.get("key");
    if (q) return q.trim();
  } catch {
    /* ignore */
  }
  return null;
}

export type ApiKeyAuth = { projectId: string; scopes: ApiScope[] };

export function hasScope(key: ApiKeyAuth, scope: ApiScope): boolean {
  return key.scopes.includes(scope);
}

// Resolve an incoming request's API key -> {projectId, scopes} (or null).
export async function authenticateApiKey(req: Request): Promise<ApiKeyAuth | null> {
  const key = extractApiKey(req);
  if (!key) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id, project_id, is_active, scopes")
    .eq("key_hash", hashApiKey(key))
    .maybeSingle();

  if (!data || !data.is_active) return null;
  await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { projectId: data.project_id, scopes: (data.scopes as ApiScope[] | null) || [] };
}

export type ApiKeyContext = ApiKeyAuth & { smsProvider: string | null; emailProvider: string | null };

// Same as authenticateApiKey, but also returns which sms/email provider is
// pinned to this key (chosen at creation, see app/admin/projects/[id]/api) —
// needed by /api/v1/campaigns to pick the right provider for sms/email sends.
// best-effort: sms_provider/email_provider — колонки миграции 0019, scopes —
// миграция 0095.
export async function authenticateApiKeyFull(req: Request): Promise<ApiKeyContext | null> {
  const key = extractApiKey(req);
  if (!key) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_keys")
    .select("id, project_id, is_active, sms_provider, email_provider, scopes")
    .eq("key_hash", hashApiKey(key))
    .maybeSingle();

  if (error || !data) {
    const { data: basic } = await admin.from("api_keys").select("id, project_id, is_active").eq("key_hash", hashApiKey(key)).maybeSingle();
    if (!basic || !basic.is_active) return null;
    await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", basic.id);
    return { projectId: basic.project_id, scopes: [], smsProvider: null, emailProvider: null };
  }
  if (!data.is_active) return null;
  await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return {
    projectId: data.project_id,
    scopes: (data.scopes as ApiScope[] | null) || [],
    smsProvider: data.sms_provider,
    emailProvider: data.email_provider,
  };
}
