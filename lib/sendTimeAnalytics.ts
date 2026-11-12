// Расчёт «Лучшего времени для отправки» (раздел «Аналитика»).
//
// Идея: берём уже отправленные сообщения получателям (строки campaign_recipients), группируем по
// моменту отправки (день недели × время суток в часовом поясе проекта) и считаем долю тех, кто
// перешёл по ссылке (для email ещё и открыл письмо) в течение окна после отправки.
// Три параметра подбираются автоматически, но могут быть заданы вручную:
//  - окно подсчёта кликов после отправки (1–72 ч): минимальное, в которое приходит 90% всех кликов;
//  - группировка по дням (по дням недели / будни и выходные / все дни вместе);
//  - шаг времени (30 минут / 1 час / 2 часа / 3 часа).
// Автоподбор берёт самую подробную группировку, в которой достаточно данных для сравнения окон.

export type Channel = "push" | "sms" | "email";
export type DayMode = "dow" | "wd" | "all";
export type StepMin = 30 | 60 | 120 | 180;

export type RecipientRow = {
  channel: string;
  created_at: string;
  clicked_at: string | null;
  opened_at: string | null;
  provider_status?: string | null;
};

export type Settings = {
  window: "auto" | number; // часов
  day: "auto" | DayMode;
  step: "auto" | StepMin;
};

export type Cell = {
  key: string;
  dayLabel: string;
  from: string; // «12:00»
  to: string; // «13:00»
  sent: number;
  engaged: number;
  rate: number; // доля, 0..1
  margin: number; // полуширина 95% доверительного интервала, 0..1
  reliable: boolean;
};

export type ChannelResult = {
  channel: Channel;
  windowHours: number;
  windowAuto: boolean;
  windowNote: string | null;
  day: DayMode;
  dayAuto: boolean;
  step: StepMin;
  stepAuto: boolean;
  delivered: number; // всего доставленных за всё время
  counted: number; // из них учтено в расчёте (окно после отправки уже закрылось)
  pending: number; // ещё набираются: окно после отправки не закрылось
  engagedTotal: number;
  reliable: Cell[]; // топ окон с достаточной выборкой
  weak: Cell[]; // окна, где данных мало
  reliableCount: number;
  note: string | null;
};

// минимальное число отправок в окне, при котором его можно ставить в рейтинг
export const MIN_SAMPLE = 30;
export const WINDOW_STEPS_H = [1, 2, 3, 6, 12, 24, 48, 72];
const WINDOW_FALLBACK_H = 24;
const WINDOW_PERCENTILE = 0.9;
const MIN_CLICKS_FOR_AUTO_WINDOW = 20;

export const DAY_SHORT: Record<number, string> = { 1: "пн", 2: "вт", 3: "ср", 4: "чт", 5: "пт", 6: "сб", 0: "вс" };

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    dtfCache.set(tz, f);
  }
  return f;
}

// День недели (0 = воскресенье) и минуты от полуночи в заданном часовом поясе
export function localParts(iso: string, tz: string): { weekday: number; minutes: number } {
  const parts = dtf(tz)
    .formatToParts(new Date(iso))
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const weekday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay();
  return { weekday, minutes: hour * 60 + Number(parts.minute) };
}

