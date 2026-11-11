"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconSearch, IconX, IconPackage } from "@tabler/icons-react";
import { Badge, Card, Input, Pagination } from "@/app/ui";
import { CustomSelect, type ComboOption } from "@/app/ui/CustomSelect";
import { formatDateTime } from "@/lib/datetime";

export type ProductRow = {
  external_id: string;
  group_id: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number | null;
  old_price: number | null;
  image_url: string | null;
  url: string | null;
  categories: string[] | null;
  params: Record<string, string> | null;
  available: boolean | null;
  stock: number | null;
  source: string;
  archived_at: string | null;
  last_order_at: string | null;
  updated_at: string;
};

const SOURCE_OPTIONS: ComboOption[] = [
  { value: "all", label: "Все источники" },
  { value: "feed", label: "Из фида" },
  { value: "order", label: "Только из заказов" },
];
const AVAIL_OPTIONS: ComboOption[] = [
  { value: "all", label: "Любое наличие" },
  { value: "in", label: "В наличии" },
  { value: "out", label: "Нет в наличии" },
  { value: "archived", label: "Пропали из фида" },
  { value: "unknown", label: "Наличие неизвестно" },
];

const money = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

export default function ProductsView({
  projectId,
  rows,
  matched,
  pageSize,
  page,
  filters,
  stats,
  feed,
  timezone,
}: {
  projectId: string;
  rows: ProductRow[];
  matched: number;
  pageSize: number;
  page: number;
  filters: { q: string; source: string; avail: string };
  stats: { total: number; fromFeed: number; fromOrders: number; archived: number };
  feed: { connected: boolean; updatedAt: string | null; error: string | null };
  timezone: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const current = useSearchParams();
  const [query, setQuery] = useState(filters.q);
  const first = useRef(true);

  function go(next: Record<string, string | null>) {
    const p = new URLSearchParams(current.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v || v === "all") p.delete(k);
      else p.set(k, v);
    }
    router.push(`${pathname}${p.toString() ? `?${p.toString()}` : ""}`);
  }

  // поиск выполняется на сервере, после паузы в наборе
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => go({ q: query.trim() || null, page: null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <main className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold m-0">Товары</h1>
      <p className="text-[13px] text-ink-muted mt-1 mb-4">
        Общий каталог проекта. Его пополняют фид и заказы: запись из заказа неполная (id, название, артикул), и фид перезаписывает её целиком, когда
        этот вариант в нём появляется. Товар, пропавший из фида, остаётся в каталоге с нулевым остатком.
      </p>

      <div className="grid gap-3 sm:grid-cols-4 mb-4">
        <Stat label="Всего вариантов" value={stats.total} />
        <Stat label="Из фида" value={stats.fromFeed} />
        <Stat label="Только из заказов" value={stats.fromOrders} hint="пока нет в фиде" />
        <Stat label="Пропали из фида" value={stats.archived} hint="остаток обнулён" />
      </div>

      {!feed.connected && (
        <Card className="mb-4">
          <div className="text-[13px]">
            Фид товаров не подключён, поэтому в каталоге только товары из заказов (без цены, картинки и категорий).{" "}
            <Link href={`/admin/projects/${projectId}/settings`} className="text-accent hover:underline">
              Подключить фид в «Настройках»
            </Link>
            .
          </div>
        </Card>
      )}
      {feed.connected && feed.error && (
        <Card className="mb-4 border-bad bg-bad-tint">
          <div className="text-[13px]">Фид не обновился: {feed.error}</div>
        </Card>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <CustomSelect value={filters.source} onChange={(v) => go({ source: v, page: null })} options={SOURCE_OPTIONS} className="w-[190px]" />
        <CustomSelect value={filters.avail} onChange={(v) => go({ avail: v, page: null })} options={AVAIL_OPTIONS} className="w-[200px]" />
        <div className="relative flex-1 min-w-[220px]">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: название, артикул, штрихкод, ID варианта или товара" className="pl-9 pr-9" />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-ink transition-colors cursor-pointer"
              aria-label="Очистить поиск"
            >
              <IconX size={15} stroke={2} />
            </button>
          )}
        </div>
      </div>

      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
        <table className="w-full border-collapse text-[13.5px] min-w-[980px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Товар</Th>
              <Th>Артикул</Th>
              <Th>ID варианта / товара</Th>
              <Th>Цена</Th>
              <Th>Наличие</Th>
              <Th>Категории</Th>
              <Th>Источник</Th>
              <Th>Обновлено</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const params = Object.entries(r.params ?? {}).filter(([k]) => !["vendor", "manufacturer", "country_of_origin", "weight"].includes(k));
              return (
                <tr key={r.external_id} className="border-t border-border row-hover align-top">
                  <Td>
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-surface-2 overflow-hidden shrink-0 flex items-center justify-center text-ink-faint">
                        {r.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <IconPackage size={18} stroke={1.6} />
                        )}
                      </div>
                      <div className="min-w-0 max-w-[340px]">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
                            {r.name}
                          </a>
                        ) : (
                          <span className="font-medium">{r.name}</span>
                        )}
                        {params.length > 0 && (
                          <div className="text-[12px] text-ink-muted mt-0.5">{params.slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td className="font-mono text-[12.5px] whitespace-nowrap">{r.sku || <span className="text-ink-faint">—</span>}</Td>
                  <Td className="font-mono text-[12px] whitespace-nowrap">
                    <div>{r.external_id}</div>
                    <div className="text-ink-faint">{r.group_id || "—"}</div>
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {r.price != null ? (
                      <>
                        <div>{money(Number(r.price))}</div>
                        {r.old_price != null && Number(r.old_price) > Number(r.price) && (
                          <div className="text-[12px] text-ink-faint line-through">{money(Number(r.old_price))}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {r.archived_at ? (
                      <Badge tone="bad">пропал из фида</Badge>
                    ) : r.available === true ? (
                      <Badge tone="good">в наличии{r.stock != null ? `: ${r.stock}` : ""}</Badge>
                    ) : r.available === false ? (
                      <Badge tone="warn">нет в наличии</Badge>
                    ) : (
                      <span className="text-ink-faint">неизвестно</span>
                    )}
                  </Td>
                  <Td>
                    {r.categories?.length ? (
                      <div className="flex gap-1 flex-wrap max-w-[220px]">
                        {r.categories.slice(0, 3).map((c) => (
                          <Badge key={c} tone="neutral">
                            {c}
                          </Badge>
                        ))}
                        {r.categories.length > 3 && <span className="text-[12px] text-ink-faint">+{r.categories.length - 3}</span>}
                      </div>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {r.source === "feed" ? <Badge tone="accent">фид</Badge> : <Badge tone="neutral">заказ</Badge>}
                    {r.last_order_at && <div className="text-[12px] text-ink-faint mt-0.5">заказ: {formatDateTime(r.last_order_at, timezone)}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-[12.5px] text-ink-muted">{formatDateTime(r.archived_at || r.updated_at, timezone)}</Td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3.5 py-6 text-center text-ink-muted">
                  {stats.total === 0 ? "Каталог пуст: товары появятся из фида или после первых заказов." : "Ничего не найдено"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} total={matched} pageSize={pageSize} onChange={(p) => go({ page: p > 1 ? String(p) : null })} />
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <div className="text-[12px] text-ink-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-0.5">{value.toLocaleString("ru-RU")}</div>
      {hint && <div className="text-[11.5px] text-ink-faint mt-0.5">{hint}</div>}
    </Card>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => <th className="px-3.5 py-2.5 text-[11px] text-ink-muted font-normal whitespace-nowrap">{children}</th>;
const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <td className={`px-3.5 py-3 ${className}`}>{children}</td>;
