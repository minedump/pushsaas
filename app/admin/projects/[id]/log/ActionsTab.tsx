"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { Badge, CustomSelect, Pagination } from "@/app/ui";

// Журнал действий пользователей (таблица audit_log, миграция 0103): кто что
// создал, изменил, удалил и какие настройки сменил. Хранится 3 месяца.

export type ActionRow = {
  id: string;
  created_at: string;
  actorName: string | null;
  actorEmail: string | null;
  source: string;
  entity: string;
  entityId: string | null;
  entityName: string | null;
  action: string;
  changes: Record<string, { old?: unknown; new?: unknown }> | null;
};

const PAGE_SIZE = 25;

const ENTITY_LABEL: Record<string, string> = {
  project: "Проект",
  template: "Шаблон",
  template_folder: "Папка шаблонов",
  campaign: "Рассылка",
  automation: "Автоматизация",
  api_key: "API-ключ",
  oidc: "Вход через OIDC",
  media: "Файл медиатеки",
  media_folder: "Папка медиатеки",
  member: "Доступ к проекту",
  subscriber: "Подписчик",
  subscribers: "Подписчики",
};

const ACTION_LABEL: Record<string, string> = {
  create: "Создание",
  update: "Изменение",
  delete: "Удаление",
  send: "Отправка",
  export: "Выгрузка",
  import: "Импорт",
  bulk: "Массовое действие",
  clear_history: "Очистка истории",
  clear_events: "Очистка событий",
  transfer: "Передача владения",
};

const MEMBER_ACTION_LABEL: Record<string, string> = { create: "Выдан доступ", delete: "Доступ отозван", transfer: "Передача владения" };

const BULK_LABEL: Record<string, string> = { delete: "удаление", tag_add: "добавление тега", tag_remove: "снятие тега", channel: "смена согласия" };

function actionLabel(r: ActionRow): string {
  if (r.entity === "member") return MEMBER_ACTION_LABEL[r.action] || ACTION_LABEL[r.action] || r.action;
  return ACTION_LABEL[r.action] || r.action;
}

function entityLabel(r: ActionRow): string {
  if (r.entity === "project" && r.action === "update") return "Настройки проекта";
  return ENTITY_LABEL[r.entity] || r.entity;
}

function actionTone(action: string): "good" | "accent" | "bad" | "neutral" {
  if (action === "create") return "good";
  if (action === "delete" || action === "clear_history" || action === "clear_events") return "bad";
  if (action === "update" || action === "transfer") return "accent";
  return "neutral";
}

function actorLabel(r: ActionRow): string {
  if (r.actorName) return r.actorName;
  if (r.actorEmail) return r.actorEmail;
  if (r.source === "api") return "API";
  return "Система";
}

// Куда вести из строки журнала; у удалённого объекта ссылки нет.
function linkFor(projectId: string, r: ActionRow): string | null {
  if (r.action === "delete") return null;
  const base = `/admin/projects/${projectId}`;
  switch (r.entity) {
    case "template":
      return r.entityId ? `${base}/templates/${r.entityId}/edit` : `${base}/templates`;
    case "template_folder":
      return `${base}/templates`;
    case "campaign":
      return r.entityId ? `${base}/campaigns/${r.entityId}/edit` : `${base}/campaigns`;
    case "automation":
      return `${base}/automations`;
    case "api_key":
      return `${base}/api`;
    case "oidc":
      return `${base}/auth`;
    case "media":
    case "media_folder":
      return `${base}/media`;
    case "member":
      return `${base}/access`;
    case "project":
      return `${base}/settings`;
    case "subscriber":
      return r.entityId ? `${base}/subscribers/${r.entityId}` : `${base}/subscribers`;
    case "subscribers":
      return `${base}/subscribers`;
    default:
      return null;
  }
}

