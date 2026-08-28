"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconPencil } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, Input, Label, Toggle, useDialogs } from "@/app/ui";
import { friendlyError } from "@/lib/errors";

type Tariff = {
  id: string;
  name: string;
  price_rub: number;
  monthly_push_limit: number;
  subscriber_limit: number | null;
  is_public: boolean;
  is_system: boolean;
  sort: number;
};

export default function TariffsManager({ initial }: { initial: Tariff[] }) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [neu, setNeu] = useState({ name: "", price_rub: 0, monthly_push_limit: 0, subscriber_limit: "", is_public: true });

  async function save(t: Tariff) {
    setBusy(true);
    await supabase
      .from("tariffs")
      .update({
        name: t.name,
        price_rub: t.price_rub,
        monthly_push_limit: t.monthly_push_limit,
        subscriber_limit: t.subscriber_limit,
        is_public: t.is_public,
      })
      .eq("id", t.id);
    setBusy(false);
    toast("Тариф сохранён", "good");
    router.refresh();
  }

  async function togglePublic(t: Tariff) {
    setBusy(true);
    const { error } = await supabase.from("tariffs").update({ is_public: !t.is_public }).eq("id", t.id);
    setBusy(false);
    if (error) toast(friendlyError(error), "bad");
    else router.refresh();
  }

  async function remove(t: Tariff) {
    if (t.is_system) return;
    const ok = await confirm({ title: `Удалить тариф «${t.name}»?`, danger: true, confirmText: "Удалить" });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from("tariffs").delete().eq("id", t.id);
    setBusy(false);
    if (error) toast(friendlyError(error), "bad");
    else router.refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("tariffs").insert({
      name: neu.name,
      price_rub: neu.price_rub,
      monthly_push_limit: neu.monthly_push_limit,
      subscriber_limit: neu.subscriber_limit === "" ? null : Number(neu.subscriber_limit),
      is_public: neu.is_public,
      sort: initial.length,
    });
    setBusy(false);
    if (error) toast(friendlyError(error), "bad");
    else {
      setNeu({ name: "", price_rub: 0, monthly_push_limit: 0, subscriber_limit: "", is_public: true });
      toast("Тариф создан", "good");
      router.refresh();
    }
  }

  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className={`mt-5 ${busy ? "opacity-60" : ""}`}>
      {initial.map((t) => (
        <TariffRow
          key={t.id}
          tariff={t}
          editing={editingId === t.id}
          onStartEdit={() => setEditingId(t.id)}
          onStopEdit={() => setEditingId(null)}
          onSave={save}
          onTogglePublic={togglePublic}
          onDelete={remove}
        />
      ))}

      <Card className="mt-5">
        <form onSubmit={create}>
          <div className="font-semibold mb-3">Новый тариф</div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <Field label="Название"><Input value={neu.name} required onChange={(e) => setNeu({ ...neu, name: e.target.value })} /></Field>
            <Field label="Цена, ₽"><Input type="number" value={neu.price_rub} onChange={(e) => setNeu({ ...neu, price_rub: Number(e.target.value) })} /></Field>
            <Field label="Пушей/мес"><Input type="number" value={neu.monthly_push_limit} onChange={(e) => setNeu({ ...neu, monthly_push_limit: Number(e.target.value) })} /></Field>
            <Field label="Лимит подписчиков"><Input type="number" placeholder="∞" value={neu.subscriber_limit} onChange={(e) => setNeu({ ...neu, subscriber_limit: e.target.value })} /></Field>
          </div>
          <Toggle className="mt-3" checked={neu.is_public} onChange={(v) => setNeu({ ...neu, is_public: v })} label={neu.is_public ? "Вкл" : "Выкл"} />
          <div>
            <Button className="mt-4" disabled={busy}>Создать тариф</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function TariffRow({
  tariff,
  editing,
  onStartEdit,
  onStopEdit,
  onSave,
  onTogglePublic,
  onDelete,
}: {
  tariff: Tariff;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onSave: (t: Tariff) => void;
  onTogglePublic: (t: Tariff) => void;
  onDelete: (t: Tariff) => void;
}) {
  const [t, setT] = useState(tariff);

  function cancel() {
    setT(tariff);
    onStopEdit();
  }

  function submit() {
    onSave(t);
    onStopEdit();
  }

  if (!editing) {
    return (
      <Card className="mb-3">
        <div className="flex justify-between items-center gap-3">
          <div>
            <div className="font-semibold flex items-center gap-2 flex-wrap">
              {tariff.name}
              {tariff.is_system && <Badge tone="warn">системный</Badge>}
              {!tariff.is_public && <Badge tone="neutral">скрыт от клиентов</Badge>}
            </div>
            <div className="text-ink-muted text-[13px] mt-1">
              {tariff.price_rub.toLocaleString("ru-RU")} ₽ · {tariff.monthly_push_limit.toLocaleString("ru-RU")} пушей/мес ·{" "}
              {tariff.subscriber_limit ? `${tariff.subscriber_limit.toLocaleString("ru-RU")} подписчиков` : "без лимита подписчиков"}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!tariff.is_system && (
              <Toggle checked={tariff.is_public} onChange={() => onTogglePublic(tariff)} label={tariff.is_public ? "Вкл" : "Выкл"} />
            )}
            <Button variant="secondary" size="sm" onClick={() => { setT(tariff); onStartEdit(); }}>
              <IconPencil size={14} stroke={1.8} />
              Редактировать
            </Button>
            {!tariff.is_system && <Button variant="danger" size="sm" onClick={() => onDelete(tariff)}>Удалить</Button>}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-3">
      <div className="flex justify-between items-center mb-3">
        <div className="font-semibold flex items-center gap-2">
          {tariff.name} {tariff.is_system && <Badge tone="warn">системный</Badge>}
        </div>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <Field label="Название"><Input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
        <Field label="Цена, ₽"><Input type="number" value={t.price_rub} onChange={(e) => setT({ ...t, price_rub: Number(e.target.value) })} /></Field>
        <Field label="Пушей/мес"><Input type="number" value={t.monthly_push_limit} onChange={(e) => setT({ ...t, monthly_push_limit: Number(e.target.value) })} /></Field>
        <Field label="Лимит подписчиков"><Input type="number" placeholder="∞" value={t.subscriber_limit ?? ""} onChange={(e) => setT({ ...t, subscriber_limit: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      </div>
      <div className="flex gap-3 items-center mt-3">
        {!tariff.is_system && <Toggle checked={t.is_public} onChange={(v) => setT({ ...t, is_public: v })} label={t.is_public ? "Вкл" : "Выкл"} />}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={cancel}>
            Отменить
          </Button>
          <Button size="sm" onClick={submit}>Сохранить</Button>
          {!tariff.is_system && <Button variant="danger" size="sm" onClick={() => onDelete(tariff)}>Удалить</Button>}
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
