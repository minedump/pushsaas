import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Отзыв прав Админа (или выход самого Админа из проекта). Забрать может
// владелец или любой Админ. Владельца лишить доступа нельзя.
export async function POST(req: Request) {
  const { projectId, userId } = await req.json().catch(() => ({}));
  if (!projectId || !userId) return NextResponse.json({ error: "projectId and userId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  const { data: project } = await admin.from("projects").select("owner_id").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  if (project.owner_id === userId) {
    return NextResponse.json({ error: "Владельца нельзя лишить доступа" }, { status: 403 });
  }

  const { data: removed, error } = await admin
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("id");
  if (error) return NextResponse.json({ error: "Не удалось забрать доступ" }, { status: 500 });
  if (!removed?.length) return NextResponse.json({ error: "У пользователя нет доступа к проекту" }, { status: 404 });

  return NextResponse.json({ ok: true, left: userId === access.user.id });
}
