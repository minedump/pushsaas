"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconKey } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, Input, useDialogs } from "@/app/ui";

type Key = {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
};

export default function ApiKeys({ projectId, initial }: { projectId: string; initial: Key[] }) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFresh(null);
    const res = await fetch("/api/admin/apikeys/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(json.error || "Ошибка", "bad");
      return;
    }
    setFresh(json.key);
    setName("");
    router.refresh();
  }

  async function revoke(id: string) {
    const ok = await confirm({
      title: "Отозвать ключ?",
      message: "Запросы с ним перестанут работать.",
      confirmText: "Отозвать",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    await supabase.from("api_keys").update({ is_active: false }).eq("id", id);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className={`mt-4 ${busy ? "opacity-60" : ""}`}>
      {fresh && (
        <Card className="border-good bg-good-tint">
          <div className="text-[13px] font-semibold mb-1.5">Ключ создан — скопируйте сейчас, больше он не покажется:</div>
          <code className="break-all text-[13px] font-mono">{fresh}</code>
        </Card>
      )}

      <form onSubmit={create} className="flex gap-2 mt-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название ключа (напр. Бекенд сайта)" />
        <Button disabled={busy} className="whitespace-nowrap">
          <IconKey size={16} stroke={1.8} />
          Создать ключ
        </Button>
      </form>

      <div className="mt-4 border border-border rounded-xl overflow-hidden">
        {initial.length === 0 ? (
          <div className="p-4 text-ink-muted text-sm">Ключей пока нет.</div>
        ) : (
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="bg-surface-2 text-left">
                <Th>Название</Th>
                <Th>Префикс</Th>
                <Th>Статус</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {initial.map((k) => (
                <tr key={k.id} className="border-t border-border">
                  <Td>{k.name}</Td>
                  <Td className="font-mono text-xs">{k.key_prefix}…</Td>
                  <Td>
                    <Badge tone={k.is_active ? "good" : "bad"} dot>
                      {k.is_active ? "активен" : "отозван"}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    {k.is_active && (
                      <Button variant="secondary" size="sm" onClick={() => revoke(k.id)}>
                        Отозвать
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-ink-faint font-normal">{children}</th>
);
const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <td className={`px-3.5 py-3 align-middle ${className}`}>{children}</td>
);
