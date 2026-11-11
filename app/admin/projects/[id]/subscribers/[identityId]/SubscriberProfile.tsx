"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconListDetails, IconChevronLeft, IconPencil, IconEraser, IconEye, IconBraces, IconX } from "@tabler/icons-react";
import { Badge, Button, ButtonLink, Card, Input, Modal, useDialogs } from "@/app/ui";
import { CustomSelect } from "@/app/ui/CustomSelect";
import { MessagePreviewModal, type PreviewContent } from "../../MessagePreviewModal";
import { OrderDetailsModal, orderStatusLabel, type OrderRow } from "./OrderDetailsModal";
import { useProjectTz } from "../../ProjectTimeProvider";
import { formatDateTime } from "@/lib/datetime";

type Identity = {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  last_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  insales_client_id: string | null;
  tags: string[] | null;
  attributes: Record<string, unknown> | null;
  sms_marketing_active_at: string | null;
  email_marketing_active_at: string | null;
  phone_verified_at: string | null;
  email_verified_at: string | null;
  timezone: string | null;
  ym_client_ids: string[] | null;
  created_at: string;
};
type DeviceRow = { id: string; platform: string; is_active: boolean; paused: boolean; created_at: string; attributes: Record<string, unknown> | null; endpoint?: string | null; timezone?: string | null };
type ChannelEventRow = { id: number; channel: string; active: boolean; contact: string | null; created_at: string; source?: string | null };
type FieldChangeRow = { id: number; field: string; old_value: string | null; new_value: string | null; created_at: string; actor: string | null };
type RecipientRow = {
  id: number;
  channel: "push" | "sms" | "email";
  status: string;
  clicked_at: string | null;
  opened_at: string | null;
  delivered_at: string | null;
  created_at: string;
  campaigns: { title: string; internal_title?: string | null } | null;
  raw_context: Record<string, unknown> | null;
  rendered_content: Record<string, unknown> | null;
};
type SiteEventRow = { id: string; label: string; detail: string; created_at: string };

const platformLabel: Record<string, string> = { ios: "iPhone", android: "Android", desktop: "Desktop", unknown: "—" };
const channelLabel: Record<string, string> = { push: "Push", sms: "SMS", email: "Email" };
const statusLabel: Record<string, string> = { delivered: "доставлено", failed: "ошибка" };
const fieldLabel: Record<string, string> = { name: "Имя (для текстов)", last_name: "Фамилия", first_name: "Имя", middle_name: "Отчество", phone: "Телефон", email: "Email", insales_client_id: "Внешний ID", tags: "Теги", timezone: "Часовой пояс", ym_client_ids: "UUID метрики" };

function displayField(field: string): string {
  if (field.startsWith("attr:")) return `Доп. поле «${field.slice(5)}»`;
  return fieldLabel[field] || field;
}

function fmt(d: string, tz: string) {
  return formatDateTime(d, tz);
}

type HistoryEntry =
  | { kind: "channel"; key: string; created_at: string; channel: string; active: boolean; contact: string | null; source: string | null }
  | { kind: "field"; key: string; created_at: string; field: string; old_value: string | null; new_value: string | null; actor: string | null }
  | { kind: "device"; key: string; created_at: string; platform: string; is_active: boolean; paused: boolean; noPush: boolean; ymClientId: string | undefined };

