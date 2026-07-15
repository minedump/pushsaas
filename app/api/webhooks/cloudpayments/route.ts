import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookHmac, proratePushes, nextPeriodEnd } from "@/lib/cloudpayments";

// CloudPayments "Pay" notification. Trust boundary: HMAC over the raw body.
// The widget passes our custom `Data` = { projectId, kind, tariffId?, pushes? }.
// AccountId is also set to projectId as a fallback.
export async function POST(req: Request) {
  const raw = await req.text();
  const hmac = req.headers.get("Content-HMAC") || req.headers.get("X-Content-HMAC");

  if (!verifyWebhookHmac(raw, hmac)) {
    // reject silently — do not credit anything on an unsigned request
    return NextResponse.json({ code: 13 });
  }

  const form = new URLSearchParams(raw);
  const amount = Number(form.get("Amount") || 0);
  const token = form.get("Token") || "";
  const accountId = form.get("AccountId") || "";
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(form.get("Data") || "{}");
  } catch {
    data = {};
  }

  const projectId = (data.projectId as string) || accountId;
  const kind = (data.kind as string) || "tariff";
  if (!projectId) return NextResponse.json({ code: 0 }); // nothing to do, ack anyway

  const admin = createAdminClient();

  if (kind === "package") {
    const pushes = Number(data.pushes || 0);
    if (pushes > 0) {
      await admin.rpc("credit_package", {
        p_project_id: projectId,
        p_pushes: pushes,
        p_amount: amount,
        p_description: `Пакет ${pushes} пушей`,
      });
    }
    return NextResponse.json({ code: 0 });
  }

  // tariff purchase / switch — webhook computes pushes + period on its own clock
  const tariffId = data.tariffId as string;
  const { data: tariff } = await admin
    .from("tariffs")
    .select("id, monthly_push_limit")
    .eq("id", tariffId)
    .maybeSingle();

  if (!tariff) return NextResponse.json({ code: 0 });

  const now = new Date();
  const pushes = proratePushes(tariff.monthly_push_limit, now);
  const periodEnd = nextPeriodEnd(now).toISOString();

  await admin.rpc("apply_paid_tariff", {
    p_project_id: projectId,
    p_tariff_id: tariffId,
    p_pushes: pushes,
    p_period_end: periodEnd,
    p_amount: amount,
    p_type: "tariff_purchase",
    p_token: token,
  });

  return NextResponse.json({ code: 0 });
}
