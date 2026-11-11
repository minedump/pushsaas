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
};

export function eventLabel(name: string): string {
  if (EVENT_LABEL[name]) return EVENT_LABEL[name];
  if (name.endsWith("_added")) return `Добавил в «${name.slice(0, -6)}»`;
  if (name.endsWith("_removed")) return `Убрал из «${name.slice(0, -8)}»`;
  return `Событие «${name}»`;
}