export default function SubscriberProfile({
  projectId,
  identity,
  devices,
  channelEvents,
  fieldChanges,
  recipients,
  orders,
  catalogNames,
  siteEvents,
  historyLimit,
}: {
  projectId: string;
  identity: Identity;
  devices: DeviceRow[];
  channelEvents: ChannelEventRow[];
  fieldChanges: FieldChangeRow[];
  recipients: RecipientRow[];
  orders: OrderRow[];
  // название варианта из каталога (фида) по id варианта: показывается в составе заказа вместо названия из заказа
  catalogNames: Record<string, string>;
  siteEvents: SiteEventRow[];
  historyLimit: number;
}) {
  const tz = useProjectTz();
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [orderQuery, setOrderQuery] = useState("");
  const [orderStatus, setOrderStatus] = useState("all");
  const [orderPay, setOrderPay] = useState("all");
  const [orderModal, setOrderModal] = useState<OrderRow | null>(null);
  const [previewRow, setPreviewRow] = useState<RecipientRow | null>(null);
  const [contextRow, setContextRow] = useState<RecipientRow | null>(null);

  async function remove() {
    const ok = await confirm({
      title: "Удалить контакт?",
      message: "Телефон, email и согласия на рассылку удалятся. Push-устройства останутся — просто без контактных данных.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/subscribers/${identity.id}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast(j.error || "Не удалось удалить", "bad");
    }
    toast("Контакт удалён", "good");
    router.push(`/admin/projects/${projectId}/subscribers`);
    router.refresh();
  }

  async function clearSection(kind: "events" | "history") {
    const ok = await confirm({
      title: kind === "events" ? "Очистить события на сайте?" : "Очистить историю изменений?",
      message:
        kind === "events"
          ? "Удалятся все отслеженные события (просмотры, корзина, избранное и т.п.) этого контакта. Действие необратимо."
          : "Удалятся записи о переключении каналов и правках полей. Устройства не затронет — они останутся. Действие необратимо.",
      confirmText: "Очистить",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/subscribers/${identity.id}/clear-${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast(j.error || "Не удалось очистить", "bad");
    }
    toast("Очищено", "good");
    router.refresh();
  }

  const attrs = identity.attributes || {};
  const attrKeys = Object.keys(attrs);
  // Заказы контакта: поиск по номеру, фильтр по статусу и по оплате.
  const orderStatusOptions = [...new Set(orders.map((o) => orderStatusLabel(o.custom_status, o.fulfillment_status)))].sort((a, b) => a.localeCompare(b, "ru"));
  const filteredOrders = orders.filter((o) => {
    if (orderQuery.trim() && !String(o.order_number || "").toLowerCase().includes(orderQuery.trim().toLowerCase())) return false;
    if (orderStatus !== "all" && orderStatusLabel(o.custom_status, o.fulfillment_status) !== orderStatus) return false;
    if (orderPay === "paid" && !(o.is_paid && !o.is_cancelled)) return false;
    if (orderPay === "unpaid" && !(!o.is_paid && !o.is_cancelled)) return false;
    if (orderPay === "cancelled" && !o.is_cancelled) return false;
    return true;
  });
  const revenueTotal = orders.filter((o) => !o.is_cancelled).reduce((sum, o) => sum + Number(o.revenue || 0), 0);
  // ClientID Яндекс.Метрики — пишется на устройство при подписке (см.
  // «Номер счётчика Метрики» в Настройках), поэтому берём с первого
  // устройства, у которого он есть, а не с самого контакта.
  // У человека их может быть несколько: сохранённые на контакте (из вебхуков, файла, входа) и на каждом устройстве.
  const ymClientIds = [
    ...new Set([...(identity.ym_client_ids ?? []), ...devices.map((d) => d.attributes?.ym_client_id).filter((v): v is string => typeof v === "string" && !!v)]),
  ];
  // Часовой пояс контакта; если у контакта его нет, показываем пояс устройства (определяется браузером).
  const deviceTimezone = devices.find((d) => d.timezone)?.timezone ?? null;

  const history: HistoryEntry[] = [
    ...channelEvents.map((e) => ({ kind: "channel" as const, key: `c${e.id}`, created_at: e.created_at, channel: e.channel, active: e.active, contact: e.contact, source: e.source ?? null })),
    ...fieldChanges.map((f) => ({ kind: "field" as const, key: `f${f.id}`, created_at: f.created_at, field: f.field, old_value: f.old_value, new_value: f.new_value, actor: f.actor })),
    ...devices.map((d) => ({
      kind: "device" as const,
      key: `d${d.id}`,
      created_at: d.created_at,
      platform: d.platform,
      is_active: d.is_active,
      paused: d.paused,
      noPush: !d.endpoint,
      ymClientId: d.attributes?.ym_client_id as string | undefined,
    })),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, historyLimit);

  return (
    <main className="max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href={`/admin/projects/${projectId}/subscribers`}
            className="inline-flex items-center gap-1 text-[13px] text-ink-faint hover:text-accent"
          >
            <IconChevronLeft size={14} stroke={2} />
            Вернуться ко всем подписчикам
          </Link>
          <h1 className="text-2xl font-semibold m-0 mt-2">{[identity.last_name, identity.first_name, identity.middle_name].filter(Boolean).join(" ") || identity.name || "Без имени"}</h1>
          <div className="flex flex-col gap-1 mt-2.5 text-[13.5px] text-ink-muted">
            {(identity.tags || []).length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span>Теги:</span>
                {(identity.tags || []).map((t) => (
                  <Badge key={t} tone="accent">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
            {identity.phone && (
              <div className="flex items-center gap-1.5">
                <span>Телефон:</span>
                <span className="font-mono text-ink">+{identity.phone}</span>
                {identity.phone_verified_at && (
                  <Badge tone="good" dot>
                    подтверждён
                  </Badge>
                )}
                <Badge tone={identity.sms_marketing_active_at ? "good" : "neutral"}>{identity.sms_marketing_active_at ? "SMS вкл" : "SMS выкл"}</Badge>
              </div>
            )}
            {identity.email && (
              <div className="flex items-center gap-1.5">
                <span>Email:</span>
                <span className="text-ink">{identity.email}</span>
                {identity.email_verified_at && (
                  <Badge tone="good" dot>
                    подтверждён
                  </Badge>
                )}
                <Badge tone={identity.email_marketing_active_at ? "good" : "neutral"}>
                  {identity.email_marketing_active_at ? "Email вкл" : "Email выкл"}
                </Badge>
              </div>
            )}
            {identity.insales_client_id && (
              <div>
                Внешний ID: <span className="font-mono text-ink">{identity.insales_client_id}</span>
              </div>
            )}
            {(identity.timezone || deviceTimezone) && (
              <div>
                Часовой пояс: <span className="font-mono text-ink">{identity.timezone || deviceTimezone}</span>
                {!identity.timezone && <span className="text-ink-faint"> (по устройству)</span>}
              </div>
            )}
            {ymClientIds.length > 0 && (
              <div title="ClientID Яндекс.Метрики: у человека их может быть несколько">
                UUID метрики: <span className="font-mono text-ink break-all">{ymClientIds.join(", ")}</span>
              </div>
            )}
            {attrKeys.map((k) => (
              <div key={k}>
                {k}: <span className="font-mono text-ink">{String(attrs[k])}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ButtonLink href={`/admin/projects/${projectId}/subscribers/${identity.id}/edit`} variant="secondary">
            <IconPencil size={16} stroke={2} />
            Изменить
          </ButtonLink>
          <Button variant="danger" onClick={remove}>
            Удалить
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 mt-6">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold m-0">События на сайте</h2>
            {siteEvents.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => clearSection("events")}>
                <IconEraser size={14} stroke={1.8} />
                Очистить
              </Button>
            )}
          </div>
          {siteEvents.length === 0 ? (
            <p className="text-[13px] text-ink-faint mt-2 mb-0">Пока нет отслеженных событий.</p>
          ) : (
            <>
              <div className="overflow-x-auto pretty-scroll">
                <table className="w-full border-collapse text-[13px] mt-3">
                  <thead>
                    <tr>
                      <Th>Событие</Th>
                      <Th>Детали</Th>
                      <Th>Когда</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {siteEvents.map((e) => (
                      <tr key={e.id} className="border-t border-border first:border-t-0 row-hover">
                        <Td className="whitespace-nowrap">
                          <Badge tone="accent">{e.label}</Badge>
                        </Td>
                        <Td className="text-ink-muted truncate max-w-[280px]">{e.detail || "—"}</Td>
                        <Td className="text-ink-faint whitespace-nowrap">{fmt(e.created_at, tz)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {siteEvents.length >= historyLimit && <p className="text-[12px] text-ink-faint mt-2 mb-0">Показаны последние {historyLimit}.</p>}
            </>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold m-0">Рассылки</h2>
          {recipients.length === 0 ? (
            <p className="text-[13px] text-ink-faint mt-2 mb-0">Ничего не приходило.</p>
          ) : (
            <>
              <div className="overflow-x-auto pretty-scroll">
                <table className="w-full border-collapse text-[13px] mt-3">
                  <thead>
                    <tr>
                      <Th>Рассылка</Th>
                      <Th>Канал</Th>
                      <Th>Статус</Th>
                      <Th>Реакция</Th>
                      <Th>Когда</Th>
                      <Th>Действия</Th>
                    </tr>
                  </thead>
                  <tbody>
                  {recipients.map((r) => (
                    <tr key={`${r.channel}-${r.id}`} className="border-t border-border first:border-t-0 row-hover">
                      <Td className="truncate max-w-[220px]">{r.campaigns?.internal_title || r.campaigns?.title || "—"}</Td>
                      <Td className="whitespace-nowrap">
                        <Badge tone="accent">{channelLabel[r.channel] || r.channel}</Badge>
                      </Td>
                      <Td className="text-ink-muted whitespace-nowrap">{r.channel === "sms" && r.status === "delivered" ? (r.delivered_at ? "доставлено" : "принято, ждём статус") : statusLabel[r.status] || r.status}</Td>
                      <Td className="whitespace-nowrap">
                        {r.clicked_at && (
                          <Badge tone="good" dot>
                            клик
                          </Badge>
                        )}
                        {r.opened_at && !r.clicked_at && <Badge tone="neutral">открыто</Badge>}
                      </Td>
                      <Td className="text-ink-faint whitespace-nowrap">{fmt(r.created_at, tz)}</Td>
                      <Td className="text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setPreviewRow(r)}
                            disabled={!r.rendered_content}
                            title={r.rendered_content ? "Превью сообщения" : "Нет снимка содержимого (отправлено до этой функции)"}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted transition-colors enabled:hover:text-ink enabled:hover:bg-surface-2 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                          >
                            <IconEye size={15} stroke={1.8} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setContextRow(r)}
                            disabled={!r.raw_context}
                            title={r.raw_context ? "Сырой контекст отправки" : "Нет снимка контекста (отправлено до этой функции)"}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted transition-colors enabled:hover:text-ink enabled:hover:bg-surface-2 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                          >
                            <IconBraces size={15} stroke={1.8} />
                          </button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
              {recipients.length >= historyLimit && <p className="text-[12px] text-ink-faint mt-2 mb-0">Показаны последние {historyLimit}.</p>}
            </>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold m-0">Заказы{orders.length > 0 && ` — ${revenueTotal.toLocaleString("ru-RU")} ₽ (без отменённых)`}</h2>
          {orders.length === 0 ? (
            <p className="text-[13px] text-ink-faint mt-2 mb-0">Заказов нет.</p>
          ) : (
            <>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_220px_180px]">
              <Input
                aria-label="Поиск по номеру заказа"
                value={orderQuery}
                onChange={(e) => setOrderQuery(e.target.value)}
                placeholder="Поиск по номеру заказа"
              />
              <CustomSelect
                value={orderStatus}
                onChange={setOrderStatus}
                ariaLabel="Фильтр по статусу заказа"
                options={[{ value: "all", label: "Все статусы" }, ...orderStatusOptions.map((v) => ({ value: v, label: v }))]}
              />
              <CustomSelect
                value={orderPay}
                onChange={setOrderPay}
                ariaLabel="Фильтр по оплате"
                options={[
                  { value: "all", label: "Любая оплата" },
                  { value: "paid", label: "Оплачен" },
                  { value: "unpaid", label: "Не оплачен" },
                  { value: "cancelled", label: "Отменён" },
                ]}
              />
            </div>
            <div className="overflow-x-auto pretty-scroll">
              <table className="w-full border-collapse text-[13px] mt-3">
                <thead>
                  <tr>
                    <Th>Номер</Th>
                    <Th>Привлечён</Th>
                    <Th>Статус</Th>
                    <Th>Оплата</Th>
                    <Th right>Сумма</Th>
                    <Th>Когда</Th>
                    <Th>{" "}</Th>
                  </tr>
                </thead>
                <tbody>
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-ink-faint">Ничего не найдено</td>
                  </tr>
                )}
                {filteredOrders.map((o) => {
                  return (
                    <Fragment key={o.id}>
                      <tr className="border-t border-border first:border-t-0 row-hover">
                        <Td className="whitespace-nowrap">{o.order_number || "—"}</Td>
                        <Td className="max-w-[260px]">
                          {o.campaign_id ? (
                            <span className="inline-flex items-center gap-1.5 min-w-0">
                              <Badge tone="good">рассылкой</Badge>
                              <span className="text-ink-muted truncate">{o.campaigns?.internal_title || o.campaigns?.title || ""}</span>
                            </span>
                          ) : (
                            <Badge tone="neutral">не привлечён</Badge>
                          )}
                        </Td>
                        <Td className="text-ink-muted max-w-[200px] truncate">{orderStatusLabel(o.custom_status, o.fulfillment_status)}</Td>
                        <Td>{o.is_cancelled ? <Badge tone="bad">отменён</Badge> : o.is_paid ? <Badge tone="good">оплачен</Badge> : <Badge tone="warn">не оплачен</Badge>}</Td>
                        <Td className="text-right tabular-nums">{Number(o.revenue).toLocaleString("ru-RU")} ₽</Td>
                        <Td className="text-ink-faint whitespace-nowrap">{fmt(o.ordered_at || o.created_at, tz)}</Td>
                        <Td className="text-right">
                          <button
                            type="button"
                            onClick={() => setOrderModal(o)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink transition-colors hover:bg-surface-2 cursor-pointer"
                            aria-label="Подробнее о заказе"
                            title="Подробнее"
                          >
                            <IconListDetails size={16} stroke={1.8} />
                          </button>
                        </Td>
                      </tr>
                    </Fragment>
                  );
                })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold m-0">История изменений</h2>
            {(channelEvents.length > 0 || fieldChanges.length > 0) && (
              <Button variant="secondary" size="sm" onClick={() => clearSection("history")}>
                <IconEraser size={14} stroke={1.8} />
                Очистить
              </Button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-[13px] text-ink-faint mt-2 mb-0">Пока пусто.</p>
          ) : (
            <>
              <div className="overflow-x-auto pretty-scroll">
                <table className="w-full border-collapse text-[13px] mt-3">
                  <thead>
                    <tr>
                      <Th>Событие</Th>
                      <Th>Детали</Th>
                      <Th>Когда</Th>
                    </tr>
                  </thead>
                  <tbody>
                  {history.map((h) => (
                    <tr key={h.key} className="border-t border-border first:border-t-0 row-hover">
                      {h.kind === "channel" ? (
                        <>
                          <Td className="whitespace-nowrap">
                            <Badge tone="accent">{channelLabel[h.channel] || h.channel}</Badge>
                          </Td>
                          <Td className="text-ink-muted truncate max-w-[280px]">
                            <Badge tone={h.active ? "good" : "neutral"}>{h.active ? "включён" : "отключён"}</Badge>
                            {h.contact && <span className="ml-1.5">{h.contact}</span>}
                            {h.source === "webhook" && <span className="ml-1.5 text-ink-faint">· вебхук магазина</span>}
                            {h.source === "webhook_order" && <span className="ml-1.5 text-ink-faint">· заказ из магазина</span>}
                            {h.source === "api" && <span className="ml-1.5 text-ink-faint">· API</span>}
                            {h.source === "import" && <span className="ml-1.5 text-ink-faint">· импорт файла</span>}
                          </Td>
                        </>
                      ) : h.kind === "field" ? (
                        <>
                          <Td className="whitespace-nowrap">
                            <Badge tone="accent">{displayField(h.field)}</Badge>
                          </Td>
                          <Td className="text-ink-muted truncate max-w-[280px]">
                            {h.old_value || "—"} → {h.new_value || "—"}
                            {h.actor && <span className="ml-1.5 text-ink-faint">· {h.actor}</span>}
                          </Td>
                        </>
                      ) : (
                        <>
                          <Td className="whitespace-nowrap">
                            <Badge tone="accent">Устройство: {platformLabel[h.platform] || h.platform}</Badge>
                          </Td>
                          <Td className="text-ink-muted truncate max-w-[280px]">
                            <Badge tone={!h.is_active ? "bad" : h.noPush || h.paused ? "warn" : "good"} dot>
                              {!h.is_active ? "отвалилось" : h.noPush ? "нет push-подписки" : h.paused ? "на паузе" : "активно"}
                            </Badge>
                            {h.ymClientId && (
                              <span className="ml-1.5 font-mono text-[11.5px]" title="ClientID Яндекс.Метрики">
                                ym: {h.ymClientId}
                              </span>
                            )}
                          </Td>
                        </>
                      )}
                      <Td className="text-ink-faint whitespace-nowrap">{fmt(h.created_at, tz)}</Td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
              {history.length >= historyLimit && <p className="text-[12px] text-ink-faint mt-2 mb-0">Показаны последние {historyLimit}.</p>}
            </>
          )}
        </Card>
      </div>

      {previewRow?.rendered_content && (
        <MessagePreviewModal label={previewRow.campaigns?.internal_title || previewRow.campaigns?.title || "Превью"} content={recipientPreviewContent(previewRow)} onClose={() => setPreviewRow(null)} />
      )}
      {orderModal && <OrderDetailsModal order={orderModal} tz={tz} catalogNames={catalogNames} onClose={() => setOrderModal(null)} />}
      {contextRow?.raw_context && (
        <RawContextModal label={contextRow.campaigns?.internal_title || contextRow.campaigns?.title || "Контекст отправки"} snapshot={contextRow.raw_context} onClose={() => setContextRow(null)} />
      )}
    </main>
  );
}

// rendered_content — снимок ИТОГОВОГО содержимого на момент отправки (см.
// migration 0080/lib/sender.ts logRecipients), уже отрендеренный (Liquid
// подставлен) — просто раскладываем по каналу в форму PreviewContent, без
// повторного резолва сырых данных.
function recipientPreviewContent(row: RecipientRow): PreviewContent {
  const rc = (row.rendered_content || {}) as Record<string, unknown>;
  if (row.channel === "email") return { channel: "email", subject: (rc.subject as string) || "", html: (rc.html as string) || "" };
  if (row.channel === "sms") return { channel: "sms", body: (rc.body as string) || "" };
  return {
    channel: "push",
    title: (rc.title as string) || "",
    body: (rc.body as string) || "",
    url: rc.url as string | undefined,
    icon_url: rc.icon as string | undefined,
    image_url: rc.image as string | undefined,
    badge_url: rc.badge as string | undefined,
    actions: rc.actions as { title: string; url: string }[] | undefined,
  };
}

// Три Liquid-неймспейса ДО резолва по фиду — ровно то, что описывает
// ContextDocs.tsx (template.*/context.*/automation.*), для проверяемости
// «что реально участвовало в отправке» отдельно от того, что в итоге
// отрендерилось (см. MessagePreviewModal выше — то другая кнопка).
function RawContextModal({ label, snapshot, onClose }: { label: string; snapshot: Record<string, unknown>; onClose: () => void }) {
  const sections: { key: string; title: string }[] = [
    { key: "template", title: "Шаблон (template.*)" },
    { key: "context", title: "Рассылка/автоматизация (context.*)" },
    { key: "automation", title: "Получено по API / триггеру / событию (automation.*)" },
  ];
  return (
    <Modal onClose={onClose} className="max-w-lg max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border shrink-0">
        <h3 className="text-base font-semibold m-0 truncate">{label}</h3>
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink transition-colors cursor-pointer shrink-0" title="Закрыть">
          <IconX size={18} stroke={1.8} />
        </button>
      </div>
      <div className="pretty-scroll flex-1 min-h-0 overflow-y-auto -mr-2 pr-2 flex flex-col gap-4">
        {sections.map((s) => {
          const val = snapshot[s.key] as Record<string, unknown> | undefined;
          const empty = !val || Object.keys(val).length === 0;
          return (
            <div key={s.key}>
              <div className="text-[12px] font-medium text-ink-muted mb-1.5">{s.title}</div>
              {empty ? (
                <p className="text-[12.5px] text-ink-faint m-0">Пусто</p>
              ) : (
                <pre className="text-[12px] font-mono bg-surface-2 rounded-lg p-3 overflow-x-auto pretty-scroll m-0 whitespace-pre-wrap break-words">
                  {JSON.stringify(val, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <td className={`px-2 first:pl-0 last:pr-0 py-2 align-middle ${className}`}>{children}</td>
);

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th
    className={`px-2 first:pl-0 last:pr-0 pb-1.5 text-[11px] text-ink-muted font-normal whitespace-nowrap ${right ? "text-right" : "text-left"}`}
  >
    {children}
  </th>
);
