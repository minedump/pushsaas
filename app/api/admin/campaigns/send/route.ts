import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchCampaign, insertCampaign } from "@/lib/sender";

// Compose + send now, or schedule for later.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { projectId, title, message, icon, image, url, segmentTags, scheduledAt, actions } = body as {
    projectId?: string;
    title?: string;
    message?: string;
    icon?: string;
    image?: string;
    url?: string;
    segmentTags?: string[];
    scheduledAt?: string;
    actions?: { title: string; url: string }[];
  };

  if (!projectId || !title?.trim() || !message?.trim()) {
    return NextResponse.json({ error: "Заполните заголовок и текст" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  // blocked (unpaid) projects can't send — superadmin bypasses
  const { data: proj } = await admin.from("projects").select("is_active").eq("id", projectId).single();
  if (!proj?.is_active) {
    const { data: profile } = await admin.from("profiles").select("role").eq("id", access.user!.id).maybeSingle();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Проект заблокирован — пополните баланс" }, { status: 402 });
    }
  }

  const scheduled = scheduledAt && new Date(scheduledAt).getTime() > Date.now();

  const campaign = await insertCampaign(admin, {
    project_id: projectId,
    title: title.trim(),
    body: message.trim(),
    icon_url: icon || null,
    image_url: image || null,
    click_url: url || null,
    segment_tags: segmentTags || [],
    actions: Array.isArray(actions) ? actions.filter((a) => a.title?.trim() && a.url?.trim()).slice(0, 2) : [],
    status: scheduled ? "scheduled" : "sending",
    scheduled_at: scheduled ? scheduledAt : null,
    created_by: access.user!.id,
  });

  if (!campaign) {
    return NextResponse.json({ error: "Ошибка создания кампании" }, { status: 500 });
  }

  if (scheduled) {
    return NextResponse.json({ scheduled: true, at: scheduledAt });
  }

  const result = await dispatchCampaign(campaign);
  if (!result.ok) {
    const msg = result.error === "insufficient balance" ? "Недостаточно баланса" : "Ошибка отправки";
    return NextResponse.json({ error: msg }, { status: 402 });
  }
  return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
}
