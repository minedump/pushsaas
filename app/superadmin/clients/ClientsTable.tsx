"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconChevronLeft, IconChevronRight, IconGift, IconLogin2, IconPlayerPauseFilled, IconPlayerPlayFilled, IconSearch, IconX } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Input, useDialogs } from "@/app/ui";
import { CustomSelect } from "@/app/ui/CustomSelect";
import { friendlyError } from "@/lib/errors";

const PAGE_SIZE = 25;

type Tariff = { id: string; name: string; price_rub: number; monthly_push_limit: number };
type Row = {
  id: string;
  name: string;
  domain: string | null;
  is_active: boolean;
  owner_email: string;
  owner_name: string | null;
  subscribers: number;
  remaining_pushes: number;
  tariff_name: string;
  tariff_id: string | null;
};

export default function ClientsTable({ rows, tariffs }: { rows: Row[]; tariffs: Tariff[] }) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, prompt, toast } = useDialogs();
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

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
    if (error) toast(friendlyError(error), "bad");
    else { toast(`Начислено ${n} пушей`, "good"); router.refresh(); }
  }

  async function activateTariff(r: Row, tariffId: string) {
    if (tariffId === r.tariff_id) return;
    const t = tariffs.find((x) => x.id === tariffId);
    if (!t) return;
    const ok = await confirm({ title: `Сменить тариф на «${t.name}»?`, message: `Проект «${r.name}» — текущий тариф «${r.tariff_name}».` });
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
    if (error) toast(friendlyError(error), "bad");
    else { toast(`Тариф «${t.name}» активирован`, "good"); router.refresh(); }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.domain, r.owner_name, r.owner_email, r.tariff_name].some((v) => (v || "").toLowerCase().includes(q))
    );
  }, [rows, query]);

  useEffect(() => setPage(1), [query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  return (
    <div>
      <div className="relative mt-4">
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск: проект, домен, владелец, тариф"
          className="pl-9 pr-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-ink cursor-pointer"
            aria-label="Очистить поиск"
          >
            <IconX size={15} stroke={2} />
          </button>
        )}
      </div>

      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll mt-3">
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
            {paged.map((r) => (
              <tr key={r.id} className={`border-t border-border ${busy === r.id ? "opacity-50" : ""}`}>
                <Td>
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-ink-faint text-xs">{r.domain}</div>
                </Td>
                <Td className="text-ink-muted">
                  <div>{r.owner_name || r.owner_email}</div>
                  {r.owner_name && <div className="text-ink-faint text-xs">{r.owner_email}</div>}
                </Td>
                <Td>
                  <CustomSelect
                    value={r.tariff_id || ""}
                    onChange={(v) => activateTariff(r, v)}
                    options={tariffs.map((t) => ({ value: t.id, label: t.name }))}
                    placeholder="Без тарифа"
                    ariaLabel={`Тариф проекта ${r.name}`}
                    className="w-[160px]"
                  />
                </Td>
                <Td right>{r.subscribers}</Td>
                <Td right>{r.remaining_pushes}</Td>
                <Td>
                  <Badge tone={r.is_active ? "good" : "bad"} dot>
                    {r.is_active ? "активен" : "выключен"}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex gap-1 items-center">
                    <Link
                      href={`/admin/projects/${r.id}`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2"
                      title="Войти в проект"
                    >
                      <IconLogin2 size={15} stroke={1.8} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleActive(r)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer"
                      title={r.is_active ? "Выключить" : "Включить"}
                    >
                      {r.is_active ? <IconPlayerPauseFilled size={13} /> : <IconPlayerPlayFilled size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => grantBonus(r)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer"
                      title="Начислить бонус"
                    >
                      <IconGift size={15} stroke={1.8} />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3.5 py-8 text-center text-ink-faint">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-[13px] text-ink-muted">
          <span>
            {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} из {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={pageSafe <= 1} onClick={() => setPage((p) => p - 1)}>
              <IconChevronLeft size={15} stroke={2} />
            </Button>
            <span className="tabular-nums">
              {pageSafe} / {pageCount}
            </span>
            <Button variant="secondary" size="sm" disabled={pageSafe >= pageCount} onClick={() => setPage((p) => p + 1)}>
              <IconChevronRight size={15} stroke={2} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`px-3.5 py-2.5 text-[11px] text-ink-faint font-normal whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-3.5 py-3 align-middle ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
);
