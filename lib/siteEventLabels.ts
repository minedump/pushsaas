// Человеко-читаемые подписи для сырых имён трекинг-событий (window.sendera.event) —
// см. EventTrackingDocs.tsx, тот же список принципов. Общие для карточки контакта и карточки устройства.
export const EVENT_LABEL: Record<string, string> = {
  cart_updated: "Обновил корзину",
  favorite_updated: "Обновил избранное",
  product_viewed: "Посмотрел товар",
  category_viewed: "Посмотрел категорию",
  checkout_started: "Начал оформление",
  widget_button_shown: "Показ кнопки подписки",
  widget_button_clicked: "Клик по кнопке подписки",
  widget_button_dismissed: "Закрыл кнопку подписки",
  widget_prompt_shown: "Показ плашки подписки",
  widget_prompt_clicked: "Клик «Разрешить» на плашке",
  widget_prompt_dismissed: "Закрыл плашку подписки",
  widget_install_opened: "Открыл инструкцию по установке",
  widget_install_platform: "Переключил платформу в инструкции",
  widget_install_done: "Нажал «Готово» в инструкции",
  // окно уведомлений и иконка-колокольчик (lib/notify-widget.ts)
  widget_notify_opened: "Показ окна уведомлений",
  widget_notify_enable_clicked: "Клик «Включить» в окне уведомлений",
  widget_notify_dismissed: "Закрыл окно уведомлений",
  widget_notify_result: "Ответ на запрос уведомлений",
  widget_notify_check_clicked: "Клик «Проверить» в инструкции включения",
  widget_notify_platform: "Переключил устройство в окне уведомлений",
  widget_notify_bell_shown: "Показ иконки уведомлений",
  widget_notify_bell_clicked: "Клик по иконке уведомлений",
};

// Расшифровка параметров событий виджетов для карточек клиента: какой экран, откуда открыто,
// чем закрыто, что ответил. Для остальных событий — пустая строка.
const NOTIFY_VIEW: Record<string, string> = {
  offer: "предложение подписаться",
  blocked: "как включить",
  subscribed: "как отключить",
  home: "iPhone вне «Домой»",
  unsupported: "браузер не поддерживает",
};
const NOTIFY_VIA: Record<string, string> = {
  auto: "само по правилам показа",
  bell: "по иконке",
  url: "по ссылке",
  api: "из кода сайта",
  preview: "предпросмотр из админки",
  x: "крестиком",
  later: "«Не сейчас»",
  esc: "клавишей Esc",
  overlay: "кликом мимо окна",
};
const NOTIFY_RESULT: Record<string, string> = {
  granted: "разрешил",
  denied: "запретил",
  dismissed: "закрыл запрос без ответа",
};
const PLATFORM: Record<string, string> = { ios: "iPhone", android: "Android", chrome: "Chrome", firefox: "Firefox", safari: "Safari" };

export function widgetEventDetail(name: string, payload: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (name === "widget_notify_opened" || name === "widget_notify_dismissed") {
    const parts = [NOTIFY_VIEW[str(payload.view)], NOTIFY_VIA[str(payload.via)]].filter(Boolean);
    return parts.join(", ");
  }
  if (name === "widget_notify_result") return NOTIFY_RESULT[str(payload.result)] || "";
  if (name === "widget_notify_platform" || name === "widget_install_platform" || name === "widget_install_done" || name === "widget_install_opened") {
    return PLATFORM[str(payload.platform)] || "";
  }
  return "";
}

export function eventLabel(name: string): string {
  if (EVENT_LABEL[name]) return EVENT_LABEL[name];
  if (name.endsWith("_added")) return `Добавил в «${name.slice(0, -6)}»`;
  if (name.endsWith("_removed")) return `Убрал из «${name.slice(0, -8)}»`;
  return `Событие «${name}»`;
}
