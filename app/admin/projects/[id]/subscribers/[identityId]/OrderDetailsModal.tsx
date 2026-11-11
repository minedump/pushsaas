"use client";

import { IconX } from "@tabler/icons-react";
import { Badge, Modal } from "@/app/ui";
import { formatDateTime } from "@/lib/datetime";

// Заказ контакта (order_attributions) и всё, что про него показываем: в списке заказов
// карточки и в окне «Подробнее». Цены и суммы уже со скидкой и без доставки.
export type OrderRow = {
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
  // доп. поля заказа из вебхука магазина (по соответствию в Настройках)
  attributes?: Record<string, unknown> | null;
  campaigns: { title: string; internal_title?: string | null } | null;
};

export type OrderItem = {
  title: string;
  quantity: number;
  price: number;
  sum: number;
  sku?: string | null;
  product_id?: string | null;
  variant_id?: string | null;
  line_id?: string | null;
};
export type OrderChange = { title: string; field: "added" | "removed" | "quantity" | "price"; from: number | null; to: number | null };

export const FULFILLMENT_LABEL: Record<string, string> = {
  new: "новый",
  accepted: "в обработке",
  approved: "согласован",
  dispatched: "передан на доставку",
  delivered: "доставлен",
  declined: "отклонён",
  returned: "возвращён",
};
export const orderStatusLabel = (custom: string | null, fulfillment: string | null) =>
  custom || (fulfillment ? FULFILLMENT_LABEL[fulfillment] || fulfillment : "—");
export const statusName = (v: string | null) => (v ? FULFILLMENT_LABEL[v] || v : "—");
export const rub = (n: number | null) => (n == null ? "—" : `${Number(n).toLocaleString("ru-RU")} ₽`);

export function changeText(c: OrderChange): string {
  if (c.field === "added") return `добавлена позиция «${c.title}» на ${rub(c.to)}`;
  if (c.field === "removed") return `убрана позиция «${c.title}» (${rub(c.from)})`;
  if (c.field === "quantity") return `«${c.title}»: количество ${c.from} → ${c.to}`;
  return `«${c.title}»: цена за штуку ${rub(c.from)} → ${rub(c.to)}${
    c.to != null && c.from != null ? (c.to > c.from ? " (скидка уменьшена или снята)" : " (скидка добавлена или увеличена)") : ""
  }`;
}

