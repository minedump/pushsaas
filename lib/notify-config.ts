// Третий виджет подписки — «Окно уведомлений». Один виджет на весь цикл:
//   · окно с пользой от уведомлений до системного запроса («Включить» / «Не сейчас»);
//   · маленькая иконка-колокольчик, которая остаётся на странице после «Не сейчас»;
//   · режимы-инструкции: уведомления запрещены в браузере (как включить), устройство уже
//     подписано (как отключить), iPhone без значка на экране «Домой» (как добавить).
// Живёт в projects.widget_config.notify. Модуль без серверных зависимостей: им пользуются
// настройки (перед записью), скрипт (при чтении) и предпросмотр в админке.

import { DEFAULT_SHOW_RULES, resolveShowRules, type ShowRules } from "./widget-rules";
import { CORNER_RADIUS_VALUES, BUTTON_POSITIONS, BUTTON_SIZES, type ButtonPosition, type ButtonSize, type CornerRadius } from "./widget-config";

// Инструкции по типам устройств. iosHome — iPhone, где сайт ещё не добавлен на экран «Домой»
// (там разрешение спросить нельзя вообще); ios — iPhone с сайтом на экране «Домой».
export type GuideKey = "iosHome" | "ios" | "android" | "chrome" | "firefox" | "safari";
export const GUIDE_KEYS: GuideKey[] = ["iosHome", "ios", "android", "chrome", "firefox", "safari"];

// Вкладки в окне: iPhone один, а какая из двух инструкций (ios / iosHome) открыта, зависит от устройства.
export const GUIDE_TAB_LABEL: Record<GuideKey, string> = {
  iosHome: "iPhone",
  ios: "iPhone",
  android: "Android",
  chrome: "Chrome",
  firefox: "Firefox",
  safari: "Safari",
};
// Названия в настройках (там iPhone разделён на два случая).
export const GUIDE_ADMIN_LABEL: Record<GuideKey, string> = {
  iosHome: "iPhone: сайт ещё не на экране «Домой»",
  ios: "iPhone: сайт на экране «Домой»",
  android: "Android (Chrome и похожие)",
  chrome: "Компьютер: Chrome, Edge, Яндекс Браузер, Opera",
  firefox: "Компьютер: Firefox",
  safari: "Компьютер: Safari на Mac",
};

export type GuideSteps = { enable: string[]; disable: string[] };

// **жирным** выделяются названия кнопок и пунктов меню — как в окне «Установка приложения».
export const DEFAULT_GUIDES: Record<GuideKey, GuideSteps> = {
  iosHome: {
    enable: [
      "Откройте сайт в **Safari**: в других браузерах на iPhone добавить сайт на экран «Домой» нельзя.",
      "Нажмите кнопку **«Поделиться»** внизу экрана.",
      "Выберите **«На экран «Домой»»** и нажмите **«Добавить»**.",
      "Откройте сайт с новой иконки на экране «Домой» и включите уведомления там.",
    ],
    disable: [],
  },
  ios: {
    enable: [
      "Откройте **«Настройки»** на iPhone и перейдите в раздел **«Уведомления»**.",
      "Найдите в списке этот сайт: название такое же, как под иконкой на экране «Домой».",
      "Включите **«Допуск уведомлений»**.",
      "Вернитесь в приложение и нажмите кнопку ниже.",
    ],
    disable: [
      "Откройте **«Настройки»** на iPhone и перейдите в раздел **«Уведомления»**.",
      "Найдите в списке этот сайт: название такое же, как под иконкой на экране «Домой».",
      "Выключите **«Допуск уведомлений»**.",
    ],
  },
  android: {
    enable: [
      "В Chrome нажмите на **значок слева от адреса сайта** (замок или «настройки»).",
      "Выберите **«Разрешения»** (в некоторых версиях **«Настройки сайта»**).",
      "Откройте **«Уведомления»** и выберите **«Разрешить»**.",
      "Вернитесь на сайт и нажмите кнопку ниже.",
    ],
    disable: [
      "В Chrome нажмите на **значок слева от адреса сайта** (замок или «настройки»).",
      "Выберите **«Разрешения»** (в некоторых версиях **«Настройки сайта»**).",
      "Откройте **«Уведомления»** и выберите **«Блокировать»**.",
    ],
  },
  chrome: {
    enable: [
      "Нажмите на **значок слева от адреса сайта** (замок или «настройки»).",
      "Выберите **«Настройки сайта»** (в Яндекс Браузере — **«Подробнее»**).",
      "Найдите **«Уведомления»** и выберите **«Разрешить»**.",
      "Вернитесь на сайт и нажмите кнопку ниже. Если браузер просит, обновите страницу.",
    ],
    disable: [
      "Нажмите на **значок слева от адреса сайта** (замок или «настройки»).",
      "Выберите **«Настройки сайта»** (в Яндекс Браузере — **«Подробнее»**).",
      "Найдите **«Уведомления»** и выберите **«Блокировать»**.",
    ],
  },
  firefox: {
    enable: [
      "Нажмите на **значок слева от адреса сайта**.",
      "Рядом с пунктом **«Получать уведомления»** нажмите **×**, чтобы убрать блокировку.",
      "Обновите страницу и нажмите кнопку подписки ещё раз.",
    ],
    disable: [
      "Откройте **«Настройки»** → **«Приватность и защита»** и найдите раздел **«Разрешения»**.",
      "Рядом с пунктом **«Уведомления»** нажмите **«Параметры»**.",
      "Найдите этот сайт в списке и выберите **«Блокировать»**, затем нажмите **«Сохранить изменения»**.",
    ],
  },
  safari: {
    enable: [
      "В меню **Safari** выберите **«Настройки»**.",
      "Откройте вкладку **«Веб-сайты»** и слева выберите **«Уведомления»**.",
      "Найдите этот сайт в списке и выберите **«Разрешить»**.",
      "Вернитесь на сайт и нажмите кнопку ниже.",
    ],
    disable: [
      "В меню **Safari** выберите **«Настройки»**.",
      "Откройте вкладку **«Веб-сайты»** и слева выберите **«Уведомления»**.",
      "Найдите этот сайт в списке и выберите **«Запретить»** (или уберите его из списка).",
    ],
  },
};

