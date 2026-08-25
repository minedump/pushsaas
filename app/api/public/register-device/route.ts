import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/oidc";
import { checkRateLimit } from "@/lib/ratelimit";

// Заводит "анонимную" (без push) строку subscribers для устройства, которое
// ещё не подписалось на push, но уже может быть трекнуто/обогащено —
// sendera.event()/sendera.identify() падают в /api/public/event и
// /api/public/identify, которым теперь для этого достаточно device_token,
// см. миграцию 0071. Отдельно от /api/public/subscribe (та требует
// настоящую PushSubscription) и от /api/public/recognize (та только ЧИТАЕТ,
// ничего не пишет — см. её собственный комментарий, менять эту гарантию
// нельзя). Идемпотентно: с уже известным deviceToken просто подтверждает,
// что строка есть, — ничего не плодит и не перевыпускает токен.
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
  const { projectId, deviceToken, userAgent, timezone } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    deviceToken?: string;
    userAgent?: string;
    timezone?: string;
  };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400, headers: CORS });

  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404, headers: CORS });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const allowed = await checkRateLimit(`device:${projectId}:${ip}`, 60_000, 20);
  if (!allowed) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: CORS });

  if (deviceToken) {
    const { data: existing } = await admin
      .from("subscribers")
      .select("id")
      .eq("project_id", projectId)
      .eq("device_token_hash", sha256(deviceToken))
      .maybeSingle();
    if (existing) return NextResponse.json({ ok: true }, { headers: CORS });
  }

  const issuedToken = "pdt_" + crypto.randomBytes(24).toString("hex");
  const row: Record<string, unknown> = {
    project_id: projectId,
    platform: detectPlatform(userAgent || ""),
    is_active: true,
    device_token_hash: sha256(issuedToken),
  };
  if (typeof timezone === "string" && timezone.length < 100) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      row.timezone = timezone;
    } catch {}
  }

  const { error } = await admin.from("subscribers").insert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });

  return NextResponse.json({ ok: true, deviceToken: issuedToken }, { headers: CORS });
}
