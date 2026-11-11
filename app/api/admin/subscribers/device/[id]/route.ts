import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseTimezone, parseYmClientId } from "@/lib/shopFields";

// Ручная правка устройства без контакта (анонимный подписчик из раздела «Подписчики»).
//
// Меняется только то, что принадлежит самому устройству: имя (для подстановки {name} в push),
// часовой пояс и ClientID Метрики. Телефон, email и теги принадлежат контакту, а привязать
// устройство к контакту вручную нельзя намеренно: привязка даёт устройству доступ к кодам входа этого
// контакта (код уходит push-ом на привязанные устройства), поэтому она создаётся только входом по коду.
// Значения: undefined — не менять, пустая строка или null — очистить.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { projectId, name, timezone, ymClientId } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    name?: string | null;
    timezone?: string | null;
    ymClientId?: string | null;
  };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const { data: device } = await admin.from("subscribers").select("id, attributes").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (!device) return NextResponse.json({ error: "Устройство не найдено" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (timezone !== undefined) {
    if (timezone === null || String(timezone).trim() === "") patch.timezone = null;
    else {
      const tz = parseTimezone(timezone);
      if (!tz) return NextResponse.json({ error: "Часовой пояс: укажите название IANA, например Europe/Moscow" }, { status: 400 });
      patch.timezone = tz;
    }
  }

  const attrs = { ...(((device.attributes as Record<string, unknown> | null) ?? {}) as Record<string, unknown>) };
  let attrsChanged = false;
  if (ymClientId !== undefined) {
    if (ymClientId === null || String(ymClientId).trim() === "") delete attrs.ym_client_id;
    else {
      const ym = parseYmClientId(ymClientId);
      if (!ym) return NextResponse.json({ error: "UUID метрики: 5–64 символа, буквы, цифры, «_» и «-»" }, { status: 400 });
      attrs.ym_client_id = ym;
    }
    attrsChanged = true;
  }
  if (name !== undefined) {
    const n = String(name ?? "").trim().slice(0, 120);
    if (n) attrs.name = n;
    else delete attrs.name;
    attrsChanged = true;
  }
  if (attrsChanged) patch.attributes = attrs;

  if (Object.keys(patch).length) await admin.from("subscribers").update(patch).eq("id", id);
  return NextResponse.json({ ok: true });
}