export type NotifyConfig = {
  // что включено: окно с предложением и/или иконка (инструкции доступны всегда, пока включено хоть что-то)
  windowEnabled: boolean;
  bellEnabled: boolean;

  // окно «предложение»
  title: string;
  intro: string;
  benefits: string[];
  enableText: string;
  laterText: string;
  note: string;

  // окно «уведомления выключены в браузере»
  blockedTitle: string;
  blockedIntro: string;
  checkText: string;
  stillOffText: string;

  // окно «вы подписаны»
  subscribedTitle: string;
  subscribedIntro: string;
  doneTitle: string;

  // iPhone без иконки на экране «Домой»
  homeTitle: string;
  homeIntro: string;
  homeMoreText: string;

  closeText: string;

  // оформление окна
  color: string;
  textColor: string;
  cardBg: string;
  cardTextColor: string;
  borderRadius: CornerRadius;

  // иконка
  bellLabel: string;
  bellPosition: ButtonPosition;
  bellSize: ButtonSize;
  bellColor: string;
  bellTextColor: string;
  bellRadius: CornerRadius;

  // когда показывать окно и иконку (общий стандарт, см. lib/widget-rules.ts)
  show: ShowRules;
  bellShow: ShowRules;

  guides: Record<GuideKey, GuideSteps>;
};

// Иконка по умолчанию мягче окна: показывается раньше и не прекращается после закрытий
// (она и есть «всегда доступный» вход). Пауза у неё считается от закрытия окна.
export const DEFAULT_BELL_SHOW: ShowRules = {
  delaySeconds: 3,
  minPageViews: 1,
  minTimeOnSiteSeconds: 0,
  pauseHours: 24,
  maxDismissals: 0,
  pagesMode: "all",
  pagePatterns: [],
};

export const DEFAULT_NOTIFY: NotifyConfig = {
  windowEnabled: false,
  bellEnabled: false,

  title: "Не пропустите самое важное",
  intro: "Включите уведомления, и мы сообщим о главном, даже когда сайт закрыт.",
  benefits: ["Статус заказа сразу, без звонков и писем", "Акции и скидки раньше всех", "Только важное, без спама"],
  enableText: "Включить уведомления",
  laterText: "Не сейчас",
  note: "Отключить можно в любой момент",

  blockedTitle: "Уведомления выключены в браузере",
  blockedIntro: "Вы запретили уведомления для этого сайта. Чтобы получать их, включите разрешение в настройках — это займёт минуту.",
  checkText: "Я включил(а)",
  stillOffText: "Пока выключено. Проверьте шаги выше и нажмите ещё раз.",

  subscribedTitle: "Вы подписаны на уведомления",
  subscribedIntro: "Мы присылаем только важное. Если захотите отключить, вот как это сделать на вашем устройстве.",
  doneTitle: "Готово, вы подписаны",

  homeTitle: "Добавьте сайт на экран «Домой»",
  homeIntro: "На iPhone уведомления работают только в приложении с экрана «Домой». Добавьте сайт и откройте его оттуда.",
  homeMoreText: "Показать с картинками",

  closeText: "Закрыть",

  color: "#2c4a66",
  textColor: "#ffffff",
  cardBg: "#ffffff",
  cardTextColor: "#16202a",
  borderRadius: "lg",

  bellLabel: "Уведомления",
  bellPosition: "bottom-right",
  bellSize: "m",
  bellColor: "#2c4a66",
  bellTextColor: "#ffffff",
  bellRadius: "lg",

  show: DEFAULT_SHOW_RULES,
  bellShow: DEFAULT_BELL_SHOW,

  guides: DEFAULT_GUIDES,
};

