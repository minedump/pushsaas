// При реальной отправке (см. lib/sender.ts) каждая http(s)-ссылка в тексте
// SMS/push заменяется на короткую через clck.ru (lib/clck.ts) — здесь
// оцениваем итоговую длину ДО отправки, чтобы счётчик символов в форме
// показывал, сколько реально уйдёт получателю, а не длину ещё-не-сокращённой
// ссылки. 15 — оценка длины ссылки clck.ru без протокола (clck.ru/XXXXXXX);
// не точное значение (зависит от ответа сервиса и не считается на клиенте),
// а ближайшая разумная оценка для счётчика.
// Сокращённая ссылка везде уходит без «https://» (clck.ru/XXXXXX, 14–15 символов): телефоны всё равно
// делают её кликабельной, а текст короче на 8 символов (в сегмент SMS кириллицей входит 70 символов).
const SHORT_LINK_LENGTH = 15;

export function withShortenedLinks(text: string): string {
  const urls = text.match(/https?:\/\/[^\s"'<>]+/g);
  if (!urls?.length) return text;
  const placeholder = "x".repeat(SHORT_LINK_LENGTH);
  let result = text;
  for (const url of new Set(urls)) {
    result = result.split(url).join(placeholder);
  }
  return result;
}
