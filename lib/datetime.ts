// Единый формат даты и времени в бэкофисе. Часовой пояс задаём явно (по
// умолчанию Москва, как у настройки проекта): без него сервер при
// отрисовке берёт UTC, браузер — местный пояс, и одно и то же время в
// разных местах разъезжается на несколько часов.
export const DEFAULT_TZ = "Europe/Moscow";

function safeTz(tz?: string | null): string {
  const t = tz || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: t });
    return t;
  } catch {
    return DEFAULT_TZ;
  }
}

export function formatDateTime(d: string | number | Date, tz?: string | null): string {
  return new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: safeTz(tz) });
}

export function formatDate(d: string | number | Date, tz?: string | null): string {
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: safeTz(tz) });
}

// Смещение часового пояса (мс) в данный момент: «стенные» часы пояса минус UTC.
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(date.getTime() / 1000) * 1000;
}

// Момент времени по «стенным» часам часового пояса: "2026-11-10T00:00:00" в
// Europe/Moscow = 2026-11-09T21:00:00Z. Границы суток в аналитике и дата
// заказа без явного смещения считаются так, а не по UTC.
export function wallTimeToUtc(local: string, tz?: string | null): Date | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
  if (!m) return null;
  const zone = safeTz(tz);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +((m[7] || "0").padEnd(3, "0")));
  let t = guess - tzOffsetMs(new Date(guess), zone);
  t = guess - tzOffsetMs(new Date(t), zone); // уточнение на переходе через смену времени
  return new Date(t);
}

// Время из внешней системы: со смещением («…+03:00», «…Z») берём как есть, без
// смещения считаем стенным временем часового пояса проекта.
export function parseExternalTime(raw: string, tz?: string | null): Date | null {
  const s = raw.trim();
  if (!s) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return wallTimeToUtc(s, tz);
}

// Сегодняшняя дата в часовом поясе проекта, формат YYYY-MM-DD.
export function todayInTz(tz?: string | null): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: safeTz(tz) });
}
