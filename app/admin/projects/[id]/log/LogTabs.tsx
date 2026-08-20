"use client";

import { useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Badge, Button } from "@/app/ui";
import { cn } from "@/app/ui/cn";

const PAGE_SIZE = 25;

type AutomationRow = {
  id: string;
  source: string;
  title: string;
  status: string;
  recipients: number;
  detail: string;
  created_at: string;
};

type ErrorRow = {
  id: string;
  source: "campaign" | "automation";
  title: string;
  channel: string;
  status: string;
  detail: string;
  created_at: string;
};

type LoginRow = {
  id: string;
  channel: string;
  provider: string | null;
  status: "verified" | "locked" | "expired" | "pending";
  created_at: string;
};

type ApiCallRow = {
  id: string;
  endpoint: string;
  ok: boolean;
  error: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

type SubEventRow = {
  id: string;
  channel: "push" | "sms" | "email";
  type: string;
  detail: string;
  created_at: string;
};

const SOURCE_LABEL: Record<string, string> = { event: "Событие", api: "API", webhook: "Вебхук", welcome: "Welcome", campaign: "Рассылка", automation: "Автоматизация" };
const STATUS_LABEL: Record<string, string> = { sent: "отправлено", failed: "ошибка", skipped: "пропущено" };
const CHANNEL_LABEL: Record<string, string> = { push: "Push", sms: "SMS", email: "Email", telegram: "Telegram" };
const LOGIN_STATUS_LABEL: Record<string, string> = { verified: "код введён", locked: "попытки исчерпаны", expired: "код не введён", pending: "ожидает" };
const ENDPOINT_LABEL: Record<string, string> = { send: "/api/v1/send", attribute: "/api/v1/attribute", contacts: "/api/v1/contacts" };
const EVENT_TYPE_LABEL: Record<string, string> = {
  subscribed: "новая подписка",
  paused: "пауза",
  resumed: "возобновление",
  dead: "устройство отвалилось",
  sms_activated: "SMS включён",
  sms_deactivated: "SMS выключен",
  email_activated: "Email включён",
  email_deactivated: "Email выключен",
};
const statusTone = (s: string) => (s === "sent" ? "good" : s === "failed" ? "bad" : "warn");
const loginStatusTone = (s: string) => (s === "verified" ? "good" : s === "locked" ? "bad" : "warn");
const eventTone = (t: string) => {
  if (t === "dead") return "bad";
  if (t.endsWith("deactivated")) return "warn";
  if (t === "subscribed" || t === "resumed" || t.endsWith("activated")) return "good";
  return "warn";
};

function fmtApiDetail(d: Record<string, unknown> | null): string {
  if (!d) return "";
  const parts: string[] = [];
  if (typeof d.total === "number") parts.push(`доставлено ${d.delivered ?? 0} из ${d.total}`);
  if (typeof d.revenue === "number") parts.push(`${d.revenue.toLocaleString("ru-RU")} ₽`);
  if (typeof d.created === "boolean") parts.push(d.created ? "новый контакт" : "обновлён");
  return parts.join(" · ");
}

export default function LogTabs({
  automationRows,
  errorRows,
  loginRows,
  apiCallRows,
  subEventRows,
}: {
  automationRows: AutomationRow[];
  errorRows: ErrorRow[];
  loginRows: LoginRow[];
  apiCallRows: ApiCallRow[];
  subEventRows: SubEventRow[];
}) {
  const [tab, setTab] = useState<"automations" | "errors" | "logins" | "api" | "events">("automations");

  return (
    <div>
      <div className="inline-flex gap-1 p-1 rounded-lg bg-surface-2 border border-border mb-4 flex-wrap">
        <TabButton active={tab === "automations"} onClick={() => setTab("automations")}>
          Автоматизации
        </TabButton>
        <TabButton active={tab === "errors"} onClick={() => setTab("errors")}>
          Ошибки отправки{errorRows.length > 0 ? ` (${errorRows.length})` : ""}
        </TabButton>
        <TabButton active={tab === "logins"} onClick={() => setTab("logins")}>
          Входы
        </TabButton>
        <TabButton active={tab === "api"} onClick={() => setTab("api")}>
          Вебхуки/API
        </TabButton>
        <TabButton active={tab === "events"} onClick={() => setTab("events")}>
          События подписчиков
        </TabButton>
      </div>

      {tab === "automations" && <AutomationsTab rows={automationRows} />}
      {tab === "errors" && <ErrorsTab rows={errorRows} />}
      {tab === "logins" && <LoginsTab rows={loginRows} />}
      {tab === "api" && <ApiTab rows={apiCallRows} />}
      {tab === "events" && <EventsTab rows={subEventRows} />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-md text-[13px] font-medium cursor-pointer transition-colors",
        active ? "bg-accent-tint text-accent" : "text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

function AutomationsTab({ rows }: { rows: AutomationRow[] }) {
  const { paged, pager } = usePager(rows);
  if (!rows.length) return <Empty text="Пока пусто — здесь появятся срабатывания автоматизаций." />;
  return (
    <div>
      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
        <table className="w-full border-collapse text-[13.5px] min-w-[680px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Источник</Th>
              <Th>Автоматизация</Th>
              <Th>Статус</Th>
              <Th right>Получатели</Th>
              <Th>Детали</Th>
              <Th>Время</Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Td>
                  <Badge tone="accent">{SOURCE_LABEL[r.source] || r.source}</Badge>
                </Td>
                <Td>{r.title}</Td>
                <Td>
                  <Badge tone={statusTone(r.status)} dot>
                    {STATUS_LABEL[r.status] || r.status}
                  </Badge>
                </Td>
                <Td right>{r.recipients}</Td>
                <Td className="text-ink-muted">{r.detail || "—"}</Td>
                <Td className="text-ink-faint whitespace-nowrap">{new Date(r.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  );
}

function ErrorsTab({ rows }: { rows: ErrorRow[] }) {
  const { paged, pager } = usePager(rows);
  if (!rows.length) return <Empty text="Ошибок нет — все отправки и срабатывания прошли штатно." />;
  return (
    <div>
      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
        <table className="w-full border-collapse text-[13.5px] min-w-[640px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Источник</Th>
              <Th>Заголовок</Th>
              <Th>Канал</Th>
              <Th>Статус</Th>
              <Th>Детали</Th>
              <Th>Время</Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Td>
                  <Badge tone="accent">{SOURCE_LABEL[r.source] || r.source}</Badge>
                </Td>
                <Td>{r.title}</Td>
                <Td>
                  <Badge tone="accent">{CHANNEL_LABEL[r.channel] || r.channel}</Badge>
                </Td>
                <Td>
                  <Badge tone={statusTone(r.status)} dot>
                    {STATUS_LABEL[r.status] || r.status}
                  </Badge>
                </Td>
                <Td className="text-ink-muted">{r.detail || "—"}</Td>
                <Td className="text-ink-faint whitespace-nowrap">{new Date(r.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  );
}

function LoginsTab({ rows }: { rows: LoginRow[] }) {
  const { paged, pager } = usePager(rows);
  if (!rows.length) return <Empty text="Пока пусто — здесь появятся попытки входа по коду." />;
  return (
    <div>
      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
        <table className="w-full border-collapse text-[13.5px] min-w-[520px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Канал</Th>
              <Th>Провайдер</Th>
              <Th>Статус</Th>
              <Th>Время</Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Td>
                  <Badge tone="accent">{CHANNEL_LABEL[r.channel] || r.channel}</Badge>
                </Td>
                <Td className="text-ink-muted">{r.provider || "—"}</Td>
                <Td>
                  <Badge tone={loginStatusTone(r.status)} dot>
                    {LOGIN_STATUS_LABEL[r.status] || r.status}
                  </Badge>
                </Td>
                <Td className="text-ink-faint whitespace-nowrap">{new Date(r.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  );
}

function ApiTab({ rows }: { rows: ApiCallRow[] }) {
  const { paged, pager } = usePager(rows);
  if (!rows.length) return <Empty text="Пока пусто — здесь появятся вызовы /api/v1/send, /api/v1/attribute и /api/v1/contacts." />;
  return (
    <div>
      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
        <table className="w-full border-collapse text-[13.5px] min-w-[600px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Эндпоинт</Th>
              <Th>Статус</Th>
              <Th>Детали</Th>
              <Th>Время</Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Td className="font-mono">{ENDPOINT_LABEL[r.endpoint] || r.endpoint}</Td>
                <Td>
                  <Badge tone={r.ok ? "good" : "bad"} dot>
                    {r.ok ? "успех" : "ошибка"}
                  </Badge>
                </Td>
                <Td className="text-ink-muted">{r.ok ? fmtApiDetail(r.detail) || "—" : r.error || "—"}</Td>
                <Td className="text-ink-faint whitespace-nowrap">{new Date(r.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  );
}

function EventsTab({ rows }: { rows: SubEventRow[] }) {
  const { paged, pager } = usePager(rows);
  if (!rows.length) return <Empty text="Пока пусто — здесь появятся подписки, паузы, отвалившиеся устройства и включение/отключение SMS/Email." />;
  return (
    <div>
      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
        <table className="w-full border-collapse text-[13.5px] min-w-[520px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Канал</Th>
              <Th>Событие</Th>
              <Th>Детали</Th>
              <Th>Время</Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Td>
                  <Badge tone="accent">{CHANNEL_LABEL[r.channel] || r.channel}</Badge>
                </Td>
                <Td>
                  <Badge tone={eventTone(r.type)} dot>
                    {EVENT_TYPE_LABEL[r.type] || r.type}
                  </Badge>
                </Td>
                <Td className="text-ink-muted">{r.detail}</Td>
                <Td className="text-ink-faint whitespace-nowrap">{new Date(r.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="border border-border rounded-xl p-6 text-center text-ink-muted text-sm">{text}</div>;
}

// Общая клиентская пагинация — тот же паттерн, что в CampaignsTable/SubscribersTable.
function usePager<T>(rows: T[]) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = rows.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const pager =
    rows.length > 0 ? (
      <div className="flex items-center justify-between mt-3 text-[13px] text-ink-muted">
        <span>
          {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, rows.length)} из {rows.length}
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
    ) : null;

  return { paged, pager };
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-ink-faint font-normal whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-3.5 py-3 align-middle ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
);
