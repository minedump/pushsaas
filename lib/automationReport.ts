import { createAdminClient } from "@/lib/supabase/admin";
import { AUTOMATION_SELECT } from "@/lib/automations";

// Генератор презентации-отчёта по автоматизациям проекта (кнопка «Скачать
// отчёт» в разделе «Автоматизации» — см. app/api/admin/automation-report/route.ts).
// Вёрстка/CSS — 1:1 копия макета presentation/automation-report-mockup.html,
// согласованного с пользователем по слайдам. Два рода контента:
//   1. Обзорные слайды (обложка + 1 на тип) — полностью статичные: заголовок,
//      подпись, «какие механики настроить в первую очередь» и «чем наполнить»
//      придуманы один раз для ВСЕХ проектов (это шаблон, не данные конкретного
//      клиента — см. историю правок макета, откуда и выросла эта копия).
//   2. Слайды настроек/статистики — по одной паре на каждую реальную строку
//      automations проекта (активную и отключённую), с реальными полями и
//      реальной статистикой по цепочке automation_log → campaigns →
//      order_attributions.

type Channel = "push" | "sms" | "email";
const CHANNELS: Channel[] = ["push", "sms", "email"];

type RawAutomation = {
  id: string;
  type: "welcome" | "event" | "custom" | "recurring";
  name: string | null;
  comment: string | null;
  is_enabled: boolean;
  channel: Channel | null;
  cascade: boolean | null;
  channel_templates: Partial<Record<Channel, string>> | null;
  template_id: string | null;
  segment_tags: string[] | null;
  delay_minutes: number | null;
  config: Record<string, unknown> | null;
  spacing_enabled: boolean | null;
  spacing_minutes: number | null;
  send_window_enabled: boolean | null;
  send_days: number[] | null;
  send_time_from: string | null;
  send_time_to: string | null;
  is_transactional: boolean | null;
  next_fire_at: string | null;
  last_fired_at: string | null;
  created_at: string;
};

// ---------- экранирование ----------
// Всё, что могло быть введено мерчантом (название/комментарий автоматизации,
// имя шаблона, сегмент, ключ вебхука, имя проекта) — обязательно через esc(),
// иначе это open XSS в скачиваемом HTML-файле, который потом открывают в браузере.
function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

// ---------- форматирование ----------
const MONTHS_GEN = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function fmtDateRu(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtDateTimeRu(iso: string, now: Date): string {
  const d = new Date(iso);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `сегодня, ${hm}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}, ${hm}` : `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}, ${hm}`;
}

function fmtDelay(mins: number): string {
  if (mins <= 0) return "Сразу";
  if (mins % 1440 === 0 && mins >= 1440) return `${mins / 1440} дн`;
  if (mins % 60 === 0 && mins >= 60) return `${mins / 60} ч`;
  return `${mins} мин`;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

function fmtMoney(n: number): string {
  return `${fmtNum(n)} ₽`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1).replace(/\.0$/, "")}%`;
}

const CHANNEL_LABEL: Record<Channel, string> = { push: "Push", sms: "SMS", email: "Email" };

const WEEKDAY_ACC: Record<number, string> = { 1: "понедельник", 2: "вторник", 3: "среду", 4: "четверг", 5: "пятницу", 6: "субботу", 0: "воскресенье" };
const WEEKDAY_NOM: Record<number, string> = { 1: "понедельник", 2: "вторник", 3: "среда", 4: "четверг", 5: "пятница", 6: "суббота", 0: "воскресенье" };
const WEEKDAY_GENDER: Record<number, "m" | "f" | "n"> = { 1: "m", 2: "m", 3: "f", 4: "m", 5: "f", 6: "f", 0: "n" };
const MONTH_WEEK_LABEL: Record<number, Record<"m" | "f" | "n", string>> = {
  1: { m: "Первый", f: "Первая", n: "Первое" },
  2: { m: "Второй", f: "Вторая", n: "Второе" },
  3: { m: "Третий", f: "Третья", n: "Третье" },
  4: { m: "Четвёртый", f: "Четвёртая", n: "Четвёртое" },
  [-1]: { m: "Последний", f: "Последняя", n: "Последнее" },
};

// Тот же принцип, что formatSchedule в AutomationsManager.tsx — своя копия,
// т.к. оригинал не экспортирован из клиентского компонента.
function formatSchedule(schedule: Record<string, unknown> | null | undefined): string {
  if (!schedule) return "не задано";
  const kind = schedule.kind as string;
  const time = String(schedule.time || "");
  if (kind === "weekly") return `Каждую ${WEEKDAY_ACC[Number(schedule.weekday)]}, ${time}`;
  if (kind === "monthly_from_date") {
    const interval = Number(schedule.intervalMonths) > 1 ? ` (раз в ${schedule.intervalMonths} мес.)` : "";
    const date = new Date(`${schedule.startDate}T00:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" });
    return `Ежемесячно${interval} от ${date}, ${time}`;
  }
  const weekday = Number(schedule.weekday);
  const weekOfMonth = Number(schedule.weekOfMonth);
  const interval = Number(schedule.intervalMonths) > 1 ? ` (раз в ${schedule.intervalMonths} мес.)` : "";
  return `${MONTH_WEEK_LABEL[weekOfMonth]?.[WEEKDAY_GENDER[weekday]] || ""} ${WEEKDAY_NOM[weekday] || ""} месяца${interval}, ${time}`;
}

