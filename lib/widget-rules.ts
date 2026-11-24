// Единый стандарт «когда показывать» для всех виджетов подписки (кнопка, плашка и
// будущее окно с колокольчиком). Один набор правил, одни и те же проверки в
// скрипте (lib/widget-gate.ts) и в настройках админки: новое правило добавляется
// здесь и сразу работает у всех виджетов. Все условия действуют вместе — виджет
// появляется, когда выполнены все.

export type PagesMode = "all" | "only" | "except";

export type ShowRules = {
  // сколько секунд ждать после полной загрузки страницы
  delaySeconds: number;
  // с какой по счёту страницы за визит можно показывать (1 — с первой)
  minPageViews: number;
  // сколько секунд посетитель суммарно провёл на сайте за визит (только пока вкладка открыта)
  minTimeOnSiteSeconds: number;
  // сколько часов молчать после того, как посетитель закрыл виджет
  pauseHours: number;
  // после скольких закрытий перестать показывать совсем (0 — не прекращать)
  maxDismissals: number;
  // на каких страницах показывать: везде / только на перечисленных / везде, кроме перечисленных
  pagesMode: PagesMode;
  // адреса страниц без домена; «*» — любая часть адреса: /catalog/*, /cart_items
  pagePatterns: string[];
};

export const PAGES_MODES: PagesMode[] = ["all", "only", "except"];

export const SHOW_LIMITS = {
  delaySeconds: { min: 0, max: 300 },
  minPageViews: { min: 1, max: 50 },
  minTimeOnSiteSeconds: { min: 0, max: 1800 },
  pauseHours: { min: 1, max: 2160 }, // до 90 дней
  maxDismissals: { min: 0, max: 20 },
  patterns: 30,
  patternLength: 120,
} as const;

// Типовые наборы, как это обычно настраивают: мягкий — для магазинов, где покупатели
// приходят надолго и раздражаются от навязчивости; настойчивый — когда главное набрать базу.
export type ShowPresetId = "soft" | "standard" | "persistent";
export const SHOW_PRESETS: Record<ShowPresetId, { label: string; hint: string; rules: ShowRules }> = {
  soft: {
    label: "Мягкий",
    hint: "С третьей страницы и после минуты на сайте, пауза неделя, после двух закрытий не беспокоить.",
    rules: { delaySeconds: 10, minPageViews: 3, minTimeOnSiteSeconds: 60, pauseHours: 168, maxDismissals: 2, pagesMode: "all", pagePatterns: [] },
  },
  standard: {
    label: "Стандартный",
    hint: "Со второй страницы и после 30 секунд на сайте, пауза 3 дня, после трёх закрытий не беспокоить.",
    rules: { delaySeconds: 5, minPageViews: 2, minTimeOnSiteSeconds: 30, pauseHours: 72, maxDismissals: 3, pagesMode: "all", pagePatterns: [] },
  },
  persistent: {
    label: "Настойчивый",
    hint: "Сразу через 3 секунды, пауза сутки, после пяти закрытий не беспокоить.",
    rules: { delaySeconds: 3, minPageViews: 1, minTimeOnSiteSeconds: 0, pauseHours: 24, maxDismissals: 5, pagesMode: "all", pagePatterns: [] },
  },
};

export const DEFAULT_SHOW_RULES: ShowRules = SHOW_PRESETS.standard.rules;

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

// Адрес страницы из настроек: допускаем вставленную целиком ссылку (оставляем только путь),
// убираем параметры и якорь, приводим к нижнему регистру, оставляем печатные ASCII-символы.
export function normalizePattern(raw: string): string | null {
  let s = String(raw || "").trim();
  if (!s) return null;
  const scheme = s.indexOf("://");
  if (scheme >= 0) {
    const rest = s.slice(scheme + 3);
    const slash = rest.indexOf("/");
    s = slash >= 0 ? rest.slice(slash) : "/";
  }
  s = s.split("#")[0].split("?")[0].trim().toLowerCase();
  s = s.replace(/[^\x21-\x7e]/g, "");
  if (!s) return null;
  if (s.charAt(0) !== "/" && s.charAt(0) !== "*") s = "/" + s;
  return s.slice(0, SHOW_LIMITS.patternLength);
}

export function normalizePatterns(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\n,]+/) : [];
  const out: string[] = [];
  for (const item of list) {
    const p = normalizePattern(String(item));
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= SHOW_LIMITS.patterns) break;
  }
  return out;
}

// raw — сохранённые правила; legacy — плоские поля старой версии настроек (dismissDays,
// delaySeconds, minPageViews), чтобы уже сохранённые кнопки и плашки не меняли поведение.
export function resolveShowRules(raw: unknown, legacy?: unknown, fallback: ShowRules = DEFAULT_SHOW_RULES): ShowRules {
  const c = (raw && typeof raw === "object" ? raw : null) as Partial<ShowRules> | null;
  const l = (legacy && typeof legacy === "object" ? legacy : {}) as { dismissDays?: unknown; delaySeconds?: unknown; minPageViews?: unknown };
  // старые настройки (без блока правил) сохраняют прежнее поведение: без лимита закрытий и времени на сайте
  const hasLegacy = l.dismissDays !== undefined || l.delaySeconds !== undefined || l.minPageViews !== undefined;
  const base: ShowRules = c || !hasLegacy
    ? fallback
    : {
        delaySeconds: clampInt(l.delaySeconds, 0, 120, 0),
        minPageViews: clampInt(l.minPageViews, 1, 20, 1),
        minTimeOnSiteSeconds: 0,
        pauseHours: clampInt(l.dismissDays, 1, 30, 1) * 24,
        maxDismissals: 0,
        pagesMode: "all",
        pagePatterns: [],
      };
  const src = c || {};
  const limits = SHOW_LIMITS;
  return {
    delaySeconds: clampInt(src.delaySeconds, limits.delaySeconds.min, limits.delaySeconds.max, base.delaySeconds),
    minPageViews: clampInt(src.minPageViews, limits.minPageViews.min, limits.minPageViews.max, base.minPageViews),
    minTimeOnSiteSeconds: clampInt(src.minTimeOnSiteSeconds, limits.minTimeOnSiteSeconds.min, limits.minTimeOnSiteSeconds.max, base.minTimeOnSiteSeconds),
    pauseHours: clampInt(src.pauseHours, limits.pauseHours.min, limits.pauseHours.max, base.pauseHours),
    maxDismissals: clampInt(src.maxDismissals, limits.maxDismissals.min, limits.maxDismissals.max, base.maxDismissals),
    pagesMode: PAGES_MODES.includes(src.pagesMode as PagesMode) ? (src.pagesMode as PagesMode) : base.pagesMode,
    pagePatterns: src.pagePatterns !== undefined ? normalizePatterns(src.pagePatterns) : base.pagePatterns,
  };
}

// Какой шаблон совпадает с текущими значениями (null — значения свои).
export function matchShowPreset(rules: ShowRules): ShowPresetId | null {
  for (const id of Object.keys(SHOW_PRESETS) as ShowPresetId[]) {
    const p = SHOW_PRESETS[id].rules;
    if (
      p.delaySeconds === rules.delaySeconds &&
      p.minPageViews === rules.minPageViews &&
      p.minTimeOnSiteSeconds === rules.minTimeOnSiteSeconds &&
      p.pauseHours === rules.pauseHours &&
      p.maxDismissals === rules.maxDismissals &&
      p.pagesMode === rules.pagesMode &&
      p.pagePatterns.length === rules.pagePatterns.length
    ) {
      return id;
    }
  }
  return null;
}
