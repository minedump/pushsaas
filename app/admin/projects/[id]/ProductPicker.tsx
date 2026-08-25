"use client";

import { useEffect, useRef, useState } from "react";
import { IconX } from "@tabler/icons-react";
import { Input, Label, Select } from "@/app/ui";
import type { ProductsRule } from "@/lib/productFeed";

type ProductLite = { external_id: string; name: string; price: number | null };

// Выбор товаров для персонализации рассылки/приветственного — то же правило
// (ProductsRule), что резолвится на бэкенде: конкретный список (вручную,
// поиском по названию) либо «N новых» (по first_seen_at). Компонент хранит
// только ПРАВИЛО — сами товары резолвятся заново при реальной отправке (см.
// sendWelcomeNow) или на бэкенде формы рассылки, поэтому здесь достаточно
// имени+цены для отображения, не полного ProductFeedItem.
export function ProductPicker({
  projectId,
  hasFeed,
  value,
  onChange,
}: {
  projectId: string;
  hasFeed: boolean;
  value: ProductsRule | null;
  onChange: (v: ProductsRule | null) => void;
}) {
  const mode = value?.mode || "none";
  const [picked, setPicked] = useState<ProductLite[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductLite[]>([]);
  const [preview, setPreview] = useState<ProductLite[]>([]);
  const hydratedFor = useRef<string>("");

  // Гидрируем названия уже выбранных id — нужно и при первом рендере формы
  // редактирования (value пришёл извне с готовыми id, но без имён), и когда
  // список меняется откуда-то ещё.
  useEffect(() => {
    if (mode !== "manual" || !value) return;
    const ids = (value as { mode: "manual"; external_ids: string[] }).external_ids;
    const key = ids.join(",");
    if (!ids.length || hydratedFor.current === key) return;
    hydratedFor.current = key;
    const known = new Map(picked.map((p) => [p.external_id, p]));
    if (ids.every((id) => known.has(id))) return;
    fetch(`/api/admin/projects/${projectId}/product-feed/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule: value }),
    })
      .then((r) => r.json())
      .then((json) => setPicked((json.items || []).map((p: ProductLite) => ({ external_id: p.external_id, name: p.name, price: p.price }))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, value && value.mode === "manual" ? value.external_ids.join(",") : ""]);

  // Превью «N новых» — обновляем при смене количества/категории, чтобы было
  // видно, какие именно товары уйдут прямо сейчас (реальная отправка резолвит
  // правило заново, превью может устареть к моменту фактической отправки).
  useEffect(() => {
    if (mode !== "newest" || !value) return;
    const rule = value as { mode: "newest"; count: number; category?: string | null };
    const t = setTimeout(() => {
      fetch(`/api/admin/projects/${projectId}/product-feed/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule }),
      })
        .then((r) => r.json())
        .then((json) => setPreview((json.items || []).map((p: ProductLite) => ({ external_id: p.external_id, name: p.name, price: p.price }))))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, value && value.mode === "newest" ? value.count : 0, value && value.mode === "newest" ? value.category : ""]);

  async function search(q: string) {
    setQuery(q);
    if (!q.trim()) return setResults([]);
    const res = await fetch(`/api/admin/projects/${projectId}/product-feed/search?q=${encodeURIComponent(q.trim())}`).catch(() => null);
    const json = res && res.ok ? await res.json() : null;
    setResults((json?.items || []).map((p: ProductLite) => ({ external_id: p.external_id, name: p.name, price: p.price })));
  }

  function addProduct(p: ProductLite) {
    const ids = value?.mode === "manual" ? value.external_ids : [];
    if (ids.includes(p.external_id)) return;
    setPicked((prev) => [...prev, p]);
    onChange({ mode: "manual", external_ids: [...ids, p.external_id] });
    setQuery("");
    setResults([]);
  }
  function removeProduct(id: string) {
    setPicked((prev) => prev.filter((p) => p.external_id !== id));
    const ids = value?.mode === "manual" ? value.external_ids : [];
    onChange({ mode: "manual", external_ids: ids.filter((x) => x !== id) });
  }

  if (!hasFeed) {
    return (
      <div>
        <Label>Товары в сообщении</Label>
        <p className="text-[12px] text-ink-faint m-0">
          Товарный фид не подключён — добавьте ссылку в разделе «Настройки», чтобы вставлять товары в рассылку.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Label>Товары в сообщении</Label>
      <Select
        value={mode}
        onChange={(e) => {
          const m = e.target.value as "none" | "manual" | "newest";
          if (m === "none") onChange(null);
          else if (m === "manual") onChange({ mode: "manual", external_ids: [] });
          else onChange({ mode: "newest", count: 3, category: undefined });
        }}
        className="w-full"
      >
        <option value="none">Не использовать</option>
        <option value="manual">Выбрать вручную</option>
        <option value="newest">Автоматически — N новых товаров</option>
      </Select>

      {mode === "manual" && (
        <div className="mt-2">
          <Input value={query} onChange={(e) => search(e.target.value)} placeholder="Поиск товара по названию…" />
          {!!results.length && (
            <div className="mt-1 border border-border rounded-lg overflow-hidden">
              {results.map((p) => (
                <button
                  key={p.external_id}
                  type="button"
                  onClick={() => addProduct(p)}
                  className="w-full text-left px-3 py-2 text-[13px] hover:bg-surface-2 border-b border-border last:border-b-0"
                >
                  {p.name}
                  {p.price ? ` — ${p.price} ₽` : ""}
                </button>
              ))}
            </div>
          )}
          {!!picked.length && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {picked.map((p) => (
                <span key={p.external_id} className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full bg-surface-2 border border-border text-[12px]">
                  {p.name}
                  <button type="button" onClick={() => removeProduct(p.external_id)} className="text-ink-faint hover:text-ink p-0.5">
                    <IconX size={12} stroke={2} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "newest" && value?.mode === "newest" && (
        <div className="mt-2">
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              min={1}
              max={20}
              value={value.count}
              onChange={(e) => onChange({ mode: "newest", count: Math.max(1, Math.min(20, Number(e.target.value))), category: value.category })}
              className="w-20"
            />
            <span className="text-[13px] text-ink-muted">товаров, самые новые в фиде</span>
          </div>
          <Input
            value={value.category || ""}
            onChange={(e) => onChange({ mode: "newest", count: value.count, category: e.target.value || undefined })}
            placeholder="Категория (необязательно)"
            className="mt-2"
          />
          {!!preview.length && (
            <p className="text-[12px] text-ink-faint mt-2 mb-0">Сейчас это: {preview.map((p) => p.name).join(", ")}</p>
          )}
        </div>
      )}

      {mode !== "none" && (
        <p className="text-[11px] text-ink-faint mt-2 mb-0">
          В шаблоне доступны как <code className="font-mono">{"{{ product }}"}</code> (первый) и{" "}
          <code className="font-mono">{"{{ products }}"}</code> — переберите циклом{" "}
          <code className="font-mono">{"{% for product in products %}...{% endfor %}"}</code>, поля товара —{" "}
          <code className="font-mono">{"{{ product.name }}"}</code>/<code className="font-mono">{"{{ product.price }}"}</code>.
        </p>
      )}
    </div>
  );
}
