"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconDeviceFloppy, IconTrash } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, useDialogs } from "@/app/ui";

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

export default function ProjectSettings({
  projectId,
  initialName,
  initialDomain,
}: {
  projectId: string;
  initialName: string;
  initialDomain: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [name, setName] = useState(initialName);
  const [domain, setDomain] = useState(initialDomain);
  const [busy, setBusy] = useState(false);

  const dirty = name.trim() !== initialName || normalizeDomain(domain) !== initialDomain;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = name.trim();
    const cleanDomain = normalizeDomain(domain);
    if (!cleanName) return toast("Название не может быть пустым", "bad");
    if (cleanDomain && !/^[a-z0-9а-яё.-]+\.[a-zа-яё]{2,}$/i.test(cleanDomain)) {
      return toast("Домен вида site.ru — без http:// и путей", "bad");
    }
    setBusy(true);
    const { error } = await supabase
      .from("projects")
      .update({ name: cleanName, domain: cleanDomain || null })
      .eq("id", projectId);
    setBusy(false);
    if (error) return toast(error.message, "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  async function remove() {
    const ok = await confirm({
      title: "Удалить проект?",
      message:
        "Безвозвратно удалятся подписчики, кампании, статистика, настройки входа и иконки. Виджет на сайте перестанет работать.",
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
      <h2 className="text-lg font-semibold">Настройки проекта</h2>
      <Card className={`mt-3 ${busy ? "opacity-60" : ""}`}>
        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-[13px] text-ink-muted block mb-1">Название</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </div>
            <div>
              <label className="text-[13px] text-ink-muted block mb-1">Домен сайта</label>
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="site.ru" />
            </div>
          </div>
          <p className="text-[12.5px] text-ink-faint m-0">
            Смена домена влияет на проверки шагов, отскок входа по телефону и адрес service worker. Виджет и подписчики
            привязаны к проекту, а не к домену — при переезде сайта они сохранятся.
          </p>
          <div>
            <Button disabled={busy || !dirty}>
              <IconDeviceFloppy size={16} stroke={1.8} />
              Сохранить
            </Button>
          </div>
        </form>
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
