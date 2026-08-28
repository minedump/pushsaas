"use client";

import { useState } from "react";
import Link from "next/link";
import { IconChevronLeft, IconChevronRight, IconBraces, IconX } from "@tabler/icons-react";
import { Badge, Button, Modal, SegmentedControl } from "@/app/ui";

const PAGE_SIZE = 25;

// Формат колонок таблицы «Рассылки» (см. CampaignsTable), но без статистики
// доставки/CTR/заказов/выручки — у провалившихся/пропущенных рассылок она
// принципиально всегда нулевая (см. фильтр в page.tsx), отдельной ценности
// не несёт.
type ErrorRow = {
  id: string;
  title: string;
  channel: string;
  templateId: string | null;
  templateName: string | null;
  type: "transactional" | "marketing";
  initiator: "manual" | "api" | "welcome" | "event" | "trigger" | "recurring" | "automation" | "auth";
  status: "failed" | "skipped";
  created_at: string;
};

type LoginRow = {
  id: string;
  channel: string;
  provider: string | null;
  contact: string | null;
  status: "verified" | "locked" | "expired" | "pending";
  created_at: string;
};

type ApiCallRow = {
  id: string;
  endpoint: string;
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  requestBody: Record<string, unknown> | null;
  responseBody: Record<string, unknown> | null;
  created_at: string;
};

const CHANNEL_LABEL: Record<string, string> = { push: "Push", sms: "SMS", email: "Email", telegram: "Telegram" };
const STATUS_LABEL: Record<string, string> = { failed: "ошибка", skipped: "пропущена" };
const TYPE_LABEL: Record<string, string> = { transactional: "Транзакционное", marketing: "Маркетинговое" };
const INITIATOR_LABEL: Record<string, string> = {
  manual: "Ручная",
  api: "API",
  welcome: "Приветственная",
  event: "Событийная",
  trigger: "Триггерная",
  recurring: "Повторяющаяся",
  automation: "Автоматизация",
  auth: "Авторизация",
};
const LOGIN_STATUS_LABEL: Record<string, string> = { verified: "код введён", locked: "попытки исчерпаны", expired: "код не введён", pending: "ожидает" };
const ENDPOINT_LABEL: Record<string, string> = {
  attribute: "/api/v1/attribute",
  subscribers: "/api/v1/subscribers",
  templates: "/api/v1/templates",
  campaigns: "/api/v1/campaigns",
  automations: "/api/v1/automations",
};
const errorStatusTone = (s: string) => (s === "failed" ? "bad" : "warn");
const loginStatusTone = (s: string) => (s === "verified" ? "good" : s === "locked" ? "bad" : "warn");

export default function LogTabs({
  projectId,
  errorRows,
  loginRows,
  apiCallRows,
}: {
  projectId: string;
  errorRows: ErrorRow[];
  loginRows: LoginRow[];
  apiCallRows: ApiCallRow[];
}) {
  const [tab, setTab] = useState<"errors" | "logins" | "api">("errors");

  const tabOptions: { value: typeof tab; label: string }[] = [
    { value: "errors", label: "Ошибки отправки" },
    { value: "logins", label: "Входы" },
    { value: "api", label: "API" },
  ];

  return (
    <div>
      <SegmentedControl value={tab} onChange={setTab} options={tabOptions} className="mb-4 flex-wrap" />

      {tab === "errors" && <ErrorsTab rows={errorRows} projectId={projectId} />}
      {tab === "logins" && <LoginsTab rows={loginRows} />}
      {tab === "api" && <ApiTab rows={apiCallRows} />}
    </div>
  );
}

