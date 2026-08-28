"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlus, IconX } from "@tabler/icons-react";
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
  attributes: Record<string, unknown> | null;
};

export default function EditSubscriberForm({
  projectId,
  identity,
  attributeKeys,
}: {
  projectId: string;
  identity: Identity;
  attributeKeys: string[];
}) {
  const router = useRouter();
  const { confirm, toast } = useDialogs();

  const [name, setName] = useState(identity.name || "");
  const [phone, setPhone] = useState(identity.phone ? `+${identity.phone}` : "");
  const [email, setEmail] = useState(identity.email || "");
  const [insalesClientId, setInsalesClientId] = useState(identity.insales_client_id || "");
  const [tags, setTags] = useState<string[]>(identity.tags || []);
  const [smsActive, setSmsActive] = useState(!!identity.sms_marketing_active_at);
  const [emailActive, setEmailActive] = useState(!!identity.email_marketing_active_at);
  // Доп. поля — набор ключей, встречавшихся хотя бы у одного контакта
  // проекта (см. page.tsx), не только у текущего: поле, расширенное через
  // CSV-импорт одному подписчику, должно быть видно и заполняемо у всех
  // остальных отсюда же, а не только через повторный импорт. Редактируются
  // построчно (ключ+значение, добавление новой строки — «+ Поле»), тем же
  // паттерном, что «Кнопки действий» в форме push-рассылки.
  const [attrRows, setAttrRows] = useState<{ key: string; value: string }[]>(() =>
    attributeKeys.map((k) => ({ key: k, value: identity.attributes?.[k] != null ? String(identity.attributes[k]) : "" }))
  );
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() && !email.trim()) return toast("Укажите телефон или email", "bad");

    // Значение null удаляет ключ целиком (см. updateContact) — так помечаем
    // ключи, у которых убрали строку в форме, а не просто очистили текст.
    const attributes: Record<string, string | null> = {};
    for (const row of attrRows) {
      const key = row.key.trim();
      if (key) attributes[key] = row.value.trim();
    }
    for (const key of attributeKeys) {
      if (!(key in attributes)) attributes[key] = null;
    }

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
        attributes,
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

        <div>
          <Label>Доп. поля</Label>
          <div>
            {attrRows.map((row, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <Input
                  value={row.key}
                  onChange={(e) => setAttrRows((rs) => rs.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
                  placeholder="Ключ, например loyalty_tier"
                />
                <Input
                  value={row.value}
                  onChange={(e) => setAttrRows((rs) => rs.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                  placeholder="Значение"
                />
                <Button type="button" variant="secondary" size="sm" onClick={() => setAttrRows((rs) => rs.filter((_, j) => j !== i))}>
                  <IconX size={15} stroke={2} />
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => setAttrRows((rs) => [...rs, { key: "", value: "" }])}>
              <IconPlus size={15} stroke={2} />
              Поле
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2">
          <Button disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</Button>
          <Button type="button" variant="secondary" onClick={() => router.push(`/admin/projects/${projectId}/subscribers`)}>
            Отмена
          </Button>
          <Button type="button" variant="danger" disabled={busy} onClick={remove}>
            Удалить
          </Button>
        </div>
      </form>
    </main>
  );
}