const FIELD_LABEL: Record<string, string> = {
  name: "Название",
  title: "Заголовок",
  internal_title: "Название",
  body: "Текст",
  subject: "Тема письма",
  html: "HTML письма",
  html_body: "HTML письма",
  url: "Ссылка",
  click_url: "Ссылка",
  icon_url: "Иконка",
  image_url: "Изображение",
  badge_url: "Значок",
  actions: "Кнопки",
  context: "Данные для подстановки",
  channel: "Канал",
  folder_id: "Папка",
  template_id: "Шаблон",
  status: "Статус",
  segment_tags: "Сегмент",
  scheduled_at: "Время отправки",
  provider: "Провайдер",
  platforms: "Платформы",
  domain: "Домен",
  is_active: "Активен",
  is_enabled: "Включено",
  timezone: "Часовой пояс",
  logo_url: "Логотип",
  ym_counter_id: "Счётчик Метрики",
  tariff_id: "Тариф",
  current_period_end: "Оплачено до",
  owner_id: "Владелец",
  delay_minutes: "Задержка, мин",
  comment: "Комментарий",
  cascade: "Каскад каналов",
  respects_priority: "Учитывать приоритет каналов",
  is_transactional: "Транзакционная",
  spacing_enabled: "Пауза между сообщениями",
  spacing_minutes: "Пауза, мин",
  send_window_enabled: "Окно отправки",
  send_days: "Дни отправки",
  send_time_from: "Окно с",
  send_time_to: "Окно до",
  send_window_subscriber_tz: "По времени подписчика",
  channel_templates: "Шаблоны по каналам",
  scopes: "Разделы API",
  sms_provider: "SMS-провайдер",
  email_provider: "Email-провайдер",
  role: "Роль",
  attribution_enabled: "Атрибуция включена",
  attribution_cookie_name: "Атрибуция: cookie",
  attribution_window_days: "Атрибуция: окно, дней",
  attribution_cookie_path: "Атрибуция: путь cookie",
  attribution_order_id_path: "Атрибуция: путь номера заказа",
  attribution_revenue_path: "Атрибуция: путь суммы",
  attribution_paid_path: "Атрибуция: путь оплаты",
  attribution_paid_value: "Атрибуция: значение оплаты",
  attribution_paid_amount_path: "Атрибуция: путь оплаченной суммы",
  product_feed_url: "Адрес товарной выгрузки",
  welcome_channel_priority: "Приоритет каналов приветствия",
  welcome_channel_enabled: "Каналы приветствия",
  welcome_channel_provider: "Провайдеры приветствия",
};

const GROUP_PREFIX: Record<string, string> = {
  widget_config: "Виджет",
  manifest_config: "Манифест",
  config: "Настройки",
};

function fieldLabel(key: string): string {
  const [head, ...rest] = key.split(".");
  if (rest.length && GROUP_PREFIX[head]) return `${GROUP_PREFIX[head]} · ${rest.join(" · ")}`;
  return FIELD_LABEL[key] || key;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "пусто";
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : "пусто";
  if (typeof v === "object") {
    if ((v as { long?: boolean }).long) return "значение изменено (слишком длинное для показа)";
    return JSON.stringify(v);
  }
  return String(v);
}

// Для «Массовое действие» / «Импорт» в changes лежат итоги, а не old/new.
function summaryLines(r: ActionRow): string[] | null {
  if (r.action === "bulk" && r.changes) {
    const c = r.changes as unknown as { action?: string; affected?: number; tag?: string; channel?: string; active?: boolean };
    const parts = [`${BULK_LABEL[c.action || ""] || c.action || "действие"}: ${c.affected ?? 0}`];
    if (c.tag) parts.push(`тег «${c.tag}»`);
    if (c.channel) parts.push(`${c.channel === "sms" ? "SMS" : "Email"}: ${c.active ? "согласие включено" : "согласие снято"}`);
    return [parts.join(", ")];
  }
  if (r.action === "import" && r.changes) {
    const c = r.changes as unknown as { matched?: number; unmatched?: number };
    return [`сопоставлено: ${c.matched ?? 0}, не найдено: ${c.unmatched ?? 0}`];
  }
  return null;
}

function hasDetails(r: ActionRow): boolean {
  if (!r.changes || r.action === "transfer") return false;
  return Object.keys(r.changes).length > 0;
}

const fmtDate = (d: string) => new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

