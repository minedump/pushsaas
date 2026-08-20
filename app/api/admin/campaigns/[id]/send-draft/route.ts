import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchCampaign, dispatchSmsCampaign, dispatchEmailCampaign, resolveChannelProvider } from "@/lib/sender";
import { hasUnsubscribeTag } from "@/lib/unsubscribeTag";

// Отправляет прямо сейчас ранее сохранённый черновик (status='draft') ИЛИ
// запланированную рассылку (status='scheduled', push — единственный канал,
// который поддерживает планирование), не дожидаясь её времени — довершает
// то, что при обычной отправке делается сразу: резолв провайдера для
// sms/email и вызов dispatch*Campaign. Аудитория — segment_tags И сохранённые
// сырые контакты (migration 0034, поле «Контакты» в форме) — dispatch*Campaign
// сам резолвит campaign.contacts, если явного override не передали (см.
// lib/sender.ts). Используется и из списка «Рассылки» (быстрое действие
// «Отправить»), и со страницы редактирования.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await params;
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  const { data: proj } = await admin.from("projects").select("is_active").eq("id", projectId).single();
  if (!proj?.is_active) {
    const { data: profile } = await admin.from("profiles").select("role").eq("id", access.user!.id).maybeSingle();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Проект заблокирован — пополните баланс" }, { status: 402 });
    }
  }

  const { data: campaign } = await admin
    .from("campaigns")
    .select(
      "id, project_id, channel, status, title, body, subject, html_body, icon_url, image_url, click_url, badge_url, segment_tags, actions, provider, type, template_data, contacts"
    )
    .eq("id", campaignId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Рассылка не найдена" }, { status: 404 });
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    return NextResponse.json({ error: "Эту рассылку уже нельзя отправить повторно" }, { status: 400 });
  }
  // Последний рубеж перед реальной отправкой — на случай, если черновик
  // стал маркетинговым (тумблер переключили) уже после того, как HTML был
  // сохранён без ссылки отписки (см. hasUnsubscribeTag). Статус НЕ трогаем —
  // черновик/план остаётся как есть, можно поправить и повторить.
  if (campaign.channel === "email" && campaign.type === "marketing" && !hasUnsubscribeTag(campaign.html_body || "")) {
    return NextResponse.json({ error: "Добавьте {{ unsubscribe_url }} в письмо — обязательно для маркетинговой рассылки" }, { status: 400 });
  }

  await admin.from("campaigns").update({ status: "sending" }).eq("id", campaignId);

  if (campaign.channel === "sms" || campaign.channel === "email") {
    let provider = campaign.provider as string | null;
    if (!provider) {
      provider = await resolveChannelProvider(admin, projectId, campaign.channel, null, campaign.type);
      if (!provider) {
        await admin.from("campaigns").update({ status: "failed" }).eq("id", campaignId);
        return NextResponse.json({ error: campaign.channel === "sms" ? "SMS не настроен" : "Email не настроен" }, { status: 402 });
      }
      await admin.from("campaigns").update({ provider }).eq("id", campaignId);
    }
    const row = { ...campaign, channel: campaign.channel as "sms" | "email", provider };
    const result = campaign.channel === "sms" ? await dispatchSmsCampaign(row) : await dispatchEmailCampaign(row);
    if (!result.ok) return NextResponse.json({ error: "Ошибка отправки" }, { status: 402 });
    return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
  }

  const result = await dispatchCampaign(campaign);
  if (!result.ok) {
    const msg = result.error === "insufficient balance" ? "Недостаточно баланса" : "Ошибка отправки";
    return NextResponse.json({ error: msg }, { status: 402 });
  }
  return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
}
