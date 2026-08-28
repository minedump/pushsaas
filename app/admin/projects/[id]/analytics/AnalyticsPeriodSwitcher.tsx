"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button, Input, SegmentedControl } from "@/app/ui";

type Period = "day" | "week" | "month" | "custom";
type Preset = "day" | "week" | "month";

const PERIOD_LABEL: Record<Preset, string> = { day: "День", week: "Неделя", month: "Месяц" };
const PERIOD_OPTIONS = (["day", "week", "month"] as Preset[]).map((k) => ({ value: k, label: PERIOD_LABEL[k] }));

// Диапазон дат и кнопка «Применить» видны всегда, а не только в отдельной
// вкладке «Произвольный» — так пользователь может задать точные даты, даже
// не выходя из готового пресета. defaultFrom/defaultTo — граница ТЕКУЩЕГО
// периода (см. resolveRange в page.tsx); синхронизируем их в поля при
// смене пресета (день/неделя/месяц), иначе после переключения таба поля
// продолжали бы показывать даты от предыдущего выбора.
export default function AnalyticsPeriodSwitcher({
  period,
  defaultFrom,
  defaultTo,
}: {
  period: Period;
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const isCustom = period === "custom";

  useEffect(() => {
    setFrom(defaultFrom);
    setTo(defaultTo);
  }, [defaultFrom, defaultTo]);

  function selectPreset(p: Preset) {
    router.push(`${pathname}?period=${p}`);
  }

  function apply() {
    router.push(`${pathname}?period=custom&from=${from}&to=${to}`);
  }

  function reset() {
    router.push(pathname);
  }

  return (
    <div className="flex items-center gap-3 flex-wrap mt-4">
      <SegmentedControl value={isCustom ? ("" as Preset) : period} onChange={selectPreset} options={PERIOD_OPTIONS} />
      <div className="flex items-center gap-2 flex-wrap">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[152px]" />
        <span className="text-ink-faint">—</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[152px]" />
        {isCustom ? (
          <Button type="button" variant="secondary" onClick={reset}>
            Сбросить
          </Button>
        ) : (
          <Button type="button" onClick={apply}>
            Применить
          </Button>
        )}
      </div>
    </div>
  );
}
