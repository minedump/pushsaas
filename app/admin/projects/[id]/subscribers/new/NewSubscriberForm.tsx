"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, TagEditor, Toggle, useDialogs } from "@/app/ui";

// Добавляет КОНТАКТ (identities: телефон/email/имя/внешний ID), не
// push-подписчика — endpoint/p256dh/auth настоящего push-устройства нельзя
// сфабриковать вручную, это ключи из Web Push API конкретного браузера.
// Контакт без привязанного устройства не получит push и не попадает в
// push-сегменты по тегам (теги живут на самом устройстве) — только SMS/Email,
// и то если явно отметить согласие на канал ниже. Устройство привяжется само,
// когда человек подпишется на push через виджет на сайте.
export default function NewSubscriberForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { toast } = useDialogs();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [insalesClientId, setInsalesClientId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [smsActive, setSmsActive] = useState(false);
  const [emailActive, setEmailActive] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() && !email.trim()) return toast("Укажите телефон или email", "bad");

    setBusy(true);
    const res = await fetch("/api/admin/subscribers/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        name: name.trim() || undefined,
        insalesClientId: insalesClientId.trim() || undefined,
        smsActive,
        emailActive,
        tags,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return toast(json.error || "Ошибка сохранения", "bad");
    toast(json.created ? "Контакт добавлен" : "Контакт обновлён — такой телефон/email уже был в базе", "good");
    router.push(`/admin/projects/${projectId}/subscribers`);
    router.refresh();
  }

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Новый подписчик</h1>

      <form onSubmit={save} className="mt-4 flex flex-col gap-3">
        <div>
          <Label>Имя</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Как обращаться" />
        </div>
        <div>
          <Label>Телефон</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+79991234567" />
          <div className="mt-2">
            <Toggle checked={smsActive} onChange={setSmsActive} label="Согласие на рассылку по SMS" disabled={!phone.trim()} />
          </div>
        </div>
        <div>
          <Label>Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.ru" />
          <div className="mt-2">
            <Toggle checked={emailActive} onChange={setEmailActive} label="Согласие на рассылку на Email" disabled={!email.trim()} />
          </div>
        </div>
        <div>
          <Label>Внешний ID</Label>
          <Input value={insalesClientId} onChange={(e) => setInsalesClientId(e.target.value)} placeholder="Например, ID клиента в InSales" />
        </div>
        <div>
          <Label>Теги</Label>
          <TagEditor tags={tags} onChange={setTags} />
        </div>

        <div className="flex gap-2 mt-2">
          <Button disabled={busy}>{busy ? "Сохраняем…" : "Добавить"}</Button>
          <Button type="button" variant="secondary" onClick={() => router.push(`/admin/projects/${projectId}/subscribers`)}>
            Отмена
          </Button>
        </div>
      </form>
    </main>
  );
}
