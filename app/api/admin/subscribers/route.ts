import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Управление подписчиком из раздела «Подписчики»: теги и приостановка/возобновление.
// Приостановка = paused=true — независимый флаг от is_active (тот отражает
// живой ли сам endpoint устройства; paused — просьба владельца отключить
// показ рассылок этому подписчику, не трогая при этом факт валидности устройства).
export async function POST(req: Request) {
  const { projectId, subscriberId, action, tags } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    subscriberId?: string;
    action?: "tags" | "pause" | "resume";
    tags?: string[];
  };

  if (!projectId || !subscriberId || !action) {
    return NextResponse.json({ error: "projectId, subscriberId, action required" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const patch =
    action === "tags"
      ? { tags: Array.isArray(tags) ? tags : [] }
      : action === "pause"
        ? { paused: true }
        : { paused: false };

  const { error } = await admin
    .from("subscribers")
    .update(patch)
    .eq("id", subscriberId)
    .eq("project_id", projectId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
