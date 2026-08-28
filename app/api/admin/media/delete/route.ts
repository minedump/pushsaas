import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "project-assets";

// Удаляет и файл(ы) в Storage, и строки метаданных — по отдельности они
// рассинхронизировались бы (осиротевший файл в бакете или битая ссылка в
// галерее), поэтому только через этот route, не прямым delete с клиента.
// Принимает один id или массив — массовое удаление из галереи идёт тем же
// путём, одним запросом, а не N по одному.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { projectId, id, ids } = body as { projectId?: string; id?: string; ids?: string[] };
  const targetIds = ids?.length ? ids : id ? [id] : [];
  if (!projectId || !targetIds.length) return NextResponse.json({ error: "projectId и id(s) обязательны" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const { data: assets } = await admin.from("media_assets").select("id, path").eq("project_id", projectId).in("id", targetIds);
  if (!assets?.length) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  await admin.storage.from(BUCKET).remove(assets.map((a) => a.path));
  await admin
    .from("media_assets")
    .delete()
    .eq("project_id", projectId)
    .in("id", assets.map((a) => a.id));

  return NextResponse.json({ ok: true, deleted: assets.length });
}
