"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh, IconPhoto } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, useDialogs } from "@/app/ui";
import { friendlyError } from "@/lib/errors";
import { CustomSelect } from "@/app/ui/CustomSelect";
import { FeedStructureDocs } from "./FeedStructureDocs";

// Часовые пояса РФ/СНГ — базовый список для проектов на русскоязычном рынке
// (см. lib/sendWindow.ts — используется как дефолт окна отправки welcome-
// сообщений, когда переключатель «по часовому поясу подписчика» выключен
// или пояс подписчика неизвестен).
const TIMEZONE_OPTIONS = [
  { id: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { id: "Europe/Moscow", label: "Москва (UTC+3)" },
  { id: "Europe/Samara", label: "Самара (UTC+4)" },
  { id: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { id: "Asia/Omsk", label: "Омск (UTC+6)" },
  { id: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)" },
  { id: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)" },
  { id: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { id: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { id: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { id: "Asia/Magadan", label: "Магадан (UTC+11)" },
  { id: "Asia/Kamchatka", label: "Камчатка (UTC+12)" },
  { id: "UTC", label: "UTC" },
];

export default function ProjectSettings({
  projectId,
  initialName,
  domain,
  initialYmCounterId,
  initialTimezone,
  initialFeedUrl,
  feedUpdatedAt,
  feedItemCount,
  feedError,
  initialLogoUrl,
}: {
  projectId: string;
  initialName: string;
  domain: string | null;
  initialYmCounterId: string | null;
  initialTimezone: string;
  initialFeedUrl: string | null;
  feedUpdatedAt: string | null;
  feedItemCount: number;
  feedError: string | null;
  initialLogoUrl: string | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [name, setName] = useState(initialName);
  const [ymCounterId, setYmCounterId] = useState(initialYmCounterId || "");
  const [timezone, setTimezone] = useState(initialTimezone);
  const [feedUrl, setFeedUrl] = useState(initialFeedUrl || "");
  const [feedBusy, setFeedBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [logoBusy, setLogoBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cleanName = name.trim();
    if (!cleanName) return toast("Название не может быть пустым", "bad");
    setBusy(true);
    const { error } = await supabase
      .from("projects")
      .update({ name: cleanName, ym_counter_id: ymCounterId.trim() || null, timezone })
      .eq("id", projectId);
    setBusy(false);
    if (error) return toast(friendlyError(error), "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  async function saveFeed() {
    if (feedBusy) return;
    setFeedBusy(true);
    const { error } = await supabase.from("projects").update({ product_feed_url: feedUrl.trim() || null }).eq("id", projectId);
    setFeedBusy(false);
    if (error) return toast(friendlyError(error), "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  async function refreshFeed() {
    if (feedBusy) return;
    if (!initialFeedUrl) return toast("Сначала укажите и сохраните ссылку на фид", "bad");
    setFeedBusy(true);
    const res = await fetch(`/api/admin/projects/${projectId}/product-feed/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const json = await res.json().catch(() => ({}));
    setFeedBusy(false);
    if (!res.ok) return toast(json.error || "Ошибка обновления фида", "bad");
    toast(json.skipped ? "Фид не изменился с прошлой проверки" : `Загружено товаров: ${json.count}`, "good");
    router.refresh();
  }

  async function deleteFeed() {
    if (feedBusy) return;
    if (!initialFeedUrl) return toast("Фид ещё не подключен", "bad");
    const ok = await confirm({
      title: "Удалить товарный фид?",
      message: "Ссылка и весь кеш товаров будут удалены. Событийные рассылки, ссылающиеся на товары, потеряют доступ к их данным — уже отправленные рассылки сохранили нужный контекст в логе и не пострадают.",
      confirmText: "Удалить фид",
      danger: true,
    });
    if (!ok) return;
    setFeedBusy(true);
    const res = await fetch(`/api/admin/projects/${projectId}/product-feed`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const json = await res.json().catch(() => ({}));
    setFeedBusy(false);
    if (!res.ok) return toast(json.error || "Не удалось удалить фид", "bad");
    setFeedUrl("");
    toast("Фид удалён", "good");
    router.refresh();
  }

  async function remove() {
    if (busy) return;
    const ok = await confirm({
      title: "Удалить проект?",
      message:
        "Безвозвратно удалятся подписчики, рассылки, статистика, настройки входа и иконки. Виджет на сайте перестанет работать.",
      confirmText: "Удалить проект",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/admin/projects/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(json.error || "Не удалось удалить", "bad");
    // полная перезагрузка, чтобы шапка перечитала список проектов
    window.location.href = "/admin";
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    const form = new FormData();
    form.append("projectId", projectId);
    form.append("file", file);
    const res = await fetch("/api/admin/project-logo/upload", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    setLogoBusy(false);
    if (!res.ok) return toast(json.error || "Не удалось загрузить логотип", "bad");
    setLogoUrl(json.url);
    toast("Логотип сохранён", "good");
  }

  async function removeLogo() {
    if (logoBusy) return;
    const ok = await confirm({ title: "Убрать логотип с экрана входа?", confirmText: "Убрать", danger: true });
    if (!ok) return;
    setLogoBusy(true);
    const res = await fetch("/api/admin/project-logo/upload", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const json = await res.json().catch(() => ({}));
    setLogoBusy(false);
    if (!res.ok) return toast(json.error || "Не удалось убрать логотип", "bad");
    setLogoUrl(null);
    toast("Логотип убран", "good");
  }

  return (
    <>
      <section className="mt-10">
        <h2 className="text-lg font-semibold mb-1">Общие настройки</h2>
        <p className="text-[13px] text-ink-muted mt-0 mb-3">Название, аналитика и часовой пояс проекта.</p>

        <Card className={busy ? "opacity-60" : ""}>
          <div className="text-[13.5px] font-semibold mb-3">Данные проекта</div>
          <form onSubmit={save} className="flex flex-col gap-3">
            <div>
              <label htmlFor="proj-name" className="text-[13px] text-ink-muted block mb-1">
                Название
              </label>
              <Input id="proj-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </div>
            <div>
              <label htmlFor="proj-domain" className="text-[13px] text-ink-muted block mb-1">
                Домен сайта
              </label>
              <Input id="proj-domain" value={domain || "не задан"} disabled />
            </div>
            <div>
              <label htmlFor="proj-ym-counter" className="text-[13px] text-ink-muted block mb-1">
                Номер счётчика Яндекс.Метрики
              </label>
              <Input
                id="proj-ym-counter"
                value={ymCounterId}
                onChange={(e) => setYmCounterId(e.target.value)}
                placeholder="Например, 12345678"
              />
            </div>
            <div>
              <div className="text-[13px] text-ink-muted mb-1">Часовой пояс проекта</div>
              <CustomSelect
                value={timezone}
                onChange={setTimezone}
                options={TIMEZONE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
                ariaLabel="Часовой пояс проекта"
                className="w-full"
              />
            </div>
            <div className="flex items-center justify-between">
              <Button>Сохранить</Button>
              <Button variant="danger" type="button" onClick={remove}>
                Удалить проект
              </Button>
            </div>
          </form>
        </Card>

        <Card className={`mt-3 ${logoBusy ? "opacity-60" : ""}`}>
          <div className="text-[13.5px] font-semibold mb-1">Логотип</div>
          <p className="text-[13px] text-ink-muted mt-0 mb-3">Загрузите логотип проекта.</p>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-border rounded-xl w-28 h-28 cursor-pointer hover:border-accent transition-colors shrink-0">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Логотип" className="max-w-20 max-h-20 object-contain" />
              ) : (
                <IconPhoto size={26} stroke={1.5} className="text-ink-faint" />
              )}
              <input
                type="file"
                accept="image/png,image/webp,image/svg+xml,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) uploadLogo(file);
                }}
              />
            </label>
            <div className="text-[13px] text-ink-muted">
              <div>PNG, WebP, SVG или JPG · до 2 МБ</div>
              <div className="text-[12px] text-ink-faint mt-0.5">Нажмите на рамку, чтобы выбрать файл — загружается сразу</div>
              {logoUrl && (
                <Button variant="danger" size="sm" type="button" className="mt-2" onClick={removeLogo} disabled={logoBusy}>
                  Убрать логотип
                </Button>
              )}
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold mb-1">Товарный фид</h2>
        <p className="text-[13px] text-ink-muted mt-0 mb-3">
          Подключите товарный фид, чтобы подставлять название, цену и картинку товара прямо в текст рассылок.
        </p>

        <Card className={feedBusy ? "opacity-60" : ""}>
          <div className="text-[13.5px] font-semibold mb-3">Ссылка на фид</div>
          <label htmlFor="feed-url" className="text-[13px] text-ink-muted block mb-1">
            URL фида
          </label>
          <Input
            id="feed-url"
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            placeholder="https://ваш-сайт/exports/yandex-market.yml"
            className="w-full"
          />
          <div className="h-3" />
          <FeedStructureDocs />
          <div className="h-3" />
          <div className="flex gap-2 flex-wrap">
            <Button type="button" onClick={saveFeed}>
              Сохранить
            </Button>
            <Button type="button" variant="secondary" onClick={refreshFeed}>
              <IconRefresh size={16} stroke={1.8} />
              Обновить
            </Button>
            <Button type="button" variant="danger" onClick={deleteFeed}>
              Удалить
            </Button>
          </div>
          {initialFeedUrl && (
            <p className="text-[12px] text-ink-faint mt-2 mb-0">
              {feedError ? (
                <span className="text-bad">Ошибка: {feedError}</span>
              ) : feedUpdatedAt ? (
                `Товаров в кеше: ${feedItemCount} · обновлено ${new Date(feedUpdatedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}`
              ) : (
                "Ещё не обновлялся — нажмите «Обновить»."
              )}
            </p>
          )}
        </Card>
      </section>
    </>
  );
}
