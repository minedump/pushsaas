import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import { eventLabel } from "@/lib/siteEventLabels";
import { resolveCatalogRefs } from "@/lib/productFeed";
import { catalogFullName } from "@/lib/catalogName";
import SubscriberProfile from "./SubscriberProfile";

const HISTORY_LIMIT = 50;

// Подставляем название товара/категории вместо сырого id из фида, где
// получится — иначе показываем id как есть (например если фид не подключён).
function eventDetail(payload: Record<string, unknown>, productNames: Record<string, string>, categoryNames: Record<string, string>): string {
  const pid = payload.product_id;
  const pids = payload.product_ids;
  const cid = payload.category_id;
  const cids = payload.category_ids;
  if (typeof pid === "string") return productNames[pid] || pid;
  if (Array.isArray(pids) && pids.length) return pids.map((v) => (typeof v === "string" ? productNames[v] || v : String(v))).join(", ");
  if (typeof cid === "string") return categoryNames[cid] || cid;
  if (Array.isArray(cids) && cids.length) return cids.map((v) => (typeof v === "string" ? categoryNames[v] || v : String(v))).join(", ");
  return "";
}

export default async function SubscriberProfilePage({ params }: { params: Promise<{ id: string; identityId: string }> }) {
  const { id, identityId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { data: identity } = await supabase
    .from("identities")
    .select(
      "id, phone, email, name, insales_client_id, tags, attributes, sms_marketing_active_at, email_marketing_active_at, phone_verified_at, email_verified_at, timezone, ym_client_ids, created_at"
    )
    .eq("id", identityId)
    .eq("project_id", id)
    .maybeSingle();
  if (!identity) notFound();

  // Устройства контакта — платформа/статус, плюс список их id для запросов
  // ниже (заказы/push-рассылки резолвятся по subscriber_id, не identity_id
  // напрямую, см. order_attributions/campaign_recipients).
  const { data: links } = await supabase.from("identity_devices").select("subscriber_id").eq("identity_id", identityId);
  const deviceIds = (links ?? []).map((l) => l.subscriber_id);
  let devices: { id: string; platform: string; is_active: boolean; paused: boolean; created_at: string; attributes: Record<string, unknown> | null }[] = [];
  if (deviceIds.length) {
    const { data } = await supabase.from("subscribers").select("id, platform, is_active, paused, created_at, attributes, endpoint, timezone").in("id", deviceIds);
    devices = data ?? [];
  }

  // История изменений данных контакта — два источника, оба прямой FK на
  // identity_id: identity_channel_events (вкл/выкл SMS/Email, миграция
  // 0029) и identity_field_changes (имя/телефон/email/внешний ID/теги/доп.
  // поля, миграция 0041) — на карточке сводятся в один список.
  const { data: channelEvents } = await supabase
    .from("identity_channel_events")
    .select("id, channel, active, contact, created_at, source")
    .eq("identity_id", identityId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const { data: fieldChanges } = await supabase
    .from("identity_field_changes")
    .select("id, field, old_value, new_value, created_at, actor_id, source")
    .eq("identity_id", identityId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  // Автор правки (миграция 0103): имя из профиля, у системных/API-правок — метка источника.
  const actorIds = [...new Set((fieldChanges ?? []).map((f) => f.actor_id).filter(Boolean))] as string[];
  const { data: actorProfiles } = actorIds.length
    ? await createAdminClient().from("profiles").select("id, email, full_name").in("id", actorIds)
    : { data: [] as { id: string; email: string; full_name: string | null }[] };
  const actorById = new Map((actorProfiles ?? []).map((p) => [p.id, p.full_name || p.email]));
  const fieldChangesWithActor = (fieldChanges ?? []).map((f) => ({
    id: f.id,
    field: f.field,
    old_value: f.old_value,
    new_value: f.new_value,
    created_at: f.created_at,
    actor: f.actor_id ? actorById.get(f.actor_id) ?? null : f.source === "api" ? "API" : f.source === "webhook" ? "вебхук магазина" : f.source === "import" ? "импорт файла" : null,
  }));

  // Рассылки, ушедшие этому контакту — push резолвится по id устройств
  // (campaign_recipients.contact = subscribers.id как текст для push),
  // sms/email — по самому телефону/email (contact = значение канала).
  const recipientRows: {
    id: number;
    channel: "push" | "sms" | "email";
    status: string;
    clicked_at: string | null;
    opened_at: string | null;
    delivered_at: string | null;
    created_at: string;
    campaigns: { title: string; internal_title: string | null } | null;
    raw_context: Record<string, unknown> | null;
    rendered_content: Record<string, unknown> | null;
  }[] = [];
  if (deviceIds.length) {
    const { data } = await supabase
      .from("campaign_recipients")
      .select("id, channel, status, clicked_at, opened_at, created_at, delivered_at, campaigns(title, internal_title), raw_context, rendered_content")
      .eq("project_id", id)
      .eq("channel", "push")
      .in("contact", deviceIds)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    recipientRows.push(...((data ?? []) as unknown as typeof recipientRows));
  }
  const contactValues = [identity.phone, identity.email].filter(Boolean) as string[];
  if (contactValues.length) {
    const { data } = await supabase
      .from("campaign_recipients")
      .select("id, channel, status, clicked_at, opened_at, created_at, delivered_at, campaigns(title, internal_title), raw_context, rendered_content")
      .eq("project_id", id)
      .in("channel", ["sms", "email"])
      .in("contact", contactValues)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    recipientRows.push(...((data ?? []) as unknown as typeof recipientRows));
  }
  recipientRows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Заказы контакта — по identity_id (миграция 0077): у покупателя может не
  // быть ни одного push-устройства (заказ пришёл вебхуком, а не через
  // подписку), поэтому запрос больше не завязан на deviceIds.
  const { data: orderRows } = await supabase
    .from("order_attributions")
    .select("id, order_number, revenue, is_paid, paid_amount, created_at, ordered_at, is_cancelled, fulfillment_status, custom_status, status_history, campaign_id, items, item_history, attributes, campaigns(title, internal_title)")
    .eq("project_id", id)
    .eq("identity_id", identityId)
    .order("ordered_at", { ascending: false, nullsFirst: false })
    .limit(HISTORY_LIMIT);
  const orders = (orderRows ?? []) as unknown as {
    id: string;
    order_number: string | null;
    revenue: number;
    is_paid: boolean;
    paid_amount: number | null;
    created_at: string;
    ordered_at: string | null;
    is_cancelled: boolean;
    fulfillment_status: string | null;
    custom_status: string | null;
    status_history: unknown;
    campaign_id: string | null;
    items: unknown;
    item_history: unknown;
    campaigns: { title: string; internal_title: string | null } | null;
  }[];

  // Названия позиций заказов берём из каталога (фида) по id варианта: он главнее названия, записанного в заказе при оформлении.
  // Нет варианта в каталоге: остаётся название из заказа.
  const orderVariantIds = new Set<string>();
  for (const o of orders) {
    if (!Array.isArray(o.items)) continue;
    for (const it of o.items as { variant_id?: string | null }[]) if (it?.variant_id) orderVariantIds.add(String(it.variant_id));
  }
  let catalogNames: Record<string, string> = {};
  if (orderVariantIds.size) {
    const { data: cat } = await createAdminClient().from("product_feed_items").select("external_id, name, variant_label").eq("project_id", id).in("external_id", [...orderVariantIds]);
    // полное название: название товара из фида и в скобках свойства варианта через «/»
    catalogNames = Object.fromEntries((cat ?? []).map((c) => [c.external_id as string, catalogFullName(c.name as string, c.variant_label as string | null)]));
  }

  // Сырые трекинг-события (window.sendera.event) с сайта — то, что реально
  // накапливает списки избранного/корзины/просмотров (см. ingest_event,
  // migration 0070). subscriber_id тут — не обязательно активная push-
  // подписка (см. миграцию 0071, push-optional): устройство залогировано,
  // даже если пуш не включён.
  let siteEvents: { id: string; label: string; detail: string; created_at: string }[] = [];
  if (deviceIds.length) {
    const { data: rawEvents } = await supabase
      .from("events")
      .select("id, name, payload, created_at")
      .eq("project_id", id)
      .in("subscriber_id", deviceIds)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);

    const productIds = new Set<string>();
    const categoryIds = new Set<string>();
    for (const e of rawEvents ?? []) {
      const p = (e.payload || {}) as Record<string, unknown>;
      if (typeof p.product_id === "string") productIds.add(p.product_id);
      if (Array.isArray(p.product_ids)) p.product_ids.forEach((v) => typeof v === "string" && productIds.add(v));
      if (typeof p.category_id === "string") categoryIds.add(p.category_id);
      if (Array.isArray(p.category_ids)) p.category_ids.forEach((v) => typeof v === "string" && categoryIds.add(v));
    }
    let productNames: Record<string, string> = {};
    if (productIds.size) {
      // id в событии может быть id варианта или id товара: ищем и так, и так
      const found = await resolveCatalogRefs(id, [...productIds]);
      productNames = Object.fromEntries([...found].map(([ref, p]) => [ref, p.name]));
    }
    let categoryNames: Record<string, string> = {};
    if (categoryIds.size) {
      const { data } = await supabase.from("product_feed_categories").select("external_id, name").eq("project_id", id).in("external_id", [...categoryIds]);
      categoryNames = Object.fromEntries((data ?? []).map((c) => [c.external_id, c.name]));
    }

    siteEvents = (rawEvents ?? []).map((e) => ({
      id: String(e.id),
      label: eventLabel(e.name),
      detail: eventDetail((e.payload || {}) as Record<string, unknown>, productNames, categoryNames),
      created_at: e.created_at,
    }));
  }

  return (
    <SubscriberProfile
      projectId={id}
      identity={identity}
      devices={devices}
      channelEvents={channelEvents ?? []}
      fieldChanges={fieldChangesWithActor}
      recipients={recipientRows.slice(0, HISTORY_LIMIT)}
      orders={orders}
      catalogNames={catalogNames}
      siteEvents={siteEvents}
      historyLimit={HISTORY_LIMIT}
    />
  );
}
