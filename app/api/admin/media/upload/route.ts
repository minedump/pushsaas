import { NextResponse } from "next/server";
import sharp from "sharp";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyError } from "@/lib/errors";

// Библиотека изображений проекта (см. migration 0081) — свободная загрузка
// картинок для использования в письмах/шаблонах, не привязанных к
// конкретной рассылке. Тот же бакет, что уже держит PWA-иконки
// (lib/manifest.ts), под своим префиксом media/<projectId>/ — только
// добавляем строку метаданных, сам бакет уже public.

export const maxDuration = 30;

const MAX_BYTES = 20 * 1024 * 1024;
const BUCKET = "project-assets";

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
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Файл больше 20 МБ" }, { status: 400 });
  if (!/^image\//.test(file.type)) return NextResponse.json({ error: "Можно загружать только изображения" }, { status: 400 });

  const admin = createAdminClient();
  await ensureBucket(admin);

  const buf = Buffer.from(await file.arrayBuffer());
  // Размеры — best-effort (не блокируем загрузку не-растровых/нестандартных
  // форматов, которые sharp не разберёт, например анимированный webp с
  // экзотическим кодеком) — просто не покажем их в галерее для этого файла.
  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = await sharp(buf).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
  } catch {}

  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `media/${projectId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) return NextResponse.json({ error: friendlyError(uploadError) }, { status: 500 });
  const url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const { data: row, error: dbError } = await admin
    .from("media_assets")
    .insert({
      project_id: projectId,
      name: file.name || "изображение",
      url,
      path,
      size: file.size,
      mime_type: file.type,
      width,
      height,
      created_by: access.user!.id,
    })
    .select("id, name, url, size, mime_type, width, height, created_at, created_by")
    .single();
  if (dbError) {
    await admin.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: friendlyError(dbError) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, asset: row });
}
