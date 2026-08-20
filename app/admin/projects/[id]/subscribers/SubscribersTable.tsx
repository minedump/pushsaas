"use client";

import { useEffect, useMemo, useState } from "react";
import { IconX, IconSearch, IconPlayerPlayFilled, IconPlayerPauseFilled, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Badge, Button, Input, useDialogs } from "@/app/ui";
import { cn } from "@/app/ui/cn";

const PAGE_SIZE = 25;

type Row = {
  id: string;
  platform: string;
  tags: string[];
  is_active: boolean;
  paused: boolean;
  created_at: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  insalesClientId: string | null;
  pushActive: boolean;
  smsActive: boolean;
  emailActive: boolean;
};

const platformLabel: Record<string, string> = { ios: "iPhone", android: "Android", desktop: "Desktop", unknown: "—" };

export default function SubscribersTable({ projectId, initial }: { projectId: string; initial: Row[] }) {
  const { confirm, toast } = useDialogs();
  const [rows, setRows] = useState<Row[]>(initial);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  async function call(subscriberId: string, body: Record<string, unknown>) {
    const res = await fetch("/api/admin/subscribers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, subscriberId, ...body }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast(j.error || "Не удалось сохранить", "bad");
      return false;
    }
    return true;
  }

  async function updateTags(id: string, tags: string[]) {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, tags } : r)));
    if (!(await call(id, { action: "tags", tags }))) setRows(prev); // откат при ошибке
  }

  // Клик по бейджу Push — та же приостановка, что раньше жила в отдельной
  // кнопке; мёртвое устройство (r.is_active=false) не кликабельно вообще —
  // его нечем "возобновлять", подписка отвалилась на стороне браузера.
  async function togglePush(r: Row) {
    if (!r.is_active) return;
    if (!r.paused) {
      const ok = await confirm({
        title: "Приостановить подписку?",
        message: "Подписчик перестанет получать любые уведомления, пока вы не возобновите. Устройство сохранится.",
        confirmText: "Приостановить",
      });
      if (!ok) return;
    }
    const action = r.paused ? "resume" : "pause";
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, paused: !r.paused } : x)));
    if (!(await call(r.id, { action }))) {
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, paused: r.paused } : x)));
    } else {
      toast(r.paused ? "Подписка возобновлена" : "Подписка приостановлена", "good");
    }
  }

  // Клик по бейджу SMS/Email — включает/выключает согласие на рассылку по
  // этому каналу (identities.sms_marketing_active_at/email_marketing_active_at,
  // см. lib/identity.upsertContact) — недоступно, если у контакта ещё нет
  // самого телефона/email.
  async function toggleChannel(r: Row, channel: "sms" | "email") {
    const key = channel === "sms" ? "smsActive" : "emailActive";
    if (channel === "sms" && !r.phone) return;
    if (channel === "email" && !r.email) return;
    const nextActive = !r[key];
    const prev = rows;
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, [key]: nextActive } : x)));
    const ok = await call(r.id, {
      action: "channel",
      channel,
      active: nextActive,
      phone: channel === "sms" ? r.phone : undefined,
      email: channel === "email" ? r.email : undefined,
    });
    if (!ok) {
      setRows(prev);
    } else {
      const label = channel === "sms" ? "SMS" : "Email";
      toast(nextActive ? `${label} включён` : `${label} отключён`, "good");
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.phone || "").includes(q) ||
        (r.email || "").toLowerCase().includes(q) ||
        (r.name || "").toLowerCase().includes(q) ||
        (r.insalesClientId || "").toLowerCase().includes(q) ||
        (platformLabel[r.platform] || r.platform).toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [rows, query]);

  useEffect(() => setPage(1), [query]); // новый поиск — всегда с первой страницы

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  return (
    <div>
      <div className="relative mb-3">
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск: имя, телефон, email, внешний ID, тег"
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

      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
        <table className="w-full border-collapse text-[13.5px] min-w-[960px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Имя</Th>
              <Th>Телефон</Th>
              <Th>Email</Th>
              <Th>Внешний ID</Th>
              <Th>Платформа</Th>
              <Th>Каналы</Th>
              <Th>Теги</Th>
              <Th>Создан</Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => {
              return (
                <tr key={r.id} className="border-t border-border">
                  <Td className="whitespace-nowrap max-w-40 overflow-hidden text-ellipsis">
                    {r.name || <span className="text-ink-faint">—</span>}
                  </Td>
                  <Td className="font-mono whitespace-nowrap">{r.phone ? `+${r.phone}` : <span className="text-ink-faint">—</span>}</Td>
                  <Td className="whitespace-nowrap max-w-52 overflow-hidden text-ellipsis">
                    {r.email || <span className="text-ink-faint">—</span>}
                  </Td>
                  <Td className="font-mono whitespace-nowrap max-w-36 overflow-hidden text-ellipsis">
                    {r.insalesClientId || <span className="text-ink-faint">—</span>}
                  </Td>
                  <Td>{platformLabel[r.platform] || r.platform}</Td>
                  <Td className="whitespace-nowrap">
                    <div className="flex gap-1">
                      <ChannelBadge label="Push" active={r.pushActive} disabled={!r.is_active} onClick={() => togglePush(r)} />
                      {r.phone && <ChannelBadge label="SMS" active={r.smsActive} onClick={() => toggleChannel(r, "sms")} />}
                      {r.email && <ChannelBadge label="Email" active={r.emailActive} onClick={() => toggleChannel(r, "email")} />}
                    </div>
                  </Td>
                  <Td>
                    <TagEditor tags={r.tags} onChange={(t) => updateTags(r.id, t)} />
                  </Td>
                  <Td className="text-ink-faint whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("ru-RU")}</Td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3.5 py-6 text-center text-ink-muted">
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

// Бейдж-переключатель канала в колонке «Каналы» — клик включает/выключает
// рассылку по этому каналу для подписчика. SMS/Email вообще не рендерятся
// вызывающим кодом, если у канала нет контакта (телефона/email) — тут только
// disabled для push-устройства, которое отвалилось (нечем "возобновлять").
function ChannelBadge({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "Устройство отвалилось — нечем возобновлять" : active ? `Отключить ${label}` : `Включить ${label}`}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap border-none transition-colors",
        active ? "bg-good-tint text-good" : "bg-surface-2 text-ink-muted",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:opacity-80"
      )}
    >
      {active ? <IconPlayerPauseFilled size={10} /> : <IconPlayerPlayFilled size={10} />}
      {label}
    </button>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState("");
  function add() {
    const t = input.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput("");
  }
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {tags.map((t) => (
        <Badge key={t} tone="accent">
          {t}
          <button
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="flex items-center border-none bg-transparent cursor-pointer text-inherit p-0 ml-0.5 opacity-70 hover:opacity-100"
            aria-label="удалить тег"
          >
            <IconX size={12} stroke={2.5} />
          </button>
        </Badge>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="+ тег"
        className="border border-dashed border-border rounded-full px-2 py-0.5 text-xs bg-transparent text-ink w-[70px] focus:outline-none focus:border-accent"
      />
    </div>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-ink-faint font-normal whitespace-nowrap">{children}</th>
);
const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <td className={`px-3.5 py-3 align-middle ${className}`}>{children}</td>
);
