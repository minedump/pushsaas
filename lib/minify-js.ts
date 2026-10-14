import { createHash } from "node:crypto";
import { minify } from "terser";

// Скрипты, которые уходят на сайты клиентов (/embed/*.js), собираются на
// сервере из шаблонов с русскими комментариями — в выдачу они попадать не
// должны: комментарии называют внутренние файлы, таблицы и миграции.
// Поэтому ответ пропускается через минификатор: комментарии вырезаются,
// локальные имена сокращаются, код сжимается в одну строку. Публичный API
// (window.sendera.*) и адреса /api/public/* остаются как есть — они нужны
// самому скрипту.
//
// Результат кэшируется по хешу исходного текста: проекту с неизменённой
// конфигурацией скрипт собирается один раз на процесс.
const CACHE_MAX = 200;
const cache = new Map<string, string>();

export async function minifyJs(code: string): Promise<string> {
  const key = createHash("sha1").update(code).digest("hex");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  try {
    const out = await minify(code, {
      compress: { passes: 2 },
      mangle: true,
      format: { comments: false },
    });
    if (!out.code) throw new Error("empty minifier output");
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, out.code);
    return out.code;
  } catch (e) {
    // сбой минификатора не должен ронять виджет на живых сайтах — отдаём как есть
    console.error("[minify-js] failed, serving unminified:", e instanceof Error ? e.message : e);
    return code;
  }
}
