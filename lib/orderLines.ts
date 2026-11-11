// Состав заказа из вебхука магазина (InSales: order_lines). Храним по позиции то, что
// нужно для истории покупок: товар, количество и цену уже со скидкой. Саму скидку и
// доставку не храним: InSales сам распределяет скидку по позициям (full_sale_price и
// full_total_price — после скидки), сумма по позициям равна items_price заказа.
export type OrderLine = {
  line_id: string | null;
  product_id: string | null;
  variant_id: string | null;
  sku: string | null;
  barcode?: string | null;
  title: string;
  quantity: number;
  price: number; // цена за единицу после скидки
  sum: number; // сумма по позиции после скидки
};

export type OrderLineChange = {
  title: string;
  field: "added" | "removed" | "quantity" | "price";
  from: number | null;
  to: number | null;
};

const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// null — в теле нет order_lines (состав не трогаем); массив — актуальный состав.
export function parseOrderLines(body: unknown): OrderLine[] | null {
  const raw = (body as { order_lines?: unknown } | null)?.order_lines;
  if (!Array.isArray(raw)) return null;
  return raw.slice(0, 200).map((l) => {
    const x = (l || {}) as Record<string, unknown>;
    const quantity = num(x.quantity) || 1;
    // InSales распределяет скидку заказа по позициям: full_total_price и full_sale_price — после
    // всех скидок (сумма по позициям равна items_price заказа), total_price и sale_price — до
    // скидки заказа. Берём значения после скидки, если они есть.
    const sumRaw = x.full_total_price ?? x.total_price;
    const priceRaw = x.full_sale_price ?? x.sale_price;
    const sum = sumRaw != null ? num(sumRaw) : num(priceRaw) * quantity;
    const price = priceRaw != null ? num(priceRaw) : quantity ? sum / quantity : 0;
    return {
      line_id: str(x.id),
      product_id: str(x.product_id),
      variant_id: str(x.variant_id),
      sku: str(x.sku),
      barcode: str(x.barcode),
      title: String(x.title ?? "Товар").slice(0, 300),
      quantity,
      price,
      sum,
    };
  });
}

const keyOf = (l: OrderLine) => l.line_id || `${l.variant_id ?? ""}|${l.sku ?? ""}|${l.title}`;

// Что изменилось между прошлым и новым составом: позиция добавлена или убрана, поменялось
// количество или цена за единицу (в том числе после снятия или добавления скидки).
export function diffOrderLines(prev: OrderLine[], next: OrderLine[]): OrderLineChange[] {
  if (!prev.length) return [];
  const before = new Map(prev.map((l) => [keyOf(l), l]));
  const after = new Map(next.map((l) => [keyOf(l), l]));
  const out: OrderLineChange[] = [];
  for (const [k, n] of after) {
    const p = before.get(k);
    if (!p) {
      out.push({ title: n.title, field: "added", from: null, to: n.sum });
      continue;
    }
    if (p.quantity !== n.quantity) out.push({ title: n.title, field: "quantity", from: p.quantity, to: n.quantity });
    if (Math.abs(p.price - n.price) > 0.005) out.push({ title: n.title, field: "price", from: p.price, to: n.price });
  }
  for (const [k, p] of before) if (!after.has(k)) out.push({ title: p.title, field: "removed", from: p.sum, to: null });
  return out;
}
