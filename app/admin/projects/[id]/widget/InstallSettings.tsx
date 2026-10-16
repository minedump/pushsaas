"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconGripVertical, IconPlus, IconTrash, IconUpload } from "@tabler/icons-react";
import { Button, Card, ColorField, Input, Label, SegmentedControl, Textarea, Toggle, useDialogs } from "@/app/ui";
import { CustomSelect } from "@/app/ui/CustomSelect";
import {
  CUSTOM_IMAGE_SCENE,
  INSTALL_MAX_STEPS,
  INSTALL_SCENES,
  INSTALL_TEXT_MAX,
  type InstallConfig,
  type InstallPlatform,
  type InstallStep,
} from "@/lib/install-guide";
import type { CornerRadius } from "@/lib/widget-config";
import InstallPreview from "./InstallPreview";
import SitePreviewLink from "./SitePreviewLink";

const RADIUS_LABEL: Record<CornerRadius, string> = {
  none: "Без закругления",
  sm: "Маленькое закругление",
  md: "Среднее закругление",
  lg: "Большое закругление",
};
const BG_COLOR_PRESETS = ["#2c4a66", "#111827", "#2563eb", "#7c3aed", "#16a34a", "#ea580c", "#dc2626", "#0d9488"];
const TEXT_COLOR_PRESETS = ["#ffffff", "#0a0a0a", "#f5f5f5", "#374151"];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// Локальный ключ нужен только для перетаскивания и списка React — на сервер не уходит.
type Row = InstallStep & { uid: string };
type Rows = Record<InstallPlatform, Row[]>;

let uidCounter = 0;
const withUid = (s: InstallStep): Row => ({ ...s, uid: `s${++uidCounter}` });

