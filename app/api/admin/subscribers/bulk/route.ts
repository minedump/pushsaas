import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logFieldChanges } from "@/lib/identity";
import { friendlyError } from "@/lib/errors";

// Массовые действия над выбранными в таблице «Подписчики» контактами —
// один запрос на весь выбор, а не N запросов на клиенте (масштаб — реальный
// список клиентов мерчанта, не 3-4 тестовых записи). identityIds всегда
// пересекается с project_id — так выбор с одной страницы не может задеть
// чужой проект, даже если id подделать в запросе.
export async function POST(req: Request) {
  const { projectId, identityIds, action, tag, channel, active } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    identityIds?: string[];
    action?: "delete" | "tag_add" | "tag_remove" | "channel";
    tag?: string;
    channel?: "sms" | "email";
    active?: boolean;
  };
  if (!projectId || !Array.isArray(identityIds) || !identityIds.length || !action) {
    return NextResponse.json({ error: "projectId, identityIds, action required" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const { data: owned } = await admin.from("identities").select("id").eq("project_id", projectId).in("id", identityIds);
  const ids = (owned ?? []).map((r) => r.id);
  if (!ids.length) return NextResponse.json({ ok: true, affected: 0 });

  if (action === "delete") {
    // Та же семантика, что и у одиночного удаления (lib/identity.deleteContact):
    // только сама identity — привязанные push-устройства остаются, просто
    // без контактных данных.
    const { error } = await admin.from("identities").delete().in("id", ids);
    if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });
    return NextResponse.json({ ok: true, affected: ids.length });
  }

  if (action === "channel") {
    if (channel !== "sms" && channel !== "email") return NextResponse.json({ error: "channel required" }, { status: 400 });
    const col = channel === "sms" ? "sms_marketing_active_at" : "email_marketing_active_at";
    const now = new Date().toISOString();
    const { data: rows } = await admin.from("identities").select("id, phone, email").in("id", ids);
    const { error } = await admin
      .from("identities")
      .update({ [col]: active ? now : null, updated_at: now })
      .in("id", ids);
    if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });
    // Тот же журнал событий, что и у одиночного переключения канала (см.
    // logChannelEvents в lib/identity.ts) — best-effort, не блокирует ответ.
    const events = (rows ?? [])
      .map((r) => ({ project_id: projectId, identity_id: r.id, channel, active: !!active, contact: channel === "sms" ? r.phone : r.email }))
      .filter((e) => e.contact) as { project_id: string; identity_id: string; channel: "sms" | "email"; active: boolean; contact: string }[];
    if (events.length) await admin.from("identity_channel_events").insert(events).then(() => {}, () => {});
    return NextResponse.json({ ok: true, affected: ids.length });
  }

  if (action === "tag_add" || action === "tag_remove") {
    const t = (tag || "").trim().toLowerCase();
    if (!t) return NextResponse.json({ error: "tag required" }, { status: 400 });
    const { data: rows } = await admin.from("identities").select("id, tags").in("id", ids);
    for (const r of rows ?? []) {
      const current = (r.tags as string[]) || [];
      const has = current.includes(t);
      if (action === "tag_add" && has) continue;
      if (action === "tag_remove" && !has) continue;
      const next = action === "tag_add" ? [...current, t] : current.filter((x) => x !== t);
      await admin.from("identities").update({ tags: next }).eq("id", r.id);
      logFieldChanges(admin, projectId, r.id, { tags: current }, { tags: next });
    }
    return NextResponse.json({ ok: true, affected: ids.length });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
