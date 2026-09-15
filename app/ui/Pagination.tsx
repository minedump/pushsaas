"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Button } from "./Button";
import { cn } from "./cn";

// Раньше эта разметка (диапазон + стрелки + «страница из скольки») была
// продублирована дословно в CampaignsTable/LogTabs/SubscribersTable/
// TemplatesManager/ClientsTable — один источник правды вместо пяти копий.
// page — уже зажатый вызывающим в границы номер (тот же, которым он режет
// свой массив на страницу) — компонент его не пересчитывает заново, только
// показывает; total/pageSize нужны исключительно для текста диапазона и
// числа страниц.
export function Pagination({
  page,
  total,
  pageSize,
  onChange,
  className,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  if (total === 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className={cn("flex items-center justify-between mt-3 text-[13px] text-ink-muted", className)}>
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} из {total}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <IconChevronLeft size={15} stroke={2} />
        </Button>
        <span className="tabular-nums">
          {page} / {pageCount}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
          <IconChevronRight size={15} stroke={2} />
        </Button>
      </div>
    </div>
  );
}
