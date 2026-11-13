"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown, IconLock } from "@tabler/icons-react";
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
  limit,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
  allowCustom?: boolean;
  // Сколько вариантов показывать, пока человек ничего не ввёл: остальные находятся поиском.
  // Нужен там, где подсказок много, а раскрытый список на весь экран только мешает.
  limit?: number;
  // заблокированный выбор: не открывается и не редактируется, затемнён, вместо стрелки замок
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Поиск начинается с первой набранной буквы: при открытии показываем подсказки, а не только
  // совпадающие с уже записанным значением (иначе из заполненного поля нельзя выбрать другой вариант).
  const [typed, setTyped] = useState(false);
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
      setTyped(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        setTyped(false);
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

  const q = typed ? query.trim().toLowerCase() : "";
  const matches = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options;
  const filtered = !q && limit ? matches.slice(0, limit) : matches;
  const hiddenCount = matches.length - filtered.length;
  // свой вариант: напечатанного нет среди подсказок, а свободный ввод разрешён
  const customText = allowCustom && typed ? query.trim() : "";
  const showCustom = !!customText && !options.some((o) => o.value === customText);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative group">
        <input
          type="text"
          disabled={disabled}
          value={open ? query : allowCustom ? value : selected?.label || ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setTyped(true);
            if (!open) setOpen(true);
            if (allowCustom) onChange(e.target.value);
          }}
          onFocus={(e) => {
            setOpen(true);
            setTyped(false);
            setQuery(allowCustom ? value : "");
            e.target.select();
          }}
          placeholder={selected ? selected.label : placeholder}
          className={cn(
            "w-full text-sm pl-3 pr-8 py-2 rounded-xl border border-border bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent-line",
            "disabled:opacity-60 disabled:cursor-not-allowed",
            allowCustom ? "cursor-text" : "cursor-pointer"
          )}
        />
        {disabled ? (
          <IconLock size={16} stroke={1.8} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        ) : (
          <IconChevronDown
            size={16}
            stroke={2}
            className={cn(
              "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint transition-[transform,color] group-hover:text-ink",
              open && "rotate-180"
            )}
          />
        )}
      </div>

      {open &&
        pos &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            className="fixed z-[200] max-h-72 overflow-auto pretty-scroll rounded-xl border border-border bg-surface shadow-lg p-1"
            style={{ top: pos.top, left: pos.left, width: pos.width, animation: "ui-pop .12s ease-out" }}
          >
            {showCustom && (
              <li role="option" aria-selected>
                <button
                  type="button"
                  onClick={() => {
                    onChange(customText);
                    setOpen(false);
                    setQuery("");
                    setTyped(false);
                  }}
                  className="flex items-center gap-2 w-full text-left text-sm px-3 py-2 rounded-lg text-accent bg-accent-tint cursor-pointer"
                >
                  <span className="truncate">Использовать «{customText}»</span>
                </button>
              </li>
            )}
            {filtered.length === 0 && !showCustom && <li className="px-3 py-2 text-sm text-ink-faint">{emptyText}</li>}
            {filtered.map((o) => (
              <li key={o.value} role="option" aria-selected={o.value === value} aria-disabled={o.disabled}>
                <button
                  type="button"
                  disabled={o.disabled}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQuery("");
                    setTyped(false);
                  }}
                  className={cn(
                    "flex items-center justify-between gap-2 w-full text-left text-sm px-3 py-2 rounded-lg transition-colors",
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
            {hiddenCount > 0 && <li className="px-3 py-2 text-xs text-ink-faint">Ещё {hiddenCount}: начните вводить, чтобы найти</li>}
          </ul>,
          document.body
        )}
    </div>
  );
}
