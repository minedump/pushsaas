"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconDeviceFloppy, IconTrash } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, useDialogs } from "@/app/ui";

export default function ProjectSettings({
  projectId,
  initialName,
}: {
  projectId: string;
  initialName: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);

  const dirty = name.trim() !== initialName;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return toast("Название не может быть пустым", "bad");
    setBusy(true);
    const { error } = await supabase.from("projects").update({ name: cleanName }).eq("id", projectId);
    setBusy(false);
    if (error) return toast(error.message, "bad");
    toast("Сохранено", "good");
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
