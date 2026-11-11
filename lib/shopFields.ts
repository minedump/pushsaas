// Доп. поля из вебхуков магазина (клиент и заказ): соответствие «поле магазина → поле у нас».
// Часть ключей системные: они пишутся в сам контакт, а не в доп. поля.
//   timezone      — часовой пояс контакта (IANA, например Europe/Moscow);
//   ym_client_id  — ClientID Яндекс.Метрики (у контакта их может быть несколько).
// Остальные ключи — обычные доп. поля контакта (в вебхуке клиента) или заказа (в вебхуке заказа).

export const SYSTEM_FIELD_KEYS = ["timezone", "ym_client_id"] as const;
export type FieldMapRow = { handle: string; key: string };

export function isSystemFieldKey(key: string): boolean {
  return (SYSTEM_FIELD_KEYS as readonly string[]).includes(key);
}

// Настоящий часовой пояс IANA или null: невалидная строка сломала бы расчёт окна отправки.
export function parseTimezone(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s || s.length > 60) return null;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: s });
    return s;
  } catch {
    return null;
  }
}

// ClientID Метрики: цифры, на всякий случай допускаем буквы, «_» и «-».
export function parseYmClientId(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^[A-Za-z0-9_-]{5,64}$/.test(s) ? s : null;
}

// В одной ячейке может быть несколько id через запятую, «;», «|» или пробел.
export function parseYmClientIds(v: unknown): string[] {
  const out = new Set<string>();
  for (const part of String(v ?? "").split(/[\s,;|]+/)) {
    const id = parseYmClientId(part);
    if (id) out.add(id);
  }
  return [...out];
}

export type MappedFields = {
  custom: Record<string, string | null>; // обычные доп. поля: пустое значение = убрать поле
  timezone?: string;
  ymIds: string[];
  notes: string[];
};

// find(handle) возвращает объект поля из тела вебхука (с value) или undefined, если поля там нет:
// такие поля не трогаем.
export function mapShopFields(map: FieldMapRow[], find: (handle: string) => Record<string, unknown> | undefined): MappedFields {
  const res: MappedFields = { custom: {}, ymIds: [], notes: [] };
  for (const m of map) {
    const handle = String(m?.handle ?? "").trim();
    const key = String(m?.key ?? "").trim();
    if (!handle || !key) continue;
    const f = find(handle);
    if (!f) continue;
    const raw = f.value == null ? "" : String(f.value).trim();
    if (key === "timezone") {
      if (!raw) continue;
      const tz = parseTimezone(raw);
      if (tz) res.timezone = tz;
      else res.notes.push(`timezone «${raw.slice(0, 40)}» is not a valid IANA time zone`);
    } else if (key === "ym_client_id") {
      if (!raw) continue;
      const ids = parseYmClientIds(raw);
      if (ids.length) res.ymIds.push(...ids);
      else res.notes.push("ym_client_id value is not a valid Metrica ClientID");
    } else {
      res.custom[key] = raw === "" ? null : raw;
    }
  }
  res.ymIds = [...new Set(res.ymIds)];
  return res;
}

// timezone (IANA или null) и ymClientIds (массив ClientID Метрики) из тела запроса API: проверенные
// значения либо текст ошибки. undefined значит «поле не передано, не трогаем».
export function parseSystemFields(body: { timezone?: unknown; ymClientIds?: unknown }): { timezone?: string | null; ymClientIds?: string[] } | { error: string } {
  const out: { timezone?: string | null; ymClientIds?: string[] } = {};
  if (body.timezone !== undefined) {
    if (body.timezone === null || body.timezone === "") out.timezone = null;
    else {
      const tz = parseTimezone(body.timezone);
      if (!tz) return { error: "invalid timezone: expected IANA name, e.g. Europe/Moscow" };
      out.timezone = tz;
    }
  }
  if (body.ymClientIds !== undefined) {
    if (!Array.isArray(body.ymClientIds)) return { error: "ymClientIds must be an array of strings" };
    const ids: string[] = [];
    for (const v of body.ymClientIds) {
      const id = parseYmClientId(v);
      if (!id) return { error: `invalid ymClientIds value: ${String(v).slice(0, 40)}` };
      ids.push(id);
    }
    out.ymClientIds = ids;
  }
  return out;
}
