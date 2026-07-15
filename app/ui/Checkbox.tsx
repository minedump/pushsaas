"use client";

import { cn } from "./cn";

export function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm cursor-pointer select-none", className)}>
      <span
        className={cn(
          "grid place-items-center w-[18px] h-[18px] rounded-[5px] border transition-colors",
          checked ? "bg-accent border-accent text-white" : "bg-surface border-border"
        )}
      >
        {checked && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
