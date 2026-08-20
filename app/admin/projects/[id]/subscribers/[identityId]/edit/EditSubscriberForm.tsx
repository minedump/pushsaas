"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, TagEditor, Toggle, useDialogs } from "@/app/ui";

type Identity = {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  insales_client_id: string | null;
  tags: string[] | null;
  sms_marketing_active_at: string | null;
  email_marketing_active_at: string | null;
};

export default function EditSubscriberForm({ projectId, identity }: { projectId: string; identity: Identity }) {
  const router = useRouter();
  const { confirm, toast } = useDialogs();

  const [name, setName] = useState(identity.name || "");
  const [phone, setPhone] = useState(identity.phone ? `+${identity.phone}` : "");
  const [email, setEmail] = useState(identity.email || "");
  const [insalesClientId, setInsalesClientId] = useState(identity.insales_client_id || "");
  const [tags, setTags] = useState<string[]>(identity.tags || []);
  const [smsActive, setSmsActive] = useState(!!identity.sms_marketing_active_at);
  const [emailActive, setEmailActive] = useState(!!identity.email_marketing_active_at);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() && !email.trim()) return toast("Укажите телефон или email", "bad");

    setBusy(true);
    const res = await fetch(`/api/admin/subscribers/${identity.id}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        phone: phone.trim(),
        email: email.trim(),
        name: name.trim(),
        insalesClientId: insalesClientId.trim(),
        smsActive,
        emailActive,
        tags,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return toast(json.error || "Ошибка сохранения", "bad");
    toast("Сохранено", "good");
    router.push(`/admin/projects/${projectId}/subscribers`);
    router.refresh();
  }

  async function remove() {
    const ok = await confirm({
      title: "Удалить контакт?",
      message: "Телефон, email и согласия на рассылку удалятся. Если к контакту привязано push-устройство, оно останется — просто без контактных данных.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/admin/subscribers/${identity.id}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return toast(json.error || "Ошибка удаления", "bad");
    }
    toast("Контакт удалён", "good");
    router.push(`/admin/projects/${projectId}/subscribers`);
    router.refresh();
  }

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Изменить подписчика</h1>

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

        <div className="flex items-center gap-2 mt-2">
          <Button disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</Button>
          <Button type="button" variant="secondary" onClick={() => router.push(`/admin/projects/${projectId}/subscribers`)}>
            Отмена
          </Button>
          <Button type="button" variant="danger" disabled={busy} onClick={remove} className="ml-auto">
            Удалить
          </Button>
        </div>
      </form>
    </main>
  );
}
