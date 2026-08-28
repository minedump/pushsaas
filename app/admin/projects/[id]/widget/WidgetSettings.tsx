"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ColorField, Input, Label, Textarea, Toggle, useDialogs } from "@/app/ui";
import { CustomSelect } from "@/app/ui/CustomSelect";
import type { ButtonConfig, ButtonPosition, ButtonSize, CornerRadius, PromptConfig } from "@/lib/widget-config";
import ButtonPreview from "./ButtonPreview";
import PromptPreview from "./PromptPreview";
import { SenderaApiDocs } from "./SenderaApiDocs";

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

function DismissDaysField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label>Пауза показа, дней</Label>
      <Input
        type="number"
        min={1}
        max={30}
        value={value}
        onChange={(e) => onChange(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
      />
    </div>
  );
}

function DelaySecondsField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label>Задержка, сек</Label>
      <Input
        type="number"
        min={0}
        max={120}
        value={value}
        onChange={(e) => onChange(Math.min(120, Math.max(0, Number(e.target.value) || 0)))}
      />
    </div>
  );
}

function MinPageViewsField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label>Показать со страницы</Label>
      <Input
        type="number"
        min={1}
        max={20}
        value={value}
        onChange={(e) => onChange(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
      />
    </div>
  );
}

function ShowConditionsRow({
  dismissDays,
  onDismissDaysChange,
  delaySeconds,
  onDelaySecondsChange,
  minPageViews,
  onMinPageViewsChange,
}: {
  dismissDays: number;
  onDismissDaysChange: (v: number) => void;
  delaySeconds: number;
  onDelaySecondsChange: (v: number) => void;
  minPageViews: number;
  onMinPageViewsChange: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <DismissDaysField value={dismissDays} onChange={onDismissDaysChange} />
      <DelaySecondsField value={delaySeconds} onChange={onDelaySecondsChange} />
      <MinPageViewsField value={minPageViews} onChange={onMinPageViewsChange} />
    </div>
  );
}

