// Окно отправки (день недели + диапазон времени) для welcome-автоматизаций —
// конверсия «настенное время в часовом поясе» <-> UTC без внешних библиотек,
// стандартный приём через Intl.DateTimeFormat.formatToParts (Node имеет
// полный ICU, доступно без доп. зависимостей).

function tzOffsetMinutes(tz: string, atUtc: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(atUtc).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return (asUtc - atUtc.getTime()) / 60_000;
}

// Y-M-D + HH:mm "настенного" времени в tz -> точный момент в UTC.
function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const naive = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const offset = tzOffsetMinutes(tz, naive);
  return new Date(naive.getTime() - offset * 60_000);
}

// Текущие Y-M-D / день недели (0=Вс..6=Сб, как Date.getDay) / HH:mm в tz для
// момента `at`.
function wallClock(tz: string, at: Date): { y: number; m: number; d: number; weekday: number; hh: number; mm: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = dtf.formatToParts(at).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  const hh = parts.hour === "24" ? 0 : Number(parts.hour);
  const mm = Number(parts.minute);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, weekday, hh, mm };
}

export type SendWindow = {
  enabled: boolean;
  days: number[] | null; // 0=Вс..6=Сб (как Date.getDay), null/[] = все дни
  timeFrom: string | null; // "HH:mm"
  timeTo: string | null; // "HH:mm"
  useSubscriberTz: boolean;
};

// true — можно слать прямо сейчас; false — нужно отложить (см. nextWindowStart).
export function isWithinSendWindow(win: SendWindow, tz: string, now: Date): boolean {
  if (!win.enabled) return true;
  const wc = wallClock(tz, now);
  if (win.days?.length && !win.days.includes(wc.weekday)) return false;
  if (!win.timeFrom || !win.timeTo) return true;
  const [fh, fm] = win.timeFrom.split(":").map(Number);
  const [th, tm] = win.timeTo.split(":").map(Number);
  const cur = wc.hh * 60 + wc.mm;
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  if (from <= to) return cur >= from && cur < to;
  return cur >= from || cur < to; // окно через полночь, напр. 22:00–06:00
}

// Ближайший момент (UTC), когда окно снова откроется — перебор до 8 дней
// вперёд (полный недельный цикл + запас), начиная с `now`.
export function nextWindowStart(win: SendWindow, tz: string, now: Date): Date {
  if (!win.timeFrom) return now;
  const [fh, fm] = win.timeFrom.split(":").map(Number);
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const probe = new Date(now.getTime() + dayOffset * 86_400_000);
    const wc = wallClock(tz, probe);
    if (win.days?.length && !win.days.includes(wc.weekday)) continue;
    const candidate = zonedToUtc(wc.y, wc.m, wc.d, fh, fm, tz);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return now;
}
