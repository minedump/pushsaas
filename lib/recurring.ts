// Расписание «Повторяющихся» автоматизаций — три вида периодичности,
// вычисление ближайшего срабатывания в часовом поясе проекта. Использует тот
// же приём конверсии "настенное время в tz" <-> UTC, что и lib/sendWindow.ts
// (Intl.DateTimeFormat.formatToParts, без внешних библиотек), но здесь свои
// копии helper'ов — те не экспортированы, а месячная арифметика (следующий
// месяц, число дней в месяце, N-й день недели месяца) специфична только
// для расписаний и не нужна send-window.

export type RecurringSchedule =
  | { kind: "weekly"; weekday: number; time: string } // weekday: 0=Вс..6=Сб (Date.getDay)
  | { kind: "monthly_from_date"; startDate: string; intervalMonths: number; time: string } // startDate: "YYYY-MM-DD", день месяца берётся из неё
  | { kind: "monthly_nth_weekday"; weekOfMonth: number; weekday: number; intervalMonths: number; time: string }; // weekOfMonth: 1..4 или -1 = последняя неделя

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Проверяет и нормализует расписание, пришедшее из тела публичного API
// (POST/PUT /api/v1/automations) — то же, что форма в AutomationsManager.tsx
// проверяет на стороне UI, но здесь на входе непроверенный JSON, а не уже
// типизированный draft-стейт.
export function validateSchedule(input: unknown): { ok: true; schedule: RecurringSchedule } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "schedule required (object)" };
  const s = input as Record<string, unknown>;
  const kind = s.kind;
  if (kind !== "weekly" && kind !== "monthly_from_date" && kind !== "monthly_nth_weekday") {
    return { ok: false, error: "schedule.kind must be weekly, monthly_from_date or monthly_nth_weekday" };
  }
  const time = typeof s.time === "string" ? s.time : "";
  if (!TIME_RE.test(time)) return { ok: false, error: "schedule.time must be HH:mm" };

  if (kind === "weekly") {
    const weekday = Number(s.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { ok: false, error: "schedule.weekday must be 0-6 (0=Sunday)" };
    return { ok: true, schedule: { kind, weekday, time } };
  }

  const intervalMonths = Number.isInteger(Number(s.intervalMonths)) ? Math.max(1, Number(s.intervalMonths)) : 1;
  if (kind === "monthly_from_date") {
    const startDate = typeof s.startDate === "string" ? s.startDate : "";
    if (!DATE_RE.test(startDate) || isNaN(new Date(`${startDate}T00:00:00Z`).getTime())) {
      return { ok: false, error: "schedule.startDate must be YYYY-MM-DD" };
    }
    return { ok: true, schedule: { kind, startDate, intervalMonths, time } };
  }

  const weekday = Number(s.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { ok: false, error: "schedule.weekday must be 0-6 (0=Sunday)" };
  const weekOfMonth = Number(s.weekOfMonth);
  if (!Number.isInteger(weekOfMonth) || (weekOfMonth < 1 && weekOfMonth !== -1) || weekOfMonth > 4) {
    return { ok: false, error: "schedule.weekOfMonth must be 1-4 or -1 (last)" };
  }
  return { ok: true, schedule: { kind, weekOfMonth, weekday, intervalMonths, time } };
}

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

function wallClockDate(tz: string, at: Date): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = dtf.formatToParts(at).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m=1..12, day 0 следующего месяца = последний день текущего
}

// N-е вхождение дня недели в месяце (1..4) или -1 для последнего.
function nthWeekdayOfMonth(y: number, m: number, weekday: number, n: number): number {
  const dim = daysInMonth(y, m);
  const matches: number[] = [];
  for (let d = 1; d <= dim; d++) {
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === weekday) matches.push(d);
  }
  return n === -1 ? matches[matches.length - 1] : matches[n - 1];
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const total = (y * 12 + (m - 1)) + delta;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

// Ближайший момент (UTC) строго ПОСЛЕ `after`, когда расписание должно
// сработать — считается в часовом поясе проекта.
export function computeNextFireAt(schedule: RecurringSchedule, tz: string, after: Date): Date {
  const [hh, mm] = schedule.time.split(":").map(Number);

  if (schedule.kind === "weekly") {
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const probe = new Date(after.getTime() + dayOffset * 86_400_000);
      const wc = wallClockDate(tz, probe);
      const weekday = new Date(Date.UTC(wc.y, wc.m - 1, wc.d)).getUTCDay();
      if (weekday !== schedule.weekday) continue;
      const candidate = zonedToUtc(wc.y, wc.m, wc.d, hh, mm, tz);
      if (candidate.getTime() > after.getTime()) return candidate;
    }
    // не должно случиться (7 дней в неделе гарантированно попадают в 14),
    // но на случай пограничного сдвига часового пояса — не зависаем молча.
    return new Date(after.getTime() + 7 * 86_400_000);
  }

  const anchorDay = schedule.kind === "monthly_from_date" ? Number(schedule.startDate.slice(8, 10)) : undefined;

  let { y, m } =
    schedule.kind === "monthly_from_date" ? wallClockDate(tz, new Date(`${schedule.startDate}T00:00:00Z`)) : wallClockDate(tz, after);
  for (let i = 0; i < 60; i++) {
    const d =
      schedule.kind === "monthly_from_date"
        ? Math.min(anchorDay!, daysInMonth(y, m))
        : nthWeekdayOfMonth(y, m, schedule.weekday, schedule.weekOfMonth);
    if (d) {
      const candidate = zonedToUtc(y, m, d, hh, mm, tz);
      if (candidate.getTime() > after.getTime()) return candidate;
    }
    ({ y, m } = addMonths(y, m, schedule.intervalMonths || 1));
  }
  // 60 итераций (5+ лет при интервале в месяц) — практически недостижимо,
  // но лучше вернуть предсказуемое значение, чем упасть.
  return new Date(after.getTime() + 30 * 86_400_000);
}