function fmtSendWindow(a: RawAutomation): { val: string; small: string } {
  if (!a.send_window_enabled) return { val: "Круглосуточно", small: "без ограничения по времени" };
  const days = a.send_days || [];
  const everyDay = days.length >= 7;
  const dayLabels: Record<number, string> = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 0: "Вс" };
  const order = [1, 2, 3, 4, 5, 6, 0];
  const daysText = everyDay ? "Ежедневно" : order.filter((d) => days.includes(d)).map((d) => dayLabels[d]).join(", ");
  const from = (a.send_time_from || "").slice(0, 5);
  const to = (a.send_time_to || "").slice(0, 5);
  return { val: daysText, small: `${from}–${to}` };
}

function channelsOf(a: RawAutomation): Channel[] {
  if (a.cascade) return CHANNELS.filter((ch) => !!a.channel_templates?.[ch]);
  return a.channel ? [a.channel] : [];
}

// ---------- иконки (те же пути, что в утверждённом макете) ----------
const ICON = {
  welcome: '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M16 19h6"/><path d="M19 16v6"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4"/>',
  event:
    '<path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 7a5 5 0 1 0 5 5"/><path d="M13 3.055a9 9 0 1 0 7.941 7.945"/><path d="M15 6v3h3l3 -3h-3v-3l-3 3"/><path d="M15 9l-3 3"/>',
  custom:
    '<path d="M4.876 13.61a4 4 0 1 0 6.124 3.39h6"/><path d="M15.066 20.502a4 4 0 1 0 1.934 -7.502c-.706 0 -1.424 .179 -2 .5l-3 -5.5"/><path d="M16 8a4 4 0 1 0 -8 0c0 1.506 .77 2.818 2 3.5l-3 5.5"/>',
  recurring: '<path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3"/><path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3"/>',
  push: '<path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/>',
  sms: '<path d="M8 9h8"/><path d="M8 13h6"/><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12"/>',
  email: '<path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10"/><path d="M3 7l9 6l9 -6"/>',
  arrow: '<path d="M5 12l14 0"/><path d="M13 18l6 -6"/><path d="M13 6l6 6"/>',
  coin: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M14.8 9a2 2 0 0 0 -1.8 -1h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1 -1.8 -1"/><path d="M12 7v10"/>',
  bell: '<path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/>',
} as const;

function typeMeta(type: RawAutomation["type"]) {
  return {
    welcome: { label: "Приветственные", varColor: "var(--t-welcome)", icon: ICON.welcome },
    event: { label: "Событийная автоматизация", varColor: "var(--t-event)", icon: ICON.event },
    custom: { label: "Триггерная автоматизация", varColor: "var(--t-custom)", icon: ICON.custom },
    recurring: { label: "Повторяющаяся автоматизация", varColor: "var(--t-recurring)", icon: ICON.recurring },
  }[type];
}

function typeLabelBlock(type: RawAutomation["type"], suffix: string, statusHtml: string): string {
  const m = typeMeta(type);
  return `
    <div class="type-label">
      <div class="tl-left">
        <div class="ic" style="background:${m.varColor}"><svg viewBox="0 0 24 24" stroke="#fff">${m.icon}</svg></div>
        <span style="color:${m.varColor}">${esc(m.label)}${suffix ? " · " + esc(suffix) : ""}</span>
      </div>
      ${statusHtml}
    </div>`;
}

function statusBlock(isEnabled: boolean): string {
  return isEnabled
    ? `<div class="status"><span class="dot on"></span><span class="active">Активна</span></div>`
    : `<div class="status"><span class="dot off"></span><span class="inactive">Отключена</span></div>`;
}

// ---------- статистика по каналам ----------
type ChannelAgg = { sent: number; delivered: number; opened: number; clicked: number; revenue: number; paid: number };
function emptyAgg(): ChannelAgg {
  return { sent: 0, delivered: 0, opened: 0, clicked: 0, revenue: 0, paid: 0 };
}

function channelCardHtml(ch: Channel, configured: boolean, agg: ChannelAgg, extraState?: string): string {
  const everFired = agg.sent > 0;
  const off = !configured;
  const stateText = off ? "Не активен" : everFired ? extraState || "Активен" : `Активен${extraState ? " · " + extraState : " · ещё не срабатывала"}`;
  const deliveredPct = agg.sent > 0 ? (agg.delivered / agg.sent) * 100 : 0;
  const openedPct = agg.delivered > 0 ? (agg.opened / agg.delivered) * 100 : 0;
  const clickedPct = agg.delivered > 0 ? (agg.clicked / agg.delivered) * 100 : 0;
  const sentVal = off ? "0" : everFired ? fmtNum(agg.sent) : "0";
  const deliveredVal = off ? "0%" : everFired ? fmtPct(deliveredPct) : "—";
  const openClickVal = off ? "0% / 0%" : everFired ? `${fmtPct(openedPct)} / ${fmtPct(clickedPct)}` : "—";
  const goodClass = !off && everFired ? " good" : "";
  return `
      <div class="channel-card${off ? " off" : ""}">
        <div class="ch-head"><svg viewBox="0 0 24 24">${ICON[ch]}</svg>${CHANNEL_LABEL[ch]}</div>
        <div class="ch-state">${esc(stateText)}</div>
        <div class="ch-tiles">
          <div class="row"><div class="lbl">Отправлено</div><div class="val">${sentVal}</div></div>
          <div class="row"><div class="lbl">Доставлено</div><div class="val${off || !everFired ? "" : goodClass}">${deliveredVal}</div></div>
          <div class="row"><div class="lbl">Открыто · клик</div><div class="val">${openClickVal}</div></div>
        </div>
      </div>`;
}

