"use client";

import { useState } from "react";
import { Card, SegmentedControl } from "@/app/ui";

type Period = "today" | "week" | "month";
type ChannelCounts = { push: number; sms: number; email: number; total: number };
type ActiveCounts = { push: number; sms: number; email: number };
type PlatformCounts = { ios: number; android: number; desktop: number };

const PERIOD_LABEL: Record<Period, string> = { today: "Сегодня", week: "Неделя", month: "Месяц" };

// Один переключатель периода на весь дашборд — раньше стоял только над
// «Отправлено» и не влиял на «Активные подписчики»/«Push по платформам»
// (те показывали общий счётчик всех активных без учёта периода). Теперь оба
// блока тоже период-зависимые: сколько НОВЫХ подписчиков появилось (и
// остаются активными) именно за выбранное окно — см. activeSince/
// platformsSince в page.tsx.
export default function DashboardOverview({
  sent,
  active,
  platforms,
}: {
  sent: Record<Period, ChannelCounts>;
  active: Record<Period, ActiveCounts>;
  platforms: Record<Period, PlatformCounts>;
}) {
  const [period, setPeriod] = useState<Period>("today");
  const s = sent[period];
  const a = active[period];
  const p = platforms[period];

  return (
    <div>
      <SegmentedControl
        value={period}
        onChange={setPeriod}
        options={(["today", "week", "month"] as Period[]).map((k) => ({ value: k, label: PERIOD_LABEL[k] }))}
        className="mt-4"
      />

      <div className="text-[13px] text-ink-muted mt-6 mb-2">Отправлено</div>
      <div className="flex gap-3 flex-wrap">
        <Tile label="Push" value={s.push} />
        <Tile label="SMS" value={s.sms} />
        <Tile label="Email" value={s.email} />
      </div>

      <div className="text-[13px] text-ink-muted mt-6 mb-2">Активные подписчики</div>
      <div className="flex gap-3 flex-wrap">
        <Tile label="Push" value={a.push} />
        <Tile label="SMS" value={a.sms} />
        <Tile label="Email" value={a.email} />
      </div>

      <div className="text-[13px] text-ink-muted mt-6 mb-2">Push по платформам</div>
      <div className="flex gap-3 flex-wrap">
        <Tile label="iPhone (iOS)" value={p.ios} />
        <Tile label="Android" value={p.android} />
        <Tile label="Desktop" value={p.desktop} />
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
