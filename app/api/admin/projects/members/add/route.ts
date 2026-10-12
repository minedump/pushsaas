import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { createAdminClient } from "@/lib/supabase/admin";

// Выдача прав Админа проекта по email. Выдать может владелец или Админ.
// Аккаунт должен уже существовать: приглашений по почте нет (почта не
// подтверждается, любой мог бы занять чужой адрес и забрать приглашение).
export async function POST(req: Request) {
  const { projectId, email } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Укажите email" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const target = email.trim().toLowerCase();

  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("email", target)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json(
      { error: "Пользователь с таким email не найден. Пусть сначала зарегистрируется на странице входа." },
      { status: 404 }
    );
  }

  const { data: project } = await admin.from("projects").select("owner_id").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  if (project.owner_id === profile.id) {
    return NextResponse.json({ error: "Этот пользователь уже владелец проекта" }, { status: 409 });
  }

  const { data: member, error } = await admin
    .from("project_members")
    .insert({ project_id: projectId, user_id: profile.id, role: "admin", invited_by: access.user.id })
    .select("created_at")
    .single();
  if (error?.code === "23505") {
    return NextResponse.json({ error: "У этого пользователя уже есть доступ" }, { status: 409 });
  }
  if (error || !member) {
    return NextResponse.json({ error: "Не удалось выдать доступ" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    member: { userId: profile.id, email: profile.email, name: profile.full_name, createdAt: member.created_at },
  });
}
