"use client";

import { useEffect, useState } from "react";
import { IconCopy, IconExternalLink } from "@tabler/icons-react";
import { Button, Input, Label, useDialogs } from "@/app/ui";

// «Посмотреть на сайте»: открывает страницу сайта клиента с параметром
// sendera_preview=<токен> — основной скрипт на сайте по нему подгружает
// предпросмотр виджета, даже если тот выключен (см. lib/widget-preview.ts).
// Ту же ссылку можно скопировать и отправить коллеге: токен подписан и живёт
// 30 минут, войти в админку для просмотра не нужно.
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
  // ссылка для ручного копирования, если браузер не дал записать её в буфер
  const [manual, setManual] = useState<string | null>(null);

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

  // Проверяет введённый адрес: целиком, http(s) и на домене проекта (или его
  // поддомене) — токен не должен уходить на чужой сайт.
  function checkedTarget(): URL | null {
    let target: URL;
    try {
      target = new URL(url.trim());
    } catch {
      toast("Введите адрес страницы целиком, например https://ваш-сайт/", "bad");
      return null;
    }
    const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
    const host = strip(target.hostname);
    const site = strip(domain || "");
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      toast("Адрес должен начинаться с https://", "bad");
      return null;
    }
    if (!site || !(host === site || host.endsWith("." + site))) {
      toast(`Адрес должен быть на сайте проекта: ${domain || "домен не указан"}`, "bad");
      return null;
    }
    return target;
  }

  // Токен выдаёт сервер: подпись на проект и этот виджет, срок 30 минут.
  async function withToken(target: URL): Promise<string | null> {
    const res = await fetch("/api/admin/widget/preview-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, widget }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok || !j.token) {
      toast(j.error || "Не удалось создать ссылку", "bad");
      return null;
    }
    target.searchParams.set(PARAM, j.token);
    try {
      localStorage.setItem(storageKey(projectId), url.trim());
    } catch {
      /* хранилище недоступно */
    }
    return target.toString();
  }

  async function open() {
    if (busy) return;
    const target = checkedTarget();
    if (!target) return;

    // Вкладку открываем сразу по клику (иначе браузер сочтёт её всплывающим
    // окном), адрес с токеном подставляем после ответа сервера.
    const tab = window.open("about:blank", "_blank");
    if (!tab) return toast("Браузер заблокировал новую вкладку — разрешите её для этой страницы", "bad");
    tab.opener = null;

    setBusy(true);
    setManual(null);
    const link = await withToken(target);
    setBusy(false);
    if (!link) return tab.close();
    tab.location.href = link;
  }

  async function copy() {
    if (busy) return;
    const target = checkedTarget();
    if (!target) return;

    setBusy(true);
    setManual(null);
    const link = await withToken(target);
    setBusy(false);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast("Ссылка скопирована — действует 30 минут", "good");
    } catch {
      // некоторые браузеры не дают писать в буфер после запроса к серверу —
      // показываем ссылку, чтобы её можно было скопировать вручную
      setManual(link);
      toast("Не удалось скопировать автоматически — скопируйте ссылку ниже", "bad");
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
        <Button variant="secondary" size="md" disabled={busy || !domain} onClick={copy}>
          <IconCopy size={16} stroke={1.8} />
          Скопировать ссылку
        </Button>
      </div>
      {manual && (
        <Input
          readOnly
          value={manual}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Ссылка предпросмотра для копирования"
          className="w-full font-mono text-xs"
        />
      )}
      <p className="text-xs text-ink-faint m-0">
        Откроет страницу вашего сайта, где подключён скрипт, и покажет этот виджет поверх неё — даже если он выключен.
        Показываются сохранённые настройки: сначала нажмите «Сохранить». Покупатели его не видят, подписки и события в
        этом режиме не создаются. Скопированную ссылку можно отправить коллеге: по ней предпросмотр увидит любой, у кого
        она есть, пока она действует — 30 минут.
      </p>
    </div>
  );
}
