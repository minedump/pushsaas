// При реальной отправке (см. lib/sender.ts) каждая http(s)-ссылка в тексте
// SMS/push заменяется на короткую через clck.ru (lib/clck.ts) — здесь
// оцениваем итоговую длину ДО отправки, чтобы счётчик символов в форме
// показывал, сколько реально уйдёт получателю, а не длину ещё-не-сокращённой
// ссылки. 24 — оценка длины типичной ссылки clck.ru (https://clck.ru/XXXXXXX);
// не точное значение (зависит от ответа сервиса и не считается на клиенте),
// а ближайшая разумная оценка для счётчика.
// В SMS ссылка уходит без «https://» (clck.ru/XXXXXX, 14–15 символов): телефоны всё равно делают её
// кликабельной, а в сегмент SMS (70 символов кириллицей) умещается на 8 символов больше. В push ссылка
// остаётся с протоколом.
const SHORT_LINK_LENGTH = 24;
const SHORT_LINK_LENGTH_SMS = 15;

export function withShortenedLinks(text: string, channel: "push" | "sms" = "push"): string {
  const urls = text.match(/https?:\/\/[^\s"'<>]+/g);
  if (!urls?.length) return text;
  const placeholder = "x".repeat(channel === "sms" ? SHORT_LINK_LENGTH_SMS : SHORT_LINK_LENGTH);
  let result = text;
  for (const url of new Set(urls)) {
    result = result.split(url).join(placeholder);
  }
  return result;
}
