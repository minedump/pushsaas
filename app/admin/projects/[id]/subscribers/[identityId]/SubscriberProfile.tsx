"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconChevronLeft, IconPencil, IconEraser, IconEye, IconBraces, IconX } from "@tabler/icons-react";
import { Badge, Button, ButtonLink, Card, Modal, useDialogs } from "@/app/ui";
import { MessagePreviewModal, type PreviewContent } from "../../MessagePreviewModal";

type Identity = {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  insales_client_id: string | null;
  tags: string[] | null;
  attributes: Record<string, unknown> | null;
  sms_marketing_active_at: string | null;
  email_marketing_active_at: string | null;
  phone_verified_at: string | null;
  email_verified_at: string | null;
  timezone: string | null;
  created_at: string;
};
type DeviceRow = { id: string; platform: string; is_active: boolean; paused: boolean; created_at: string; attributes: Record<string, unknown> | null };
type ChannelEventRow = { id: number; channel: string; active: boolean; contact: string | null; created_at: string };
type FieldChangeRow = { id: number; field: string; old_value: string | null; new_value: string | null; created_at: string };
type RecipientRow = {
  id: number;
  channel: "push" | "sms" | "email";
  status: string;
  clicked_at: string | null;
  opened_at: string | null;
  created_at: string;
  campaigns: { title: string } | null;
  raw_context: Record<string, unknown> | null;
  rendered_content: Record<string, unknown> | null;
};
type OrderRow = {
  id: string;
  order_number: string | null;
  revenue: number;
  is_paid: boolean;
  paid_amount: number | null;
  created_at: string;
  campaigns: { title: string } | null;
};
type SiteEventRow = { id: string; label: string; detail: string; created_at: string };

const platformLabel: Record<string, string> = { ios: "iPhone", android: "Android", desktop: "Desktop", unknown: "—" };
const channelLabel: Record<string, string> = { push: "Push", sms: "SMS", email: "Email" };
const statusLabel: Record<string, string> = { delivered: "доставлено", failed: "ошибка" };
const fieldLabel: Record<string, string> = { name: "Имя", phone: "Телефон", email: "Email", insales_client_id: "Внешний ID", tags: "Теги" };

function displayField(field: string): string {
  if (field.startsWith("attr:")) return `Доп. поле «${field.slice(5)}»`;
  return fieldLabel[field] || field;
}

