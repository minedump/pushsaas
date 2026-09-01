import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyError } from "@/lib/errors";
import { sanitizeSvg } from "@/lib/sanitizeSvg";

// Логотип проекта — один файл на проект, показывается по центру на экране
// входа (app/oidc/[projectId]/auth/route.ts). Тот же бакет, что и PWA-иконки
// (lib/manifest.ts), фиксированный путь БЕЗ расширения в имени — Storage
// определяет тип отдачи по contentType, сохранённому при загрузке, не по
// имени файла, так что смена формата логотипа (например png → svg) просто
// перезаписывает тот же объект (upsert), не оставляя старый файл сиротой.

const MAX_BYTES = 2 * 1024 * 1024;
const BUCKET = "project-assets";
const ALLOWED = /^image\/(png|webp|svg\+xml|jpe?g)$/;

async function ensureBucket(admin: ReturnType<typeof createAdminClient>) {
  await admin.storage.createBucket(BUCKET, { public: true }).catch(() => {});
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart form expected" }, { status: 400 });

  const projectId = String(form.get("projectId") || "");
  const file = form.get("file");

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Выберите файл" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Файл больше 2 МБ" }, { status: 400 });
  if (!ALLOWED.test(file.type)) return NextResponse.json({ error: "Формат: PNG, WebP, SVG или JPG" }, { status: 400 });

  const admin = createAdminClient();
  await ensureBucket(admin);

  let buf = Buffer.from(await file.arrayBuffer());
  // SVG отдаётся с того же origin, что и сам апп — исполняемый вложенный JS
  // (script/on*/javascript:/foreignObject) вырезаем до сохранения, иначе
  // прямой переход по ссылке на файл — stored XSS в origin приложения.
  if (file.type === "image/svg+xml") buf = Buffer.from(sanitizeSvg(buf.toString("utf8")), "utf8");
  const path = `${projectId}/logo`;
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: true,
  });
  if (uploadError) return NextResponse.json({ error: friendlyError(uploadError) }, { status: 500 });

  // upsert перезаписывает тот же путь, но публичный URL закэширован клиентами
  // (браузером, CDN) по старому content — метка версии в query заставляет их
  // забрать свежий файл сразу, а не ждать протухания cacheControl.
  const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const url = `${publicUrl}?v=${Date.now()}`;

  const { error: dbError } = await admin.from("projects").update({ logo_url: url }).eq("id", projectId);
  if (dbError) return NextResponse.json({ error: friendlyError(dbError) }, { status: 500 });

  return NextResponse.json({ ok: true, url });
}

export async function DELETE(req: Request) {
  const { projectId } = await req.json().catch(() => ({}) as { projectId?: string });
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  await admin.storage.from(BUCKET).remove([`${projectId}/logo`]);
  const { error } = await admin.from("projects").update({ logo_url: null }).eq("id", projectId);
  if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });

  return NextResponse.json({ ok: true });
}
