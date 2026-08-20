import { Liquid } from "liquidjs";

// Единственный шаблонизатор для контента рассылок — Liquid: циклы (for/
// tablerow), условия (if/unless/case), фильтры (upcase, downcase, join,
// where, map, date, round, default, ...) и операторы. strictVariables/
// strictFilters выключены: опечатка в имени переменной должна рендериться
// пустотой, а не ронять отправку.
const liquid = new Liquid({ strictVariables: false, strictFilters: false, cache: true });

// Рендерит строку через Liquid ({{ }} / {% %}) с данными как корневым
// scope. Невалидный Liquid не должен ронять отправку — возвращаем строку
// как есть.
export function renderLiquid(str: string | null | undefined, data: Record<string, unknown> = {}): string {
  if (!str) return "";
  try {
    return liquid.parseAndRenderSync(str, data);
  } catch {
    return str;
  }
}

// Replaces {{ var }} / {% tag %} with values from `data` (subscriber
// attributes, one-off template_data, event fields, ...).
export function applyTemplate(str: string | null | undefined, data: Record<string, unknown> = {}): string {
  return renderLiquid(str, data);
}

// Like applyTemplate, but `data` is an arbitrary incoming JSON (a webhook
// payload) rather than flat subscriber attributes. The whole root object is
// exposed under `data` for deep/array access — {{ data.fields }},
// {{ data.items[0].sku }} — and array-find-by-property, which the old
// {path[key=value]} shorthand used to special-case, is just Liquid's own
// `where`/`first` filters: {{ data.fields | where: "name", "Трек" | first |
// map: "value" }}. `extra` (named vars) is merged into the top-level scope
// and wins over same-named root fields when both are present.
export function applyTemplatePaths(
  str: string | null | undefined,
  root: unknown,
  extra: Record<string, unknown> = {}
): string {
  const scope: Record<string, unknown> =
    root && typeof root === "object" && !Array.isArray(root) ? { ...(root as Record<string, unknown>), ...extra, data: root } : { ...extra, data: root };
  return renderLiquid(str, scope);
}
