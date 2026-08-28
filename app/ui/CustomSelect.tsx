"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown, IconCheck } from "@tabler/icons-react";
import { cn } from "./cn";

export type ComboOption = { value: string; label: string; disabled?: boolean };

// Настоящий выпадающий список (кнопка + позиционированный div), а не
// стилизованный нативный <select> — у нативного список опций рисует сама ОС
// и его нельзя оформить кросс-браузерно (см. Select.tsx, там как раз этот
// компромисс). Здесь список — обычная разметка, значит стили/тема/анимация
// применяются как к любому другому элементу страницы.
//
// Список рендерится порталом в document.body с position:fixed, а не как
// обычный absolute-потомок триггера — иначе его обрезает и добавляет
// скроллбар любой предок с overflow (например таблица со горизонтальной
// прокруткой, см. ClientsTable.tsx). Позиция считается от getBoundingClientRect
// триггера и пересчитывается на scroll/resize, пока список открыт.
export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Выберите",
  className,
  ariaLabel,
  footer,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  // Доп. пункт под списком опций (например «+ Создать проект») — не
  // выбираемая опция, а произвольное действие, поэтому передаётся как
  // готовый узел (ссылка/кнопка), а не как ComboOption.
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  function updatePosition() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 192) });
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
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
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

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className={cn("relative inline-block text-left", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center justify-between gap-2 w-full text-sm pl-3 pr-2.5 py-2 rounded-lg border border-border bg-surface text-ink cursor-pointer transition-colors",
          "hover:border-accent-line focus:outline-none focus:ring-2 focus:ring-accent-line",
          open && "border-accent-line ring-2 ring-accent-line"
        )}
      >
        <span className={cn("truncate", !selected && "text-ink-faint")}>{selected ? selected.label : placeholder}</span>
        <IconChevronDown size={16} stroke={2} className={cn("shrink-0 text-ink-faint transition-transform", open && "rotate-180")} />
      </button>

      {open &&
        pos &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            className="fixed z-[200] max-h-72 overflow-auto rounded-lg border border-border bg-surface shadow-lg py-1"
            style={{ top: pos.top, left: pos.left, width: pos.width, animation: "ui-pop .12s ease-out" }}
          >
            {options.length === 0 && <li className="px-3 py-2 text-sm text-ink-faint">Нет вариантов</li>}
            {options.map((o) => (
              <li key={o.value} role="option" aria-selected={o.value === value} aria-disabled={o.disabled}>
                <button
                  type="button"
                  disabled={o.disabled}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
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
                  {o.value === value && <IconCheck size={15} stroke={2.2} className="shrink-0" />}
                </button>
              </li>
            ))}
            {footer && (
              <>
                <li role="presentation" className="my-1 h-px bg-border" />
                <li>{footer}</li>
              </>
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}