// ---------- слайды настроек/статистики одной автоматизации ----------
function settingsSlide(a: RawAutomation, opts: { suffix: string; templateNames: Map<string, string> }): string {
  const chs = channelsOf(a);
  const chLabel = chs.map((c) => CHANNEL_LABEL[c]).join(" или ") || "—";

  let triggerVal: string, triggerSmall: string;
  if (a.type === "welcome") {
    triggerVal = "Контакт стал активным";
    triggerSmall = `по каналу ${chLabel}`;
  } else if (a.type === "event") {
    triggerVal = `Событие ${esc((a.config as { trigger_event?: string } | null)?.trigger_event || "—")}`;
    triggerSmall = "вызывается с сайта";
  } else if (a.type === "custom") {
    triggerVal = "Вебхук из&nbsp;внешней системы";
    triggerSmall = `ключ: ${esc((a.config as { key?: string } | null)?.key || "—")}`;
  } else {
    triggerVal = "По расписанию";
    triggerSmall = esc(formatSchedule((a.config as { schedule?: Record<string, unknown> } | null)?.schedule));
  }

  let condVal: string, condSmall: string;
  if (a.type === "recurring") {
    condVal = a.next_fire_at ? fmtDateRu(a.next_fire_at) : "не запланировано";
    condSmall = "следующий раз";
  } else {
    condVal = fmtDelay(a.delay_minutes || 0);
    condSmall = a.type === "event" ? "после события" : a.type === "custom" ? "после вебхука" : "после подписки";
  }

  const names = chs.map((c) => (a.channel_templates?.[c] ? opts.templateNames.get(a.channel_templates[c]!) : null)).filter(Boolean) as string[];
  const singleName = a.template_id ? opts.templateNames.get(a.template_id) : null;
  const contentName = a.cascade ? Array.from(new Set(names))[0] || "—" : singleName || "—";
  const contentSmall = a.cascade ? `${chs.map((c) => CHANNEL_LABEL[c]).join(" → ")}, каскад` : `канал: ${chLabel}`;

  const win = fmtSendWindow(a);
  const segment = a.segment_tags?.length ? esc(a.segment_tags.join(", ")) : "Все подписчики";

  return `
<section class="slide">
  <div class="slide-inner">
    ${typeLabelBlock(a.type, opts.suffix, statusBlock(a.is_enabled))}
    <h1 class="headline">«${esc(a.name || "Без названия")}»</h1>
    ${a.comment ? `<div class="automation-comment">${esc(a.comment)}</div>` : ""}
    <div class="meta">Создана ${fmtDateRu(a.created_at)}</div>

    <div class="section-label">Настройки</div>
    <div class="flow">
      <div class="flow-step"><div class="lbl">Триггер</div><div class="val">${triggerVal}<small>${triggerSmall}</small></div></div>
      <div class="flow-arrow"><svg viewBox="0 0 24 24">${ICON.arrow}</svg></div>
      <div class="flow-step"><div class="lbl">Условие</div><div class="val">${esc(condVal)}<small>${esc(condSmall)}</small></div></div>
      <div class="flow-arrow"><svg viewBox="0 0 24 24">${ICON.arrow}</svg></div>
      <div class="flow-step"><div class="lbl">Контент</div><div class="val">Шаблон «${esc(contentName)}»<small>${esc(contentSmall)}</small></div></div>
      <div class="flow-arrow"><svg viewBox="0 0 24 24">${ICON.arrow}</svg></div>
      <div class="flow-step"><div class="lbl">Окно отправки</div><div class="val">${esc(win.val)}<small>${esc(win.small)}</small></div></div>
    </div>

    <div class="settings-row">
      <div class="setting"><div class="lbl">Сегмент</div><div class="val">${segment}</div></div>
      <div class="setting"><div class="lbl">Транзакционное</div><div class="val ${a.is_transactional ? "on" : "off"}">${a.is_transactional ? "Вкл" : "Выкл"}</div></div>
      <div class="setting"><div class="lbl">Каскадная отправка</div><div class="val ${a.cascade ? "on" : "off"}">${a.cascade ? "Вкл" : "Выкл"}</div></div>
      <div class="setting"><div class="lbl">Защита от наложения</div><div class="val ${a.spacing_enabled ? "on" : "off"}">${a.spacing_enabled ? `Вкл · ${fmtDelay(a.spacing_minutes || 0)}` : "Выкл"}</div></div>
    </div>

  </div>
</section>`;
}

function statsSlide(a: RawAutomation, opts: { suffix: string; perChannel: Record<Channel, ChannelAgg>; now: Date }): string {
  const chs = channelsOf(a);
  const metaText = a.last_fired_at ? `Последний раз сработала ${fmtDateTimeRu(a.last_fired_at, opts.now)}` : "Ещё не срабатывала";
  const cards = CHANNELS.map((ch) => channelCardHtml(ch, chs.includes(ch), opts.perChannel[ch])).join("");
  const totalSent = CHANNELS.reduce((s, ch) => s + opts.perChannel[ch].sent, 0);
  const totalRevenue = CHANNELS.reduce((s, ch) => s + opts.perChannel[ch].revenue, 0);
  const totalPaid = CHANNELS.reduce((s, ch) => s + opts.perChannel[ch].paid, 0);
  const revenueBlock =
    totalSent === 0
      ? `<div><div class="lbl">Выручка</div><div class="val">0 ₽</div><div class="note">данных пока нет</div></div>`
      : `<div><div class="lbl">Выручка</div><div class="val">${fmtMoney(totalRevenue)}</div><div class="note">оплачено ${fmtMoney(totalPaid)}</div></div>`;

  return `
<section class="slide">
  <div class="slide-inner" style="justify-content:center">
    ${typeLabelBlock(a.type, opts.suffix, statusBlock(a.is_enabled))}
    <h1 class="headline">«${esc(a.name || "Без названия")}»</h1>
    <div class="meta">${esc(metaText)}</div>

    <div class="section-label">Статистика по каналам</div>
    <div class="channel-stats">${cards}</div>
    <div class="channel-revenue">
      <div class="ic"><svg viewBox="0 0 24 24">${ICON.coin}</svg></div>
      ${revenueBlock}
    </div>

  </div>
</section>`;
}