function hhmm(totalMin: number): string {
  const m = ((totalMin % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Момент вовлечения: клик (для email ещё и открытие, что раньше)
function engagedAt(r: RecipientRow, channel: Channel): number | null {
  const click = r.clicked_at ? Date.parse(r.clicked_at) : null;
  if (channel !== "email") return click;
  const open = r.opened_at ? Date.parse(r.opened_at) : null;
  if (click == null) return open;
  if (open == null) return click;
  return Math.min(click, open);
}

// Полуширина 95% доверительного интервала Уилсона для доли x из n
function wilsonMargin(x: number, n: number): number {
  if (!n) return 0;
  const z = 1.96;
  const p = x / n;
  return (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
}

type Item = { weekday: number; minutes: number; engaged: boolean };

function bucketize(items: Item[], day: DayMode, step: StepMin): Cell[] {
  const map = new Map<string, { dayKey: number; slot: number; sent: number; engaged: number }>();
  for (const it of items) {
    const dayKey = day === "dow" ? it.weekday : day === "wd" ? (it.weekday === 0 || it.weekday === 6 ? 1 : 0) : 0;
    const slot = Math.floor(it.minutes / step);
    const key = `${dayKey}-${slot}`;
    const b = map.get(key) || { dayKey, slot, sent: 0, engaged: 0 };
    b.sent++;
    if (it.engaged) b.engaged++;
    map.set(key, b);
  }
  const dayLabel = (k: number) => (day === "dow" ? DAY_SHORT[k] : day === "wd" ? (k === 1 ? "выходные" : "будни") : "все дни");
  return [...map.values()].map((b) => ({
    key: `${b.dayKey}-${b.slot}`,
    dayLabel: dayLabel(b.dayKey),
    from: hhmm(b.slot * step),
    to: hhmm((b.slot + 1) * step),
    sent: b.sent,
    engaged: b.engaged,
    rate: b.sent ? b.engaged / b.sent : 0,
    margin: wilsonMargin(b.engaged, b.sent),
    reliable: b.sent >= MIN_SAMPLE,
  }));
}

const DAY_CELLS: Record<DayMode, number> = { dow: 7, wd: 2, all: 1 };

// Самые подробные группировки идут первыми (по числу возможных ячеек)
function candidates(dayFixed: "auto" | DayMode, stepFixed: "auto" | StepMin): { day: DayMode; step: StepMin }[] {
  const days: DayMode[] = dayFixed === "auto" ? ["dow", "wd", "all"] : [dayFixed];
  const steps: StepMin[] = stepFixed === "auto" ? [30, 60, 120, 180] : [stepFixed];
  const out: { day: DayMode; step: StepMin }[] = [];
  for (const day of days) for (const step of steps) out.push({ day, step });
  return out.sort((a, b) => DAY_CELLS[b.day] * (1440 / b.step) - DAY_CELLS[a.day] * (1440 / a.step));
}

// Окно подсчёта кликов: минимальное из шагов, в которое укладывается 90% всех кликов
export function autoWindowHours(delaysH: number[]): { hours: number; note: string | null } {
  if (delaysH.length < MIN_CLICKS_FOR_AUTO_WINDOW) {
    return { hours: WINDOW_FALLBACK_H, note: `кликов пока мало (${delaysH.length}), взято ${WINDOW_FALLBACK_H} ч` };
  }
  const sorted = [...delaysH].sort((a, b) => a - b);
  const p = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * WINDOW_PERCENTILE) - 1)];
  const hours = WINDOW_STEPS_H.find((h) => h >= p) ?? WINDOW_STEPS_H[WINDOW_STEPS_H.length - 1];
  return { hours, note: null };
}

export function computeBestSendTimes(rows: RecipientRow[], tz: string, settings: Settings, now: Date = new Date()): Record<Channel, ChannelResult> {
  const out = {} as Record<Channel, ChannelResult>;
  for (const channel of ["push", "sms", "email"] as Channel[]) {
    // доставленными считаем строки со статусом «доставлено», у которых провайдер не вернул «не доставлено» (МТС: 301)
    const mine = rows.filter((r) => r.channel === channel && r.provider_status !== "301");

    const delays: number[] = [];
    for (const r of mine) {
      const e = engagedAt(r, channel);
      if (e != null) delays.push(Math.max(0, (e - Date.parse(r.created_at)) / 3_600_000));
    }
    const auto = settings.window === "auto" ? autoWindowHours(delays) : { hours: settings.window, note: null };
    const windowMs = auto.hours * 3_600_000;

    const items: Item[] = [];
    let pending = 0;
    let engagedTotal = 0;
    for (const r of mine) {
      const sentAt = Date.parse(r.created_at);
      if (sentAt + windowMs > now.getTime()) {
        pending++;
        continue;
      }
      const e = engagedAt(r, channel);
      const engaged = e != null && e - sentAt <= windowMs;
      if (engaged) engagedTotal++;
      const { weekday, minutes } = localParts(r.created_at, tz);
      items.push({ weekday, minutes, engaged });
    }

    // автоподбор детализации: самая подробная, где минимум 2 окна с достаточной выборкой и они покрывают 80% отправок
    let chosen: { day: DayMode; step: StepMin; cells: Cell[] } | null = null;
    let fallback: { day: DayMode; step: StepMin; cells: Cell[] } | null = null;
    for (const c of candidates(settings.day, settings.step)) {
      const cells = bucketize(items, c.day, c.step);
      const reliable = cells.filter((x) => x.reliable);
      const coverage = items.length ? reliable.reduce((s, x) => s + x.sent, 0) / items.length : 0;
      if (!fallback && reliable.length >= 1 && coverage >= 0.8) fallback = { ...c, cells };
      if (reliable.length >= 2 && coverage >= 0.8) {
        chosen = { ...c, cells };
        break;
      }
    }
    if (!chosen) {
      const list = candidates(settings.day, settings.step);
      const last = list[list.length - 1];
      chosen = fallback ?? { ...last, cells: bucketize(items, last.day, last.step) };
    }

    const reliable = chosen.cells
      .filter((c) => c.reliable)
      .sort((a, b) => b.rate - a.rate || b.sent - a.sent)
      .slice(0, 5);
    const weak = chosen.cells
      .filter((c) => !c.reliable)
      .sort((a, b) => b.sent - a.sent)
      .slice(0, 5);
    const reliableCount = chosen.cells.filter((c) => c.reliable).length;

    let note: string | null = null;
    if (mine.length && !items.length) note = "Окно подсчёта кликов после отправки ещё не закрылось: данные появятся позже.";
    else if (items.length && reliableCount < 2) {
      note = "Сравнивать пока нечего: данных хватает не более чем в одном окне. Нужны отправки в разное время, по " + MIN_SAMPLE + " и больше получателей на окно.";
    }

    out[channel] = {
      channel,
      windowHours: auto.hours,
      windowAuto: settings.window === "auto",
      windowNote: auto.note,
      day: chosen.day,
      dayAuto: settings.day === "auto",
      step: chosen.step,
      stepAuto: settings.step === "auto",
      delivered: mine.filter((r) => r.channel === channel).length,
      counted: items.length,
      pending,
      engagedTotal,
      reliable,
      weak,
      reliableCount,
      note,
    };
  }
  return out;
}

export function parseSettings(sp: { win?: string; day?: string; step?: string }): Settings {
  const win = Number(sp.win);
  const step = Number(sp.step);
  return {
    window: WINDOW_STEPS_H.includes(win) ? win : "auto",
    day: sp.day === "dow" || sp.day === "wd" || sp.day === "all" ? sp.day : "auto",
    step: step === 30 || step === 60 || step === 120 || step === 180 ? (step as StepMin) : "auto",
  };
}
