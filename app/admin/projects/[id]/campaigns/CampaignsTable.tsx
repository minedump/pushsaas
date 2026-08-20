"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconChevronLeft, IconChevronRight, IconDownload, IconSearch, IconX, IconSend, IconTrash, IconPencil } from "@tabler/icons-react";
import { Badge, Button, Input, useDialogs } from "@/app/ui";
import { CustomSelect, type ComboOption } from "@/app/ui/CustomSelect";
import { createClient } from "@/lib/supabase/client";

const PAGE_SIZE = 25;

type Row = {
  id: string;
  campaignId: string | null;
  title: string;
  internal_title: string | null;
  status: string;
  channel: string;
  type: "transactional" | "marketing";
  initiator: "manual" | "api" | "automation" | "auth";
  sent_count: number;
  delivered_count: number;
  clicked_count: number;
  created_at: string;
  revenue: number;
};

const statusTone = (s: string) => (s === "sent" ? "good" : s === "failed" ? "bad" : s === "skipped" ? "neutral" : "warn");
const CHANNEL_LABEL: Record<string, string> = { push: "Push", sms: "SMS", email: "Email" };
const STATUS_LABEL: Record<string, string> = {
  draft: "черновик",
  scheduled: "запланирована",
  sending: "отправляется",
  sent: "отправлена",
  failed: "ошибка",
  canceled: "отменена",
  skipped: "пропущена",
};
const TYPE_LABEL: Record<string, string> = { transactional: "Транзакционное", marketing: "Маркетинговое" };
const INITIATOR_LABEL: Record<string, string> = { manual: "Ручная", api: "Вебхук/API", automation: "Автоматизация", auth: "Авторизация" };

const TYPE_OPTIONS: ComboOption[] = [
  { value: "all", label: "Все типы" },
  { value: "transactional", label: "Транзакционные" },
  { value: "marketing", label: "Маркетинговые" },
];
const INITIATOR_OPTIONS: ComboOption[] = [
  { value: "all", label: "Все инициаторы" },
  { value: "manual", label: "Ручная" },
  { value: "api", label: "Вебхук/API" },
  { value: "automation", label: "Автоматизация" },
  { value: "auth", label: "Авторизация" },
];

