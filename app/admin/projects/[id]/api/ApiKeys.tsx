"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconKey } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, Input, Label, useDialogs } from "@/app/ui";
import { CustomSelect } from "@/app/ui/CustomSelect";

type Key = {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  sms_provider?: string | null;
  email_provider?: string | null;
};

type ProviderOption = { value: string; label: string };

const PROVIDER_LABEL: Record<string, string> = { bytehand: "Bytehand", smsc: "SMSC.ru", haskimail: "Haskimail" };

export default function ApiKeys({
  projectId,
  initial,
  providerOptions,
}: {
  projectId: string;
  initial: Key[];
  providerOptions: { sms: ProviderOption[]; email: ProviderOption[] };
}) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [name, setName] = useState("");
  const [smsProvider, setSmsProvider] = useState("");
  const [emailProvider, setEmailProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFresh(null);
    const res = await fetch("/api/admin/apikeys/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name, smsProvider: smsProvider || undefined, emailProvider: emailProvider || undefined }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(json.error || "Ошибка", "bad");
      return;
    }
    setFresh(json.key);
    setName("");
    setSmsProvider("");
    setEmailProvider("");
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

      <Card className="mt-3">
        <form onSubmit={create}>
          <Label>Название ключа</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="напр. Бекенд сайта" />

          {(providerOptions.sms.length > 0 || providerOptions.email.length > 0) && (
            <div className="flex gap-3 mt-3">
              {providerOptions.sms.length > 0 && (
                <div className="flex-1">
                  <Label>SMS через</Label>
                  <CustomSelect
                    value={smsProvider}
                    onChange={setSmsProvider}
                    options={providerOptions.sms}
                    placeholder="не использовать"
                    className="w-full"
                  />
                </div>
              )}
              {providerOptions.email.length > 0 && (
                <div className="flex-1">
                  <Label>Email через</Label>
                  <CustomSelect
                    value={emailProvider}
                    onChange={setEmailProvider}
                    options={providerOptions.email}
                    placeholder="не использовать"
                    className="w-full"
                  />
                </div>
              )}
            </div>
          )}

          <Button disabled={busy} className="mt-3.5 whitespace-nowrap">
            <IconKey size={16} stroke={1.8} />
            Создать ключ
          </Button>
        </form>
      </Card>

      <div className="mt-4 border border-border rounded-xl overflow-hidden">
        {initial.length === 0 ? (
          <div className="p-4 text-ink-muted text-sm">Ключей пока нет.</div>
        ) : (
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="bg-surface-2 text-left">
                <Th>Название</Th>
                <Th>Префикс</Th>
                <Th>Каналы</Th>
                <Th>Статус</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {initial.map((k) => (
                <tr key={k.id} className="border-t border-border">
                  <Td>{k.name}</Td>
                  <Td className="font-mono text-xs">{k.key_prefix}…</Td>
                  <Td className="text-ink-muted text-[12.5px]">
                    {[k.sms_provider && `SMS: ${PROVIDER_LABEL[k.sms_provider] || k.sms_provider}`, k.email_provider && `Email: ${PROVIDER_LABEL[k.email_provider] || k.email_provider}`]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </Td>
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
