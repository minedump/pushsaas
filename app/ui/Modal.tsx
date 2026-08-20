"use client";

import { useEffect } from "react";
import { cn } from "./cn";

// Общая обёртка для попапов с произвольным содержимым (не confirm/prompt —
// для тех есть useDialogs, см. Dialogs.tsx). Даёт всем модалкам в проекте
// одинаковый оверлей, анимацию, закрытие по клику вне и по Esc — раньше
// каждая модалка копировала эту разметку вручную и расходилась в деталях.
export function Modal({
  onClose,
  children,
  className,
}: {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4"
      style={{ animation: "ui-fade .12s ease-out" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={cn("w-full bg-surface border border-border rounded-2xl p-5 shadow-2xl", className || "max-w-sm")} style={{ animation: "ui-pop .16s ease-out" }}>
        {children}
      </div>
    </div>
  );
}