export const NOTIFY_LIMITS = { benefits: 4, steps: 8, stepLength: 220 } as const;
const HEX = /^#[0-9a-fA-F]{3,8}$/;

function text(raw: unknown, fallback: string, max: number): string {
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, max) : fallback;
}
function color(raw: unknown, fallback: string): string {
  return typeof raw === "string" && HEX.test(raw.trim()) ? raw.trim() : fallback;
}
function lines(raw: unknown, max: number, itemMax: number): string[] | null {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split("\n") : null;
  if (!list) return null;
  return list
    .map((x) => String(x ?? "").trim().slice(0, itemMax))
    .filter(Boolean)
    .slice(0, max);
}

function resolveGuides(raw: unknown): Record<GuideKey, GuideSteps> {
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<GuideKey, Partial<GuideSteps>>>;
  const out = {} as Record<GuideKey, GuideSteps>;
  for (const k of GUIDE_KEYS) {
    const g = src[k] || {};
    const enable = lines(g.enable, NOTIFY_LIMITS.steps, NOTIFY_LIMITS.stepLength);
    const disable = lines(g.disable, NOTIFY_LIMITS.steps, NOTIFY_LIMITS.stepLength);
    out[k] = {
      // пустой список = «ничего не заполнено»: возвращаем стандартный, чтобы окно никогда не было без шагов
      enable: enable && enable.length ? enable : DEFAULT_GUIDES[k].enable,
      disable: k === "iosHome" ? [] : disable && disable.length ? disable : DEFAULT_GUIDES[k].disable,
    };
  }
  return out;
}

export function resolveNotifyConfig(raw: unknown): NotifyConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<NotifyConfig> & Record<string, unknown>;
  const d = DEFAULT_NOTIFY;
  const benefits = lines(c.benefits, NOTIFY_LIMITS.benefits, 80);
  const radius = (v: unknown, f: CornerRadius) => (CORNER_RADIUS_VALUES.includes(v as CornerRadius) ? (v as CornerRadius) : f);
  return {
    windowEnabled: c.windowEnabled === true,
    bellEnabled: c.bellEnabled === true,

    title: text(c.title, d.title, 60),
    intro: text(c.intro, d.intro, 200),
    // список преимуществ можно очистить целиком — тогда блок просто не показывается
    benefits: benefits === null ? d.benefits : benefits,
    enableText: text(c.enableText, d.enableText, 40),
    laterText: text(c.laterText, d.laterText, 30),
    note: typeof c.note === "string" ? c.note.trim().slice(0, 80) : d.note,

    blockedTitle: text(c.blockedTitle, d.blockedTitle, 60),
    blockedIntro: text(c.blockedIntro, d.blockedIntro, 220),
    checkText: text(c.checkText, d.checkText, 40),
    stillOffText: text(c.stillOffText, d.stillOffText, 120),

    subscribedTitle: text(c.subscribedTitle, d.subscribedTitle, 60),
    subscribedIntro: text(c.subscribedIntro, d.subscribedIntro, 220),
    doneTitle: text(c.doneTitle, d.doneTitle, 60),

    homeTitle: text(c.homeTitle, d.homeTitle, 60),
    homeIntro: text(c.homeIntro, d.homeIntro, 220),
    homeMoreText: text(c.homeMoreText, d.homeMoreText, 40),

    closeText: text(c.closeText, d.closeText, 30),

    color: color(c.color, d.color),
    textColor: color(c.textColor, d.textColor),
    cardBg: color(c.cardBg, d.cardBg),
    cardTextColor: color(c.cardTextColor, d.cardTextColor),
    borderRadius: radius(c.borderRadius, d.borderRadius),

    bellLabel: text(c.bellLabel, d.bellLabel, 40),
    bellPosition: BUTTON_POSITIONS.includes(c.bellPosition as ButtonPosition) ? (c.bellPosition as ButtonPosition) : d.bellPosition,
    bellSize: BUTTON_SIZES.includes(c.bellSize as ButtonSize) ? (c.bellSize as ButtonSize) : d.bellSize,
    bellColor: color(c.bellColor, d.bellColor),
    bellTextColor: color(c.bellTextColor, d.bellTextColor),
    bellRadius: radius(c.bellRadius, d.bellRadius),

    show: resolveShowRules(c.show, undefined, d.show),
    // у иконки лимит закрытий не нужен — она не закрывается, пауза считается от закрытия окна
    bellShow: { ...resolveShowRules(c.bellShow, undefined, d.bellShow), maxDismissals: 0 },

    guides: resolveGuides(c.guides),
  };
}
