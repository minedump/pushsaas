"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, ButtonLink, Select, useDialogs } from "@/app/ui";

type Tariff = { id: string; name: string; price_rub: number; monthly_push_limit: number };
type Row = {
  id: string;
  name: string;
  domain: string | null;
  is_active: boolean;
  owner_email: string;
  subscribers: number;
  remaining_pushes: number;
  tariff_name: string;
};

export default function ClientsTable({ rows, tariffs }: { rows: Row[]; tariffs: Tariff[] }) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, prompt, toast } = useDialogs();
  const [busy, setBusy] = useState<string | null>(null);

  async function toggleActive(r: Row) {
    setBusy(r.id);
    await supabase.from("projects").update({ is_active: !r.is_active }).eq("id", r.id);
    setBusy(null);
    router.refresh();
  }

  async function grantBonus(r: Row) {
    const raw = await prompt({
      title: `Бонусные пуши — ${r.name}`,
      message: "Начисляется в непрогораемый пакетный баланс.",
      defaultValue: "1000",
      confirmText: "Начислить",
    });
    if (!raw) return;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(r.id);
    const { error } = await supabase.rpc("admin_grant_bonus", { p_project_id: r.id, p_pushes: n, p_description: "Бонус от суперадмина" });
    setBusy(null);
    if (error) toast(error.message, "bad");
    else { toast(`Начислено ${n} пушей`, "good"); router.refresh(); }
  }

  async function activateTariff(r: Row, tariffId: string) {
    const t = tariffs.find((x) => x.id === tariffId);
    if (!t) return;
    const ok = await confirm({ title: `Активировать «${t.name}»?`, message: `Проект «${r.name}».` });
    if (!ok) return;
    const raw = await prompt({
      title: "Сколько пушей зачислить?",
      defaultValue: String(t.monthly_push_limit),
      confirmText: "Активировать",
    });
    if (!raw) return;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return;
    setBusy(r.id);
    const { error } = await supabase.rpc("admin_activate_tariff", { p_project_id: r.id, p_tariff_id: tariffId, p_pushes: n });
    setBusy(null);
    if (error) toast(error.message, "bad");
    else { toast(`Тариф «${t.name}» активирован`, "good"); router.refresh(); }
  }

  return (
    <div className="border border-border rounded-xl overflow-x-auto mt-4">
      <table className="w-full border-collapse text-[13.5px] min-w-[820px]">
        <thead>
          <tr className="bg-surface-2 text-left">
            <Th>Проект</Th>
            <Th>Владелец</Th>
            <Th>Тариф</Th>
            <Th right>Подписчики</Th>
            <Th right>Баланс</Th>
            <Th>Статус</Th>
            <Th>Действия</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-t border-border ${busy === r.id ? "opacity-50" : ""}`}>
              <Td>
                <div className="font-semibold">{r.name}</div>
                <div className="text-ink-faint text-xs">{r.domain}</div>
              </Td>
              <Td className="text-ink-muted">{r.owner_email}</Td>
              <Td>{r.tariff_name}</Td>
              <Td right>{r.subscribers}</Td>
              <Td right>{r.remaining_pushes}</Td>
              <Td>
                <Badge tone={r.is_active ? "good" : "bad"} dot>
                  {r.is_active ? "активен" : "выключен"}
                </Badge>
              </Td>
              <Td>
                <div className="flex gap-1.5 flex-wrap items-center">
                  <ButtonLink href={`/admin/projects/${r.id}`} variant="secondary" size="sm">
                    Войти
                  </ButtonLink>
                  <Button variant="secondary" size="sm" onClick={() => toggleActive(r)}>
                    {r.is_active ? "Выключить" : "Включить"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => grantBonus(r)}>
                    Бонус
                  </Button>
                  <Select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        activateTariff(r, e.target.value);
                        e.target.value = "";
                      }
                    }}
                    className="py-1.5 text-xs"
                  >
                    <option value="">Тариф…</option>
                    {tariffs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-ink-faint font-normal whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-3.5 py-3 align-middle ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
);
