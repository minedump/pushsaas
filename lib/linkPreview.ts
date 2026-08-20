// При реальной отправке (см. lib/sender.ts) каждая http(s)-ссылка в тексте
// SMS/push заменяется на короткую через clck.ru (lib/clck.ts) — здесь
// оцениваем итоговую длину ДО отправки, чтобы счётчик символов в форме
// показывал, сколько реально уйдёт получателю, а не длину ещё-не-сокращённой
// ссылки. 24 — оценка длины типичной ссылки clck.ru (https://clck.ru/XXXXXXX);
// не точное значение (зависит от ответа сервиса и не считается на клиенте),
// а ближайшая разумная оценка для счётчика.
const SHORT_LINK_LENGTH = 24;
const SHORT_LINK_PLACEHOLDER = "x".repeat(SHORT_LINK_LENGTH);

export function withShortenedLinks(text: string): string {
  const urls = text.match(/https?:\/\/[^\s"'<>]+/g);
  if (!urls?.length) return text;
  let result = text;
  for (const url of new Set(urls)) {
    result = result.split(url).join(SHORT_LINK_PLACEHOLDER);
  }
  return result;
}
