"use client";

import type { ReactNode } from "react";
import { Card, SegmentedControl } from "@/app/ui";

export type PreviewDevice = "phone" | "desktop";

// Общая сцена предпросмотра виджетов: рамка телефона (пропорции современного
// смартфона 9:19,5) или окно браузера на компьютере с заглушкой витрины внутри.
// Содержимое виджета рисуют вызывающие компоненты (абсолютное позиционирование
// внутри рамки), этот компонент отвечает только за сцену и переключатель.
export function PreviewCard<T extends string>({
  title = "Предпросмотр",
  value,
  onChange,
  options,
  children,
}: {
  title?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm font-semibold text-ink">{title}</div>
        <SegmentedControl value={value} onChange={onChange} options={options} className="flex-wrap" />
      </div>
      {children}
    </Card>
  );
}

function SiteSkeleton() {
  return (
    <div className="p-4 flex flex-col gap-2.5 opacity-60" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="h-3 w-[74px] rounded bg-border-strong" />
        <div className="flex gap-1.5">
          <div className="h-3 w-[22px] rounded bg-border" />
          <div className="h-3 w-[22px] rounded bg-border" />
        </div>
      </div>
      <div className="h-[78px] rounded-[10px] bg-surface-2 border border-border" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-surface-2 border border-border" />
        ))}
      </div>
    </div>
  );
}

export function DeviceStage({ device, children }: { device: PreviewDevice; children: ReactNode }) {
  return (
    <div className="mt-3 flex justify-center rounded-xl border border-border bg-surface-2 px-3 py-5">
      {device === "phone" ? (
        <div className="relative w-full max-w-[290px] aspect-[9/19.5] rounded-[36px] border-[7px] border-ink bg-surface overflow-hidden">
          <SiteSkeleton />
          {children}
        </div>
      ) : (
        <div className="relative w-full h-[340px] rounded-[10px] border border-border-strong bg-surface overflow-hidden">
          <SiteSkeleton />
          {children}
        </div>
      )}
    </div>
  );
}
