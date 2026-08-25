"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconDeviceFloppy, IconTrash, IconRefresh } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Select, useDialogs } from "@/app/ui";
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
  initialYmCounterId,
  initialTimezone,
  initialFeedUrl,
  feedUpdatedAt,
  feedItemCount,
  feedError,
}: {
  projectId: string;
  initialName: string;
  initialYmCounterId: string | null;
  initialTimezone: string;
  initialFeedUrl: string | null;
  feedUpdatedAt: string | null;
  feedItemCount: number;
  feedError: string | null;
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
  const feedDirty = feedUrl.trim() !== (initialFeedUrl || "");

  const dirty = name.trim() !== initialName || ymCounterId.trim() !== (initialYmCounterId || "") || timezone !== initialTimezone;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return toast("Название не может быть пустым", "bad");
    setBusy(true);
    const { error } = await supabase
      .from("projects")
      .update({ name: cleanName, ym_counter_id: ymCounterId.trim() || null, timezone })
      .eq("id", projectId);
    setBusy(false);
    if (error) return toast(error.message, "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  async function saveFeed() {
    setFeedBusy(true);
    const { error } = await supabase.from("projects").update({ product_feed_url: feedUrl.trim() || null }).eq("id", projectId);
    setFeedBusy(false);
    if (error) return toast(error.message, "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  async function refreshFeed() {
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

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Общие настройки</h2>
      <Card className={`mt-3 ${busy ? "opacity-60" : ""}`}>
        <form onSubmit={save} className="flex flex-col gap-3">
          <div>
            <label className="text-[13px] text-ink-muted block mb-1">Название</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </div>
          <div>
            <label className="text-[13px] text-ink-muted block mb-1">Номер счётчика Яндекс.Метрики</label>
            <Input value={ymCounterId} onChange={(e) => setYmCounterId(e.target.value)} placeholder="Например, 12345678" />
            <p className="text-[12px] text-ink-faint mt-1 mb-0">
              Виджет будет передавать ClientID посетителя из Метрики вместе с push-подпиской — пригодится, чтобы
              найти его сессию в самой Метрике. Требует, чтобы счётчик Метрики уже стоял на сайте.
            </p>
          </div>
          <div>
            <label className="text-[13px] text-ink-muted block mb-1">Часовой пояс проекта</label>
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full">
              {TIMEZONE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
            <p className="text-[12px] text-ink-faint mt-1 mb-0">
              Используется как база для окна отправки приветственных сообщений (раздел «Автоматизации»), когда оно
              не привязано к часовому поясу самого подписчика.
            </p>
          </div>
          <div>
            <Button disabled={busy || !dirty}>
              <IconDeviceFloppy size={16} stroke={1.8} />
              Сохранить
            </Button>
          </div>
        </form>
      </Card>

      <Card className={`mt-3 ${feedBusy ? "opacity-60" : ""}`}>
        <div className="text-[13.5px] font-semibold mb-1">Товарный фид</div>
        <p className="text-[12.5px] text-ink-faint mt-0 mb-3">
          Ссылка на YML-фид (Яндекс.Маркет — тот же формат, что штатный экспорт InSales). Загружается в кеш и
          используется как источник названия/цены/картинки товара в событийных рассылках («Автоматизации» → «Событийные») —{" "}
          <code className="font-mono text-[12px]">{"{{ product.name }}"}</code>, <code className="font-mono text-[12px]">{"{{ product.price }}"}</code>,
          кастомные параметры фида — <code className="font-mono text-[12px]">{'{{ product.params["Цвет товара"] }}'}</code>. Товары с общим{" "}
          <code className="font-mono text-[12px]">group_id</code> распознаются как варианты одной модели. Обновляется каждые 15 минут
          автоматически, но полный пересчёт кеша пропускается, если дата фида не изменилась с прошлой проверки.
        </p>
        <FeedStructureDocs />
        <div className="h-3" />
        <div className="flex gap-2 items-start flex-wrap">
          <Input
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            placeholder="https://ваш-сайт/exports/yandex-market.yml"
            className="flex-1 min-w-[260px]"
          />
          <Button type="button" variant="secondary" disabled={feedBusy || !feedDirty} onClick={saveFeed}>
            <IconDeviceFloppy size={16} stroke={1.8} />
            Сохранить
          </Button>
          <Button type="button" variant="secondary" disabled={feedBusy || !initialFeedUrl} onClick={refreshFeed}>
            <IconRefresh size={16} stroke={1.8} />
            Обновить сейчас
          </Button>
          <Button type="button" variant="danger" disabled={feedBusy || !initialFeedUrl} onClick={deleteFeed}>
            <IconTrash size={16} stroke={1.8} />
            Удалить фид
          </Button>
        </div>
        {initialFeedUrl && (
          <p className="text-[12px] text-ink-faint mt-2 mb-0">
            {feedError ? (
              <span className="text-bad">Ошибка: {feedError}</span>
            ) : feedUpdatedAt ? (
              `Товаров в кеше: ${feedItemCount} · обновлено ${new Date(feedUpdatedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}`
            ) : (
              "Ещё не обновлялся — нажмите «Обновить сейчас»."
            )}
          </p>
        )}
      </Card>

      <Card className="mt-3 border-bad">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[13.5px] font-semibold">Удалить проект</div>
            <div className="text-[12.5px] text-ink-faint">
              Подписчики, кампании, статистика и настройки входа будут удалены безвозвратно.
            </div>
          </div>
          <Button variant="danger" disabled={busy} onClick={remove} type="button">
            <IconTrash size={16} stroke={1.8} />
            Удалить
          </Button>
        </div>
      </Card>
    </section>
  );
}
