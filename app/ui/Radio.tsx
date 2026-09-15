"use client";

import { cn } from "./cn";

// Тот же рисунок, что у Checkbox.tsx (18px, border-border/bg-surface в покое,
// accent при выборе) — только кружок с точкой вместо квадрата с галочкой,
// поскольку это взаимоисключающий выбор одного варианта из нескольких, а не
// независимые да/нет. name группирует несколько Radio в одну натив-группу
// (клавиатурная навигация стрелками между ними — бесплатно от браузера).
// Как и label у Toggle — обязателен, не опционален: кружок без подписи не
// говорит, что именно выбирает.
export function Radio({
  checked,
  onChange,
  label,
  name,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: () => void;
  label: React.ReactNode;
  name: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex items-start gap-2 text-sm select-none",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className
      )}
    >
      <span
        className={cn(
          "grid place-items-center w-[18px] h-[18px] mt-[0.5px] rounded-full border shrink-0 transition-colors",
          checked ? "border-accent" : "border-border bg-surface"
        )}
      >
        {checked && <span className="w-[9px] h-[9px] rounded-full bg-accent" />}
      </span>
      <input
        type="radio"
        name={name}
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={() => !disabled && onChange()}
      />
      {label}
    </label>
  );
}
