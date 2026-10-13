import { NextResponse } from "next/server";
import sharp from "sharp";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyError } from "@/lib/errors";
import { sanitizeSvg } from "@/lib/sanitizeSvg";

// Своя картинка к шагу инструкции «Установки приложения» (PNG, JPG, WebP или SVG,
// до 2 МБ). Хранится в бакете project-assets рядом с иконками манифеста, в
// папке <projectId>/install/, адрес возвращаем — он ложится в widget_config.install.
// SVG отдаётся с того же origin, что и сам апп, поэтому исполняемое содержимое
// вырезаем до сохранения (см. lib/sanitizeSvg.ts); растровые файлы
// пересобираем через sharp — это заодно убирает метаданные и скрытые данные.

const MAX_BYTES = 2 * 1024 * 1024;
const BUCKET = "project-assets";
const ALLOWED = /^image\/(png|webp|svg\+xml|jpe?g)$/;
const MAX_SIDE = 1400;

// Поверх sanitizeSvg убираем ещё вложения, способные подтянуть чужой контент.
function hardenSvg(svg: string): string {
  return sanitizeSvg(svg)
    .replace(/<!DOCTYPE[\s\S]*?\]>/gi, "")
    .replace(/<!ENTITY[^>]*>/gi, "")
    .replace(/<(iframe|embed|object|audio|video)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(iframe|embed|object|audio|video)\b[^>]*\/?>/gi, "");
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart form expected" }, { status: 400 });

  const projectId = String(form.get("projectId") || "");
  const file = form.get("file");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Выберите файл" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Файл больше 2 МБ, уменьшите картинку" }, { status: 400 });
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (!isSvg && !ALLOWED.test(file.type)) return NextResponse.json({ error: "Подойдёт PNG, JPG, WebP или SVG" }, { status: 400 });

  let buf: Buffer = Buffer.from(await file.arrayBuffer());
  let contentType: string;
  let ext: string;
  try {
    if (isSvg) {
      const text = buf.toString("utf8");
      if (!/<svg[\s>]/i.test(text)) return NextResponse.json({ error: "Не похоже на SVG-файл" }, { status: 400 });
      buf = Buffer.from(hardenSvg(text), "utf8");
      contentType = "image/svg+xml";
      ext = "svg";
    } else {
      const img = sharp(buf).rotate();
      const meta = await img.metadata();
      if (!meta.width || !meta.height) return NextResponse.json({ error: "Не удалось прочитать картинку" }, { status: 400 });
      const resized = img.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
      if (meta.format === "png") {
        buf = await resized.png({ palette: true, quality: 90, effort: 8, compressionLevel: 9 }).toBuffer();
        contentType = "image/png";
        ext = "png";
      } else if (meta.format === "webp") {
        buf = await resized.webp({ quality: 88 }).toBuffer();
        contentType = "image/webp";
        ext = "webp";
      } else {
        buf = await resized.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
        contentType = "image/jpeg";
        ext = "jpg";
      }
    }
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать картинку: проверьте файл" }, { status: 400 });
  }

  const admin = createAdminClient();
  await admin.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const path = `${projectId}/install/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, { contentType, cacheControl: "31536000", upsert: false });
  if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });

  return NextResponse.json({ ok: true, url: admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
}