export default function ActionsTab({ projectId, rows }: { projectId: string; rows: ActionRow[] }) {
  const [actor, setActor] = useState("all");
  const [entity, setEntity] = useState("all");
  const [action, setAction] = useState("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const actorOptions = useMemo(() => {
    const names = [...new Set(rows.map(actorLabel))].sort((a, b) => a.localeCompare(b, "ru"));
    return [{ value: "all", label: "Все пользователи" }, ...names.map((n) => ({ value: n, label: n }))];
  }, [rows]);
  const entityOptions = useMemo(() => {
    const keys = [...new Set(rows.map((r) => r.entity))];
    return [
      { value: "all", label: "Все объекты" },
      ...keys.map((k) => ({ value: k, label: k === "project" ? "Проект и настройки" : ENTITY_LABEL[k] || k })),
    ];
  }, [rows]);
  const actionOptions = useMemo(() => {
    const keys = [...new Set(rows.map((r) => r.action))];
    return [{ value: "all", label: "Все действия" }, ...keys.map((k) => ({ value: k, label: ACTION_LABEL[k] || k }))];
  }, [rows]);

  const filtered = rows.filter(
    (r) => (actor === "all" || actorLabel(r) === actor) && (entity === "all" || r.entity === entity) && (action === "all" || r.action === action)
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  if (!rows.length) {
    return (
      <div className="border border-border rounded-xl p-6 text-center text-ink-muted text-sm">
        Пока пусто — здесь появятся создания, правки и удаления объектов проекта, смена настроек и выдача доступа. Записи хранятся 3 месяца.
      </div>
    );
  }

  const reset = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <CustomSelect value={actor} onChange={reset(setActor)} options={actorOptions} ariaLabel="Пользователь" className="w-full sm:w-56" />
        <CustomSelect value={entity} onChange={reset(setEntity)} options={entityOptions} ariaLabel="Объект" className="w-full sm:w-56" />
        <CustomSelect value={action} onChange={reset(setAction)} options={actionOptions} ariaLabel="Действие" className="w-full sm:w-56" />
      </div>

      {!filtered.length ? (
        <div className="border border-border rounded-xl p-6 text-center text-ink-muted text-sm">По выбранным фильтрам записей нет.</div>
      ) : (
        <>
          <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
            <table className="w-full border-collapse text-[13.5px] min-w-[680px]">
              <thead>
                <tr className="bg-surface-2 text-left">
                  <Th>Когда</Th>
                  <Th>Кто</Th>
                  <Th>Действие</Th>
                  <Th>Объект</Th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => {
                  const href = linkFor(projectId, r);
                  const label = r.entityName || (r.entityId ? r.entityId.slice(0, 8) : "—");
                  const expandable = hasDetails(r) || !!summaryLines(r);
                  const isOpen = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className="border-t border-border row-hover">
                        <Td className="whitespace-nowrap text-ink-muted">{fmtDate(r.created_at)}</Td>
                        <Td className="max-w-[200px] truncate" title={r.actorEmail || undefined}>
                          {actorLabel(r)}
                          {r.source === "api" && r.actorName && <span className="text-ink-faint"> · API</span>}
                        </Td>
                        <Td>
                          <Badge tone={actionTone(r.action)}>{actionLabel(r)}</Badge>
                        </Td>
                        <Td className="max-w-[300px]">
                          <span className="text-ink-muted">{entityLabel(r)}</span>
                          {r.entityName || r.entityId ? (
                            <>
                              {" "}
                              {href ? (
                                <Link href={href} className="inline-flex items-center gap-0.5 font-semibold text-ink hover:underline max-w-full align-bottom">
                                  <span className="min-w-0 truncate">{label}</span>
                                  <IconChevronRight size={13} stroke={2} className="text-ink-faint shrink-0" />
                                </Link>
                              ) : (
                                <span className="font-semibold">{label}</span>
                              )}
                            </>
                          ) : null}
                        </Td>
                        <td className="px-2 text-right">
                          {expandable && (
                            <button
                              type="button"
                              onClick={() => setOpen(isOpen ? null : r.id)}
                              title={isOpen ? "Свернуть" : "Что изменилось"}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted transition-colors hover:text-ink hover:bg-surface-2 cursor-pointer"
                            >
                              <IconChevronDown size={15} stroke={1.8} className={isOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-surface-2/50">
                          <td colSpan={5} className="px-3.5 py-3">
                            <ChangeList row={r} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={pageSafe} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function ChangeList({ row }: { row: ActionRow }) {
  const summary = summaryLines(row);
  if (summary) {
    return (
      <ul className="m-0 p-0 list-none text-[13px] text-ink-muted">
        {summary.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    );
  }
  const entries = Object.entries(row.changes || {});
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-1.5 text-[13px]">
      {entries.map(([key, v]) => (
        <li key={key} className="flex flex-wrap gap-x-2 gap-y-0.5">
          <span className="text-ink-muted shrink-0">{fieldLabel(key)}:</span>
          <span className="text-ink-faint line-through break-all">{formatValue(v?.old)}</span>
          <span className="text-ink-faint">→</span>
          <span className="text-ink break-all">{formatValue(v?.new)}</span>
        </li>
      ))}
    </ul>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3.5 py-2.5 text-[11px] text-ink-muted font-normal whitespace-nowrap text-left">{children}</th>
);
const Td = ({ children, className = "", title }: { children: React.ReactNode; className?: string; title?: string }) => (
  <td className={`px-3.5 py-3 align-middle ${className}`} title={title}>
    {children}
  </td>
);
