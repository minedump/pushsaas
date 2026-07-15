import { IconChevronDown } from "@tabler/icons-react";
import { cn } from "./cn";

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative inline-flex items-center">
      <select
        className={cn(
          "appearance-none text-sm pl-3 pr-9 py-2 rounded-lg border border-border bg-surface text-ink cursor-pointer",
          "focus:outline-none focus:ring-2 focus:ring-accent-line",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <IconChevronDown size={16} stroke={2} className="absolute right-2.5 pointer-events-none text-ink-faint" />
    </div>
  );
}
