"use client";

import { cn } from "./cn";

// label обязателен, не опционален — голый переключатель без текста рядом
// не говорит, что именно он включает/выключает ни глазами, ни скринридеру.
// Минимум — "Вкл"/"Выкл" по месту (см. AuthSettings.tsx), где нет более
// содержательного текста под рукой.
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("inline-flex items-center gap-2.5 text-sm select-none", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "relative w-9 h-5 rounded-full transition-colors shrink-0",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
          checked ? "bg-accent" : "bg-border"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-4"
          )}
        />
      </button>
      {label}
    </label>
  );
}
