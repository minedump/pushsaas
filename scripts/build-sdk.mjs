// Собирает публичный service-worker.js из исходника sdk-src/service-worker.js:
// без комментариев, с сокращёнными именами, в одну строку. Исходник с
// комментариями остаётся только в репозитории, наружу уходит результат.
// Запускается автоматически перед `npm run build` (см. prebuild в package.json).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "sdk-src", "service-worker.js"), "utf8");

const out = await minify(src, {
  compress: { passes: 2 },
  mangle: true,
  format: { comments: false },
});
if (!out.code) throw new Error("build-sdk: minifier returned empty output");

// без этих двух обработчиков файл бесполезен — защита от случайной порчи сборки
for (const needle of ['"push"', '"notificationclick"']) {
  if (!out.code.includes(needle)) throw new Error(`build-sdk: ${needle} handler missing in output`);
}

const dest = join(root, "public", "sdk", "service-worker.js");
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, out.code + "\n");
console.log(`build-sdk: ${dest} (${out.code.length} bytes)`);