export default function InstallSettings({
  projectId,
  domain,
  initial,
  version,
  hasManifest,
}: {
  projectId: string;
  domain: string | null;
  initial: InstallConfig;
  version: string;
  hasManifest: boolean;
}) {
  const router = useRouter();
  const { toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [title, setTitle] = useState(initial.title);
  const [intro, setIntro] = useState(initial.intro);
  const [buttonText, setButtonText] = useState(initial.buttonText);
  const [buttonColor, setButtonColor] = useState(initial.buttonColor);
  const [buttonTextColor, setButtonTextColor] = useState(initial.buttonTextColor);
  const [buttonRadius, setButtonRadius] = useState<CornerRadius>(initial.buttonRadius);
  const [rows, setRows] = useState<Rows>(() => ({ ios: initial.ios.map(withUid), android: initial.android.map(withUid) }));
  const [platform, setPlatform] = useState<InstallPlatform>("ios");

  // перетаскивание шагов — тот же приём, что у приоритета каналов в автоматизациях
  const [dragUid, setDragUid] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const config: InstallConfig = useMemo(
    () => ({
      enabled,
      title: title.trim() || "Установите приложение",
      intro: intro.trim(),
      buttonText: buttonText.trim() || "Понятно",
      buttonColor,
      buttonTextColor,
      buttonRadius,
      ios: rows.ios.map(({ text, scene, image }) => ({ text, scene, image })),
      android: rows.android.map(({ text, scene, image }) => ({ text, scene, image })),
    }),
    [enabled, title, intro, buttonText, buttonColor, buttonTextColor, buttonRadius, rows]
  );

  const list = rows[platform];
  const setList = (fn: (l: Row[]) => Row[]) => setRows((r) => ({ ...r, [platform]: fn(r[platform]) }));
  const patch = (uid: string, p: Partial<InstallStep>) => setList((l) => l.map((r) => (r.uid === uid ? { ...r, ...p } : r)));

  // Перетаскивание: слушатели движения и отпускания вешаем на окно на время жеста, а не на ручку.
  // Когда строка переставляется, React переносит её узел в DOM, браузер снимает захват указателя
  // с ручки, и событие отпускания до неё уже не доходит — строка зависала бы в режиме переноса.
  function dragStart(e: React.PointerEvent, uid: string) {
    e.preventDefault();
    setDragUid(uid);
    const move = (ev: PointerEvent) => dragTo(ev.clientY, uid);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      setDragUid(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }
  // Новое место строки — по числу остальных строк, середина которых выше курсора: так резкий
  // рывок мыши переставляет сразу на нужное место, а не на одну позицию за событие.
  function dragTo(y: number, uid: string) {
    setList((l) => {
      const cur = l.findIndex((r) => r.uid === uid);
      if (cur < 0) return l;
      const others = l.filter((r) => r.uid !== uid);
      let idx = 0;
      for (const r of others) {
        const box = rowRefs.current[r.uid]?.getBoundingClientRect();
        if (box && y > box.top + box.height / 2) idx++;
      }
      if (idx === cur) return l;
      const next = [...others];
      next.splice(idx, 0, l[cur]);
      return next;
    });
  }

  function addStep() {
    if (list.length >= INSTALL_MAX_STEPS) return toast(`Не больше ${INSTALL_MAX_STEPS} шагов в инструкции`, "warn");
    setList((l) => [...l, withUid({ text: "Новый шаг", scene: "", image: "" })]);
  }

  async function uploadImage(uid: string, file: File) {
    if (file.size > MAX_IMAGE_BYTES) return toast("Файл больше 2 МБ, уменьшите картинку", "bad");
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type) && !/\.svg$/i.test(file.name)) return toast("Подойдёт PNG, JPG, WebP или SVG", "bad");
    setUploading(uid);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("file", file);
    const res = await fetch("/api/admin/widget/install-image", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setUploading(null);
    if (!res.ok) return toast(j.error || "Не удалось загрузить картинку", "bad");
    patch(uid, { image: j.url as string });
  }

  async function save() {
    setBusy(true);
    const res = await fetch("/api/admin/widget/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, install: config }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error || "Ошибка", "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  const sceneOptions = [
    { value: "", label: "Без рисунка" },
    ...INSTALL_SCENES[platform].map((s) => ({ value: s.id, label: s.label })),
    { value: CUSTOM_IMAGE_SCENE, label: "Своя картинка…" },
  ];

  return (
    <>
      <h2 className="text-base font-semibold">Установка приложения</h2>
      <p className="text-sm text-ink-muted mt-1">
        Окно с пошаговой инструкцией, как добавить сайт на экран телефона. Открывается методами основного скрипта из кода сайта — их
        список в «Методы основного скрипта».
      </p>
      <div className="mt-3 flex flex-col gap-4">
        <Card className={`flex flex-col gap-3 ${busy ? "opacity-60" : ""}`}>
          <Toggle checked={enabled} onChange={setEnabled} label="Показывать окно" />

          <div>
            <Label>Заголовок окна</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Установите приложение" maxLength={60} />
          </div>
          <div>
            <Label>Текст над шагами</Label>
            <Textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} maxLength={240} placeholder="Зачем ставить приложение на экран телефона" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Текст кнопки</Label>
              <Input value={buttonText} onChange={(e) => setButtonText(e.target.value)} placeholder="Понятно" maxLength={30} />
            </div>
            <div>
              <Label>Скругление кнопки</Label>
              <CustomSelect
                value={buttonRadius}
                onChange={(v) => setButtonRadius(v as CornerRadius)}
                options={(Object.keys(RADIUS_LABEL) as CornerRadius[]).map((r) => ({ value: r, label: RADIUS_LABEL[r] }))}
                className="w-full"
              />
            </div>
            <div>
              <Label>Цвет кнопки</Label>
              <ColorField value={buttonColor} onChange={setButtonColor} presets={BG_COLOR_PRESETS} />
            </div>
            <div>
              <Label>Цвет текста кнопки</Label>
              <ColorField value={buttonTextColor} onChange={setButtonTextColor} presets={TEXT_COLOR_PRESETS} />
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <div className="text-sm font-semibold text-ink mb-2">Шаги инструкции</div>
            <SegmentedControl
              value={platform}
              onChange={setPlatform}
              options={[
                { value: "ios", label: "iPhone" },
                { value: "android", label: "Android" },
              ]}
              className="mb-3"
            />

            {list.length === 0 && (
              <div className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-center text-[13px] text-ink-muted">
                Шагов пока нет. Добавьте первый, и он появится в окне.
              </div>
            )}

            <div className="flex flex-col gap-2">
              {list.map((s, i) => (
                <div
                  key={s.uid}
                  ref={(el) => {
                    rowRefs.current[s.uid] = el;
                  }}
                  className={`flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
                    dragUid === s.uid ? "bg-surface-2 shadow-sm select-none border-border-strong" : "border-border"
                  }`}
                >
                  <div
                    onPointerDown={(e) => dragStart(e, s.uid)}
                    style={{ touchAction: "none" }}
                    className={`p-1 -m-1 mt-0.5 text-ink-faint hover:text-ink ${dragUid === s.uid ? "cursor-grabbing text-ink" : "cursor-grab"}`}
                    aria-label="Перетащить для изменения порядка шагов"
                    role="button"
                  >
                    <IconGripVertical size={16} stroke={1.8} />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div className="text-sm font-semibold text-ink">Шаг {i + 1}</div>
                    <Textarea
                      value={s.text}
                      onChange={(e) => patch(s.uid, { text: e.target.value })}
                      rows={2}
                      maxLength={INSTALL_TEXT_MAX}
                      aria-label={`Текст шага ${i + 1}`}
                    />
                    <CustomSelect
                      value={s.scene}
                      onChange={(v) => patch(s.uid, { scene: v })}
                      options={sceneOptions}
                      className="w-full"
                    />
                    {s.scene === CUSTOM_IMAGE_SCENE && (
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-2">
                        {s.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.image} alt="" className="w-16 h-16 rounded-lg object-cover border border-border bg-surface shrink-0" />
                        ) : (
                          <div className="w-16 h-16 rounded-lg border border-dashed border-border-strong flex items-center justify-center text-ink-faint shrink-0">
                            <IconUpload size={20} stroke={1.6} />
                          </div>
                        )}
                        <div className="min-w-0 flex flex-col items-start gap-1.5">
                          <label className={`inline-flex ${uploading === s.uid ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}>
                            <span className="inline-flex items-center justify-center h-8 px-3 rounded-lg border border-border-strong bg-surface text-[13px] text-ink hover:bg-surface-2">
                              {uploading === s.uid ? "Загрузка…" : s.image ? "Заменить" : "Загрузить картинку"}
                            </span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                if (f) uploadImage(s.uid, f);
                              }}
                            />
                          </label>
                          <span className="text-xs text-ink-faint">PNG, JPG, WebP или SVG, до 2 МБ</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setList((l) => l.filter((r) => r.uid !== s.uid))}
                    className="p-1.5 -mt-1 shrink-0 text-ink-faint hover:text-bad transition-colors cursor-pointer"
                    aria-label={`Удалить шаг ${i + 1}`}
                    title="Удалить шаг"
                  >
                    <IconTrash size={16} stroke={1.8} />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-2">
              <Button type="button" variant="secondary" size="sm" onClick={addStep}>
                <IconPlus size={15} stroke={1.8} />
                Добавить шаг
              </Button>
            </div>
            {!hasManifest && (
              <p className="text-xs text-ink-faint mt-2 mb-0">
                Манифест пока не создан — в схемах будет буква на плашке.{" "}
                <a href={`/admin/projects/${projectId}/settings`} className="text-accent underline">
                  Создать манифест
                </a>
                .
              </p>
            )}
          </div>

          <div>
            <Button size="md" disabled={busy} onClick={save}>
              Сохранить окно
            </Button>
          </div>

          <SitePreviewLink projectId={projectId} domain={domain} widget="install" />
        </Card>

        <InstallPreview config={config} projectId={projectId} version={version} />
      </div>
    </>
  );
}
