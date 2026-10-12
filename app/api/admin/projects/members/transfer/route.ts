import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";

// Передача проекта одному из его Админов. Все проверки (кто вправе передавать,
// что получатель уже Админ) внутри SQL-функции transfer_project_ownership,
// там же прежний владелец становится Админом, всё одной транзакцией.
export async function POST(req: Request) {
  const { projectId, userId } = await req.json().catch(() => ({}));
  if (!projectId || !userId) return NextResponse.json({ error: "projectId and userId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_project_ownership", {
    p_project_id: projectId,
    p_new_owner: userId,
  });
  if (error) return NextResponse.json({ error: friendlyError(error, "Не удалось передать проект") }, { status: 403 });

  return NextResponse.json({ ok: true });
}
