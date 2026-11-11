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

  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [insalesClientId, setInsalesClientId] = useState("");
  const [telegramId, setTelegramId] = useState("");
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
        lastName: lastName.trim() || undefined,
        firstName: firstName.trim() || undefined,
        middleName: middleName.trim() || undefined,
        insalesClientId: insalesClientId.trim() || undefined,
        telegramId: telegramId.trim() || undefined,
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Фамилия</Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <Label>Имя</Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label>Отчество</Label>
            <Input value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
          </div>
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
          <Label>Telegram ID</Label>
          <Input value={telegramId} onChange={(e) => setTelegramId(e.target.value)} inputMode="numeric" placeholder="Числовой идентификатор, например 123456789" />
        </div>
        <div>
          <Label>Теги</Label>
          <TagEditor tags={tags} onChange={setTags} />
        </div>

        <div className="flex gap-2">
          <Button disabled={busy}>{busy ? "Сохраняем…" : "Добавить"}</Button>
          <Button type="button" variant="secondary" onClick={() => router.push(`/admin/projects/${projectId}/subscribers`)}>
            Отмена
          </Button>
        </div>
      </form>
    </main>
  );
}
