// Отдельно от lib/unsubscribe.ts (использует Node "crypto" — только сервер):
// эта проверка чисто на regex, без зависимостей — безопасно импортировать и
// в клиентские компоненты форм (для проверки перед отправкой на сервер), и
// на сервере. Требуется в HTML маркетингового письма ДО рендера Liquid —
// ищем сам тег {{ unsubscribe_url }}, а не готовую ссылку (её ещё нет).
export function hasUnsubscribeTag(html: string): boolean {
  return /\{\{\s*unsubscribe_url\s*\}\}/.test(html);
}
