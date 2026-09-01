// Логотип проекта допускает SVG (см. app/api/admin/project-logo/upload) —
// отдаётся с того же origin, что и сам апп (self-proxy архитектура, см.
// next.config.mjs), поэтому прямой переход по ссылке на файл исполнит
// вложенный JS в origin приложения (в отличие от <img>, где SVG не
// исполняется). Секьюрити-аудит (2026-09-01): вырезаем реальные векторы —
// <script>, обработчики событий on*, javascript:-ссылки, <foreignObject>
// (несёт произвольный HTML) — до сохранения в бакет. Не полноценный
// XML-парсер, но достаточно для авторизованной (не анонимной) загрузки лого.
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"(?:[^"]*)"/gi, "")
    .replace(/\son\w+\s*=\s*'(?:[^']*)'/gi, "")
    .replace(/(xlink:href|href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "");
}