function fmt(d: string) {
  return new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

type HistoryEntry =
  | { kind: "channel"; key: string; created_at: string; channel: string; active: boolean; contact: string | null }
  | { kind: "field"; key: string; created_at: string; field: string; old_value: string | null; new_value: string | null }
  | { kind: "device"; key: string; created_at: string; platform: string; is_active: boolean; paused: boolean; ymClientId: string | undefined };

export default function SubscriberProfile({
  projectId,
  identity,
  devices,
  channelEvents,
  fieldChanges,
  recipients,
  orders,
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
  siteEvents: SiteEventRow[];
  historyLimit: number;
}) {
  const router = useRouter();
  const { confirm, toast } = useDialogs();
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
  const revenueTotal = orders.reduce((sum, o) => sum + Number(o.revenue || 0), 0);
  // ClientID Яндекс.Метрики — пишется на устройство при подписке (см.
  // «Номер счётчика Метрики» в Настройках), поэтому берём с первого
  // устройства, у которого он есть, а не с самого контакта.
  const ymClientId = devices.find((d) => d.attributes?.ym_client_id)?.attributes?.ym_client_id as string | undefined;

  const history: HistoryEntry[] = [
    ...channelEvents.map((e) => ({ kind: "channel" as const, key: `c${e.id}`, created_at: e.created_at, channel: e.channel, active: e.active, contact: e.contact })),
    ...fieldChanges.map((f) => ({ kind: "field" as const, key: `f${f.id}`, created_at: f.created_at, field: f.field, old_value: f.old_value, new_value: f.new_value })),
    ...devices.map((d) => ({
      kind: "device" as const,
      key: `d${d.id}`,
      created_at: d.created_at,
      platform: d.platform,
      is_active: d.is_active,
      paused: d.paused,
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
          <h1 className="text-2xl font-semibold m-0 mt-2">{identity.name || "Без имени"}</h1>
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
            {identity.timezone && (
              <div>
                Часовой пояс: <span className="font-mono text-ink">{identity.timezone}</span>
              </div>
            )}
            {ymClientId && (
              <div title="ClientID Яндекс.Метрики">
                UUID метрики: <span className="font-mono text-ink">{ymClientId}</span>
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
                      <tr key={e.id} className="border-t border-border first:border-t-0">
                        <Td className="whitespace-nowrap">
                          <Badge tone="accent">{e.label}</Badge>
                        </Td>
                        <Td className="text-ink-muted truncate max-w-[280px]">{e.detail || "—"}</Td>
                        <Td className="text-ink-faint whitespace-nowrap">{fmt(e.created_at)}</Td>
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
                      <Th> </Th>
                    </tr>
                  </thead>
                  <tbody>
                  {recipients.map((r) => (
                    <tr key={`${r.channel}-${r.id}`} className="border-t border-border first:border-t-0">
                      <Td className="truncate max-w-[220px]">{r.campaigns?.title || "—"}</Td>
                      <Td className="whitespace-nowrap">
                        <Badge tone="accent">{channelLabel[r.channel] || r.channel}</Badge>
                      </Td>
                      <Td className="text-ink-muted whitespace-nowrap">{statusLabel[r.status] || r.status}</Td>
                      <Td className="whitespace-nowrap">
                        {r.clicked_at && (
                          <Badge tone="good" dot>
                            клик
                          </Badge>
                        )}
                        {r.opened_at && !r.clicked_at && <Badge tone="neutral">открыто</Badge>}
                      </Td>
                      <Td className="text-ink-faint whitespace-nowrap">{fmt(r.created_at)}</Td>
                      <Td className="text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setPreviewRow(r)}
                            disabled={!r.rendered_content}
                            title={r.rendered_content ? "Превью сообщения" : "Нет снимка содержимого (отправлено до этой функции)"}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted enabled:hover:text-ink enabled:hover:bg-surface-2 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                          >
                            <IconEye size={15} stroke={1.8} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setContextRow(r)}
                            disabled={!r.raw_context}
                            title={r.raw_context ? "Сырой контекст отправки" : "Нет снимка контекста (отправлено до этой функции)"}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted enabled:hover:text-ink enabled:hover:bg-surface-2 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
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
          <h2 className="text-sm font-semibold m-0">Заказы{orders.length > 0 && ` — ${revenueTotal.toLocaleString("ru-RU")} ₽`}</h2>
          {orders.length === 0 ? (
            <p className="text-[13px] text-ink-faint mt-2 mb-0">Атрибутированных заказов нет.</p>
          ) : (
            <div className="overflow-x-auto pretty-scroll">
              <table className="w-full border-collapse text-[13px] mt-3">
                <thead>
                  <tr>
                    <Th>Номер</Th>
                    <Th>Рассылка</Th>
                    <Th>Оплата</Th>
                    <Th right>Сумма</Th>
                    <Th>Когда</Th>
                  </tr>
                </thead>
                <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-border first:border-t-0">
                    <Td className="whitespace-nowrap">{o.order_number || "—"}</Td>
                    <Td className="text-ink-muted truncate max-w-[220px]">{o.campaigns?.title || "—"}</Td>
                    <Td>{o.is_paid && <Badge tone="good">оплачен</Badge>}</Td>
                    <Td className="text-right tabular-nums">{Number(o.revenue).toLocaleString("ru-RU")} ₽</Td>
                    <Td className="text-ink-faint whitespace-nowrap">{fmt(o.created_at)}</Td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
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
                    <tr key={h.key} className="border-t border-border first:border-t-0">
                      {h.kind === "channel" ? (
                        <>
                          <Td className="whitespace-nowrap">
                            <Badge tone="accent">{channelLabel[h.channel] || h.channel}</Badge>
                          </Td>
                          <Td className="text-ink-muted truncate max-w-[280px]">
                            <Badge tone={h.active ? "good" : "neutral"}>{h.active ? "включён" : "отключён"}</Badge>
                            {h.contact && <span className="ml-1.5">{h.contact}</span>}
                          </Td>
                        </>
                      ) : h.kind === "field" ? (
                        <>
                          <Td className="whitespace-nowrap">
                            <Badge tone="accent">{displayField(h.field)}</Badge>
                          </Td>
                          <Td className="text-ink-muted truncate max-w-[280px]">
                            {h.old_value || "—"} → {h.new_value || "—"}
                          </Td>
                        </>
                      ) : (
                        <>
                          <Td className="whitespace-nowrap">
                            <Badge tone="accent">Устройство: {platformLabel[h.platform] || h.platform}</Badge>
                          </Td>
                          <Td className="text-ink-muted truncate max-w-[280px]">
                            <Badge tone={!h.is_active ? "bad" : h.paused ? "warn" : "good"} dot>
                              {!h.is_active ? "отвалилось" : h.paused ? "на паузе" : "активно"}
                            </Badge>
                            {h.ymClientId && (
                              <span className="ml-1.5 font-mono text-[11.5px]" title="ClientID Яндекс.Метрики">
                                ym: {h.ymClientId}
                              </span>
                            )}
                          </Td>
                        </>
                      )}
                      <Td className="text-ink-faint whitespace-nowrap">{fmt(h.created_at)}</Td>
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
        <MessagePreviewModal label={previewRow.campaigns?.title || "Превью"} content={recipientPreviewContent(previewRow)} onClose={() => setPreviewRow(null)} />
      )}
      {contextRow?.raw_context && (
        <RawContextModal label={contextRow.campaigns?.title || "Контекст отправки"} snapshot={contextRow.raw_context} onClose={() => setContextRow(null)} />
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
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink cursor-pointer shrink-0" title="Закрыть">
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
    className={`px-2 first:pl-0 last:pr-0 pb-1.5 text-[11px] text-ink-faint font-normal whitespace-nowrap ${right ? "text-right" : "text-left"}`}
  >
    {children}
  </th>
);
