"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown } from "@tabler/icons-react";
import { Button } from "./Button";
import { cn } from "./cn";

// Выпадающий список массовых действий над выбранными строками — та же
// механика (клик снаружи/Escape закрывают, позиционирование, анимация), что
// и у CustomSelect, но пункты не «выбираются» насовсем, а сразу выполняют
// действие и закрывают список. Удаление сюда, как правило, не входит — оно
// опаснее остальных, поэтому у него обычно своя отдельная всегда видимая
// кнопка рядом (см. вызовы в SubscribersTable/TemplatesManager).
//
// Список рендерится порталом в document.body с position:fixed — таблицы, где
// эта кнопка обычно стоит, часто сами горизонтально прокручиваются
// (overflow-x-auto), а это обрезает обычный absolute-потомок (см. CustomSelect).
// Список прижат правым краем к кнопке — держим через style.right, не left,
// чтобы не знать его ширину заранее.
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
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  function updatePosition() {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
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

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        {label}
        <IconChevronDown size={14} stroke={2} className={cn("transition-transform", open && "rotate-180")} />
      </Button>

      {open &&
        pos &&
        createPortal(
          <ul
            ref={listRef}
            role="menu"
            className="fixed z-[200] min-w-[13rem] rounded-lg border border-border bg-surface shadow-lg py-1"
            style={{ top: pos.top, right: pos.right, animation: "ui-pop .12s ease-out" }}
          >
            {items.map((item) => (
              <li key={item.label} role="menuitem">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className="flex items-center gap-2 w-full text-left text-sm px-3 py-2 text-ink hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  {item.icon}
                  {item.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  );
}
