"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ColorField, Input, Label, Textarea, Toggle, useDialogs } from "@/app/ui";
import { CustomSelect } from "@/app/ui/CustomSelect";
import {
  DEFAULT_GUIDES,
  GUIDE_ADMIN_LABEL,
  GUIDE_KEYS,
  NOTIFY_LIMITS,
  type GuideKey,
  type NotifyConfig,
} from "@/lib/notify-config";
import type { ButtonPosition, ButtonSize, CornerRadius } from "@/lib/widget-config";
import NotifyPreview from "./NotifyPreview";
import ShowRulesFields from "./ShowRulesFields";
import SitePreviewLink from "./SitePreviewLink";

const POSITION_LABEL: Record<ButtonPosition, string> = {
  "bottom-right": "Справа внизу",
  "bottom-left": "Слева внизу",
  "top-right": "Справа вверху",
  "top-left": "Слева вверху",
};
const SIZE_LABEL: Record<ButtonSize, string> = { s: "Маленькая", m: "Средняя", l: "Большая" };
const RADIUS_LABEL: Record<CornerRadius, string> = {
  none: "Без закругления",
  sm: "Маленькое закругление",
  md: "Среднее закругление",
  lg: "Большое закругление",
};
const BG_COLOR_PRESETS = ["#2c4a66", "#111827", "#2563eb", "#7c3aed", "#16a34a", "#ea580c", "#dc2626", "#0d9488"];
const TEXT_COLOR_PRESETS = ["#ffffff", "#0a0a0a", "#f5f5f5", "#374151"];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 pt-3 border-t border-border">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-ink-faint mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const toLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export default function NotifySettings({
  projectId,
  domain,
  initial,
  installEnabled,
}: {
  projectId: string;
  domain: string | null;
  initial: NotifyConfig;
  installEnabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useDialogs();
  const [cfg, setCfg] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [benefitsText, setBenefitsText] = useState(initial.benefits.join("\n"));
  const [guide, setGuide] = useState<GuideKey>("android");
  // черновики инструкций: перевод строки в поле не должен схлопываться, пока человек печатает
  const [guideText, setGuideText] = useState(() =>
    Object.fromEntries(GUIDE_KEYS.map((k) => [k, { enable: initial.guides[k].enable.join("\n"), disable: initial.guides[k].disable.join("\n") }])) as Record<
      GuideKey,
      { enable: string; disable: string }
    >
  );
  const set = (patch: Partial<NotifyConfig>) => setCfg((c) => ({ ...c, ...patch }));

  function setSteps(kind: "enable" | "disable", text: string) {
    setGuideText((g) => ({ ...g, [guide]: { ...g[guide], [kind]: text } }));
    setCfg((c) => ({ ...c, guides: { ...c.guides, [guide]: { ...c.guides[guide], [kind]: toLines(text) } } }));
  }
  function resetGuide() {
    const d = DEFAULT_GUIDES[guide];
    setGuideText((g) => ({ ...g, [guide]: { enable: d.enable.join("\n"), disable: d.disable.join("\n") } }));
    setCfg((c) => ({ ...c, guides: { ...c.guides, [guide]: { enable: d.enable, disable: d.disable } } }));
  }

  async function save() {
    setBusy(true);
    const res = await fetch("/api/admin/widget/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, notify: cfg }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error || "Ошибка", "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  const radiusOptions = (Object.keys(RADIUS_LABEL) as CornerRadius[]).map((r) => ({ value: r, label: RADIUS_LABEL[r] }));

  return (
    <>
      <h2 className="text-base font-semibold">Окно уведомлений</h2>
      <p className="text-sm text-ink-muted mt-1">
        Один виджет на весь цикл подписки: окно с пользой до системного запроса, после «Не сейчас» — маленькая иконка-колокольчик, а
        если уведомления запрещены в браузере или уже включены — инструкция, как включить или отключить, под устройство посетителя.
      </p>

      <div className="mt-3 flex flex-col gap-4">
        <Card className={`flex flex-col gap-3 ${busy ? "opacity-60" : ""}`}>
          <Toggle checked={cfg.windowEnabled} onChange={(v) => set({ windowEnabled: v })} label="Показывать окно с предложением" />
          <Toggle checked={cfg.bellEnabled} onChange={(v) => set({ bellEnabled: v })} label="Показывать иконку-колокольчик" />
          <p className="text-xs text-ink-faint -mt-1">
            Иконка и «Кнопка подписки» занимают один угол, поэтому обычно включают что-то одно.
          </p>

          <Section title="Окно с предложением">
            <Field label="Заголовок">
              <Input value={cfg.title} onChange={(e) => set({ title: e.target.value })} maxLength={60} />
            </Field>
            <Field label="Текст">
              <Textarea value={cfg.intro} onChange={(e) => set({ intro: e.target.value })} rows={2} maxLength={200} />
            </Field>
            <Field label={`Что получит подписчик (по одному в строке, до ${NOTIFY_LIMITS.benefits})`}>
              <Textarea
                value={benefitsText}
                onChange={(e) => {
                  setBenefitsText(e.target.value);
                  set({ benefits: toLines(e.target.value).slice(0, NOTIFY_LIMITS.benefits) });
                }}
                rows={4}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Основная кнопка">
                <Input value={cfg.enableText} onChange={(e) => set({ enableText: e.target.value })} maxLength={40} />
              </Field>
              <Field label="Вторая кнопка">
                <Input value={cfg.laterText} onChange={(e) => set({ laterText: e.target.value })} maxLength={30} />
              </Field>
            </div>
            <Field label="Мелкая подпись под кнопками">
              <Input value={cfg.note} onChange={(e) => set({ note: e.target.value })} maxLength={80} placeholder="Можно оставить пустой" />
            </Field>
          </Section>

          <Section title="Оформление окна">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Цвет кнопки и акцентов">
                <ColorField value={cfg.color} onChange={(v) => set({ color: v })} presets={BG_COLOR_PRESETS} />
              </Field>
              <Field label="Цвет текста на кнопке">
                <ColorField value={cfg.textColor} onChange={(v) => set({ textColor: v })} presets={TEXT_COLOR_PRESETS} />
              </Field>
              <Field label="Заливка окна">
                <ColorField value={cfg.cardBg} onChange={(v) => set({ cardBg: v })} presets={["#ffffff", "#f8fafc", "#111827"]} />
              </Field>
              <Field label="Цвет текста окна">
                <ColorField value={cfg.cardTextColor} onChange={(v) => set({ cardTextColor: v })} presets={["#16202a", "#0a0a0a", "#ffffff"]} />
              </Field>
            </div>
            <Field label="Скругление">
              <CustomSelect value={cfg.borderRadius} onChange={(v) => set({ borderRadius: v as CornerRadius })} options={radiusOptions} className="w-full" />
            </Field>
          </Section>

          <ShowRulesFields title="Когда показывать окно" rules={cfg.show} onChange={(show) => set({ show })} />

          <Section title="Иконка-колокольчик" hint="Появляется после «Не сейчас», когда пройдёт пауза, а также если уведомления запрещены в браузере. Нажатие открывает окно по состоянию устройства.">
            <Field label="Подпись для читалок экрана и всплывающая подсказка">
              <Input value={cfg.bellLabel} onChange={(e) => set({ bellLabel: e.target.value })} maxLength={40} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Угол экрана">
                <CustomSelect
                  value={cfg.bellPosition}
                  onChange={(v) => set({ bellPosition: v as ButtonPosition })}
                  options={(Object.keys(POSITION_LABEL) as ButtonPosition[]).map((p) => ({ value: p, label: POSITION_LABEL[p] }))}
                  className="w-full"
                />
              </Field>
              <Field label="Размер">
                <CustomSelect
                  value={cfg.bellSize}
                  onChange={(v) => set({ bellSize: v as ButtonSize })}
                  options={(Object.keys(SIZE_LABEL) as ButtonSize[]).map((s) => ({ value: s, label: SIZE_LABEL[s] }))}
                  className="w-full"
                />
              </Field>
              <Field label="Цвет">
                <ColorField value={cfg.bellColor} onChange={(v) => set({ bellColor: v })} presets={BG_COLOR_PRESETS} />
              </Field>
              <Field label="Цвет колокольчика">
                <ColorField value={cfg.bellTextColor} onChange={(v) => set({ bellTextColor: v })} presets={TEXT_COLOR_PRESETS} />
              </Field>
            </div>
            <Field label="Скругление">
              <CustomSelect value={cfg.bellRadius} onChange={(v) => set({ bellRadius: v as CornerRadius })} options={radiusOptions} className="w-full" />
            </Field>
          </Section>

          <ShowRulesFields variant="bell" title="Когда показывать иконку" rules={cfg.bellShow} onChange={(bellShow) => set({ bellShow })} />

          <Section
            title="Инструкции по устройствам"
            hint="Шаги без картинок. Название кнопки или пункта меню выделяйте **двумя звёздочками**: так оно станет жирным. Посетитель сразу видит инструкцию своего устройства и может переключиться на другое."
          >
            <Field label="Устройство">
              <CustomSelect
                value={guide}
                onChange={(v) => setGuide(v as GuideKey)}
                options={GUIDE_KEYS.map((k) => ({ value: k, label: GUIDE_ADMIN_LABEL[k] }))}
                className="w-full"
              />
            </Field>
            <Field label={guide === "iosHome" ? "Как добавить сайт на экран «Домой» (по шагу в строке)" : "Как включить, когда запрещено (по шагу в строке)"}>
              <Textarea value={guideText[guide].enable} onChange={(e) => setSteps("enable", e.target.value)} rows={5} />
            </Field>
            {guide !== "iosHome" && (
              <Field label="Как отключить, когда уже подписан (по шагу в строке)">
                <Textarea value={guideText[guide].disable} onChange={(e) => setSteps("disable", e.target.value)} rows={4} />
              </Field>
            )}
            <div>
              <Button size="sm" variant="secondary" onClick={resetGuide}>
                Вернуть стандартный текст
              </Button>
            </div>
          </Section>

          <details className="pt-3 border-t border-border">
            <summary className="text-sm font-semibold cursor-pointer">Тексты остальных экранов</summary>
            <div className="mt-3 flex flex-col gap-3">
              <Field label="Запрещено в браузере: заголовок">
                <Input value={cfg.blockedTitle} onChange={(e) => set({ blockedTitle: e.target.value })} maxLength={60} />
              </Field>
              <Field label="Запрещено в браузере: текст">
                <Textarea value={cfg.blockedIntro} onChange={(e) => set({ blockedIntro: e.target.value })} rows={2} maxLength={220} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Кнопка проверки">
                  <Input value={cfg.checkText} onChange={(e) => set({ checkText: e.target.value })} maxLength={40} />
                </Field>
                <Field label="Если всё ещё выключено">
                  <Input value={cfg.stillOffText} onChange={(e) => set({ stillOffText: e.target.value })} maxLength={120} />
                </Field>
              </div>
              <Field label="Подписан: заголовок">
                <Input value={cfg.subscribedTitle} onChange={(e) => set({ subscribedTitle: e.target.value })} maxLength={60} />
              </Field>
              <Field label="Подписан: текст">
                <Textarea value={cfg.subscribedIntro} onChange={(e) => set({ subscribedIntro: e.target.value })} rows={2} maxLength={220} />
              </Field>
              <Field label="После подписки в окне">
                <Input value={cfg.doneTitle} onChange={(e) => set({ doneTitle: e.target.value })} maxLength={60} />
              </Field>
              <Field label="iPhone без «Домой»: заголовок">
                <Input value={cfg.homeTitle} onChange={(e) => set({ homeTitle: e.target.value })} maxLength={60} />
              </Field>
              <Field label="iPhone без «Домой»: текст">
                <Textarea value={cfg.homeIntro} onChange={(e) => set({ homeIntro: e.target.value })} rows={2} maxLength={220} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Ссылка на окно с картинками">
                  <Input value={cfg.homeMoreText} onChange={(e) => set({ homeMoreText: e.target.value })} maxLength={40} />
                </Field>
                <Field label="Кнопка «Закрыть»">
                  <Input value={cfg.closeText} onChange={(e) => set({ closeText: e.target.value })} maxLength={30} />
                </Field>
              </div>
              <p className="text-xs text-ink-faint">
                Ссылка на окно с картинками показывается, только если включено окно «Установка приложения».
              </p>
            </div>
          </details>

          <div>
            <Button size="md" disabled={busy} onClick={save}>
              Сохранить окно уведомлений
            </Button>
          </div>

          <SitePreviewLink projectId={projectId} domain={domain} widget="notify" />
        </Card>

        <NotifyPreview config={cfg} installEnabled={installEnabled} />
      </div>
    </>
  );
}