// ---------- статичные слайды (обзор по типам, не зависят от проекта) ----------
function coverSlide(projectName: string, todayLabel: string): string {
  const chips = (["welcome", "event", "custom", "recurring"] as const)
    .map((t) => {
      const m = typeMeta(t);
      return `
      <div class="type-chip">
        <div class="ic" style="background:${m.varColor}"><svg viewBox="0 0 24 24" stroke="#fff">${m.icon}</svg></div>
        <div class="tc-label">${esc(m.label.replace(" автоматизация", ""))}</div>
      </div>`;
    })
    .join("");
  return `
<section class="slide cover">
  <div class="slide-inner">
    <div class="brand">
      <div class="mark"><svg viewBox="0 0 24 24">${ICON.bell}</svg></div>
      <div class="word">SENDERA</div>
    </div>

    <div class="eyebrow">Отчёт по автоматизациям</div>
    <h1 class="cover-title">${esc(projectName)}</h1>
    <p class="cover-lede">Как настроена каждая автоматизация и что уже принесла — по всем механикам проекта. Отдельно показано, что ещё не настроено и какие есть идеи.</p>

    <div class="type-legend">${chips}</div>

    <div class="cover-meta">Сформировано ${esc(todayLabel)}</div>
  </div>
</section>`;
}

function ideaCard(color: string, iconPath: string, text: string): string {
  return `
      <div class="idea">
        <div class="idea-ic" style="background:${color}"><svg viewBox="0 0 24 24" stroke="#fff">${iconPath}</svg></div>
        <div class="idea-t">${text}</div>
      </div>`;
}

function priorityBox(n: number, title: string, note: string): string {
  return `
      <div class="priority-box">
        <div class="pb-num">Механика ${n}</div>
        <div class="pb-title">${title}</div>
        <div class="pb-note">${note}</div>
      </div>`;
}

const WELCOME_ICONS = {
  coin: ICON.coin,
  ticket: '<path d="M15 5l0 2"/><path d="M15 11l0 2"/><path d="M15 17l0 2"/><path d="M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-3a2 2 0 0 0 0 -4v-3a2 2 0 0 1 2 -2"/>',
  bag: '<path d="M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304"/><path d="M9 11v-5a3 3 0 0 1 6 0v5"/>',
  card: '<path d="M3 8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -8"/><path d="M3 10l18 0"/><path d="M7 15l.01 0"/><path d="M11 15l2 0"/>',
  award: '<path d="M6 9a6 6 0 1 0 12 0a6 6 0 1 0 -12 0"/><path d="M12 15l3.4 5.89l1.598 -3.233l3.598 .232l-3.4 -5.889"/><path d="M6.802 12l-3.4 5.89l3.598 -.233l1.598 3.232l3.4 -5.889"/>',
  clipboard:
    '<path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2"/><path d="M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2"/><path d="M9 12l.01 0"/><path d="M13 12l2 0"/><path d="M9 16l.01 0"/><path d="M13 16l2 0"/>',
  users: '<path d="M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/>',
  grid: '<path d="M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"/><path d="M14 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"/><path d="M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"/><path d="M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"/>',
};

function welcomeOverviewSlide(): string {
  const flow = [
    ["Механика 1", "Спасибо за&nbsp;подписку", "через 5 минут"],
    ["Механика 2", "Расскажем о&nbsp;бренде", "через 2 дня"],
    ["Механика 3", "Расскажем о&nbsp;сервисе", "через 5 дней"],
  ]
    .map(([lbl, val, small]) => `<div class="flow-step"><div class="lbl">${lbl}</div><div class="val">${val}<small>${small}</small></div></div>`)
    .join("");
  const ideas = [
    [WELCOME_ICONS.coin, "Сколько бонусов лояльности начислено за&nbsp;подписку"],
    [WELCOME_ICONS.ticket, "Персональный промокод на&nbsp;первую покупку"],
    [WELCOME_ICONS.bag, "Подборка товаров, которые могут заинтересовать"],
    [WELCOME_ICONS.card, "Что&nbsp;товары можно купить в&nbsp;рассрочку или&nbsp;частями"],
    [WELCOME_ICONS.award, "Как&nbsp;устроена программа лояльности магазина"],
    [WELCOME_ICONS.clipboard, "Короткий опрос для&nbsp;персонализации писем"],
    [WELCOME_ICONS.users, "Приглашение в&nbsp;сообщество или&nbsp;чат бренда"],
    [WELCOME_ICONS.grid, "Рассказать про&nbsp;коллекции магазина"],
  ]
    .map(([icon, text]) => ideaCard("var(--t-welcome)", icon, text))
    .join("");
  return `
<section class="slide">
  <div class="slide-inner" style="justify-content:center">
    ${typeLabelBlock("welcome", "", "")}
    <h1 class="headline">Первое, что&nbsp;видит новый подписчик</h1>
    <p class="sub">Пока интерес ещё свежий&nbsp;— превращают факт подписки в&nbsp;знакомство с&nbsp;магазином, чтобы человек не&nbsp;забыл, зачем подписался. Количество, порядок и&nbsp;задержка между механиками настраиваются под&nbsp;каждый магазин отдельно.</p>

    <div class="ideas-label">Какие механики настроить в&nbsp;первую очередь</div>
    <div class="flow" style="gap:16px">${flow}</div>

    <div class="ideas-label">Чем&nbsp;наполнить приветственные письма</div>
    <div class="idea-row">${ideas}</div>

  </div>
</section>`;
}

