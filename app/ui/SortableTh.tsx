"use client";

import { IconArrowUp, IconArrowDown, IconArrowsSort } from "@tabler/icons-react";
import { cn } from "./cn";

export type SortDir = "asc" | "desc";

// Заголовок колонки с сортировкой — клик циклит asc → desc → снят (обратно
// к порядку сервера). Общий для SubscribersTable/CampaignsTable/
// TemplatesManager — везде своя логика сравнения значений, но одинаковый
// вид и поведение заголовка.
export function SortableTh<K extends string>({
  label,
  sortKey,
  active,
  dir,
  onClick,
  right,
}: {
  label: string;
  sortKey: K;
  active: boolean;
  dir: SortDir;
  onClick: (key: K) => void;
  right?: boolean;
}) {
  return (
    <th className={cn("px-3.5 py-2.5 text-[11px] uppercase tracking-wider font-normal whitespace-nowrap", right ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 cursor-pointer transition-colors",
          active ? "text-ink" : "text-ink-faint hover:text-ink"
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <IconArrowUp size={12} stroke={2.2} />
          ) : (
            <IconArrowDown size={12} stroke={2.2} />
          )
        ) : (
          <IconArrowsSort size={12} stroke={2} className="opacity-40" />
        )}
      </button>
    </th>
  );
}
