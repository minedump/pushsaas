"use client";

import { cn } from "@/app/ui";

const PLATFORM_OPTIONS: { value: string; label: string }[] = [
  { value: "ios", label: "iPhone" },
  { value: "android", label: "Android" },
  { value: "desktop", label: "Desktop" },
];
export const PLATFORM_VALUES = PLATFORM_OPTIONS.map((o) => o.value);

// Доп. фильтр push-аудитории по платформе устройства — сужает уже
// резолвленных по контактам/сегменту получателей, не отдельный источник
// аудитории (см. dispatchCampaign/countAudience в lib/sender.ts). Пусто =
// без фильтра, все платформы.
export function PlatformFilter({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {PLATFORM_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => toggle(o.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg border text-[13px] cursor-pointer transition-colors",
            value.includes(o.value) ? "border-accent-line bg-accent-tint text-accent" : "border-border bg-surface text-ink-muted hover:text-ink"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
