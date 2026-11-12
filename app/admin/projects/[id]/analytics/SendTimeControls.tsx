"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/app/ui";
import { CustomSelect, type ComboOption } from "@/app/ui/CustomSelect";

const WINDOW_OPTIONS: ComboOption[] = [
  { value: "auto", label: "Авто" },
  ...[1, 2, 3, 6, 12, 24, 48, 72].map((h) => ({ value: String(h), label: `${h} ч` })),
];
const DAY_OPTIONS = [
  { value: "auto", label: "Авто" },
  { value: "dow", label: "По дням" },
  { value: "wd", label: "Будни и выходные" },
  { value: "all", label: "Все дни" },
];
const STEP_OPTIONS = [
  { value: "auto", label: "Авто" },
  { value: "30", label: "30 мин" },
  { value: "60", label: "1 час" },
  { value: "120", label: "2 часа" },
  { value: "180", label: "3 часа" },
];

// Три независимых выбора для блока «Лучшее время для отправки»: окно подсчёта кликов, группировка по
// дням недели и шаг времени. «Авто» подбирает значение по накопленным данным. Значения живут в адресе
// страницы (win, day, step), остальные параметры страницы (период) сохраняются.
export default function SendTimeControls({ win, day, step }: { win: string; day: string; step: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(name: "win" | "day" | "step", value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "auto") next.delete(name);
    else next.set(name, value);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="flex items-end gap-x-5 gap-y-3 flex-wrap mb-4">
      <div>
        <div className="text-[12px] text-ink-faint mb-1">Клики за</div>
        <CustomSelect value={win} onChange={(v) => set("win", v)} options={WINDOW_OPTIONS} className="w-[110px]" />
      </div>
      <div>
        <div className="text-[12px] text-ink-faint mb-1">Дни</div>
        <SegmentedControl value={day} onChange={(v) => set("day", v)} options={DAY_OPTIONS} />
      </div>
      <div>
        <div className="text-[12px] text-ink-faint mb-1">Время</div>
        <SegmentedControl value={step} onChange={(v) => set("step", v)} options={STEP_OPTIONS} />
      </div>
    </div>
  );
}
