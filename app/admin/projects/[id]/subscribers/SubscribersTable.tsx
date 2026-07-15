"use client";

import { useMemo, useState } from "react";
import { IconX, IconSearch } from "@tabler/icons-react";
import { Badge, Button, Input, useDialogs } from "@/app/ui";

type Row = {
  id: string;
  platform: string;
  tags: string[];
  is_active: boolean;
  paused: boolean;
  created_at: string;
  phone: string | null;
  email: string | null;
  externalId: string | null;
};

const platformLabel: Record<string, string> = { ios: "iPhone", android: "Android", desktop: "Desktop", unknown: "—" };

function statusOf(r: Row): { label: string; tone: "good" | "bad" | "neutral" } {
  if (!r.is_active) return { label: "отвалился", tone: "bad" }; // 410/browser unsubscribe
  if (r.paused) return { label: "приостановлен", tone: "neutral" }; // владелец попросил отключить
  return { label: "активен", tone: "good" };
}

export default function SubscribersTable({ projectId, initial }: { projectId: string; initial: Row[] }) {
  const { confirm, toast } = useDialogs();
  const [rows, setRows] = useState<Row[]>(initial);
  const [query, setQuery] = useState("");

  async function call(subscriberId: string, action: "tags" | "pause" | "resume", tags?: string[]) {
    const res = await fetch("/api/admin/subscribers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, subscriberId, action, tags }),
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
    if (!(await call(id, "tags", tags))) setRows(prev); // откат при ошибке
  }

  async function togglePause(r: Row) {
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
    if (!(await call(r.id, action))) {
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, paused: r.paused } : x)));
    } else {
      toast(r.paused ? "Подписка возобновлена" : "Подписка приостановлена", "good");
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.phone || "").includes(q) ||
        (r.email || "").toLowerCase().includes(q) ||
        (r.externalId || "").toLowerCase().includes(q) ||
        (platformLabel[r.platform] || r.platform).toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [rows, query]);

  return (
    <div>
      <div className="relative mb-3 max-w-xs">
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск: телефон, email, внешний ID, тег"
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

      <div className="border border-border rounded-xl overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px] min-w-[960px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Телефон</Th>
              <Th>Email</Th>
              <Th>Внешний ID</Th>
              <Th>Платформа</Th>
              <Th>Теги</Th>
              <Th>Статус</Th>
              <Th>Подписан</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const st = statusOf(r);
              return (
                <tr key={r.id} className="border-t border-border">
                  <Td className="font-mono whitespace-nowrap">{r.phone ? `+${r.phone}` : <span className="text-ink-faint">—</span>}</Td>
                  <Td className="whitespace-nowrap max-w-52 overflow-hidden text-ellipsis">
                    {r.email || <span className="text-ink-faint">—</span>}
                  </Td>
                  <Td className="font-mono whitespace-nowrap max-w-36 overflow-hidden text-ellipsis">
                    {r.externalId || <span className="text-ink-faint">—</span>}
                  </Td>
                  <Td>{platformLabel[r.platform] || r.platform}</Td>
                  <Td>
                    <TagEditor tags={r.tags} onChange={(t) => updateTags(r.id, t)} />
                  </Td>
                  <Td>
                    <Badge tone={st.tone} dot>
                      {st.label}
                    </Badge>
                  </Td>
                  <Td className="text-ink-faint whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("ru-RU")}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {r.is_active && (
                      <Button variant="secondary" size="sm" onClick={() => togglePause(r)}>
                        {r.paused ? "Возобновить" : "Приостановить"}
                      </Button>
                    )}
                  </Td>
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
    </div>
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
