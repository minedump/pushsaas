import { NextResponse } from "next/server";
import { authenticateApiKeyFull } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiCall } from "@/lib/apiLog";

// POST /api/v1/campaigns/{id}/duplicate — копирует рассылку ЛЮБОГО статуса
// в новый черновик, тот же принцип, что и «Копировать как новую» в разделе
// «Рассылки» (app/api/admin/campaigns/[id]/duplicate) — канал, контент,
// сегмент, контакты, провайдер, шаблон, тип переносятся; время планирования
// и статистика отправки — нет, копия всегда стартует чистым черновиком.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateApiKeyFull(req);
  if (!key) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { projectId } = key;
  const { id: campaignId } = await params;

  const admin = createAdminClient();
  const { data: proj } = await admin.from("projects").select("is_active").eq("id", projectId).single();
  if (!proj?.is_active) return NextResponse.json({ error: "project blocked" }, { status: 402 });

  const { data: source } = await admin
    .from("campaigns")
    .select(
      "channel, title, body, subject, html_body, icon_url, image_url, click_url, badge_url, segment_tags, platforms, actions, provider, type, template_id, template_data, internal_title, contacts"
    )
    .eq("id", campaignId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!source) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  const { data: created, error } = await admin
    .from("campaigns")
    .insert({
      ...source,
      project_id: projectId,
      status: "draft",
      scheduled_at: null,
      initiator: "api",
      internal_title: `Копия — ${source.internal_title || source.title}`,
    })
    .select("id")
    .single();
  if (error || !created) {
    const responseBody = { error: "duplicate failed" };
    await logApiCall(admin, projectId, "campaigns", 500, { sourceId: campaignId }, responseBody);
    return NextResponse.json(responseBody, { status: 500 });
  }

  const responseBody = { ok: true, campaignId: created.id, status: "draft" };
  await logApiCall(admin, projectId, "campaigns", 200, { sourceId: campaignId }, responseBody);
  return NextResponse.json(responseBody);
}
