"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconDownload, IconPalette, IconPhoto } from "@tabler/icons-react";
import { Button, Card, Input, useDialogs } from "@/app/ui";
import CodeBlock from "./CodeBlock";

type ManifestResult = {
  manifest: string;
  headSnippet: string;
  icons: { i192: string; i512: string; m192: string; m512: string; apple: string };
};

const COLOR_PRESETS = ["#2c4a66", "#111827", "#2563eb", "#7c3aed", "#16a34a", "#ea580c", "#dc2626", "#0d9488"];

// «Соседнее приложение» в превью экрана «Домой» — серый плейсхолдер
function SkeletonApp() {
  return (
    <div className="flex flex-col items-center gap-1.5" aria-hidden="true">
      <div className="w-16 h-16 rounded-[18px] bg-border/70" />
      <div className="w-10 h-[9px] rounded bg-border/70" />
    </div>
  );
}

export default function ManifestSetup({
  projectId,
  initial,
  domain,
}: {
  projectId: string;
  initial: ManifestResult | null;
  domain: string | null;
}) {
  const router = useRouter();
  const { toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ManifestResult | null>(initial);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [themeColor, setThemeColor] = useState("#2c4a66");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!initial);

  // подпись под иконкой в превью — из готового манифеста
  const manifestShortName = useMemo(() => {
    if (!result) return "";
    try {
      return JSON.parse(result.manifest).short_name || "";
    } catch {
      return "";
    }
  }, [result]);

  function pickFile(f: File | null) {
    setFile(f);
    setFilePreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return toast("Загрузите иконку", "bad");
    setBusy(true);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("name", name);
    fd.set("shortName", shortName);
    fd.set("themeColor", themeColor);
    fd.set("icon", file);
    const res = await fetch("/api/admin/manifest/generate", { method: "POST", body: fd });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return toast(json.error || "Ошибка генерации", "bad");
    setResult(json);
    setShowForm(false);
    toast("Манифест и иконки готовы", "good");
    router.refresh();
  }

  function download() {
    if (!result) return;
    const blob = new Blob([result.manifest], { type: "application/manifest+json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "site.webmanifest";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className={busy ? "opacity-60" : ""}>
      {showForm && (
        <Card className="mt-2">
          <form onSubmit={generate} className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="text-[13px] text-ink-muted block mb-1">Название сайта</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Мой магазин" required maxLength={60} />
              </div>
              <div>
                <label className="text-[13px] text-ink-muted block mb-1">Короткое название (подпись под иконкой)</label>
                <Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Магазин" required maxLength={15} />
              </div>
            </div>

            <div>
              <label className="text-[13px] text-ink-muted block mb-1">Цвет темы</label>
              <div className="flex gap-2.5 items-center flex-wrap">
                <div
                  className="relative w-10 h-10 rounded-lg border border-border shadow-inner shrink-0 overflow-hidden"
                  style={{ backgroundColor: themeColor }}
                  title="Выбрать цвет"
                >
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(themeColor) ? themeColor : "#2c4a66"}
                    onChange={(e) => setThemeColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    aria-label="Выбрать цвет темы"
                  />
                </div>
                <Input value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="font-mono max-w-28" />
                <div className="flex gap-1.5 items-center">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setThemeColor(c)}
                      className={`w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 ${
                        themeColor.toLowerCase() === c ? "ring-2 ring-accent ring-offset-2" : "border border-border"
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`Цвет ${c}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="text-[13px] text-ink-muted block mb-1">Иконка приложения</label>
              <label className="flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-border rounded-xl px-5 py-6 cursor-pointer hover:border-accent transition-colors text-center">
                {filePreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={filePreview} alt="иконка" className="w-16 h-16 rounded-xl object-cover border border-border" />
                ) : (
                  <IconPhoto size={28} stroke={1.5} className="text-ink-faint" />
                )}
                <span className="text-[13.5px] text-ink">
                  {file ? file.name : "Нажмите, чтобы выбрать иконку"}
                </span>
                <span className="text-[12px] text-ink-faint">
                  PNG, JPG или WebP · квадрат от 512×512 · до 3 МБ · углы без скруглений
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] || null)}
                />
              </label>
              <p className="text-[12.5px] text-ink-faint mt-1.5 mb-0">
                Изображение по центру, с небольшими полями. Остальные форматы сделаем сами: Android — со скруглением,
                maskable — с полями на подложке цвета темы, Apple — без скруглений и прозрачности (iOS скругляет сам).
              </p>
            </div>

            <div>
              <Button disabled={busy}>
                <IconPalette size={16} stroke={1.8} />
                Сгенерировать манифест и иконки
              </Button>
            </div>
          </form>
        </Card>
      )}

      {result && (
        <div className="mt-3">
          <div className="flex items-center gap-4 flex-wrap">
            {/* превью «экран Домой»: скелетоны соседних приложений + наша иконка */}
            <div className="flex items-start gap-4 px-6 py-4 rounded-xl bg-surface-2 border border-border">
              <SkeletonApp />
              <div className="flex flex-col items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.icons.i192}
                alt="иконка приложения"
                className="w-16 h-16 rounded-[18px] shadow-sm"
              />
              <div className="text-[11px] text-ink leading-none max-w-16 truncate">{manifestShortName || " "}</div>
            </div>
              <SkeletonApp />
            </div>
            <div className="flex-1 min-w-52">
              <p className="text-[13px] text-ink-muted m-0">
                Так сайт будет выглядеть на экране «Домой» после установки.
              </p>
              <div className="flex flex-col items-start gap-2 mt-2">
                <Button variant="secondary" size="sm" onClick={download}>
                  <IconDownload size={15} stroke={1.8} />
                  Скачать site.webmanifest
                </Button>
                {!showForm && (
                  <Button variant="secondary" size="sm" onClick={() => setShowForm(true)}>
                    Перегенерировать
                  </Button>
                )}
              </div>
            </div>
          </div>

          <p className="text-[13px] text-ink-faint mt-3 mb-0">
            Иконки загружать никуда не нужно — они уже размещены у нас и прописаны в манифесте прямыми ссылками.
          </p>

          <p className="text-sm text-ink-muted mt-4 mb-1">
            1. Скачайте и загрузите файл в раздел{" "}
            {domain ? (
              <a href={`https://${domain}/admin2/account_files`} target="_blank" rel="noreferrer" className="text-accent">
                Файлы
              </a>
            ) : (
              "«Файлы»"
            )}
            .
          </p>
          <p className="text-sm text-ink-muted mb-1">
            2. Добавьте в{" "}
            {domain ? (
              <a
                href={`https://${domain}/admin2/account/codes_settings`}
                target="_blank"
                rel="noreferrer"
                className="text-accent"
              >
                Настройки → Блоки кода
              </a>
            ) : (
              "Настройки → Блоки кода"
            )}{" "}
            → «В раздел &lt;head&gt;»:
          </p>
          <CodeBlock code={result.headSnippet} />
          <p className="text-[12.5px] text-ink-faint">
            Если в шаблоне уже есть старый <code className="font-mono">&lt;link rel=&quot;manifest&quot;&gt;</code> или{" "}
            <code className="font-mono">apple-touch-icon</code> — замените их, дублировать нельзя.{" "}
            <code className="font-mono">display: standalone</code> уже включён в манифест — без него пуши на iPhone не
            работают.
          </p>
        </div>
      )}
    </div>
  );
}
