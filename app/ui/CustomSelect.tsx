"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconCheck } from "@tabler/icons-react";
import { cn } from "./cn";

export type ComboOption = { value: string; label: string; disabled?: boolean };

// Настоящий выпадающий список (кнопка + позиционированный div), а не
// стилизованный нативный <select> — у нативного список опций рисует сама ОС
// и его нельзя оформить кросс-браузерно (см. Select.tsx, там как раз этот
// компромисс). Здесь список — обычная разметка, значит стили/тема/анимация
// применяются как к любому другому элементу страницы.
export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Выберите",
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className={cn("relative inline-block text-left", className)}>
      <button
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

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-30 mt-1.5 w-full min-w-[12rem] max-h-72 overflow-auto rounded-lg border border-border bg-surface shadow-lg py-1"
          style={{ animation: "ui-pop .12s ease-out" }}
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
        </ul>
      )}
    </div>
  );
}