function eventOverviewSlide(): string {
  const priority = [
    priorityBox(1, "Брошенная корзина", "Товар добавлен в корзину, оформление не начато"),
    priorityBox(2, "Брошенный чекаут", "Оформление начато, но заказ не завершён"),
    priorityBox(3, "Брошенное избранное", "Товар в избранном, но покупка не совершена"),
  ].join("");
  const ideas = [
    [WELCOME_ICONS.ticket, "Промокод на&nbsp;скидку — не&nbsp;всем сразу, а&nbsp;следующим шагом после напоминания"],
    [WELCOME_ICONS.bag, "Похожие или сопутствующие товары к&nbsp;тому, что в&nbsp;корзине"],
    [WELCOME_ICONS.coin, "Напомнить о&nbsp;накопленных бонусах — их&nbsp;можно списать прямо сейчас"],
    [
      '<path d="M3 9a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1l0 -2"/><path d="M12 8l0 13"/><path d="M19 12v7a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0 -5a4.8 8 0 0 1 4.5 5a4.8 8 0 0 1 4.5 -5a2.5 2.5 0 0 1 0 5"/>',
      "Начислить бонусы на&nbsp;эту покупку, если оформит в&nbsp;течение суток",
    ],
    [WELCOME_ICONS.card, "Предложить оплатить со&nbsp;скидкой, например через&nbsp;СБП"],
    [
      '<path d="M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.294 -2.333 5.588c0 3.704 3.134 6.706 7 6.706c3.866 0 7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235"/>',
      "Сколько товара осталось на&nbsp;складе — создаёт ощущение срочности",
    ],
  ]
    .map(([icon, text]) => ideaCard("var(--t-event)", icon, text))
    .join("");
  return `
<section class="slide">
  <div class="slide-inner" style="justify-content:center">
    ${typeLabelBlock("event", "", "")}
    <h1 class="headline">Реакция на&nbsp;действие в&nbsp;реальном времени</h1>
    <p class="sub">Срабатывает не&nbsp;по расписанию и&nbsp;не&nbsp;при подписке, а&nbsp;сразу когда на&nbsp;сайте произошло конкретное действие. Корзина, чекаут и&nbsp;избранное — разные этапы воронки, их&nbsp;стоит настраивать отдельными механиками, а&nbsp;не&nbsp;одной общей.</p>

    <div class="ideas-label">Какие механики настроить в&nbsp;первую очередь</div>
    <div class="priority-row">${priority}</div>

    <div class="ideas-label">Чем наполнить событийные сообщения</div>
    <div class="idea-row" style="grid-template-columns:repeat(3,1fr)">${ideas}</div>

  </div>
</section>`;
}

function customOverviewSlide(): string {
  const priority = [
    priorityBox(1, "Возврат оформлен", "Статус для покупателя о сроках зачисления денег"),
    priorityBox(2, "Заказ доставлен", "Смена статуса на «Доставлен» — просьба оставить отзыв"),
    priorityBox(3, "Оплата не прошла", "Неудачная попытка оплаты — напоминание вернуться к оплате"),
  ].join("");
  const ideas = [
    [
      '<path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5"/><path d="M12 12l8 -4.5"/><path d="M12 12l0 9"/><path d="M12 12l-8 -4.5"/><path d="M16 5.25l-8 4.5"/>',
      "Прямая ссылка на&nbsp;статус или трек-номер заказа",
    ],
    ['<path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245"/>', "Просьба оставить отзыв или фото товара"],
    [WELCOME_ICONS.ticket, "Промокод в&nbsp;благодарность за&nbsp;ожидание — например, при задержке или возврате"],
    ['<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 7v5l3 3"/>', "Точные сроки — когда ждать доставку или возврат денег"],
    [ICON.sms, "Контакты поддержки, если что-то пошло не&nbsp;так"],
    [WELCOME_ICONS.bag, "Предложить сопутствующий товар или услугу к&nbsp;этому статусу заказа"],
  ]
    .map(([icon, text]) => ideaCard("var(--t-custom)", icon, text))
    .join("");
  return `
<section class="slide">
  <div class="slide-inner">
    ${typeLabelBlock("custom", "", "")}
    <h1 class="headline">Через вебхук — для нестандартных сценариев</h1>
    <p class="sub">Срабатывает по вебхуку из внешней системы — для сценариев, которых нет во встроенных событиях: смена статуса заказа, возврат, начисление бонусов.</p>

    <div class="ideas-label">Какие механики настроить в&nbsp;первую очередь</div>
    <div class="priority-row">${priority}</div>

    <div class="ideas-label">Чем наполнить триггерные сообщения</div>
    <div class="idea-row" style="grid-template-columns:repeat(3,1fr)">${ideas}</div>

  </div>
</section>`;
}

