import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertContact } from "@/lib/identity";

// Управление подписчиком из раздела «Подписчики»: теги, приостановка push и
// активация SMS/Email-канала для рассылок (клик по бейджу в «Каналы»).
// Приостановка = paused=true — независимый флаг от is_active (тот отражает
// живой ли сам endpoint устройства; paused — просьба владельца отключить
// показ рассылок этому подписчику, не трогая при этом факт валидности устройства).
// smsActive/emailActive живут на identities (см. lib/identity.upsertContact) —
// это то же согласие на рассылку, что включается через /api/v1/contacts.
export async function POST(req: Request) {
  const { projectId, subscriberId, action, tags, channel, active, phone, email } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    subscriberId?: string;
    action?: "tags" | "pause" | "resume" | "channel";
    tags?: string[];
    channel?: "sms" | "email";
    active?: boolean;
    phone?: string | null;
    email?: string | null;
  };

  if (!projectId || !subscriberId || !action) {
    return NextResponse.json({ error: "projectId, subscriberId, action required" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  if (action === "channel") {
    if (channel !== "sms" && channel !== "email") return NextResponse.json({ error: "channel required" }, { status: 400 });
    const contact = channel === "sms" ? { phone } : { email };
    if (!contact.phone && !contact.email) return NextResponse.json({ error: "нет контакта для этого канала" }, { status: 400 });
    const result = await upsertContact(projectId, { ...contact, [channel === "sms" ? "smsActive" : "emailActive"]: !!active });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

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

  if (action === "pause" || action === "resume") {
    await admin
      .from("push_events")
      .insert({ project_id: projectId, subscriber_id: subscriberId, type: action === "pause" ? "paused" : "resumed" })
      .then(
        () => {},
        () => {}
      );
  }

  return NextResponse.json({ ok: true });
}
