import { NextResponse } from "next/server";
import { extractApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePath } from "@/lib/jsonpath";
import { upsertContact } from "@/lib/identity";
import { logApiCall } from "@/lib/apiLog";

// POST /api/v1/attribute — order-attribution intake (last-click). Separate from
// /api/v1/trigger on purpose: this endpoint records revenue, it never sends a push.
// Auth is a DEDICATED per-project token (project_secrets.attribution_token,
// see lib/attribution.ts), not an api_keys row — narrow-scope webhook secret,
// auto-generated once at project creation, always visible in Настройки, not
// a general API key. No "enabled" flag to flip: a valid token means the
// webhook is live; no incoming calls (or a cookie that never matches) just
// means the revenue card in Аналитика/Рассылки shows zeros, nothing to
// configure first.
//
// Field paths below are hardcoded, NOT merchant-configurable — confirmed
// against a REAL InSales order (create + mark-paid, webhooks orders/create
// and orders/update registered on a live test store, 2026-08-25):
//   number                — order number
//   total_price            — full order total, incl. delivery
//   items_price            — order total WITHOUT delivery, WITH discounts
//                            applied (exactly "оборот без доставки, со
//                            скидками" — no separate "amount path" needed)
//   financial_status        — "paid" once fully paid (paid_amount/paid_at
//                            also populate then, but financial_status is the
//                            stable signal — paid_amount didn't match the
//                            order's actual discounted total in testing)
//   client.phone/.email    — customer contact, nested under `client`
// The only thing left for the merchant to set is the attribution cookie name
// + window (Настройки) — everything else here is fixed by InSales's own
// webhook schema, not something that varies per store.
//
// The cookie our own tracking script sets (see embed widget) encodes
// "<campaignId>.<timestampMs>". InSales captures ANY cookie the merchant lists
// under Настройки → /admin2/checkout → «Список cookies, которые требуется
// сохранить при оформлении заказа» into the order body at cookies.<name> —
// confirmed against a real order payload. So the path is always
// `cookies.<attribution_cookie_name>`, never a merchant-specific guess —
// the merchant just has to list the SAME name there as configured below.
export async function POST(req: Request) {
  const token = extractApiKey(req);
  if (!token) return NextResponse.json({ error: "missing key" }, { status: 401 });

  const admin = createAdminClient();
  const { data: secretRow } = await admin.from("project_secrets").select("project_id").eq("attribution_token", token).maybeSingle();
  const projectId = secretRow?.project_id;
  if (!projectId) return NextResponse.json({ error: "invalid key" }, { status: 401 });

  const { data: project } = await admin
    .from("projects")
    .select("attribution_cookie_name, attribution_window_days")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "invalid key" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const cookieName = project.attribution_cookie_name || "pss_attr";
  const cookieVal = String(resolvePath(body, `cookies.${cookieName}`) ?? "");
  const dot = cookieVal.lastIndexOf(".");
  if (dot < 0) return NextResponse.json({ ok: true, skipped: "no attribution cookie in payload" });

  const campaignId = cookieVal.slice(0, dot);
  const clickedAt = Number(cookieVal.slice(dot + 1));
  if (!campaignId || !Number.isFinite(clickedAt)) {
    await logApiCall(admin, projectId, "attribute", false, "malformed cookie", {});
    return NextResponse.json({ ok: true, skipped: "malformed cookie" });
  }

  const windowMs = (project.attribution_window_days || 7) * 86_400_000;
  if (Date.now() - clickedAt > windowMs) {
    return NextResponse.json({ ok: true, skipped: "outside attribution window" });
  }

  const { data: campaign } = await admin
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!campaign) {
    await logApiCall(admin, projectId, "attribute", false, "campaign not found", { campaignId });
    return NextResponse.json({ ok: true, skipped: "campaign not found" });
  }

  const orderNumber = String(resolvePath(body, "number") ?? "");
  const revenue = Number(resolvePath(body, "total_price") ?? 0) || 0;
  const isPaid = String(resolvePath(body, "financial_status") ?? "") === "paid";
  const paidAmount = isPaid ? Number(resolvePath(body, "items_price") ?? 0) || 0 : null;

  // Контакт покупателя — заводим/находим identity, чтобы заказ был виден на
  // ЕГО карточке (см. миграцию 0077), даже если push никогда не включался.
  // Каналы НЕ включаем (smsActive/emailActive не передаём) — согласие на
  // рассылку это заказ не даёт, только сам факт "мы знаем этого клиента".
  const rawPhone = String(resolvePath(body, "client.phone") ?? resolvePath(body, "phone") ?? "");
  const rawEmail = String(resolvePath(body, "client.email") ?? resolvePath(body, "email") ?? "");
  const clientName = String(resolvePath(body, "client.name") ?? "") || undefined;

  let identityId: string | null = null;
  let subscriberId: string | null = null;
  if (rawPhone || rawEmail) {
    const contact = await upsertContact(projectId, { phone: rawPhone || undefined, email: rawEmail || undefined, name: clientName });
    if (contact.ok) {
      identityId = contact.id;
      const { data: link } = await admin.from("identity_devices").select("subscriber_id").eq("identity_id", identityId).limit(1).maybeSingle();
      subscriberId = link?.subscriber_id || null;
    }
  }

  // upsert, не insert — InSales обычно шлёт отдельные вебхуки на создание И
  // на смену статуса заказа, мерчант может законно навесить оба на этот же
  // адрес (см. Настройки); без дедупа по (project_id, order_number) выручка
  // заказа считалась бы по разу на каждое срабатывание (см. migration 0074).
  await admin.from("order_attributions").upsert(
    {
      project_id: projectId,
      campaign_id: campaign.id,
      subscriber_id: subscriberId,
      identity_id: identityId,
      order_number: orderNumber || null,
      revenue,
      is_paid: isPaid,
      paid_amount: paidAmount,
      raw_cookie: cookieVal,
    },
    { onConflict: "project_id,order_number" }
  );

  await logApiCall(admin, projectId, "attribute", true, null, { campaignId, orderNumber, revenue, isPaid });
  return NextResponse.json({ ok: true, recorded: true, campaignId, revenue, isPaid });
}