function recurringOverviewSlide(): string {
  const priority = [
    priorityBox(1, "Подборка новинок", "Каждый понедельник — email с товарами, добавленными за неделю"),
    priorityBox(2, "«Скучаем по вам»", "Раз в месяц, сегмент «Не покупали 60 дней»"),
    priorityBox(3, "Акция выходного дня", "Каждую пятницу — короткое SMS с активной на выходные акцией"),
  ].join("");
  const ideas = [
    [
      '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6"/>',
      "Персональная подборка на&nbsp;основе прошлых покупок и&nbsp;просмотров",
    ],
    [WELCOME_ICONS.coin, "Сколько бонусов сгорает и&nbsp;до&nbsp;какого числа"],
    [WELCOME_ICONS.grid, "Новые поступления в&nbsp;категориях, которые интересны клиенту"],
    [WELCOME_ICONS.clipboard, "Короткий опрос — что понравилось за&nbsp;последний месяц"],
    [WELCOME_ICONS.users, "Раннее уведомление о&nbsp;распродаже для постоянных клиентов"],
    [
      '<path d="M3 9a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1l0 -2"/><path d="M12 8l0 13"/><path d="M19 12v7a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0 -5a4.8 8 0 0 1 4.5 5a4.8 8 0 0 1 4.5 -5a2.5 2.5 0 0 1 0 5"/>',
      "Персональное поздравление с&nbsp;днём рождения — скидка или подарок",
    ],
  ]
    .map(([icon, text]) => ideaCard("var(--t-recurring)", icon, text))
    .join("");
  return `
<section class="slide">
  <div class="slide-inner">
    ${typeLabelBlock("recurring", "", "")}
    <h1 class="headline">По&nbsp;расписанию, а&nbsp;не&nbsp;по&nbsp;действию человека</h1>
    <p class="sub">Отправляется сегменту по календарному расписанию — не привязана к действию конкретного человека, а идёт регулярно всем, кто подходит под условие.</p>

    <div class="ideas-label">Какие механики настроить в&nbsp;первую очередь</div>
    <div class="priority-row">${priority}</div>

    <div class="ideas-label">Чем наполнить повторяющиеся сообщения</div>
    <div class="idea-row" style="grid-template-columns:repeat(3,1fr)">${ideas}</div>

  </div>
</section>`;
}