export default function WidgetSettings({
  projectId,
  initialButton,
  initialPrompt,
}: {
  projectId: string;
  initialButton: ButtonConfig;
  initialPrompt: PromptConfig;
}) {
  const router = useRouter();
  const { toast } = useDialogs();
  const [button, setButton] = useState(initialButton);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busyButton, setBusyButton] = useState(false);
  const [busyPrompt, setBusyPrompt] = useState(false);

  async function saveButton() {
    setBusyButton(true);
    const res = await fetch("/api/admin/widget/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, button }),
    });
    setBusyButton(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error || "Ошибка", "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  async function savePrompt() {
    setBusyPrompt(true);
    const res = await fetch("/api/admin/widget/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, prompt }),
    });
    setBusyPrompt(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error || "Ошибка", "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  return (
    <>
      <SenderaApiDocs />

      <h2 className="text-base font-semibold mt-8">Плавающая кнопка подписки</h2>
      <p className="text-sm text-ink-muted mt-1">Кнопка в углу экрана вызывающая окно подписки на уведомления.</p>
      <div className="mt-3 flex flex-col gap-4">
        <Card className={`flex flex-col gap-3 ${busyButton ? "opacity-60" : ""}`}>
          <Toggle checked={button.enabled} onChange={(v) => setButton({ ...button, enabled: v })} label="Показывать кнопку" />

          <div>
            <Label>Текст на кнопке</Label>
            <Input value={button.text} onChange={(e) => setButton({ ...button, text: e.target.value })} placeholder="Уведомления" />
          </div>
          <div>
            <Label>Скругление</Label>
            <CustomSelect
              value={button.borderRadius}
              onChange={(v) => setButton({ ...button, borderRadius: v as CornerRadius })}
              options={(Object.keys(RADIUS_LABEL) as CornerRadius[]).map((r) => ({ value: r, label: RADIUS_LABEL[r] }))}
              className="w-full"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Цвет</Label>
              <ColorField value={button.color} onChange={(v) => setButton({ ...button, color: v })} presets={BG_COLOR_PRESETS} />
            </div>
            <div>
              <Label>Цвет текста</Label>
              <ColorField value={button.textColor} onChange={(v) => setButton({ ...button, textColor: v })} presets={TEXT_COLOR_PRESETS} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Угол экрана</Label>
              <CustomSelect
                value={button.position}
                onChange={(v) => setButton({ ...button, position: v as ButtonPosition })}
                options={(Object.keys(POSITION_LABEL) as ButtonPosition[]).map((p) => ({ value: p, label: POSITION_LABEL[p] }))}
                className="w-full"
              />
            </div>
            <div>
              <Label>Размер</Label>
              <CustomSelect
                value={button.size}
                onChange={(v) => setButton({ ...button, size: v as ButtonSize })}
                options={(Object.keys(SIZE_LABEL) as ButtonSize[]).map((s) => ({ value: s, label: SIZE_LABEL[s] }))}
                className="w-full"
              />
            </div>
          </div>
          <ShowConditionsRow
            dismissDays={button.dismissDays}
            onDismissDaysChange={(v) => setButton({ ...button, dismissDays: v })}
            delaySeconds={button.delaySeconds}
            onDelaySecondsChange={(v) => setButton({ ...button, delaySeconds: v })}
            minPageViews={button.minPageViews}
            onMinPageViewsChange={(v) => setButton({ ...button, minPageViews: v })}
          />

          <div>
            <Button size="md" disabled={busyButton} onClick={saveButton}>
              Сохранить кнопку
            </Button>
          </div>
        </Card>

        <div>
          <div className="text-sm font-semibold text-ink mb-2">Предпросмотр</div>
          <ButtonPreview config={button} />
        </div>
      </div>

      <h2 className="text-base font-semibold mt-8">Плашка перед системным запросом</h2>
      <p className="text-sm text-ink-muted mt-1">
        Плашка со своим текстом и кнопками «Разрешить»/«Не сейчас» — выезжает сверху на телефоне, всплывает в левом
        верхнем углу на компьютере, прямо перед настоящим системным диалогом браузера.
      </p>
      <div className="mt-3 flex flex-col gap-4">
        <Card className={`flex flex-col gap-3 ${busyPrompt ? "opacity-60" : ""}`}>
          <Toggle checked={prompt.enabled} onChange={(v) => setPrompt({ ...prompt, enabled: v })} label="Показывать плашку" />

          <div>
            <Label>Заголовок</Label>
            <Input value={prompt.title} onChange={(e) => setPrompt({ ...prompt, title: e.target.value })} placeholder="Получайте уведомления" />
          </div>
          <div>
            <Label>Текст</Label>
            <Textarea
              value={prompt.body}
              onChange={(e) => setPrompt({ ...prompt, body: e.target.value })}
              rows={2}
              placeholder="Узнавайте первыми о заказах и акциях"
            />
          </div>
          <div>
            <Label>Скругление</Label>
            <CustomSelect
              value={prompt.borderRadius}
              onChange={(v) => setPrompt({ ...prompt, borderRadius: v as CornerRadius })}
              options={(Object.keys(RADIUS_LABEL) as CornerRadius[]).map((r) => ({ value: r, label: RADIUS_LABEL[r] }))}
              className="w-full"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Заливка плашки</Label>
              <ColorField value={prompt.cardBg} onChange={(v) => setPrompt({ ...prompt, cardBg: v })} presets={BG_COLOR_PRESETS} />
            </div>
            <div>
              <Label>Основной цвет</Label>
              <ColorField value={prompt.cardTextColor} onChange={(v) => setPrompt({ ...prompt, cardTextColor: v })} presets={TEXT_COLOR_PRESETS} />
            </div>
            <div>
              <Label>Цвет кнопки «Разрешить»</Label>
              <ColorField value={prompt.color} onChange={(v) => setPrompt({ ...prompt, color: v })} presets={BG_COLOR_PRESETS} />
            </div>
            <div>
              <Label>Цвет текста «Разрешить»</Label>
              <ColorField value={prompt.textColor} onChange={(v) => setPrompt({ ...prompt, textColor: v })} presets={TEXT_COLOR_PRESETS} />
            </div>
            <div>
              <Label>Цвет заливки «Не сейчас»</Label>
              <ColorField value={prompt.secondaryBg} onChange={(v) => setPrompt({ ...prompt, secondaryBg: v })} presets={BG_COLOR_PRESETS} />
            </div>
            <div>
              <Label>Цвет текста «Не сейчас»</Label>
              <ColorField
                value={prompt.secondaryColor}
                onChange={(v) => setPrompt({ ...prompt, secondaryColor: v })}
                presets={TEXT_COLOR_PRESETS}
              />
            </div>
          </div>
          <ShowConditionsRow
            dismissDays={prompt.dismissDays}
            onDismissDaysChange={(v) => setPrompt({ ...prompt, dismissDays: v })}
            delaySeconds={prompt.delaySeconds}
            onDelaySecondsChange={(v) => setPrompt({ ...prompt, delaySeconds: v })}
            minPageViews={prompt.minPageViews}
            onMinPageViewsChange={(v) => setPrompt({ ...prompt, minPageViews: v })}
          />

          <div>
            <Button size="md" disabled={busyPrompt} onClick={savePrompt}>
              Сохранить плашку
            </Button>
          </div>
        </Card>

        <div>
          <div className="text-sm font-semibold text-ink mb-2">Предпросмотр</div>
          <PromptPreview config={prompt} />
        </div>
      </div>
    </>
  );
}
