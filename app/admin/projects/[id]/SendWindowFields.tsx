"use client";

import { Input, Label, Select, Toggle } from "@/app/ui";
import { cn } from "@/app/ui/cn";

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABEL: Record<number, string> = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 0: "Вс" };

function DayOfWeekPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="flex gap-1.5">
      {DAY_ORDER.map((d) => {
        const active = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => onChange(active ? value.filter((x) => x !== d) : [...value, d])}
            className={cn(
              "w-9 h-9 rounded-lg text-[12.5px] font-medium border transition-colors",
              active ? "bg-accent-tint text-accent border-accent-line" : "border-border text-ink-muted hover:text-ink"
            )}
          >
            {DAY_LABEL[d]}
          </button>
        );
      })}
    </div>
  );
}

export type SendWindowState = {
  sendWindowEnabled: boolean;
  sendDays: number[];
  sendTimeFrom: string;
  sendTimeTo: string;
  sendWindowSubscriberTz: boolean;
  spacingEnabled: boolean;
  spacingAmount: number;
  spacingUnit: number;
};

export const SEND_WINDOW_DEFAULTS: SendWindowState = {
  sendWindowEnabled: false,
  sendDays: [1, 2, 3, 4, 5, 6, 0],
  sendTimeFrom: "09:00",
  sendTimeTo: "21:00",
  sendWindowSubscriberTz: false,
  spacingEnabled: false,
  spacingAmount: 60,
  spacingUnit: 1,
};

// Окно отправки + защита от наложения — та же пара опций, что уже есть у
// welcome-автоматизаций (см. AutomationsManager.tsx), теперь и для обычных
// рассылок (migration 0056): опционально, по умолчанию выключено, кампании
// без изменений в поведении. Отправка при включённой опции идёт через
// пер-получательские задания (см. lib/sender.ts enqueueWindowedCampaign) —
// размазывается по окну, а не уходит разом.

// Дни недели по умолчанию — все сразу (см. SEND_WINDOW_DEFAULTS.sendDays),
// но пользователь может снять все галочки; при включённом окне отправки
// пустой список дней означает "никогда не отправлять", что почти всегда
// ошибка ввода, а не осознанный выбор — блокируем сохранение формы этой
// проверкой (вызывается из validate()/create*/saveEdit* каждой формы, где
// используется SendWindowFields).
export function sendWindowError(v: Pick<SendWindowState, "sendWindowEnabled" | "sendDays">): string | null {
  if (v.sendWindowEnabled && v.sendDays.length === 0) return "Выберите хотя бы один день недели";
  return null;
}

export function SendWindowFields({
  value,
  onChange,
  projectTimezone,
}: {
  value: SendWindowState;
  onChange: (v: SendWindowState) => void;
  projectTimezone: string;
}) {
  return (
    <div>
      <Toggle
        checked={value.spacingEnabled}
        onChange={(v) => onChange({ ...value, spacingEnabled: v })}
        label="Защита от наложения"
      />
      {value.spacingEnabled && (
        <>
          <div className="h-2" />
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              value={value.spacingAmount}
              onChange={(e) => onChange({ ...value, spacingAmount: Number(e.target.value) })}
              className="w-20"
            />
            <Select value={value.spacingUnit} onChange={(e) => onChange({ ...value, spacingUnit: Number(e.target.value) })} className="flex-1">
              <option value={1}>минут</option>
              <option value={60}>часов</option>
              <option value={1440}>дней</option>
            </Select>
          </div>
        </>
      )}

      <div className="h-3" />
      <Toggle checked={value.sendWindowEnabled} onChange={(v) => onChange({ ...value, sendWindowEnabled: v })} label="Окно отправки" />
      {value.sendWindowEnabled && (
        <>
          <div className="h-2" />
          <Label>
            Дни недели <span className="text-bad">*</span>
          </Label>
          <DayOfWeekPicker value={value.sendDays} onChange={(days) => onChange({ ...value, sendDays: days })} />
          <div className="h-2" />
          <Label>Время</Label>
          <div className="flex items-center gap-2">
            <Input type="time" value={value.sendTimeFrom} onChange={(e) => onChange({ ...value, sendTimeFrom: e.target.value })} className="flex-1" />
            <span className="text-ink-faint text-[13px]">—</span>
            <Input type="time" value={value.sendTimeTo} onChange={(e) => onChange({ ...value, sendTimeTo: e.target.value })} className="flex-1" />
          </div>
          <div className="h-2" />
          <Toggle
            checked={value.sendWindowSubscriberTz}
            onChange={(v) => onChange({ ...value, sendWindowSubscriberTz: v })}
            label="По часовому поясу подписчика"
          />
        </>
      )}
    </div>
  );
}
