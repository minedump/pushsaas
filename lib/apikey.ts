import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

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

// Resolve an incoming request's API key -> projectId (or null).
export async function authenticateApiKey(req: Request): Promise<string | null> {
  const key = extractApiKey(req);
  if (!key) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id, project_id, is_active")
    .eq("key_hash", hashApiKey(key))
    .maybeSingle();

  if (!data || !data.is_active) return null;
  await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data.project_id;
}
