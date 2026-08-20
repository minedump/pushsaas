"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconX, IconSearch, IconPlayerPlayFilled, IconPlayerPauseFilled, IconChevronLeft, IconChevronRight, IconPencil, IconTrash } from "@tabler/icons-react";
import { Button, Input, TagEditor, useDialogs } from "@/app/ui";
import { cn } from "@/app/ui/cn";

const PAGE_SIZE = 25;

// Одно push-устройство контакта — один подписчик может иметь несколько
// (телефон + десктоп), каждое со своим статусом активности/паузы.
export type Device = { id: string; platform: string; is_active: boolean; paused: boolean };

export type Row = {
  // Синтетический ключ ("identity-<uuid>" для контактов, id устройства для
  // анонимных подписчиков без identity) — не путать с id самого устройства.
  id: string;
  devices: Device[];
  tags: string[];
  created_at: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  insalesClientId: string | null;
  smsActive: boolean;
  emailActive: boolean;
  // id контакта (identities.id) — null, если у устройства нет привязанной
  // identity (никто не подписывался через код). Именно по нему ведут
  // карандаш/корзина/теги — редактируется/удаляется контакт, не устройство.
  identityId: string | null;
};

const platformLabel: Record<string, string> = { ios: "iPhone", android: "Android", desktop: "Desktop", unknown: "—" };

export default function SubscribersTable({ projectId, initial }: { projectId: string; initial: Row[] }) {
  const { confirm, toast } = useDialogs();
  const router = useRouter();
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

  // Теги живут на identities (см. миграцию 0037) — один контакт может иметь
  // несколько устройств, у всех должны обновиться одинаковые теги.
  async function updateTags(identityId: string, tags: string[]) {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.identityId === identityId ? { ...r, tags } : r)));
    const res = await fetch("/api/admin/subscribers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, identityId, action: "tags", tags }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast(j.error || "Не удалось сохранить", "bad");
      setRows(prev); // откат при ошибке
    }
  }

  // Клик по бейджу конкретной платформы — приостановка/возобновление ИМЕННО
  // этого устройства, не всех устройств контакта сразу. Мёртвое устройство
  // (device.is_active=false) не кликабельно вообще — его нечем
  // "возобновлять", подписка отвалилась на стороне браузера.
  async function toggleDevice(row: Row, device: Device) {
    if (!device.is_active) return;
    if (!device.paused) {
      const ok = await confirm({
        title: "Приостановить подписку?",
        message: "Устройство перестанет получать любые уведомления, пока вы не возобновите.",
        confirmText: "Приостановить",
      });
      if (!ok) return;
    }
    const action = device.paused ? "resume" : "pause";
    const setPaused = (paused: boolean) =>
      setRows((rs) =>
        rs.map((r) => (r.id === row.id ? { ...r, devices: r.devices.map((d) => (d.id === device.id ? { ...d, paused } : d)) } : r))
      );
    setPaused(!device.paused);
    if (!(await call(device.id, { action }))) {
      setPaused(device.paused);
    } else {
      toast(device.paused ? "Подписка возобновлена" : "Подписка приостановлена", "good");
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

  // Удаление КОНТАКТА (identities), не устройства — если к нему привязан
  // push, устройство остаётся в базе, просто без телефона/email/тегов
  // контакта (см. lib/identity.deleteContact).
  async function removeContact(r: Row) {
    if (!r.identityId) return;
    const ok = await confirm({
      title: "Удалить контакт?",
      message: "Телефон, email и согласия на рассылку удалятся. Push-устройства останутся — просто без контактных данных.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/subscribers/${r.identityId}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast(j.error || "Не удалось удалить", "bad");
      return;
    }
    toast("Контакт удалён", "good");
    router.refresh();
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
        r.devices.some((d) => (platformLabel[d.platform] || d.platform).toLowerCase().includes(q)) ||
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
              <Th>Устройства</Th>
              <Th>Каналы</Th>
              <Th>Теги</Th>
              <Th>Создан</Th>
              <Th> </Th>
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
                  <Td className="whitespace-nowrap">
                    {r.devices.length ? (
                      <div className="flex gap-1 flex-wrap">
                        {r.devices.map((d) => (
                          <DeviceBadge key={d.id} device={d} onClick={() => toggleDevice(r, d)} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-ink-faint" title="Нет push-подписки — контакт добавлен без устройства">
                        —
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <div className="flex gap-1">
                      {r.phone && <ChannelBadge label="SMS" active={r.smsActive} onClick={() => toggleChannel(r, "sms")} />}
                      {r.email && <ChannelBadge label="Email" active={r.emailActive} onClick={() => toggleChannel(r, "email")} />}
                    </div>
                  </Td>
                  <Td>
                    {r.identityId ? (
                      <TagEditor tags={r.tags} onChange={(t) => updateTags(r.identityId!, t)} />
                    ) : (
                      <span className="text-ink-faint text-xs" title="Теги привязаны к контакту — недоступны анонимному устройству без привязанного контакта">
                        —
                      </span>
                    )}
                  </Td>
                  <Td className="text-ink-faint whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("ru-RU")}</Td>
                  <Td className="text-right">
                    {r.identityId && (
                      <div className="flex justify-end gap-1">
                        <Link
                          href={`/admin/projects/${projectId}/subscribers/${r.identityId}/edit`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2"
                          title="Изменить"
                        >
                          <IconPencil size={15} stroke={1.8} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => removeContact(r)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-bad hover:bg-surface-2 cursor-pointer"
                          title="Удалить"
                        >
                          <IconTrash size={15} stroke={1.8} />
                        </button>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3.5 py-6 text-center text-ink-muted">
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

// Бейдж одного push-устройства в колонке «Устройства» — платформа + иконка
// статуса (активно/на паузе/отвалилось), клик приостанавливает/возобновляет
// ИМЕННО это устройство, не все устройства контакта.
function DeviceBadge({ device, onClick }: { device: Device; onClick: () => void }) {
  const label = platformLabel[device.platform] || device.platform;
  const disabled = !device.is_active;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "Устройство отвалилось — нечем возобновлять" : device.paused ? `Возобновить ${label}` : `Приостановить ${label}`}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap border-none transition-colors",
        !disabled && !device.paused ? "bg-good-tint text-good" : "bg-surface-2 text-ink-muted",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:opacity-80"
      )}
    >
      {!disabled && (device.paused ? <IconPlayerPlayFilled size={10} /> : <IconPlayerPauseFilled size={10} />)}
      {label}
    </button>
  );
}

// Бейдж-переключатель канала в колонке «Каналы» — клик включает/выключает
// рассылку по этому каналу для подписчика. SMS/Email вообще не рендерятся
// вызывающим кодом, если у канала нет контакта (телефона/email).
function ChannelBadge({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? `Отключить ${label}` : `Включить ${label}`}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap border-none transition-colors cursor-pointer hover:opacity-80",
        active ? "bg-good-tint text-good" : "bg-surface-2 text-ink-muted"
      )}
    >
      {active ? <IconPlayerPauseFilled size={10} /> : <IconPlayerPlayFilled size={10} />}
      {label}
    </button>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-ink-faint font-normal whitespace-nowrap">{children}</th>
);
const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <td className={`px-3.5 py-3 align-middle ${className}`}>{children}</td>
);
