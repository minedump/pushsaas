import { NextResponse } from "next/server";
import sharp from "sharp";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { generateManifestAssets, buildManifestJson, buildHeadSnippet } from "@/lib/manifest";

// Генерация PWA-манифеста: multipart-форма { projectId, name, shortName,
// themeColor, icon (PNG/JPG, квадрат, рекомендовано 512×512, БЕЗ скруглений) }.
// Возвращает содержимое site.webmanifest + сниппет для <head> + ссылки на иконки.

export const maxDuration = 30; // sharp-обработка 5 изображений

const MAX_ICON_BYTES = 3 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart form expected" }, { status: 400 });

  const projectId = String(form.get("projectId") || "");
  const name = String(form.get("name") || "").trim();
  const shortName = String(form.get("shortName") || "").trim();
  const themeColor = String(form.get("themeColor") || "").trim();
  const icon = form.get("icon");

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  if (!name || name.length > 60) return NextResponse.json({ error: "Укажите название (до 60 символов)" }, { status: 400 });
  if (!shortName || shortName.length > 15) {
    return NextResponse.json({ error: "Короткое название — до 15 символов (подпись под иконкой)" }, { status: 400 });
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(themeColor)) {
    return NextResponse.json({ error: "Цвет темы — hex вида #2c4a66" }, { status: 400 });
  }
  if (!(icon instanceof File) || !icon.size) {
    return NextResponse.json({ error: "Загрузите иконку (PNG или JPG)" }, { status: 400 });
  }
  if (icon.size > MAX_ICON_BYTES) {
    return NextResponse.json({ error: "Иконка больше 3 МБ — уменьшите файл" }, { status: 400 });
  }
  if (!/^image\/(png|jpe?g|webp)$/.test(icon.type)) {
    return NextResponse.json({ error: "Формат: PNG, JPG или WebP" }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await icon.arrayBuffer());

    // размер исходника: совсем маленький — отказ (из него не собрать даже 192),
    // меньше 512 — генерируем, но предупреждаем, что крупные иконки выйдут размытыми
    const meta = await sharp(buf).metadata().catch(() => null);
    if (!meta?.width || !meta?.height) {
      return NextResponse.json({ error: "Не удалось прочитать картинку — проверьте файл" }, { status: 400 });
    }
    const side = Math.min(meta.width, meta.height);
    if (side < 192) {
      return NextResponse.json(
        { error: `Иконка слишком маленькая (${meta.width}×${meta.height}). Нужен квадрат от 512×512, минимум 192×192` },
        { status: 400 }
      );
    }
    const warning =
      side < 512
        ? `Иконка ${meta.width}×${meta.height} меньше 512×512 — крупные иконки получатся размытыми. Лучше загрузить квадрат от 512×512`
        : undefined;

    const config = await generateManifestAssets(projectId, buf, { name, shortName, themeColor });
    return NextResponse.json({
      ok: true,
      manifest: buildManifestJson(config),
      headSnippet: buildHeadSnippet(config),
      icons: config.icons,
      warning,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
