import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import { checkRateLimit } from "@/lib/ratelimit";
import { sha256 } from "@/lib/oidc";

// Public "enrich my own subscription" endpoint — called by the merchant's OWN
// theme JS (window.sendera.identify({phone,email,name,insales_client_id})),
// e.g. after ajaxAPI.shop.client.get() for an authenticated InSales customer.
//
// This does NOT create new trust. Linking a phone OR email to a device — the
// thing that lets that device receive that key's login codes — only ever
// happens through a real OTP in the /oidc/*/auth flow (see lib/otp.sendOtp,
// keyed by phone or by email symmetrically). Everything below happens on the
// IDENTITY (the person), not the device — ONLY if this exact device is
// already linked to an identity where the SPECIFIC key sent (phone or email)
// was itself the one verified — phone via phone_verified_at, email via
// email_verified_at. Sending a phone/email this device never verified
// matches nothing — silently, no error, no new binding; the caller just
// doesn't get what it didn't earn. Once matched:
//   - name refreshes
//   - insales_client_id refreshes (the external CRM id, e.g. InSales
//     client.id; this is a property of the PERSON, not of each individual
//     device, so it does NOT live on subscribers.attributes)
//   - the OTHER key (the one not used to match) also gets filled in as an
//     unverified association, symmetric in both directions: matched via
//     phone → email fills in; matched via email → phone fills in. Neither
//     direction sets the corresponding *_verified_at, so it never grants new
//     trust — same as before, just now symmetric instead of phone-only.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  const { projectId, endpoint, deviceToken, phone, email, name, insales_client_id, insalesClientId } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    endpoint?: string;
    deviceToken?: string;
    phone?: string;
    email?: string;
    name?: string;
    insales_client_id?: string;
    insalesClientId?: string;
  };

  if (!projectId || (!endpoint && !deviceToken)) {
    return NextResponse.json({ error: "projectId and (endpoint or deviceToken) required" }, { status: 400, headers: CORS });
  }

  const admin = createAdminClient();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const allowed = await checkRateLimit(`identify:${projectId}:${ip}`, 60_000, 20);
  if (!allowed) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: CORS });

  // Устройство — по push-endpoint, если есть, иначе по device_token (без
  // push-подписки, см. migration 0071 и /api/public/register-device).
  let subscriber: { id: string; timezone: string | null } | null = null;
  if (endpoint) {
    const { data } = await admin
      .from("subscribers")
      .select("id, timezone")
      .eq("project_id", projectId)
      .eq("endpoint", endpoint)
      .eq("is_active", true)
      .maybeSingle();
    subscriber = data;
  }
  if (!subscriber && deviceToken) {
    const { data } = await admin
      .from("subscribers")
      .select("id, timezone")
      .eq("project_id", projectId)
      .eq("device_token_hash", sha256(deviceToken))
      .eq("is_active", true)
      .maybeSingle();
    subscriber = data;
  }
  if (!subscriber) return NextResponse.json({ error: "unknown device — subscribe or register first" }, { status: 404, headers: CORS });
  const subscriberId = subscriber.id;
  const extId = (insales_client_id ?? insalesClientId ?? "").toString().trim();

  const cleanEmail = (email || "").trim().toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ? cleanEmail : null;
  const cleanName = name?.trim() || undefined;
  const phoneDigits = phone ? normalizePhone(phone) : null;

  // Матчим строго по ключу, который сам был доказан для ЭТОГО устройства —
  // подтверждённый телефон, ИЛИ (независимо) подтверждённый email. Один
  // запрос с caller'ом, отправившим И phone И email, не даёт "два шанса" на
  // один и тот же чужой аккаунт — каждая ветка бьёт только в свою identity и
  // требует свою собственную честную привязку устройства. matchedVia говорит
  // вызывающему коду, какой ключ был доказан — чтобы дозаписать именно ДРУГОЙ.
  async function verifiedLinkedIdentity(): Promise<{ id: string; matchedVia: "phone" | "email" } | null> {
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
        if (link) return { id: identity.id, matchedVia: "phone" };
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
        if (link) return { id: identity.id, matchedVia: "email" };
      }
    }
    return null;
  }

  let identityRefreshed = false;
  const identity = await verifiedLinkedIdentity();
  if (identity) {
    // дозаписываем ДРУГОЙ ключ (не тот, которым матчились) как простую
    // ассоциацию — *_verified_at при этом не трогаем, новое доверие не
    // возникает, симметрично в обе стороны.
    const patch: Record<string, string> = {};
    if (identity.matchedVia === "phone" && validEmail) patch.email = validEmail;
    if (identity.matchedVia === "email" && phoneDigits) patch.phone = phoneDigits;
    if (cleanName) patch.name = cleanName;
    if (extId) patch.insales_client_id = extId;
    // Часовой пояс — с устройства, которым матчились (наиболее «текущий»
    // источник); та же логика best-effort, что и у имени.
    if (subscriber.timezone) patch.timezone = subscriber.timezone;
    if (Object.keys(patch).length) {
      await admin
        .from("identities")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", identity.id);
    }
    await admin.from("identity_devices").update({ last_used_at: new Date().toISOString() }).eq("identity_id", identity.id).eq("subscriber_id", subscriberId);
    identityRefreshed = true;

    // name — как и insales_client_id, свойство ЧЕЛОВЕКА, а не устройства, но
    // подстановка {name} в тексте кампаний читает subscribers.attributes (на
    // уровне устройства) — поэтому дублируем его во ВСЕ устройства этой
    // identity, а не только в текущее.
    if (cleanName) {
      const { data: links } = await admin.from("identity_devices").select("subscriber_id").eq("identity_id", identity.id);
      const subIds = [...new Set((links || []).map((l) => l.subscriber_id))];
      if (subIds.length) {
        const { data: subs } = await admin.from("subscribers").select("id, attributes").in("id", subIds);
        for (const s of subs || []) {
          const attrs = { ...((s.attributes as Record<string, unknown> | null) || {}), name: cleanName };
          await admin.from("subscribers").update({ attributes: attrs }).eq("id", s.id);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, identityRefreshed }, { headers: CORS });
}
