"use client";

import { useState } from "react";
import { Input, Label, SegmentedControl, Textarea } from "@/app/ui";
import { CustomSelect } from "@/app/ui/CustomSelect";
import {
  SHOW_LIMITS,
  SHOW_PRESETS,
  matchShowPreset,
  normalizePatterns,
  type PagesMode,
  type ShowPresetId,
  type ShowRules,
} from "@/lib/widget-rules";

// Единый блок «Когда показывать» — один и тот же у кнопки, плашки и окна с колокольчиком.
// Настройки лежат в ShowRules (lib/widget-rules.ts), проверяет их скрипт из lib/widget-gate.ts.

const PAGES_MODE_LABEL: Record<PagesMode, string> = {
  all: "На всех страницах",
  only: "Только на этих страницах",
  except: "На всех, кроме этих",
};

// Число с черновиком: можно стереть и набрать заново, значение приводится к допустимому при выходе из поля.
function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft === null) return;
    const n = Math.round(Number(draft));
    onChange(Number.isFinite(n) && draft.trim() !== "" ? Math.min(max, Math.max(min, n)) : min);
    setDraft(null);
  }
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      {hint && <p className="text-xs text-ink-faint mt-1">{hint}</p>}
    </div>
  );
}

function PauseField({ hours, onChange, label, hint }: { hours: number; onChange: (v: number) => void; label: string; hint: string }) {
  const [unit, setUnit] = useState<"h" | "d">(hours >= 24 && hours % 24 === 0 ? "d" : "h");
  const mult = unit === "d" ? 24 : 1;
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft === null) return;
    const m = mult;
    const raw = draft;
    const n = Math.round(Number(raw));
    const v = Number.isFinite(n) && raw.trim() !== "" ? n : 1;
    onChange(Math.min(SHOW_LIMITS.pauseHours.max, Math.max(SHOW_LIMITS.pauseHours.min, v * m)));
    setDraft(null);
  }
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          type="number"
          min={1}
          value={draft ?? String(Math.max(1, Math.round(hours / mult)))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="min-w-0"
        />
        <CustomSelect
          value={unit}
          onChange={(v) => {
            const next = v as "h" | "d";
            // меняем единицу, не меняя саму паузу: 3 дня остаются 72 часами
            setUnit(next);
            setDraft(null);
          }}
          options={[
            { value: "h", label: "часов" },
            { value: "d", label: "дней" },
          ]}
          className="w-28 shrink-0"
        />
      </div>
      <p className="text-xs text-ink-faint mt-1">{hint}</p>
    </div>
  );
}

export default function ShowRulesFields({
  rules,
  onChange,
  title = "Когда показывать",
  variant = "window",
}: {
  rules: ShowRules;
  onChange: (next: ShowRules) => void;
  title?: string;
  // bell — иконка: пауза считается от закрытия окна, лимита закрытий у неё нет
  variant?: "window" | "bell";
}) {
  const bell = variant === "bell";
  const preset = matchShowPreset(rules);
  const [patternsText, setPatternsText] = useState(rules.pagePatterns.join("\n"));
  const set = (patch: Partial<ShowRules>) => onChange({ ...rules, ...patch });
  const presetOptions: { value: ShowPresetId | "custom"; label: string }[] = [
    ...(Object.keys(SHOW_PRESETS) as ShowPresetId[]).map((id) => ({ value: id, label: SHOW_PRESETS[id].label })),
    { value: "custom", label: "Свои значения" },
  ];

  return (
    <div className="flex flex-col gap-3 pt-3 border-t border-border">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-ink-faint mt-0.5">Все условия работают вместе: виджет появится, когда выполнены все.</p>
      </div>

      <div>
        <SegmentedControl
          value={preset ?? "custom"}
          onChange={(v) => {
            if (v === "custom") return;
            const p = SHOW_PRESETS[v].rules;
            // шаблон не трогает список страниц: он зависит от сайта, а не от «характера» показа
            onChange({ ...p, pagesMode: rules.pagesMode, pagePatterns: rules.pagePatterns });
          }}
          options={presetOptions}
          className="flex-wrap"
        />
        <p className="text-xs text-ink-faint mt-1.5">{preset ? SHOW_PRESETS[preset].hint : "Значения изменены вручную. Шаблон можно выбрать снова."}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NumberField
          label="Через сколько секунд после загрузки страницы"
          value={rules.delaySeconds}
          min={SHOW_LIMITS.delaySeconds.min}
          max={SHOW_LIMITS.delaySeconds.max}
          onChange={(v) => set({ delaySeconds: v })}
        />
        <NumberField
          label="Показывать со страницы №"
          hint="Сколько страниц сайта посетитель должен открыть за визит. 1 — с первой."
          value={rules.minPageViews}
          min={SHOW_LIMITS.minPageViews.min}
          max={SHOW_LIMITS.minPageViews.max}
          onChange={(v) => set({ minPageViews: v })}
        />
        <NumberField
          label="Минимум времени на сайте, сек"
          hint="Суммарно за визит, пока вкладка открыта. 0 — не учитывать."
          value={rules.minTimeOnSiteSeconds}
          min={SHOW_LIMITS.minTimeOnSiteSeconds.min}
          max={SHOW_LIMITS.minTimeOnSiteSeconds.max}
          onChange={(v) => set({ minTimeOnSiteSeconds: v })}
        />
        <PauseField
          hours={rules.pauseHours}
          onChange={(v) => set({ pauseHours: v })}
          label={bell ? "Показать иконку через" : "Пауза после закрытия"}
          hint={bell ? "Сколько ждать после того, как посетитель закрыл окно «Не сейчас»." : "Сколько молчать, после того как посетитель нажал «закрыть»."}
        />
        {!bell && (
          <NumberField
            label="Перестать показывать после закрытий"
            hint="Сколько раз посетитель может закрыть, прежде чем окно замолчит насовсем (иконка при этом остаётся). 0 — не прекращать."
            value={rules.maxDismissals}
            min={SHOW_LIMITS.maxDismissals.min}
            max={SHOW_LIMITS.maxDismissals.max}
            onChange={(v) => set({ maxDismissals: v })}
          />
        )}
        <div>
          <Label>Страницы</Label>
          <CustomSelect
            value={rules.pagesMode}
            onChange={(v) => set({ pagesMode: v as PagesMode })}
            options={(Object.keys(PAGES_MODE_LABEL) as PagesMode[]).map((m) => ({ value: m, label: PAGES_MODE_LABEL[m] }))}
            className="w-full"
          />
        </div>
      </div>

      {rules.pagesMode !== "all" && (
        <div>
          <Label>{rules.pagesMode === "only" ? "Показывать на страницах" : "Не показывать на страницах"}</Label>
          <Textarea
            value={patternsText}
            onChange={(e) => {
              setPatternsText(e.target.value);
              set({ pagePatterns: normalizePatterns(e.target.value) });
            }}
            rows={3}
            placeholder={"/catalog/*\n/product/*"}
          />
          <p className="text-xs text-ink-faint mt-1">
            По одному адресу в строке, без домена. Звёздочка заменяет любую часть адреса: /catalog/* — все страницы каталога. Главная
            страница — просто /.
            {rules.pagesMode === "except" && " Для корзины и оформления заказа обычно: /cart_items и /new_order."}
          </p>
          {rules.pagePatterns.length === 0 && (
            <p className="text-xs text-warn mt-1">
              Список пуст, поэтому ограничение не действует: виджет показывается на всех страницах.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
