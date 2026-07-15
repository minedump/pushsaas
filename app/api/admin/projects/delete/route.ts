import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Удаление проекта. RLS-политики delete на projects нет намеренно —
// удаление идёт только через этот роут с проверкой владения.
// FK-каскады снесут подписчиков, кампании, identity-слой и секреты.
export async function POST(req: Request) {
  const { projectId } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  // иконки манифеста в Storage — best-effort, БД важнее
  try {
    const { data: files } = await admin.storage.from("project-assets").list(projectId);
    if (files?.length) {
      await admin.storage.from("project-assets").remove(files.map((f) => `${projectId}/${f.name}`));
    }
  } catch {}

  const { error } = await admin.from("projects").delete().eq("id", projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