const Cell = ({ children, right, className = "" }: { children?: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-3 py-2 align-middle ${right ? "text-right" : "text-left"} ${className}`}>{children}</td>
);
const HeadCell = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <th className={`px-3 py-2 text-[11px] text-ink-muted font-normal whitespace-nowrap ${right ? "text-right" : "text-left"}`}>{children}</th>
);

export function OrderDetailsModal({ order: o, tz, catalogNames = {}, onClose }: { order: OrderRow; tz: string; catalogNames?: Record<string, string>; onClose: () => void }) {
  const items = (Array.isArray(o.items) ? o.items : []) as OrderItem[];
  const history = (Array.isArray(o.item_history) ? o.item_history : []) as { at: string; changes: OrderChange[] }[];
  const statuses = (Array.isArray(o.status_history) ? o.status_history : []) as { at: string; from: string | null; to: string | null }[];
  const itemsTotal = items.reduce((t, it) => t + Number(it.sum || 0), 0);
  const qtyTotal = items.reduce((t, it) => t + Number(it.quantity || 0), 0);

  return (
    <Modal onClose={onClose} className="max-w-4xl max-h-[90vh] flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border shrink-0">
        <h3 className="text-base font-semibold m-0 truncate">Заказ № {o.order_number || "—"}</h3>
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink transition-colors cursor-pointer shrink-0" title="Закрыть">
          <IconX size={18} stroke={1.8} />
        </button>
      </div>

      <div className="pretty-scroll flex-1 min-h-0 overflow-y-auto -mr-2 pr-2 flex flex-col gap-5">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 text-[13px]">
          <div>
            <div className="text-[11px] text-ink-muted mb-0.5">Номер</div>
            <div>{o.order_number || "—"}</div>
          </div>
          <div>
            <div className="text-[11px] text-ink-muted mb-0.5">Привлечён</div>
            {o.campaign_id ? (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <Badge tone="good">рассылкой</Badge>
                <span className="text-ink-muted truncate">{o.campaigns?.internal_title || o.campaigns?.title || "Рассылка"}</span>
              </span>
            ) : (
              <Badge tone="neutral">не привлечён</Badge>
            )}
          </div>
          <div>
            <div className="text-[11px] text-ink-muted mb-0.5">Статус</div>
            <div>{orderStatusLabel(o.custom_status, o.fulfillment_status)}</div>
          </div>
          <div>
            <div className="text-[11px] text-ink-muted mb-0.5">Оплата</div>
            {o.is_cancelled ? <Badge tone="bad">отменён</Badge> : o.is_paid ? <Badge tone="good">оплачен</Badge> : <Badge tone="warn">не оплачен</Badge>}
          </div>
          <div>
            <div className="text-[11px] text-ink-muted mb-0.5">Сумма (товары без доставки)</div>
            <div className="tabular-nums">{rub(Number(o.revenue))}</div>
          </div>
          <div>
            <div className="text-[11px] text-ink-muted mb-0.5">Дата заказа</div>
            <div>{formatDateTime(o.ordered_at || o.created_at, tz)}</div>
          </div>
        </div>

        {o.attributes && Object.keys(o.attributes).length > 0 && (
          <div>
            <div className="text-[12px] font-medium text-ink-muted mb-1.5">Доп. поля заказа</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-[13px]">
              {Object.entries(o.attributes).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <div className="text-[11px] text-ink-muted mb-0.5 truncate">{k}</div>
                  <div className="break-words">{String(v)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-[12px] font-medium text-ink-muted mb-1.5">Состав заказа</div>
          {items.length === 0 ? (
            <p className="text-[12.5px] text-ink-faint m-0">Состав заказа не получен.</p>
          ) : (
            <div className="overflow-x-auto pretty-scroll rounded-lg border border-border">
              <table className="w-full border-collapse text-[12.5px] min-w-[760px]">
                <thead>
                  <tr className="bg-surface-2">
                    <HeadCell>№</HeadCell>
                    <HeadCell>Товар</HeadCell>
                    <HeadCell>Артикул</HeadCell>
                    <HeadCell>ID товара</HeadCell>
                    <HeadCell>ID варианта</HeadCell>
                    <HeadCell right>Кол-во</HeadCell>
                    <HeadCell right>Цена, ₽</HeadCell>
                    <HeadCell right>Сумма, ₽</HeadCell>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-t border-border">
                      <Cell className="text-ink-faint tabular-nums">{i + 1}</Cell>
                      {/* название из каталога (фид): название товара и в скобках варианты через слеш; нет в каталоге: из заказа */}
                      <Cell className="min-w-[220px]">
                        <span title={it.variant_id && catalogNames[it.variant_id] && catalogNames[it.variant_id] !== it.title ? `В заказе записано: ${it.title}` : undefined}>
                          {(it.variant_id && catalogNames[it.variant_id]) || it.title}
                        </span>
                      </Cell>
                      <Cell className="font-mono text-[11.5px] whitespace-nowrap">{it.sku || "—"}</Cell>
                      <Cell className="font-mono text-[11.5px] whitespace-nowrap">{it.product_id || "—"}</Cell>
                      <Cell className="font-mono text-[11.5px] whitespace-nowrap">{it.variant_id || "—"}</Cell>
                      <Cell right className="tabular-nums">{it.quantity}</Cell>
                      <Cell right className="tabular-nums whitespace-nowrap">{Number(it.price).toLocaleString("ru-RU")}</Cell>
                      <Cell right className="tabular-nums whitespace-nowrap">{Number(it.sum).toLocaleString("ru-RU")}</Cell>
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-surface-2 font-semibold">
                    <Cell> </Cell>
                    <Cell>Итого</Cell>
                    <Cell> </Cell>
                    <Cell> </Cell>
                    <Cell> </Cell>
                    <Cell right className="tabular-nums">{qtyTotal}</Cell>
                    <Cell> </Cell>
                    <Cell right className="tabular-nums whitespace-nowrap">{itemsTotal.toLocaleString("ru-RU")}</Cell>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11.5px] text-ink-faint mt-1.5 mb-0">Цена и сумма уже со скидкой, без доставки.</p>
        </div>

        {statuses.length > 0 && (
          <div>
            <div className="text-[12px] font-medium text-ink-muted mb-1.5">История статуса</div>
            <ul className="m-0 pl-5 grid gap-1 text-[12.5px]">
              {statuses.map((h, i) => (
                <li key={i}>
                  <span className="text-ink-faint">{formatDateTime(h.at, tz)}</span> {statusName(h.from)} → {statusName(h.to)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {history.length > 0 && (
          <div>
            <div className="text-[12px] font-medium text-ink-muted mb-1.5">Изменения позиций</div>
            <ul className="m-0 pl-5 grid gap-1 text-[12.5px]">
              {history.flatMap((h, i) =>
                h.changes.map((c, j) => (
                  <li key={`${i}-${j}`}>
                    <span className="text-ink-faint">{formatDateTime(h.at, tz)}</span> {changeText(c)}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
