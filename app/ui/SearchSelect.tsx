"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown } from "@tabler/icons-react";
import { cn } from "./cn";
import type { ComboOption } from "./CustomSelect";

// Как CustomSelect, но список фильтруется вводом — нужен там, где вариантов
// может стать много (шаблоны: список растёт без предела, обычный <select>/
// CustomSelect со скроллом на полсотни строк невозможно использовать). Открыт
// — печатаешь и видишь совпадения; закрыт — показывает название выбранного.
//
// allowCustom — для полей, где options — это только ПОДСКАЗКИ (имя события,
// имя списка), а не закрытый набор: value отражает то, что реально напечатано
// (не обязано совпадать ни с одной option), клик по подсказке просто
// подставляет её текст. Замена нативному <input list="…"><datalist> —
// тот же смысл (текст + подсказки), но в едином со всем проектом стиле
// выпадающего списка, а не системном виде datalist.
//
// Список рендерится порталом в document.body с position:fixed — как у
// CustomSelect (см. его комментарий): поле часто стоит внутри модалки/карточки
// с overflow, обычный absolute-потомок список бы обрезал.
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Выберите",
  emptyText = "Ничего не найдено",
  className,
  allowCustom = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
  allowCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);

  function updatePosition() {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    function onReposition() {
      updatePosition();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open]);

  const filtered = query.trim() ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : options;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative group">
        <input
          type="text"
          value={open ? query : allowCustom ? value : selected?.label || ""}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
            if (allowCustom) onChange(e.target.value);
          }}
          onFocus={(e) => {
            setOpen(true);
            setQuery(allowCustom ? value : "");
            e.target.select();
          }}
          placeholder={selected ? selected.label : placeholder}
          className={cn(
            "w-full text-sm pl-3 pr-8 py-2 rounded-lg border border-border bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent-line",
            allowCustom ? "cursor-text" : "cursor-pointer"
          )}
        />
        <IconChevronDown
          size={16}
          stroke={2}
          className={cn(
            "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint transition-[transform,color] group-hover:text-ink",
            open && "rotate-180"
          )}
        />
      </div>

      {open &&
        pos &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            className="fixed z-[200] max-h-72 overflow-auto rounded-lg border border-border bg-surface shadow-lg py-1"
            style={{ top: pos.top, left: pos.left, width: pos.width, animation: "ui-pop .12s ease-out" }}
          >
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-ink-faint">{emptyText}</li>}
            {filtered.map((o) => (
              <li key={o.value} role="option" aria-selected={o.value === value} aria-disabled={o.disabled}>
                <button
                  type="button"
                  disabled={o.disabled}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex items-center justify-between gap-2 w-full text-left text-sm px-3 py-2 transition-colors",
                    o.disabled
                      ? "text-ink-faint opacity-50 cursor-not-allowed"
                      : o.value === value
                      ? "bg-accent-tint text-accent font-semibold cursor-pointer"
                      : "text-ink hover:bg-surface-2 cursor-pointer"
                  )}
                >
                  <span className="truncate">{o.label}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  );
}
