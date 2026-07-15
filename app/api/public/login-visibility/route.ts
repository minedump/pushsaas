import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Public, read-only decision endpoint: should the merchant's native InSales
// "Войти через <наше приложение>" social-login button be shown on THIS device?
//
//   require_phone_verification ON (secure default) — always show: login will
//     work regardless (falls through to email/telegram/sms if this device
//     isn't push-linked yet).
//   require_phone_verification OFF — show ONLY if this exact device already
//     has a phone linked (identity_devices row) — otherwise login would be an
//     instant, confusing refusal (device_not_linked), so hiding it is kinder.
//
// Reveals only a boolean — never which phone, never whose identity.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  const { projectId, endpoint } = (await req.json().catch(() => ({}))) as { projectId?: string; endpoint?: string };
  if (!projectId) return NextResponse.json({ show: false }, { headers: CORS });

  const admin = createAdminClient();
  const { data: oidc } = await admin
    .from("oidc_clients")
    .select("is_enabled, config")
    .eq("project_id", projectId)
    .maybeSingle();

  // Наш вход не настроен/выключен — НЕ вмешиваемся: в блоке соцвхода могут
  // быть чужие кнопки (VK ID, Яндекс, другой OIDC-провайдер), прятать их нельзя.
  if (!oidc?.is_enabled) return NextResponse.json({ show: true }, { headers: CORS });
  if (oidc.config?.require_phone_verification !== false) {
    return NextResponse.json({ show: true }, { headers: CORS });
  }

  // toggle OFF — only show if THIS device already has any phone linked
  if (!endpoint) return NextResponse.json({ show: false }, { headers: CORS });

  const { data: subscriber } = await admin
    .from("subscribers")
    .select("id")
    .eq("project_id", projectId)
    .eq("endpoint", endpoint)
    .eq("is_active", true)
    .maybeSingle();
  if (!subscriber) return NextResponse.json({ show: false }, { headers: CORS });

  const { data: link } = await admin
    .from("identity_devices")
    .select("identity_id")
    .eq("subscriber_id", subscriber.id)
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ show: !!link }, { headers: CORS });
}
