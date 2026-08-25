import { IconChevronDown } from "@tabler/icons-react";
import { cn } from "./cn";

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  // className (w-full, w-40, flex-1 и т.п.) — это размер целиком ВСЕГО
  // контрола, поэтому идёт на внешний div, а не на сам <select>: тот внутри
  // — inline-flex (сам по себе сжимается по содержимому), и className,
  // применённый только к <select>, не заставлял бы обёртку растягиваться —
  // с несколькими Select в один flex-ряд (см. ExportImport.tsx) это давало
  // разную ширину полей вместо одинаковой, хотя оба получали className="w-full".
  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <select
        className="w-full appearance-none text-sm pl-3 pr-9 py-2 rounded-lg border border-border bg-surface text-ink cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-line"
        {...props}
      >
        {children}
      </select>
      <IconChevronDown size={16} stroke={2} className="absolute right-2.5 pointer-events-none text-ink-faint" />
    </div>
  );
}