function ErrorsTab({ rows, projectId }: { rows: ErrorRow[]; projectId: string }) {
  const { paged, pager } = usePager(rows);
  if (!rows.length) return <Empty text="Ошибок нет — все рассылки прошли штатно." />;
  return (
    <div>
      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
        <table className="w-full border-collapse text-[13.5px] min-w-[680px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Название</Th>
              <Th>Канал</Th>
              <Th>Шаблон</Th>
              <Th>Тип</Th>
              <Th>Инициатор</Th>
              <Th>Статус</Th>
              <Th>Дата</Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Td className="truncate max-w-[220px]">{r.title}</Td>
                <Td>
                  <Badge tone="accent">{CHANNEL_LABEL[r.channel] || r.channel}</Badge>
                </Td>
                <Td>
                  {r.templateId ? (
                    <Link
                      href={`/admin/projects/${projectId}/templates/${r.templateId}/edit`}
                      className="inline-flex items-center gap-1 max-w-[160px] text-ink hover:text-accent hover:underline"
                    >
                      <span className="min-w-0 truncate">{r.templateName || "Шаблон"}</span>
                      <IconChevronRight size={13} stroke={2} className="text-ink-faint shrink-0" />
                    </Link>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </Td>
                <Td className="text-ink-muted whitespace-nowrap">{TYPE_LABEL[r.type]}</Td>
                <Td className="text-ink-muted whitespace-nowrap">{INITIATOR_LABEL[r.initiator] || r.initiator}</Td>
                <Td>
                  <Badge tone={errorStatusTone(r.status)} dot>
                    {STATUS_LABEL[r.status] || r.status}
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

function LoginsTab({ rows }: { rows: LoginRow[] }) {
  const { paged, pager } = usePager(rows);
  if (!rows.length) return <Empty text="Пока пусто — здесь появятся попытки входа по коду." />;
  return (
    <div>
      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
        <table className="w-full border-collapse text-[13.5px] min-w-[600px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Канал</Th>
              <Th>Куда</Th>
              <Th>Провайдер</Th>
              <Th>Статус</Th>
              <Th>Дата</Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Td>
                  <Badge tone="accent">{CHANNEL_LABEL[r.channel] || r.channel}</Badge>
                </Td>
                <Td className="text-ink-muted font-mono">{r.contact || "—"}</Td>
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
  const [openRow, setOpenRow] = useState<ApiCallRow | null>(null);
  if (!rows.length) return <Empty text="Пока пусто — здесь появятся POST/PUT-вызовы /api/v1/campaigns, /api/v1/attribute, /api/v1/subscribers, /api/v1/templates и /api/v1/automations." />;
  return (
    <div>
      <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
        <table className="w-full border-collapse text-[13.5px] min-w-[560px]">
          <thead>
            <tr className="bg-surface-2 text-left">
              <Th>Эндпоинт</Th>
              <Th>Статус</Th>
              <Th>Дата</Th>
              <Th>{null}</Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Td className="font-mono">{ENDPOINT_LABEL[r.endpoint] || r.endpoint}</Td>
                <Td>
                  <Badge tone={r.ok ? "good" : "bad"} dot>
                    {r.statusCode ?? (r.ok ? "успех" : "ошибка")}
                  </Badge>
                </Td>
                <Td className="text-ink-faint whitespace-nowrap">{new Date(r.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</Td>
                <Td right>
                  <button
                    type="button"
                    onClick={() => setOpenRow(r)}
                    title="Тело запроса и ответа"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted enabled:hover:text-ink enabled:hover:bg-surface-2 cursor-pointer"
                  >
                    <IconBraces size={15} stroke={1.8} />
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
      {openRow && (
        <ApiCallModal label={ENDPOINT_LABEL[openRow.endpoint] || openRow.endpoint} requestBody={openRow.requestBody} responseBody={openRow.responseBody} onClose={() => setOpenRow(null)} />
      )}
    </div>
  );
}

// Сырые тело запроса и ответа одного вызова — тот же принцип, что
// RawContextModal в карточке подписчика: показать как есть, не выжимку.
function ApiCallModal({
  label,
  requestBody,
  responseBody,
  onClose,
}: {
  label: string;
  requestBody: Record<string, unknown> | null;
  responseBody: Record<string, unknown> | null;
  onClose: () => void;
}) {
  const sections: { key: string; title: string; value: Record<string, unknown> | null }[] = [
    { key: "request", title: "Тело запроса", value: requestBody },
    { key: "response", title: "Ответ", value: responseBody },
  ];
  return (
    <Modal onClose={onClose} className="max-w-lg max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border shrink-0">
        <h3 className="text-base font-semibold m-0 truncate">{label}</h3>
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink cursor-pointer shrink-0" title="Закрыть">
          <IconX size={18} stroke={1.8} />
        </button>
      </div>
      <div className="pretty-scroll flex-1 min-h-0 overflow-y-auto -mr-2 pr-2 flex flex-col gap-4">
        {sections.map((s) => {
          const empty = !s.value || Object.keys(s.value).length === 0;
          return (
            <div key={s.key}>
              <div className="text-[12px] font-medium text-ink-muted mb-1.5">{s.title}</div>
              {empty ? (
                <p className="text-[12.5px] text-ink-faint m-0">Пусто</p>
              ) : (
                <pre className="text-[12px] font-mono bg-surface-2 rounded-lg p-3 overflow-x-auto pretty-scroll m-0 whitespace-pre-wrap break-words">
                  {JSON.stringify(s.value, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
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
  <th className={`px-3.5 py-2.5 text-[11px] text-ink-faint font-normal whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-3.5 py-3 align-middle ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
);
