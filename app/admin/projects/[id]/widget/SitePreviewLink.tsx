"use client";

import { useEffect, useState } from "react";
import { IconExternalLink } from "@tabler/icons-react";
import { Button, Input, Label, useDialogs } from "@/app/ui";

// «Посмотреть на сайте»: открывает страницу сайта клиента с параметром
// sendera_preview=<токен> — основной скрипт на сайте по нему подгружает
// предпросмотр виджета, даже если тот выключен (см. lib/widget-preview.ts).
// Имя параметра дублируем здесь строкой: сам модуль подписи серверный.
const PARAM = "sendera_preview";
const storageKey = (projectId: string) => `sendera-preview-url-${projectId}`;

export default function SitePreviewLink({
  projectId,
  domain,
  widget,
}: {
  projectId: string;
  domain: string | null;
  widget: "button" | "prompt" | "install";
}) {
  const { toast } = useDialogs();
  const [url, setUrl] = useState(domain ? `https://${domain}/` : "");
  const [busy, setBusy] = useState(false);

  // Последний использованный адрес (например, страница тестовой темы) помним
  // в браузере; хранилище может быть недоступно — тогда просто стартуем с главной.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey(projectId));
      if (saved) setUrl(saved);
    } catch {
      /* хранилище недоступно */
    }
  }, [projectId]);

  async function open() {
    if (busy) return;
    let target: URL;
    try {
      target = new URL(url.trim());
    } catch {
      return toast("Введите адрес страницы целиком, например https://ваш-сайт/", "bad");
    }
    const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
    const host = strip(target.hostname);
    const site = strip(domain || "");
    if (target.protocol !== "https:" && target.protocol !== "http:") return toast("Адрес должен начинаться с https://", "bad");
    if (!site || !(host === site || host.endsWith("." + site))) {
      return toast(`Адрес должен быть на сайте проекта: ${domain || "домен не указан"}`, "bad");
    }

    // Вкладку открываем сразу по клику (иначе браузер сочтёт её всплывающим
    // окном), адрес с токеном подставляем после ответа сервера.
    const tab = window.open("about:blank", "_blank");
    if (!tab) return toast("Браузер заблокировал новую вкладку — разрешите её для этой страницы", "bad");
    tab.opener = null;

    setBusy(true);
    const res = await fetch("/api/admin/widget/preview-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, widget }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok || !j.token) {
      tab.close();
      return toast(j.error || "Не удалось создать ссылку", "bad");
    }

    target.searchParams.set(PARAM, j.token);
    tab.location.href = target.toString();
    try {
      localStorage.setItem(storageKey(projectId), url.trim());
    } catch {
      /* хранилище недоступно */
    }
  }

  return (
    <div className="border-t border-border pt-3 flex flex-col gap-2">
      <Label>Предпросмотр на сайте</Label>
      <div className="flex gap-2 flex-wrap items-stretch">
        <Input
          className="flex-1 min-w-[220px]"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={domain ? `https://${domain}/` : "Домен сайта не указан в настройках проекта"}
          aria-label="Адрес страницы сайта для предпросмотра"
        />
        <Button variant="secondary" size="md" disabled={busy || !domain} onClick={open}>
          <IconExternalLink size={16} stroke={1.8} />
          Открыть на сайте
        </Button>
      </div>
      <p className="text-xs text-ink-faint m-0">
        Откроет страницу вашего сайта, где подключён скрипт, и покажет этот виджет поверх неё — даже если он выключен.
        Показываются сохранённые настройки: сначала нажмите «Сохранить». Покупатели его не видят, подписки и события в
        этом режиме не создаются. Ссылка действует 30 минут.
      </p>
    </div>
  );
}
