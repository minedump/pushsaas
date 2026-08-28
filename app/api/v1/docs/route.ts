import { NextResponse } from "next/server";
import { API_INTRO, API_GROUPS, type ApiField, type ApiEndpoint } from "@/lib/apiSpec";

// GET /api/v1/docs — отдаёт markdown-справочник публичного API на скачивание
// (кнопка «Скачать API.md» в разделе «API» админки). Без авторизации — это
// просто документация контракта, ключ проекта в файле не участвует.
// Генерируется из lib/apiSpec.ts — единого источника, из которого строится и
// разворачиваемая таблица полей прямо на странице «API» (не расходятся).
export async function GET() {
  const md = buildDocs();
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sendera-api.md"',
    },
  });
}

function fieldsTable(fields: ApiField[]): string {
  const rows: string[] = [];
  for (const f of fields) {
    rows.push(`| \`${f.name}\`${f.required ? " \\*" : ""}<br>\`${f.type}\` | ${f.description} |`);
    for (const c of f.children || []) {
      rows.push(`| ↳ \`${c.name}\`${c.required ? " \\*" : ""}<br>\`${c.type}\` | ${c.description} |`);
    }
  }
  return ["| Поле | Описание |", "|---|---|", ...rows].join("\n");
}

function errorsTable(errors: { code: number; description: string }[]): string {
  const rows = errors.map((e) => `| \`${e.code}\` | ${e.description} |`);
  return ["| Код | Когда |", "|---|---|", ...rows].join("\n");
}

function statusTable(values: { value: string; description: string }[]): string {
  const rows = values.map((s) => `| \`${s.value}\` | ${s.description} |`);
  return ["| status | Описание |", "|---|---|", ...rows].join("\n");
}

function headersTable(needsContentType: boolean): string {
  const rows = ["| `Authorization` | `Bearer wpk_ВАШ_КЛЮЧ` |"];
  if (needsContentType) rows.push("| `Content-Type` | `application/json` |");
  return ["| Заголовок | Значение |", "|---|---|", ...rows].join("\n");
}

// Порядок соответствует блокам на странице «API»: метод → эндпоинт →
// заголовки → query-параметры → описание → тело запроса (пример(ы) первыми,
// потом таблица полей) → пример ответа → возможные ошибки.
function endpointMd(e: ApiEndpoint): string {
  const hasBody = !!(e.bodyFields?.length || e.bodyGroups?.length);
  const hasBodyContent = hasBody || !!e.bodyExample || !!e.bodyExamples?.length || !!e.bodyNote;
  const needsContentType = hasBody || !!e.sendsJsonBody;
  const parts: string[] = [`### ${e.method} ${e.path}`, ""];

  parts.push("**Заголовки:**", "", headersTable(needsContentType), "");
  if (e.queryParams?.length) {
    parts.push("**Query-параметры:**", "", fieldsTable(e.queryParams), "");
  }
  parts.push("**Описание:**", "", e.summary, "");

  if (hasBodyContent) {
    parts.push("**Тело запроса:**", "");
    if (e.bodyNote) parts.push(e.bodyNote, "");
    if (e.bodyExample) parts.push("Пример:", "", "```json", e.bodyExample, "```", "");
    for (const ex of e.bodyExamples || []) {
      parts.push(`*${ex.label}*`, "", "```json", ex.json, "```", "");
    }
    if (e.bodyFields?.length) parts.push(fieldsTable(e.bodyFields), "");
    if (e.bodyGroups?.length) {
      for (const g of e.bodyGroups) parts.push(`*${g.title}:*`, "", fieldsTable(g.fields), "");
    }
  }

  if (e.responseExample || e.responseFields?.length) {
    parts.push("**Пример ответа:**", "");
    if (e.responseExample) parts.push("```json", e.responseExample, "```", "");
    if (e.responseFields?.length) parts.push(fieldsTable(e.responseFields), "");
    if (e.responseStatus?.length) parts.push(statusTable(e.responseStatus), "");
    if (e.responseNote) parts.push(e.responseNote, "");
  } else if (e.responseNote) {
    parts.push(e.responseNote, "");
  }
  if (e.errors?.length) {
    parts.push("**Возможные ошибки:**", "", errorsTable(e.errors), "");
  }
  return parts.join("\n");
}

function buildDocs(): string {
  const header = `# Sendera API

Справочник для интеграции и для ИИ-агентов, которым поручили подключить рассылки.

## Авторизация

${API_INTRO.authNote}

${API_INTRO.authMethods.map((m) => `- \`${m}\``).join("\n")}

## Шаблонизация — Liquid, только двойные фигурные скобки

${API_INTRO.liquidNote}

Источники значений для подстановки, в порядке возрастания приоритета (более специфичное побеждает при совпадении имени):
${API_INTRO.liquidSources.map((s, i) => `${i + 1}. ${s}`).join("\n")}

${API_INTRO.liquidExample}
`;

  const groups = API_GROUPS.map((g) => `## ${g.title}\n\n${g.endpoints.map((e) => endpointMd(e)).join("\n---\n\n")}`).join("\n---\n\n");

  return `${header}\n---\n\n${groups}`;
}
