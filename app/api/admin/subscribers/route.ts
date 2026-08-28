import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertContact } from "@/lib/identity";
import { friendlyError } from "@/lib/errors";

// Управление подписчиком из раздела «Подписчики»: теги, приостановка push и
// активация SMS/Email-канала для рассылок (клик по бейджу в «Каналы»).
// Приостановка = paused=true — независимый флаг от is_active (тот отражает
// живой ли сам endpoint устройства; paused — просьба владельца отключить
// показ рассылок этому подписчику, не трогая при этом факт валидности устройства).
// smsActive/emailActive живут на identities (см. lib/identity.upsertContact) —
// это то же согласие на рассылку, что включается через /api/v1/subscribers.
// tags живут на identities (см. миграцию 0037) — контакт, а не конкретное
// устройство; identityId, а не subscriberId, идентифицирует, чей тег меняем.
export async function POST(req: Request) {
  const { projectId, subscriberId, identityId, action, tags, channel, active, phone, email } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    subscriberId?: string;
    identityId?: string;
    action?: "tags" | "pause" | "resume" | "channel";
    tags?: string[];
    channel?: "sms" | "email";
    active?: boolean;
    phone?: string | null;
    email?: string | null;
  };

  if (!projectId || !action) {
    return NextResponse.json({ error: "projectId, action required" }, { status: 400 });
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

  if (action === "tags") {
    if (!identityId) return NextResponse.json({ error: "identityId required" }, { status: 400 });
    const { error } = await admin
      .from("identities")
      .update({ tags: Array.isArray(tags) ? tags : [] })
      .eq("id", identityId)
      .eq("project_id", projectId);
    if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!subscriberId) return NextResponse.json({ error: "subscriberId required" }, { status: 400 });

  const { error } = await admin
    .from("subscribers")
    .update({ paused: action === "pause" })
    .eq("id", subscriberId)
    .eq("project_id", projectId);

  if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });

  await admin
    .from("push_events")
    .insert({ project_id: projectId, subscriber_id: subscriberId, type: action === "pause" ? "paused" : "resumed" })
    .then(
      () => {},
      () => {}
    );

  return NextResponse.json({ ok: true });
}