export default function CampaignsTable({ rows, attributionEnabled, projectId }: { rows: Row[]; attributionEnabled: boolean; projectId: string }) {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("all");
  const [initiatorFilter, setInitiatorFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({});
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const supabase = createClient();

  function updateSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  // Внутреннее название — только для организации в списке, получателям не
  // уходит (в отличие от title, который и есть контент). titleOverrides —
  // локальный кэш поверх серверных данных, чтобы правка отражалась сразу,
  // без router.refresh() на каждую букву.
  async function saveInternalTitle(campaignId: string, value: string, previous: string) {
    setTitleOverrides((o) => ({ ...o, [campaignId]: value }));
    const { error } = await supabase.from("campaigns").update({ internal_title: value || null }).eq("id", campaignId);
    if (error) {
      setTitleOverrides((o) => ({ ...o, [campaignId]: previous }));
      toast("Не удалось сохранить название", "bad");
    }
  }

  async function sendDraft(campaignId: string) {
    const ok = await confirm({
      title: "Отправить сейчас?",
      message: "Сообщения уйдут получателям немедленно — действие нельзя отменить.",
      confirmText: "Отправить",
    });
    if (!ok) return;

    setBusyId(campaignId);
    const res = await fetch(`/api/admin/campaigns/${campaignId}/send-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const json = await res.json();
    setBusyId(null);
    if (!res.ok) return toast(json.error || "Ошибка отправки", "bad");
    toast(`Отправлено ${json.delivered} из ${json.total}, ошибок ${json.failed}`, "good");
    router.refresh();
  }

  async function deleteDraft(campaignId: string, status: string) {
    const ok = await confirm({
      title: status === "draft" ? "Удалить черновик?" : "Отменить запланированную рассылку?",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setBusyId(campaignId);
    await supabase.from("campaigns").delete().eq("id", campaignId);
    setBusyId(null);
    router.refresh();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (typeFilter === "all" || r.type === typeFilter) &&
        (initiatorFilter === "all" || r.initiator === initiatorFilter) &&
        (!q || r.title.toLowerCase().includes(q) || (r.internal_title || "").toLowerCase().includes(q))
    );
  }, [rows, typeFilter, initiatorFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  return (
    <div>
      <div className="flex gap-2 flex-wrap mb-3">
        <CustomSelect
          value={typeFilter}
          onChange={(v) => {
            setTypeFilter(v);
            setPage(1);
          }}
          options={TYPE_OPTIONS}
          className="w-[180px]"
        />
        <CustomSelect
          value={initiatorFilter}
          onChange={(v) => {
            setInitiatorFilter(v);
            setPage(1);
          }}
          options={INITIATOR_OPTIONS}
          className="w-[180px]"
        />
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <Input value={search} onChange={(e) => updateSearch(e.target.value)} placeholder="Поиск: заголовок" className="pl-9 pr-9" />
          {search && (
            <button
              type="button"
              onClick={() => updateSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-ink cursor-pointer"
              aria-label="Очистить поиск"
            >
              <IconX size={15} stroke={2} />
            </button>
          )}
        </div>
      </div>

      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Заголовок</Th>
              <Th>Канал</Th>
              <Th>Тип</Th>
              <Th>Инициатор</Th>
              <Th>Статус</Th>
              <Th right>Отправлено</Th>
              <Th right>Клики</Th>
              <Th right>CTR</Th>
              {attributionEnabled && <Th right>Выручка</Th>}
              <Th>Дата</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((c) => {
              const isPush = c.channel === "push";
              const cctr = c.delivered_count ? Math.round((c.clicked_count / c.delivered_count) * 100) : 0;
              const titleOverride = c.campaignId ? titleOverrides[c.campaignId] : undefined;
              const displayTitle = titleOverride !== undefined ? titleOverride || c.title : c.internal_title || c.title;
              return (
                <tr key={c.id} className="border-t border-border group">
                  <Td>
                    <InlineTitle
                      value={displayTitle}
                      editable={!!c.campaignId}
                      onSave={(v) => c.campaignId && saveInternalTitle(c.campaignId, v, displayTitle)}
                    />
                  </Td>
                  <Td>
                    <Badge tone="accent">{CHANNEL_LABEL[c.channel] || c.channel}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={c.type === "transactional" ? "warn" : "neutral"}>{TYPE_LABEL[c.type]}</Badge>
                  </Td>
                  <Td className="text-ink-muted whitespace-nowrap">{INITIATOR_LABEL[c.initiator]}</Td>
                  <Td>
                    <Badge tone={statusTone(c.status)} dot>
                      {STATUS_LABEL[c.status] || c.status}
                    </Badge>
                  </Td>
                  <Td right>{c.delivered_count}</Td>
                  <Td right>{c.campaignId ? c.clicked_count : "—"}</Td>
                  {attributionEnabled && <Td right>{isPush && c.campaignId ? `${c.revenue.toLocaleString("ru-RU")} ₽` : "—"}</Td>}
                  <Td right>{c.campaignId && c.status === "sent" ? `${cctr}%` : "—"}</Td>
                  <Td className="text-ink-faint">{new Date(c.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      {c.campaignId && (c.status === "draft" || c.status === "scheduled") && (
                        <>
                          <Link
                            href={`/admin/projects/${projectId}/campaigns/${c.campaignId}/edit`}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2"
                            title="Изменить"
                          >
                            <IconPencil size={15} stroke={1.8} />
                          </Link>
                          <button
                            type="button"
                            disabled={busyId === c.campaignId}
                            onClick={() => sendDraft(c.campaignId!)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Отправить сейчас"
                          >
                            <IconSend size={15} stroke={1.8} />
                          </button>
                          <button
                            type="button"
                            disabled={busyId === c.campaignId}
                            onClick={() => deleteDraft(c.campaignId!, c.status)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-bad hover:bg-surface-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title={c.status === "draft" ? "Удалить черновик" : "Отменить"}
                          >
                            <IconTrash size={15} stroke={1.8} />
                          </button>
                        </>
                      )}
                      {c.campaignId && (c.status === "sent" || c.status === "failed") && (
                        <a
                          href={`/api/admin/campaigns/${c.campaignId}/recipients?projectId=${projectId}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2"
                          title="Скачать статистику по каждому адресату"
                        >
                          <IconDownload size={15} stroke={1.8} />
                        </a>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={attributionEnabled ? 11 : 10} className="px-3.5 py-6 text-center text-ink-muted">
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

// Внутреннее название — карандашик появляется по наведению на строку (класс
// group на <tr>), клик превращает текст в обычный input без рамки/фона
// (визуально остаётся текстом, а не полноценным полем), сохранение — по
// потере фокуса или Enter, Escape — отмена без сохранения.
function InlineTitle({ value, editable, onSave }: { value: string; editable: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const trimmed = draft.trim();
          if (trimmed !== value.trim()) onSave(trimmed);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="bg-transparent border-none outline-none p-0 m-0 text-[13.5px] text-ink w-full max-w-[240px] focus:ring-1 focus:ring-accent-line rounded px-1 -mx-1"
      />
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 max-w-full">
      <span className="truncate max-w-[220px]">{value}</span>
      {editable && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded text-ink-faint hover:text-ink cursor-pointer"
          title="Изменить название"
        >
          <IconPencil size={16} stroke={1.8} />
        </button>
      )}
    </span>
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
