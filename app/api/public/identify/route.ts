import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import { checkRateLimit } from "@/lib/ratelimit";

// Public "trust the storefront session" identity linking — called by the
// merchant's OWN theme JS after ajaxAPI.shop.client.get() (InSales), via
// window.PushSaaS.identify({phone,email,name}) in the embed widget.
//
// Two distinct cases:
//   1. This device is ALREADY linked to this exact phone (it went through a
//      real OTP at some point) — always allowed, this call is just refreshing
//      email/name on an identity we've already honestly verified. No new trust
//      is being granted, so the toggle below doesn't apply.
//   2. This would be a NEW (phone, device) claim — gated by the project's
//      `require_phone_verification` toggle (default true = OFF/disabled here).
//      Turning it off means we trust whatever phone is POSTed here WITHOUT our
//      own OTP check — since this endpoint is public and keyed only by
//      projectId, anyone who can reach it can claim ANY phone for their own
//      push device. A poisoned identity_devices row then receives that
//      phone's login codes (account takeover) — hence the secure default.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  const { projectId, endpoint, phone, email, name } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    endpoint?: string;
    phone?: string;
    email?: string;
    name?: string;
  };

  if (!projectId || !endpoint || !phone) {
    return NextResponse.json({ error: "projectId, endpoint, phone required" }, { status: 400, headers: CORS });
  }

  const admin = createAdminClient();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const allowed = await checkRateLimit(`identify:${projectId}:${ip}`, 60_000, 20);
  if (!allowed) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: CORS });

  const { data: oidc } = await admin
    .from("oidc_clients")
    .select("is_enabled, config")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!oidc?.is_enabled) {
    return NextResponse.json({ error: "phone auth not enabled for this project" }, { status: 403, headers: CORS });
  }

  const phoneDigits = normalizePhone(phone);
  if (!phoneDigits) return NextResponse.json({ error: "invalid phone" }, { status: 400, headers: CORS });

  const { data: subscriber } = await admin
    .from("subscribers")
    .select("id")
    .eq("project_id", projectId)
    .eq("endpoint", endpoint)
    .eq("is_active", true)
    .maybeSingle();
  if (!subscriber) return NextResponse.json({ error: "unknown device — subscribe first" }, { status: 404, headers: CORS });

  // случай 1: устройство уже честно привязано именно к этому телефону —
  // это просто обновление email/имени, доверие не расширяется.
  const { data: existingIdentity } = await admin
    .from("identities")
    .select("id")
    .eq("project_id", projectId)
    .eq("phone", phoneDigits)
    .not("phone_verified_at", "is", null)
    .maybeSingle();
  let alreadyLinked = false;
  if (existingIdentity) {
    const { data: link } = await admin
      .from("identity_devices")
      .select("identity_id")
      .eq("identity_id", existingIdentity.id)
      .eq("subscriber_id", subscriber.id)
      .maybeSingle();
    alreadyLinked = !!link;
  }

  // случай 2: новая заявка на связку — решает тумблер проекта.
  if (!alreadyLinked && oidc.config?.require_phone_verification !== false) {
    return NextResponse.json({ error: "verification_required" }, { status: 403, headers: CORS });
  }

  const cleanEmail = (email || "").trim().toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ? cleanEmail : null;

  const baseRow = {
    project_id: projectId,
    phone: phoneDigits,
    phone_verified_at: new Date().toISOString(),
    ...(validEmail ? { email: validEmail } : {}),
    ...(name?.trim() ? { name: name.trim() } : {}),
    updated_at: new Date().toISOString(),
  };
  // best-effort: verification_source (миграция 0010, чисто аудиторное поле) —
  // если колонки ещё нет, откатываемся на upsert без него, а не 500-им весь запрос.
  let identity = null as { id: string } | null;
  {
    const { data, error } = await admin
      .from("identities")
      .upsert({ ...baseRow, verification_source: "insales_session" }, { onConflict: "project_id,phone" })
      .select("id")
      .single();
    if (!error) identity = data;
    else {
      const { data: fallback } = await admin
        .from("identities")
        .upsert(baseRow, { onConflict: "project_id,phone" })
        .select("id")
        .single();
      identity = fallback;
    }
  }
  if (!identity) return NextResponse.json({ error: "identify failed" }, { status: 500, headers: CORS });

  await admin.from("identity_devices").upsert(
    { identity_id: identity.id, subscriber_id: subscriber.id, last_used_at: new Date().toISOString() },
    { onConflict: "identity_id,subscriber_id" }
  );

  return NextResponse.json({ ok: true }, { headers: CORS });
}
