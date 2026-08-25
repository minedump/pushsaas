import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import SubscriberProfile from "./SubscriberProfile";

const HISTORY_LIMIT = 50;

// Человеко-читаемые подписи для сырых имён трекинг-событий (window.sendera.event) —
// см. EventTrackingDocs.tsx, тот же список принципов.
const EVENT_LABEL: Record<string, string> = {
  cart_updated: "Обновил корзину",
  favorite_updated: "Обновил избранное",
  product_viewed: "Посмотрел товар",
  category_viewed: "Посмотрел категорию",
  checkout_started: "Начал оформление",
};
function eventLabel(name: string): string {
  if (EVENT_LABEL[name]) return EVENT_LABEL[name];
  if (name.endsWith("_added")) return `Добавил в «${name.slice(0, -6)}»`;
  if (name.endsWith("_removed")) return `Убрал из «${name.slice(0, -8)}»`;
  return `Событие «${name}»`;
}
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
      "id, phone, email, name, insales_client_id, tags, attributes, sms_marketing_active_at, email_marketing_active_at, phone_verified_at, email_verified_at, timezone, created_at"
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
    const { data } = await supabase.from("subscribers").select("id, platform, is_active, paused, created_at, attributes").in("id", deviceIds);
    devices = data ?? [];
  }

  // История изменений данных контакта — два источника, оба прямой FK на
  // identity_id: identity_channel_events (вкл/выкл SMS/Email, миграция
  // 0029) и identity_field_changes (имя/телефон/email/внешний ID/теги/доп.
  // поля, миграция 0041) — на карточке сводятся в один список.
  const { data: channelEvents } = await supabase
    .from("identity_channel_events")
    .select("id, channel, active, contact, created_at")
    .eq("identity_id", identityId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const { data: fieldChanges } = await supabase
    .from("identity_field_changes")
    .select("id, field, old_value, new_value, created_at")
    .eq("identity_id", identityId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  // Рассылки, ушедшие этому контакту — push резолвится по id устройств
  // (campaign_recipients.contact = subscribers.id как текст для push),
  // sms/email — по самому телефону/email (contact = значение канала).
  const recipientRows: { id: number; channel: string; status: string; clicked_at: string | null; opened_at: string | null; created_at: string; campaigns: { title: string } | null }[] = [];
  if (deviceIds.length) {
    const { data } = await supabase
      .from("campaign_recipients")
      .select("id, channel, status, clicked_at, opened_at, created_at, campaigns(title)")
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
      .select("id, channel, status, clicked_at, opened_at, created_at, campaigns(title)")
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
    .select("id, order_number, revenue, is_paid, paid_amount, created_at, campaigns(title)")
    .eq("project_id", id)
    .eq("identity_id", identityId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const orders = (orderRows ?? []) as unknown as {
    id: string;
    order_number: string | null;
    revenue: number;
    is_paid: boolean;
    paid_amount: number | null;
    created_at: string;
    campaigns: { title: string } | null;
  }[];

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
      const { data } = await supabase.from("product_feed_items").select("external_id, name").eq("project_id", id).in("external_id", [...productIds]);
      productNames = Object.fromEntries((data ?? []).map((p) => [p.external_id, p.name]));
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
      fieldChanges={fieldChanges ?? []}
      recipients={recipientRows.slice(0, HISTORY_LIMIT)}
      orders={orders}
      siteEvents={siteEvents}
      historyLimit={HISTORY_LIMIT}
    />
  );
}
