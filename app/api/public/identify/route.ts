import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import { checkRateLimit } from "@/lib/ratelimit";

// Public "enrich my own subscription" endpoint — called by the merchant's OWN
// theme JS (window.PushSaaS.identify({phone,email,name,external_id})), e.g.
// after ajaxAPI.shop.client.get() for an authenticated InSales customer.
//
// This does NOT create new trust. Linking a phone OR email to a device — the
// thing that lets that device receive that key's login codes — only ever
// happens through a real OTP in the /oidc/*/auth flow (see lib/otp.sendOtp,
// keyed by phone or by email symmetrically). Two things happen here:
//   1. name refreshes on the identity — ONLY if this exact device is already
//      linked to an identity where the SPECIFIC key sent (phone or email)
//      was itself the one verified — phone via phone_verified_at, email via
//      email_verified_at. Sending a phone this device never verified, or an
//      email this device never verified, matches nothing — silently, no
//      error, no new binding; the caller just doesn't get what it didn't earn.
//   2. external_id refreshes on this device's own attributes — under the
//      SAME gate as name: only if the sent key was verified for this device.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  const { projectId, endpoint, phone, email, name, external_id, externalId } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    endpoint?: string;
    phone?: string;
    email?: string;
    name?: string;
    external_id?: string;
    externalId?: string;
  };

  if (!projectId || !endpoint) {
    return NextResponse.json({ error: "projectId, endpoint required" }, { status: 400, headers: CORS });
  }

  const admin = createAdminClient();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const allowed = await checkRateLimit(`identify:${projectId}:${ip}`, 60_000, 20);
  if (!allowed) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: CORS });

  const { data: subscriber } = await admin
    .from("subscribers")
    .select("id, attributes")
    .eq("project_id", projectId)
    .eq("endpoint", endpoint)
    .eq("is_active", true)
    .maybeSingle();
  if (!subscriber) return NextResponse.json({ error: "unknown device — subscribe first" }, { status: 404, headers: CORS });
  const subscriberId = subscriber.id;
  const extId = (external_id ?? externalId ?? "").toString().trim();

  const cleanEmail = (email || "").trim().toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ? cleanEmail : null;
  const cleanName = name?.trim() || undefined;
  const phoneDigits = phone ? normalizePhone(phone) : null;

  // Матчим строго по ключу, который сам был доказан для ЭТОГО устройства —
  // подтверждённый телефон, ИЛИ (независимо) подтверждённый email — той же
  // веткой каскада входа, что и телефон, просто по другому ключу. Один
  // запрос с caller'ом, отправившим И phone И email, не даёт "два шанса" на
  // один и тот же чужой аккаунт — каждая ветка бьёт только в свою identity и
  // требует свою собственную честную привязку устройства.
  async function verifiedLinkedIdentity(): Promise<{ id: string } | null> {
    if (phoneDigits) {
      const { data: identity } = await admin
        .from("identities")
        .select("id")
        .eq("project_id", projectId)
        .eq("phone", phoneDigits)
        .not("phone_verified_at", "is", null)
        .maybeSingle();
      if (identity) {
        const { data: link } = await admin
          .from("identity_devices")
          .select("identity_id")
          .eq("identity_id", identity.id)
          .eq("subscriber_id", subscriberId)
          .maybeSingle();
        if (link) return identity;
      }
    }
    if (validEmail) {
      const { data: identity } = await admin
        .from("identities")
        .select("id")
        .eq("project_id", projectId)
        .eq("email", validEmail)
        .not("email_verified_at", "is", null)
        .maybeSingle();
      if (identity) {
        const { data: link } = await admin
          .from("identity_devices")
          .select("identity_id")
          .eq("identity_id", identity.id)
          .eq("subscriber_id", subscriberId)
          .maybeSingle();
        if (link) return identity;
      }
    }
    return null;
  }

  let identityRefreshed = false;
  const identity = await verifiedLinkedIdentity();
  if (identity) {
    // email пишем сюда только если match произошёл по телефону (email тогда
    // ещё не доказан для этой identity — как и раньше, просто ассоциация).
    // При match по email — он и так уже здесь, дописывать нечего.
    const emailPatch = phoneDigits && validEmail ? { email: validEmail } : {};
    if (cleanName || Object.keys(emailPatch).length) {
      await admin
        .from("identities")
        .update({ ...emailPatch, ...(cleanName ? { name: cleanName } : {}), updated_at: new Date().toISOString() })
        .eq("id", identity.id);
    }
    await admin.from("identity_devices").update({ last_used_at: new Date().toISOString() }).eq("identity_id", identity.id).eq("subscriber_id", subscriberId);
    if (extId) {
      const merged = { ...((subscriber.attributes as object) || {}), external_id: extId };
      await admin.from("subscribers").update({ attributes: merged }).eq("id", subscriberId);
    }
    identityRefreshed = true;
  }

  return NextResponse.json({ ok: true, identityRefreshed }, { headers: CORS });
}
