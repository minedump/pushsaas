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

// Для предпросмотра: каждая ссылка заменяется условной короткой («рыбой») вида clck.ru/Ab3dE9, как она будет
// выглядеть в SMS. Код псевдослучайный, но для одной и той же ссылки всегда один и тот же (чтобы текст не
// «прыгал» при перерисовке). Настоящий код выдаст clck.ru в момент отправки.
export function previewShortLinks(text: string): { text: string; replaced: boolean } {
  const urls = text.match(/https?:\/\/[^\s"'<>]+/g);
  if (!urls?.length) return { text, replaced: false };
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const fakeCode = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += alphabet[h % alphabet.length];
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    }
    return code;
  };
  let result = text;
  for (const url of new Set(urls)) result = result.split(url).join(`clck.ru/${fakeCode(url)}`);
  return { text: result, replaced: true };
}

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