// ---------- CSS (1:1 из согласованного макета) ----------
const REPORT_CSS = `
  :root{
    --paper:#f6f8fb; --surface:#ffffff; --surface-2:#edf1f5; --border:#dbe2e9;
    --ink:#16191e; --ink-muted:#5b6470; --ink-faint:#8b93a0;
    --accent:#2c4a66; --accent-tint:#e7eef3; --accent-line:#9db6c8;
    --good:#16a34a; --good-tint:#e6f3ec;
    --warn:#d97706; --warn-tint:#f8efdc;
    --t-welcome:#2c4a66; --t-event:#7c3aed; --t-custom:#ea580c; --t-recurring:#16a34a;
    --font-sans:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    --font-mono:ui-monospace,'SF Mono',Consolas,'Liberation Mono',Menlo,monospace;
  }
  *{box-sizing:border-box}
  html,body{margin:0; padding:0; background:#3a4552; font-family:var(--font-sans); color:var(--ink)}
  body{display:flex; flex-direction:column; align-items:center; gap:28px; padding:28px 0 60px}

  .slide{width:1440px; height:900px; flex:none; position:relative; overflow:hidden; background:var(--paper); box-shadow:0 18px 44px rgba(10,14,20,.35)}
  .slide-inner{position:absolute; inset:0; padding:72px 96px; display:flex; flex-direction:column}

  .type-label{display:flex; align-items:center; justify-content:space-between; gap:12px}
  .type-label .tl-left{display:flex; align-items:center; gap:12px}
  .type-label .ic{width:44px; height:44px; border-radius:13px; display:flex; align-items:center; justify-content:center; flex:none}
  .type-label .ic svg{width:23px; height:23px; stroke-width:1.9; fill:none}
  .type-label span{font-size:15px; font-weight:800; text-transform:uppercase; letter-spacing:.8px}
  .status{display:flex; align-items:center; gap:8px; font-size:14px; font-weight:700; color:var(--ink-muted); flex:none}
  .status .dot{width:8px; height:8px; border-radius:50%; flex:none}
  .status .dot.on{background:var(--good)}
  .status .dot.off{background:var(--ink-faint)}
  .status .active{color:var(--good); font-weight:800}
  .status .inactive{color:var(--ink-faint); font-weight:800}
  .meta{font-size:14.5px; color:var(--ink-muted); font-weight:600; margin-top:6px}
  .automation-comment{font-size:14.5px; color:var(--ink-muted); margin-top:10px; max-width:760px; line-height:1.5}

  h1.headline{font-size:44px; line-height:1.15; font-weight:800; letter-spacing:-.5px; margin:20px 0 0; max-width:1100px; text-wrap:balance}
  p.sub{font-size:18px; color:var(--ink-muted); margin:14px 0 0; max-width:880px; line-height:1.55}

  .flow{display:flex; align-items:stretch; gap:0; margin-top:56px}
  .flow-step{flex:1; background:var(--surface); border:1px solid var(--border); border-radius:20px; padding:30px 30px; min-width:0}
  .flow-step .lbl{font-size:13px; text-transform:uppercase; letter-spacing:.7px; color:var(--ink-faint); font-weight:800}
  .flow-step .val{font-size:21px; font-weight:800; margin-top:14px; line-height:1.35}
  .flow-step .val small{display:block; font-size:14.5px; font-weight:500; color:var(--ink-muted); margin-top:8px; line-height:1.4}
  .flow-arrow{flex:none; width:56px; display:flex; align-items:center; justify-content:center}
  .flow-arrow svg{width:26px; height:26px; stroke:var(--ink-faint); fill:none; stroke-width:2}

  .ideas-label + .flow{margin-top:18px}
  .priority-row{display:flex; gap:16px; margin-top:14px}
  .priority-box{flex:1; background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:20px 22px}
  .priority-box .pb-num{font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.5px; color:var(--ink-faint)}
  .priority-box .pb-title{font-size:19px; font-weight:800; margin-top:8px}
  .priority-box .pb-note{font-size:13.5px; color:var(--ink-muted); margin-top:6px; line-height:1.4}

  .ideas-label{font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:.6px; color:var(--ink-faint); margin-top:36px}
  .idea-row{display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-top:14px}
  .idea{display:flex; align-items:center; gap:11px; background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:15px 16px}
  .idea .idea-ic{width:34px; height:34px; border-radius:10px; flex:none; display:flex; align-items:center; justify-content:center}
  .idea .idea-ic svg{width:17px; height:17px; stroke-width:2; fill:none}
  .idea .idea-t{font-size:13.5px; line-height:1.38; font-weight:600}

  .section-label{font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:.6px; color:var(--ink-faint); margin-top:44px}
  .section-label + .flow{margin-top:18px}
  .section-label + .stats{margin-top:18px}
  .section-label + .channel-stats{margin-top:18px}

  .settings-row{display:grid; grid-template-columns:repeat(2,1fr); gap:14px; margin-top:16px; flex:1; align-content:start}
  .setting{background:var(--surface); border:1px solid var(--border); border-radius:15px; padding:15px 18px}
  .setting .lbl{font-size:12px; color:var(--ink-faint); text-transform:uppercase; letter-spacing:.5px; font-weight:700}
  .setting .val{font-size:15px; font-weight:800; margin-top:6px}
  .setting .val.on{color:var(--good)}
  .setting .val.off{color:var(--ink-faint)}

  .channel-stats{display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin-top:24px}
  .channel-card{background:var(--surface); border:1px solid var(--border); border-radius:20px; padding:28px 26px}
  .channel-card.off{background:var(--surface-2)}
  .channel-card .ch-head{display:flex; align-items:center; gap:10px; font-size:16px; font-weight:800}
  .channel-card .ch-head svg{width:19px; height:19px; stroke-width:1.9; stroke:var(--ink-muted); fill:none; flex:none}
  .channel-card.off .ch-head{color:var(--ink-faint)}
  .channel-card.off .ch-head svg{stroke:var(--ink-faint)}
  .channel-card .ch-state{font-size:13px; font-weight:700; color:var(--good); margin-top:4px}
  .channel-card.off .ch-state{color:var(--ink-faint)}
  .channel-card .ch-tiles{display:flex; flex-direction:column; gap:15px; margin-top:22px}
  .channel-card .ch-tiles .row{display:flex; align-items:baseline; justify-content:space-between; gap:10px}
  .channel-card .ch-tiles .lbl{font-size:13.5px; color:var(--ink-faint); font-weight:600}
  .channel-card .ch-tiles .val{font-family:var(--font-mono); font-size:19px; font-weight:700}
  .channel-card .ch-tiles .val.good{color:var(--good)}
  .channel-card.off .ch-tiles .val{color:var(--ink-faint)}
  .channel-revenue{margin-top:18px; background:var(--surface); border:1px solid var(--border); border-radius:18px; padding:26px 32px; display:flex; align-items:center; gap:28px}
  .channel-revenue .ic{width:52px; height:52px; border-radius:14px; background:var(--good-tint); display:flex; align-items:center; justify-content:center; flex:none}
  .channel-revenue .ic svg{width:26px; height:26px; stroke:var(--good); fill:none; stroke-width:1.9}
  .channel-revenue .lbl{font-size:14px; color:var(--ink-faint); text-transform:uppercase; letter-spacing:.6px; font-weight:800}
  .channel-revenue .val{font-family:var(--font-mono); font-size:34px; font-weight:700; color:var(--good); margin-top:6px}
  .channel-revenue .note{font-size:14px; color:var(--ink-muted); margin-top:4px}

  .cover .slide-inner{background:linear-gradient(150deg,#20344a 0%,#14202e 62%,#0e1720 100%); color:#fff}
  .cover .brand{display:flex; align-items:center; gap:10px}
  .cover .brand .mark{width:36px; height:36px; border-radius:10px; background:rgba(255,255,255,.12); display:flex; align-items:center; justify-content:center; flex:none}
  .cover .brand .mark svg{width:19px; height:19px; stroke:#fff; fill:none; stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round}
  .cover .brand .word{font-size:18px; font-weight:800; letter-spacing:.3px}
  .cover .eyebrow{font-size:13px; font-weight:800; letter-spacing:1.6px; text-transform:uppercase; color:#9db6c8; margin-top:100px}
  .cover h1.cover-title{font-size:56px; line-height:1.08; font-weight:800; letter-spacing:-.5px; margin:16px 0 0; max-width:900px; text-wrap:balance}
  .cover p.cover-lede{font-size:19px; line-height:1.6; color:rgba(255,255,255,.68); max-width:680px; margin:20px 0 0}
  .cover .type-legend{display:flex; gap:16px; margin-top:64px}
  .cover .type-chip{flex:1; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14); border-radius:16px; padding:20px 20px; display:flex; align-items:center; gap:14px}
  .cover .type-chip .ic{width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex:none}
  .cover .type-chip .ic svg{width:21px; height:21px; stroke-width:1.9; fill:none; stroke:#fff}
  .cover .type-chip .tc-label{font-size:15px; font-weight:700}
  .cover .cover-meta{margin-top:auto; padding-top:36px; font-family:var(--font-mono); font-size:13px; color:rgba(255,255,255,.4)}
`;

