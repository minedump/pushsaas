"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, Select, Textarea, Toggle, useDialogs } from "@/app/ui";
import type { ButtonConfig, ButtonPosition, ButtonSize, PromptConfig } from "@/lib/widget-config";
import CopyBox from "../CopyBox";

const POSITION_LABEL: Record<ButtonPosition, string> = {
  "bottom-right": "Справа внизу",
  "bottom-left": "Слева внизу",
  "top-right": "Справа вверху",
  "top-left": "Слева вверху",
};
const SIZE_LABEL: Record<ButtonSize, string> = { s: "Маленькая", m: "Средняя", l: "Большая" };

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#2c4a66"}
        onChange={(e) => onChange(e.target.value)}
        className="w-9 h-9 shrink-0 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
      />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#2c4a66" />
    </div>
  );
}

export default function WidgetSettings({
  projectId,
  appUrl,
  initialButton,
  initialPrompt,
}: {
  projectId: string;
  appUrl: string;
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
      <h2 className="text-base font-semibold mt-8">Подключение</h2>
      <p className="text-sm text-ink-muted mt-1">
        Один скрипт на обе механики — какие из них реально попадут на страницу, решают тумблеры ниже.
      </p>
      <CopyBox text={`<script src="${appUrl}/embed/${projectId}.js" async></script>\n<script src="${appUrl}/embed/${projectId}/widgets.js" async></script>`} />

      <h2 className="text-base font-semibold mt-8">Плавающая кнопка подписки</h2>
      <p className="text-sm text-ink-muted mt-1">
        Кнопка в углу экрана — вызывает <code className="font-mono">PushSaaS.subscribe()</code> по клику. Включена по
        умолчанию для всех, кто подключил скрипт выше.
      </p>
      <Card className={`mt-3 flex flex-col gap-3 ${busyButton ? "opacity-60" : ""}`}>
        <div className="flex justify-between items-center gap-3">
          <div className="text-sm">Показывать кнопку</div>
          <Toggle checked={button.enabled} onChange={(v) => setButton({ ...button, enabled: v })} />
        </div>

        {button.enabled && (
          <>
            <div className="h-px bg-border" />
            <div>
              <Label>Текст на кнопке</Label>
              <Input value={button.text} onChange={(e) => setButton({ ...button, text: e.target.value })} placeholder="Уведомления" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label>Цвет</Label>
                <ColorField value={button.color} onChange={(v) => setButton({ ...button, color: v })} />
              </div>
              <div className="w-36 shrink-0">
                <Label>Угол экрана</Label>
                <Select value={button.position} onChange={(e) => setButton({ ...button, position: e.target.value as ButtonPosition })} className="w-full">
                  {(Object.keys(POSITION_LABEL) as ButtonPosition[]).map((p) => (
                    <option key={p} value={p}>
                      {POSITION_LABEL[p]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-28 shrink-0">
                <Label>Размер</Label>
                <Select value={button.size} onChange={(e) => setButton({ ...button, size: e.target.value as ButtonSize })} className="w-full">
                  {(Object.keys(SIZE_LABEL) as ButtonSize[]).map((s) => (
                    <option key={s} value={s}>
                      {SIZE_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </>
        )}

        <div>
          <Button size="sm" disabled={busyButton} onClick={saveButton}>
            Сохранить кнопку
          </Button>
        </div>
      </Card>

      <h2 className="text-base font-semibold mt-8">Плашка перед системным запросом</h2>
      <p className="text-sm text-ink-muted mt-1">
        Показывается ДО настоящего диалога браузера — на телефоне выезжает сверху экрана, на компьютере всплывает в
        левом верхнем углу, примерно там же, где браузер сам потом спросит разрешение. Клик «Разрешить» вызывает{" "}
        <code className="font-mono">PushSaaS.subscribe()</code> и открывает настоящий системный диалог; «Не сейчас» —
        прячет плашку и больше не показывает её на этом устройстве. Выключена по умолчанию.
      </p>
      <Card className={`mt-3 flex flex-col gap-3 ${busyPrompt ? "opacity-60" : ""}`}>
        <div className="flex justify-between items-center gap-3">
          <div className="text-sm">Показывать плашку</div>
          <Toggle checked={prompt.enabled} onChange={(v) => setPrompt({ ...prompt, enabled: v })} />
        </div>

        {prompt.enabled && (
          <>
            <div className="h-px bg-border" />
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
              <Label>Цвет кнопки «Разрешить»</Label>
              <ColorField value={prompt.color} onChange={(v) => setPrompt({ ...prompt, color: v })} />
            </div>
          </>
        )}

        <div>
          <Button size="sm" disabled={busyPrompt} onClick={savePrompt}>
            Сохранить плашку
          </Button>
        </div>
      </Card>
    </>
  );
}
