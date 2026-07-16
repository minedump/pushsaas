import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOneOff } from "@/lib/sender";
import { sha256 } from "@/lib/oidc";
import { checkRateLimit } from "@/lib/ratelimit";

// Public endpoint — called cross-origin from the client's own site by the
// embed widget. Keyed by projectId (like TryVice /api/widget/*). CORS-open.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function detectPlatform(ua: string): "ios" | "android" | "desktop" | "unknown" {
  if (!ua) return "unknown";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  if (/windows|macintosh|linux|cros/i.test(ua)) return "desktop";
  return "unknown";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { projectId, subscription, userAgent, deviceToken } = body || {};

  if (!projectId || !subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json({ error: "bad payload" }, { status: 400, headers: CORS });
  }

  const admin = createAdminClient();

  const { data: project } = await admin.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "unknown project" }, { status: 404, headers: CORS });
  }

  // защита от спама подписками с одного адреса (не мешает обычным пользователям)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const allowed = await checkRateLimit(`sub:${projectId}:${ip}`, 60_000, 20);
  if (!allowed) {
    return NextResponse.json({ error: "too many requests" }, { status: 429, headers: CORS });
  }

  const row = {
    project_id: projectId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    platform: detectPlatform(userAgent || ""),
    is_active: true,
  };

  // Устройство с валидным device_token: обновляем ЕГО строку даже при ротации
  // endpoint браузером — так сохраняются id подписчика и привязки к телефону.
  if (deviceToken) {
    const { data: byToken } = await admin
      .from("subscribers")
      .select("id, endpoint")
      .eq("project_id", projectId)
      .eq("device_token_hash", sha256(deviceToken))
      .maybeSingle();
    if (byToken) {
      if (byToken.endpoint !== subscription.endpoint) {
        // endpoint переехал: убираем возможный дубль, севший на новый endpoint
        await admin.from("subscribers").delete().eq("endpoint", subscription.endpoint).neq("id", byToken.id);
      }
      const { error: updErr } = await admin.from("subscribers").update(row).eq("id", byToken.id);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500, headers: CORS });
      return NextResponse.json({ ok: true }, { headers: CORS });
    }
  }

  // was this endpoint already known? (to fire the welcome push only once)
  // ВАЖНО: только старые колонки — путь подписки не должен зависеть от 0003
  const { data: existing } = await admin
    .from("subscribers")
    .select("id")
    .eq("endpoint", subscription.endpoint)
    .maybeSingle();

  const { data: saved, error } = await admin
    .from("subscribers")
    .upsert(row, { onConflict: "endpoint" })
    .select("id, endpoint, p256dh, auth")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });

  // Паспорт устройства: выдаём токен один раз, храним только sha256.
  // Отдельный best-effort запрос: до миграции 0003 колонки нет — молча
  // пропускаем, подписка и welcome работают как раньше.
  let issuedToken: string | null = null;
  if (saved) {
    const { data: tok, error: tokErr } = await admin
      .from("subscribers")
      .select("device_token_hash")
      .eq("id", saved.id)
      .maybeSingle();
    if (!tokErr && !tok?.device_token_hash) {
      issuedToken = "pdt_" + crypto.randomBytes(24).toString("hex");
      const { error: setErr } = await admin
        .from("subscribers")
        .update({ device_token_hash: sha256(issuedToken) })
        .eq("id", saved.id);
      if (setErr) issuedToken = null;
    }
  }

  // welcome automation — fire once, for genuinely new subscribers only
  if (!existing && saved) {
    const { data: welcome } = await admin
      .from("automations")
      .select("id, title, body, click_url, delay_minutes, config")
      .eq("project_id", projectId)
      .eq("type", "welcome")
      .eq("is_enabled", true)
      .maybeSingle();
    if (welcome?.title && welcome?.body) {
      const actions = (welcome.config as { actions?: { title: string; url: string }[] } | null)?.actions;
      if (welcome.delay_minutes > 0) {
        // отложенный welcome — та же очередь, что у событийных автоматизаций
        await admin.from("automation_jobs").insert({
          project_id: projectId,
          automation_id: welcome.id,
          subscriber_id: saved.id,
          fire_at: new Date(Date.now() + welcome.delay_minutes * 60_000).toISOString(),
        });
      } else {
        await sendOneOff(projectId, saved, { title: welcome.title, body: welcome.body, url: welcome.click_url || "/", actions });
      }
    }
  }

  return NextResponse.json({ ok: true, ...(issuedToken ? { deviceToken: issuedToken } : {}) }, { headers: CORS });
}
