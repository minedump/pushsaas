"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, Input, Label, Checkbox, useDialogs } from "@/app/ui";

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

  async function remove(t: Tariff) {
    if (t.is_system) return;
    const ok = await confirm({ title: `Удалить тариф «${t.name}»?`, danger: true, confirmText: "Удалить" });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from("tariffs").delete().eq("id", t.id);
    setBusy(false);
    if (error) toast(error.message, "bad");
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
    if (error) toast(error.message, "bad");
    else {
      setNeu({ name: "", price_rub: 0, monthly_push_limit: 0, subscriber_limit: "", is_public: true });
      toast("Тариф создан", "good");
      router.refresh();
    }
  }

  return (
    <div className={`mt-5 ${busy ? "opacity-60" : ""}`}>
      {initial.map((t) => (
        <TariffRow key={t.id} tariff={t} onSave={save} onDelete={remove} />
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
          <Checkbox className="mt-3" checked={neu.is_public} onChange={(v) => setNeu({ ...neu, is_public: v })} label="Показывать клиентам" />
          <div>
            <Button className="mt-4" disabled={busy}>Создать тариф</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function TariffRow({ tariff, onSave, onDelete }: { tariff: Tariff; onSave: (t: Tariff) => void; onDelete: (t: Tariff) => void }) {
  const [t, setT] = useState(tariff);
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
        <Checkbox checked={t.is_public} onChange={(v) => setT({ ...t, is_public: v })} label="Показывать клиентам" />
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => onSave(t)}>Сохранить</Button>
          <Button variant="secondary" size="sm" disabled={tariff.is_system} title={tariff.is_system ? "Системный тариф удалить нельзя" : ""} onClick={() => onDelete(tariff)}>
            Удалить
          </Button>
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
