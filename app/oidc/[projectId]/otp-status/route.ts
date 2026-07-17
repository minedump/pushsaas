import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyParam } from "@/lib/oidc";
import { checkSmsDelivery } from "@/lib/otp/sms";
import { checkSmscDelivery } from "@/lib/otp/smsc";
import { needsDeliveryPoll } from "@/lib/otp/providers";

// Опрашивается со страницы кода (см. codeForm в ../auth/route.ts) для любого
// (channel, provider), которому это реально нужно (см. needsDeliveryPoll) —
// сейчас это Bytehand (sms) и SMSC (sms/telegram/email): у обоих отправка
// "успешна" означает лишь "запрос принят", реальная доставка (или провал)
// выясняется позже отдельным запросом. Раньше мы об этом не узнавали вообще —
// пользователь молча ждал код, который не придёт.
// Same-origin (браузер уже на нашем домене после отскока) — CORS не нужен.
//
// Только помечает мёртвый OTP при подтверждённом провале доставки — саму
// реакцию (пробовать другой ключ дальше по каскаду или сдаться) решает
// POST action=delivery_failed в ../auth/route.ts, у него есть остальной
// контекст сессии (пробовали ли уже второй ключ).
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  const { sid, sig } = (await req.json().catch(() => ({}))) as { sid?: string; sig?: string };
  if (!sid || !sig || !verifyParam(sid, sig)) return NextResponse.json({ status: "unknown" });

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("oidc_auth_sessions")
    .select("id, otp_id, status")
    .eq("id", sid)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!session || session.status !== "pending" || !session.otp_id) return NextResponse.json({ status: "unknown" });

  const { data: otp } = await admin
    .from("otp_requests")
    .select("id, channel, provider, provider_message_id, consumed_at, phone, email")
    .eq("id", session.otp_id)
    .maybeSingle();
  if (!otp || !otp.provider_message_id || otp.consumed_at) return NextResponse.json({ status: "unknown" });
  const channel = otp.channel as "push" | "email" | "telegram" | "sms";
  if (!needsDeliveryPoll(channel, otp.provider)) return NextResponse.json({ status: "unknown" });

  const target = otp.phone || otp.email;
  if (!target) return NextResponse.json({ status: "unknown" });

  let state: "pending" | "delivered" | "failed";
  if (otp.provider === "smsc") {
    const { data: secrets } = await admin.from("project_secrets").select("smsc_login, smsc_password").eq("project_id", projectId).maybeSingle();
    if (!secrets?.smsc_login || !secrets?.smsc_password) return NextResponse.json({ status: "unknown" });
    state = await checkSmscDelivery(secrets.smsc_login, secrets.smsc_password, otp.provider_message_id, target, channel === "telegram");
  } else {
    // единственный другой провайдер, которому сейчас нужен поллинг — Bytehand (sms)
    const { data: secrets } = await admin.from("project_secrets").select("bytehand_service_key").eq("project_id", projectId).maybeSingle();
    if (!secrets?.bytehand_service_key) return NextResponse.json({ status: "unknown" });
    state = await checkSmsDelivery(secrets.bytehand_service_key, otp.provider_message_id);
  }

  if (state !== "failed") return NextResponse.json({ status: state });

  // помечаем мёртвым — случайно пришедший позже код уже не должен сработать
  await admin.from("otp_requests").update({ consumed_at: new Date().toISOString() }).eq("id", otp.id);

  return NextResponse.json({ status: "failed" });
}
