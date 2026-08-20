import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Копирует рассылку ЛЮБОГО статуса (черновик/запланированная/отправленная/
// с ошибкой) в новый черновик — тот же канал, контент, сегмент, контакты,
// провайдер, шаблон, тип. НЕ копируются: время планирования и вся
// статистика отправки (sent/delivered/failed/clicked, sent_at) — копия
// всегда стартует как чистый черновик, а не повторяет прошлое расписание
// или счётчики исходной кампании. internal_title копии всегда переписан,
// чтобы копию было видно в списке «Рассылки» с первого взгляда — реального
// содержимого сообщения (title/body/subject/html_body) это не касается.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await params;
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  const { data: source } = await admin
    .from("campaigns")
    .select(
      "channel, title, body, subject, html_body, icon_url, image_url, click_url, badge_url, segment_tags, actions, provider, type, template_id, template_data, internal_title, contacts"
    )
    .eq("id", campaignId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!source) return NextResponse.json({ error: "Рассылка не найдена" }, { status: 404 });

  const { data: created, error } = await admin
    .from("campaigns")
    .insert({
      ...source,
      project_id: projectId,
      status: "draft",
      scheduled_at: null,
      created_by: access.user!.id,
      initiator: "manual",
      internal_title: `Копия — ${source.internal_title || source.title}`,
    })
    .select("id")
    .single();
  if (error || !created) return NextResponse.json({ error: "Ошибка копирования" }, { status: 500 });

  return NextResponse.json({ ok: true, id: created.id });
}