// ---------- сбор и агрегация данных ----------
export async function generateAutomationReportHtml(projectId: string): Promise<string> {
  const admin = createAdminClient();
  const now = new Date();

  const [{ data: project }, { data: automationsRaw }, { data: templatesRaw }] = await Promise.all([
    admin.from("projects").select("name").eq("id", projectId).maybeSingle(),
    admin.from("automations").select(AUTOMATION_SELECT).eq("project_id", projectId).order("created_at", { ascending: true }),
    admin.from("templates").select("id, name").eq("project_id", projectId),
  ]);

  const automations = (automationsRaw || []) as unknown as RawAutomation[];
  const templateNames = new Map((templatesRaw || []).map((t) => [t.id as string, t.name as string]));

  const automationIds = automations.map((a) => a.id);
  const { data: logsRaw } = automationIds.length
    ? await admin.from("automation_log").select("automation_id, channel, campaign_id").eq("project_id", projectId).in("automation_id", automationIds)
    : { data: [] };
  const logs = (logsRaw || []) as { automation_id: string | null; channel: Channel | null; campaign_id: string | null }[];

  const campaignIds = Array.from(new Set(logs.map((l) => l.campaign_id).filter((id): id is string => !!id)));
  const { data: campaignsRaw } = campaignIds.length
    ? await admin.from("campaigns").select("id, sent_count, delivered_count, clicked_count, opened_count").in("id", campaignIds)
    : { data: [] };
  const campaignById = new Map((campaignsRaw || []).map((c) => [c.id as string, c]));

  const { data: attrRaw } = campaignIds.length ? await admin.from("order_attributions").select("campaign_id, revenue, is_paid, paid_amount").in("campaign_id", campaignIds) : { data: [] };
  const attrByCampaign = new Map<string, { revenue: number; paid: number }>();
  for (const r of attrRaw || []) {
    const cid = r.campaign_id as string | null;
    if (!cid) continue;
    const cur = attrByCampaign.get(cid) || { revenue: 0, paid: 0 };
    cur.revenue += Number(r.revenue || 0);
    if (r.is_paid) cur.paid += Number(r.paid_amount || 0);
    attrByCampaign.set(cid, cur);
  }

  // automation_id -> channel -> agg
  const aggByAutomation = new Map<string, Record<Channel, ChannelAgg>>();
  for (const a of automations) aggByAutomation.set(a.id, { push: emptyAgg(), sms: emptyAgg(), email: emptyAgg() });
  for (const log of logs) {
    if (!log.automation_id || !log.campaign_id) continue;
    const ch: Channel = (log.channel as Channel) || "push";
    const bucket = aggByAutomation.get(log.automation_id);
    if (!bucket) continue;
    const camp = campaignById.get(log.campaign_id);
    const attr = attrByCampaign.get(log.campaign_id);
    bucket[ch].sent += Number(camp?.sent_count || 0);
    bucket[ch].delivered += Number(camp?.delivered_count || 0);
    bucket[ch].opened += Number(camp?.opened_count || 0);
    bucket[ch].clicked += Number(camp?.clicked_count || 0);
    bucket[ch].revenue += attr?.revenue || 0;
    bucket[ch].paid += attr?.paid || 0;
  }

  const byType: Record<RawAutomation["type"], RawAutomation[]> = { welcome: [], event: [], custom: [], recurring: [] };
  for (const a of automations) byType[a.type]?.push(a);

  const todayLabel = `${now.getDate()} ${["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"][now.getMonth()]} ${now.getFullYear()}`;

  const slides: string[] = [coverSlide(project?.name || "Проект", todayLabel), welcomeOverviewSlide()];
  for (const [i, a] of byType.welcome.entries()) {
    const suffix = `механика ${i + 1} из ${byType.welcome.length}`;
    slides.push(settingsSlide(a, { suffix, templateNames }));
    slides.push(statsSlide(a, { suffix, perChannel: aggByAutomation.get(a.id)!, now }));
  }

  slides.push(eventOverviewSlide());
  for (const [i, a] of byType.event.entries()) {
    const suffix = byType.event.length > 1 ? `механика ${i + 1} из ${byType.event.length}` : "";
    slides.push(settingsSlide(a, { suffix, templateNames }));
    slides.push(statsSlide(a, { suffix, perChannel: aggByAutomation.get(a.id)!, now }));
  }

  slides.push(customOverviewSlide());
  for (const [i, a] of byType.custom.entries()) {
    const suffix = byType.custom.length > 1 ? `механика ${i + 1} из ${byType.custom.length}` : "";
    slides.push(settingsSlide(a, { suffix, templateNames }));
    slides.push(statsSlide(a, { suffix, perChannel: aggByAutomation.get(a.id)!, now }));
  }

  slides.push(recurringOverviewSlide());
  for (const [i, a] of byType.recurring.entries()) {
    const suffix = byType.recurring.length > 1 ? `механика ${i + 1} из ${byType.recurring.length}` : "";
    slides.push(settingsSlide(a, { suffix, templateNames }));
    slides.push(statsSlide(a, { suffix, perChannel: aggByAutomation.get(a.id)!, now }));
  }

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<title>${esc(project?.name || "Проект")} — отчёт по автоматизациям</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>${REPORT_CSS}</style>
</head>
<body>
${slides.join("\n")}
</body>
</html>`;
}
