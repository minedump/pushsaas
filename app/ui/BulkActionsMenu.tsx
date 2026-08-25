"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { Button } from "./Button";
import { cn } from "./cn";

// Выпадающий список массовых действий над выбранными строками — та же
// механика (клик снаружи/Escape закрывают, позиционирование, анимация), что
// и у CustomSelect, но пункты не «выбираются» насовсем, а сразу выполняют
// действие и закрывают список. Удаление сюда, как правило, не входит — оно
// опаснее остальных, поэтому у него обычно своя отдельная всегда видимая
// кнопка рядом (см. вызовы в SubscribersTable/TemplatesManager).
export function BulkActionsMenu({
  items,
  disabled,
  label = "Действия",
}: {
  items: { label: string; icon: React.ReactNode; onClick: () => void }[];
  disabled?: boolean;
  label?: string;
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

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        {label}
        <IconChevronDown size={14} stroke={2} className={cn("transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <ul
          role="menu"
          className="absolute right-0 z-30 mt-1.5 min-w-[13rem] rounded-lg border border-border bg-surface shadow-lg py-1"
          style={{ animation: "ui-pop .12s ease-out" }}
        >
          {items.map((item) => (
            <li key={item.label} role="menuitem">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className="flex items-center gap-2 w-full text-left text-sm px-3 py-2 text-ink hover:bg-surface-2 cursor-pointer"
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
