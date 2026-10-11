import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyError } from "@/lib/errors";

// Удаление проекта. RLS-политики delete на projects нет намеренно —
// удаление идёт только через этот роут с проверкой владения.
// FK-каскады снесут подписчиков, кампании, identity-слой и секреты.
export async function POST(req: Request) {
  const { projectId } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  // Доступ к проекту есть и у Админов, а удалять может только владелец
  // (и администратор платформы).
  const [{ data: owned }, { data: profile }] = await Promise.all([
    admin.from("projects").select("owner_id").eq("id", projectId).maybeSingle(),
    admin.from("profiles").select("role").eq("id", access.user.id).maybeSingle(),
  ]);
  if (owned?.owner_id !== access.user.id && profile?.role !== "admin") {
    return NextResponse.json({ error: "Удалить проект может только владелец" }, { status: 403 });
  }

  // иконки манифеста в Storage — best-effort, БД важнее
  try {
    const { data: files } = await admin.storage.from("project-assets").list(projectId);
    if (files?.length) {
      await admin.storage.from("project-assets").remove(files.map((f) => `${projectId}/${f.name}`));
    }
  } catch {}

  const { error } = await admin.from("projects").delete().eq("id", projectId);
  if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });

  return NextResponse.json({ ok: true });
}
