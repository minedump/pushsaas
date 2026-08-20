"use client";

import { useState } from "react";
import { Card } from "@/app/ui";
import { cn } from "@/app/ui/cn";

type ChannelCounts = { push: number; sms: number; email: number; total: number };
type Period = "today" | "week" | "month";

const PERIOD_LABEL: Record<Period, string> = { today: "Сегодня", week: "Неделя", month: "Месяц" };

export default function DashboardMetrics({ metrics }: { metrics: Record<Period, ChannelCounts> }) {
  const [period, setPeriod] = useState<Period>("today");
  const m = metrics[period];

  return (
    <div>
      <div className="inline-flex gap-1 p-1 rounded-lg bg-surface-2 border border-border">
        {(["today", "week", "month"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              "px-3 py-1.5 rounded-md text-[13px] font-medium cursor-pointer transition-colors",
              p === period ? "bg-accent-tint text-accent" : "text-ink-muted hover:text-ink"
            )}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      <div className="flex gap-3 flex-wrap mt-3">
        <Tile label="Push" value={m.push} />
        <Tile label="SMS" value={m.sms} />
        <Tile label="Email" value={m.email} />
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex-1 min-w-[130px]">
      <div className="text-ink-muted text-xs">{label}</div>
      <div className="text-[26px] font-bold tabular-nums">{value.toLocaleString("ru-RU")}</div>
    </Card>
  );
}
