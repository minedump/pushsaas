import { NextResponse } from "next/server";
import { extractWebhookKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePath } from "@/lib/jsonpath";
import { upsertContact, applyShopConsent, isTruthyFlag, addYmClientIds, setIdentityTimezone } from "@/lib/identity";
import { mapShopFields, type FieldMapRow } from "@/lib/shopFields";
import { logApiCall } from "@/lib/apiLog";
import { auditAs } from "@/lib/auditContext";
import { logWebhookReject } from "@/lib/webhookReject";
import { parseExternalTime } from "@/lib/datetime";
import { parseOrderLines, diffOrderLines, type OrderLine } from "@/lib/orderLines";

// POST /api/v1/attribute — order intake (last-click attribution, when a
// cookie matches a live campaign, PLUS the merchant's full order stream —
// every call is recorded in order_attributions, with campaign_id left null
// when there's no attribution match. That full stream is what RFM tagging
// (see app/api/cron/recompute-rfm) aggregates per identity — attribution-only
// recording would have silently dropped every order that didn't come from a
// click on our own campaign. Separate from /api/v1/trigger on purpose: this
// endpoint records revenue, it never sends a push.
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
  const token = extractWebhookKey(req);
  if (!token) {
    await logWebhookReject("attribute", 401, "missing key", req);
    return NextResponse.json({ error: "missing key" }, { status: 401 });
  }

  const authAdmin = createAdminClient();
  const { data: secretRow } = await authAdmin.from("project_secrets").select("project_id").eq("attribution_token", token).maybeSingle();
  const projectId = secretRow?.project_id;
  if (!projectId) {
    await logWebhookReject("attribute", 401, "invalid key", req, { key: token });
    return NextResponse.json({ error: "invalid key" }, { status: 401 });
  }

  // Правки контакта из заказа подписаны в истории карточки источником «вебхук магазина».
  auditAs(null, "webhook");
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("attribution_cookie_name, attribution_window_days, timezone, client_sms_field, order_field_map")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "invalid key" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Attribution match — best effort, no longer gates whether the order gets
  // recorded at all (see header comment): a matched click sets campaignId,
  // anything else still falls through with campaignId left null so the
  // merchant's full order stream is captured, not just clicks we attributed.
  let campaignId: string | null = null;
  const cookieName = project.attribution_cookie_name || "pss_attr";
  const cookieVal = String(resolvePath(body, `cookies.${cookieName}`) ?? "");
  const dot = cookieVal.lastIndexOf(".");
  if (dot >= 0) {
    const candidateCampaignId = cookieVal.slice(0, dot);
    const clickedAt = Number(cookieVal.slice(dot + 1));
    const windowMs = (project.attribution_window_days || 7) * 86_400_000;
    if (candidateCampaignId && Number.isFinite(clickedAt) && Date.now() - clickedAt <= windowMs) {
      const { data: campaign } = await admin
        .from("campaigns")
        .select("id")
        .eq("id", candidateCampaignId)
        .eq("project_id", projectId)
        .maybeSingle();
      campaignId = campaign?.id ?? null;
    }
  }

  const orderNumber = String(resolvePath(body, "number") ?? "");
  // База выручки — товары без доставки, со скидками (items_price). Сумма с доставкой
  // (total_price) хранится справочно. Нет items_price — берём сумму минус доставка.
  const totalPrice = Number(resolvePath(body, "total_price") ?? 0) || 0;
  const itemsRaw = resolvePath(body, "items_price");
  const deliveryPrice = Number(resolvePath(body, "full_delivery_price") ?? resolvePath(body, "delivery_price") ?? 0) || 0;
  const revenue = itemsRaw != null && itemsRaw !== "" ? Number(itemsRaw) || 0 : Math.max(0, totalPrice - deliveryPrice);
  const isPaid = String(resolvePath(body, "financial_status") ?? "") === "paid";
  const paidAmount = isPaid ? revenue : null;
  // Статусы заказа и настоящая дата заказа (миграция 0110). Отменённый или
  // возвращённый заказ не должен считаться выручкой: fulfillment_status
  // declined/returned или финансовый статус refunded.
  const financialStatus = String(resolvePath(body, "financial_status") ?? "") || null;
  const fulfillmentStatus = String(resolvePath(body, "fulfillment_status") ?? "") || null;
  const isCancelled = fulfillmentStatus === "declined" || fulfillmentStatus === "returned" || financialStatus === "refunded";
  const orderedAtRaw = String(resolvePath(body, "created_at") ?? "");
  // со смещением («+03:00») берём как есть, без смещения — время по часовому поясу проекта
  const orderedAt = (orderedAtRaw ? parseExternalTime(orderedAtRaw, (project as { timezone?: string | null }).timezone) : null)?.toISOString() ?? new Date().toISOString();

  // Контакт покупателя — заводим/находим identity, чтобы заказ был виден на
  // ЕГО карточке (см. миграцию 0077), даже если push никогда не включался.
  // Согласия на каналы выставляются ниже из галочек, отмеченных при оформлении
  // заказа (только включение, см. applyChannelConsent).
  const rawPhone = String(resolvePath(body, "client.phone") ?? resolvePath(body, "phone") ?? "");
  const rawEmail = String(resolvePath(body, "client.email") ?? resolvePath(body, "email") ?? "");
  const clientName =
    [resolvePath(body, "client.name"), resolvePath(body, "client.surname")]
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .join(" ") || undefined;

  // Доп. поля заказа по соответствию из Настроек (поле магазина → поле заказа). Ищем и среди полей заказа,
  // и среди полей клиента в заказе. Системные ключи (timezone, ym_client_id) уходят в контакт.
  const orderFieldMap = (Array.isArray((project as { order_field_map?: unknown }).order_field_map) ? (project as { order_field_map: FieldMapRow[] }).order_field_map : []) as FieldMapRow[];
  const orderFieldLists = [resolvePath(body, "fields_values"), resolvePath(body, "client.fields_values")];
  const findOrderField = (want: string): Record<string, unknown> | undefined => {
    for (const list of orderFieldLists) {
      if (!Array.isArray(list)) continue;
      const f = (list as Record<string, unknown>[]).find((x) => [x?.handle, x?.name, x?.field_id].some((k) => k != null && String(k).trim().toLowerCase() === want.trim().toLowerCase()));
      if (f) return f;
    }
    return undefined;
  };
  const mapped = mapShopFields(orderFieldMap, findOrderField);

  let identityId: string | null = null;
  let subscriberId: string | null = null;
  if (rawPhone || rawEmail) {
    const clientId = resolvePath(body, "client.id");
    const contact = await upsertContact(projectId, {
      phone: rawPhone || undefined,
      email: rawEmail || undefined,
      name: clientName,
      fillOnly: true,
      // внешний id клиента: по нему вебхук клиентов потом находит этот же контакт
      insalesClientId: clientId != null && clientId !== "" ? String(clientId) : undefined,
    });
    if (contact.ok) {
      identityId = contact.id;
      // Согласия, данные при оформлении заказа (галочки в корзине), в том числе гостем:
      // email — системное поле клиента subscribe, SMS — дополнительное поле клиента
      // (его имя задано в Настройках; ищем и среди полей клиента, и среди полей заказа).
      // По заказу согласие только включаем: не отмеченная галочка согласие не снимает.
      const smsHandle = String((project as { client_sms_field?: string | null }).client_sms_field || "").trim().toLowerCase();
      const fieldLists = [resolvePath(body, "client.fields_values"), resolvePath(body, "fields_values")];
      let smsFlag: boolean | undefined;
      if (smsHandle) {
        for (const list of fieldLists) {
          if (!Array.isArray(list)) continue;
          const f = (list as Record<string, unknown>[]).find((x) =>
            [x?.handle, x?.name, x?.field_id].some((k) => k != null && String(k).trim().toLowerCase() === smsHandle)
          );
          if (f) {
            smsFlag = isTruthyFlag(f.value);
            break;
          }
        }
      }
      const subscribe = resolvePath(body, "client.subscribe");
      // Клиент магазина другой, чем известный нам у контакта (гость с тем же телефоном): согласия
      // только включаем. Тот же клиент: галочка включена даёт согласие, выключенная после включённой снимает.
      const { data: idRow } = await admin.from("identities").select("insales_client_id").eq("id", identityId).maybeSingle();
      const knownId = String((idRow as { insales_client_id?: string | null } | null)?.insales_client_id || "");
      const differentAccount = !!knownId && !!clientId && knownId !== String(clientId);
      await applyShopConsent(
        admin,
        projectId,
        identityId,
        { sms: rawPhone ? smsFlag : undefined, email: typeof subscribe === "boolean" && rawEmail ? subscribe : undefined },
        { source: "webhook_order", grantOnly: differentAccount }
      );
      if (mapped.timezone) await setIdentityTimezone(admin, projectId, identityId, mapped.timezone, differentAccount);
      if (mapped.ymIds.length) await addYmClientIds(admin, projectId, identityId, mapped.ymIds);
      const { data: link } = await admin.from("identity_devices").select("subscriber_id").eq("identity_id", identityId).limit(1).maybeSingle();
      subscriberId = link?.subscriber_id || null;
    }
  }

  // Ни клика по рассылке, ни резолвленного контакта — заказ анонимный для
  // нас, писать не к чему (как и раньше в таком случае).
  if (!campaignId && !identityId) {
    const responseBody = { ok: true, skipped: "no attribution and no contact" };
    await logApiCall(admin, projectId, "attribute", 200, body, responseBody);
    return NextResponse.json(responseBody);
  }

  // upsert, не insert — InSales шлёт вебхуки и на создание, и на каждое изменение
  // заказа, без дедупа по (project_id, order_number) выручка считалась бы по
  // разу на каждое срабатывание (см. migration 0074). Поля, которых в этом
  // вебхуке нет (кука, контакт), не затираем: при повторе без куки заказ не
  // теряет уже найденную рассылку.
  const { data: existing } = orderNumber
    ? await admin.from("order_attributions").select("id, items, item_history, custom_status, fulfillment_status, status_history, attributes").eq("project_id", projectId).eq("order_number", orderNumber).maybeSingle()
    : { data: null };
  const row: Record<string, unknown> = {
    project_id: projectId,
    order_number: orderNumber || null,
    revenue,
    is_paid: isPaid,
    paid_amount: paidAmount,
    ordered_at: orderedAt,
    financial_status: financialStatus,
    fulfillment_status: fulfillmentStatus,
    is_cancelled: isCancelled,
    updated_at: new Date().toISOString(),
  };
  // Состав заказа: цена и сумма по позициям уже с учётом скидки (скидку отдельно не храним,
  // InSales сам распределяет её по позициям). Изменение позиций при правке заказа, например
  // рост цены после снятия скидки, дописываем в историю заказа.
  const lines = parseOrderLines(body);
  if (lines) {
    row.items = lines;
    const prev = ((existing as { items?: OrderLine[] } | null)?.items ?? []) as OrderLine[];
    const prevHistory = ((existing as { item_history?: unknown[] } | null)?.item_history ?? []) as unknown[];
    const changes = existing ? diffOrderLines(prev, lines) : [];
    if (changes.length) {
      const updatedRaw = String(resolvePath(body, "updated_at") ?? "");
      const at = (updatedRaw ? parseExternalTime(updatedRaw, (project as { timezone?: string | null }).timezone) : null) ?? new Date();
      row.item_history = [...prevHistory, { at: at.toISOString(), changes }].slice(-50);
    }
  }
  // Статус заказа: название, которое видит клиент (custom_status), иначе системный. Смены
  // статуса копим в истории заказа.
  const customStatus = String(resolvePath(body, "custom_status.title") ?? "").trim() || null;
  row.custom_status = customStatus;
  if (existing) {
    const ex = existing as { custom_status?: string | null; fulfillment_status?: string | null; status_history?: unknown[] };
    const was = ex.custom_status || ex.fulfillment_status || null;
    const now = customStatus || fulfillmentStatus || null;
    if (now && was !== now) {
      const updatedRaw = String(resolvePath(body, "updated_at") ?? "");
      const at = (updatedRaw ? parseExternalTime(updatedRaw, (project as { timezone?: string | null }).timezone) : null) ?? new Date();
      row.status_history = [...(ex.status_history ?? []), { at: at.toISOString(), from: was, to: now }].slice(-50);
    }
  }
  // Доп. поля заказа: значения из вебхука поверх уже сохранённых, пустое значение убирает поле,
  // поля, которых в этом вебхуке нет, не трогаем.
  if (Object.keys(mapped.custom).length) {
    const merged = { ...(((existing as { attributes?: Record<string, unknown> } | null)?.attributes) ?? {}) } as Record<string, unknown>;
    for (const [k, v] of Object.entries(mapped.custom)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    row.attributes = merged;
  }
  if (campaignId) row.campaign_id = campaignId;
  if (cookieVal) row.raw_cookie = cookieVal;
  if (subscriberId) row.subscriber_id = subscriberId;
  if (identityId) row.identity_id = identityId;
  await admin.from("order_attributions").upsert(row, { onConflict: "project_id,order_number" });

  const responseBody = {
    ok: true,
    recorded: true,
    updated: !!existing,
    campaignId,
    revenue,
    isPaid,
    isCancelled,
    items: lines ? lines.length : undefined,
    ...(mapped.notes.length ? { notes: mapped.notes } : {}),
  };
  await logApiCall(admin, projectId, "attribute", 200, body, responseBody);
  return NextResponse.json(responseBody);
}
