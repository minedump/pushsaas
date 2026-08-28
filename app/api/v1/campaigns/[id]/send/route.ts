import { NextResponse } from "next/server";
import { authenticateApiKeyFull } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchCampaign, dispatchSmsCampaign, dispatchEmailCampaign, resolveChannelProvider, enqueueWindowedCampaign } from "@/lib/sender";
import { hasUnsubscribeTag } from "@/lib/unsubscribe";
import { logApiCall } from "@/lib/apiLog";

// POST /api/v1/campaigns/{id}/send — отправляет прямо сейчас ранее
// сохранённый черновик или запланированную рассылку (любым способом
// созданную — вручную или через API), не дожидаясь её времени. Тот же путь,
// что и кнопка «Отправить» у черновика в разделе «Рассылки» —
// app/api/admin/campaigns/[id]/send-draft.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateApiKeyFull(req);
  if (!key) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { projectId } = key;
  const { id: campaignId } = await params;

  const admin = createAdminClient();
  const { data: proj } = await admin.from("projects").select("is_active").eq("id", projectId).single();
  if (!proj?.is_active) return NextResponse.json({ error: "project blocked" }, { status: 402 });

  const { data: campaign } = await admin
    .from("campaigns")
    .select(
      "id, project_id, channel, status, title, body, subject, html_body, icon_url, image_url, click_url, badge_url, segment_tags, platforms, actions, provider, type, template_data, contacts, send_window_enabled, send_days, send_time_from, send_time_to, send_window_subscriber_tz, spacing_enabled, spacing_minutes"
    )
    .eq("id", campaignId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    return NextResponse.json({ error: "this campaign was already sent" }, { status: 400 });
  }
  if (campaign.channel === "email" && campaign.type === "marketing" && !hasUnsubscribeTag(campaign.html_body || "")) {
    return NextResponse.json({ error: "unsubscribe link required" }, { status: 400 });
  }

  await admin.from("campaigns").update({ status: "sending" }).eq("id", campaignId);

  if (campaign.channel === "sms" || campaign.channel === "email") {
    let provider = campaign.provider as string | null;
    if (!provider) {
      provider = await resolveChannelProvider(admin, projectId, campaign.channel, null, campaign.type);
      if (!provider) {
        await admin.from("campaigns").update({ status: "failed", error: "provider not configured" }).eq("id", campaignId);
        const responseBody = { error: "provider not configured" };
        await logApiCall(admin, projectId, "campaigns", 402, { campaignId }, responseBody);
        return NextResponse.json(responseBody, { status: 402 });
      }
      await admin.from("campaigns").update({ provider }).eq("id", campaignId);
    }
    if (campaign.send_window_enabled || campaign.spacing_enabled) {
      const r = await enqueueWindowedCampaign({ ...campaign, provider }, undefined);
      const responseBody = { ok: r.ok, campaignId, delivered: 0, failed: 0, total: r.enqueued };
      await logApiCall(admin, projectId, "campaigns", r.ok ? 200 : 402, { campaignId }, responseBody);
      return NextResponse.json(responseBody);
    }
    const row = { ...campaign, channel: campaign.channel as "sms" | "email", provider };
    const result = campaign.channel === "sms" ? await dispatchSmsCampaign(row) : await dispatchEmailCampaign(row);
    const httpStatus = result.ok ? 200 : 402;
    const responseBody = result.ok
      ? { ok: true, campaignId, delivered: result.delivered, failed: result.failed, total: result.total }
      : { error: result.error };
    await logApiCall(admin, projectId, "campaigns", httpStatus, { campaignId }, responseBody);
    return NextResponse.json(responseBody, { status: httpStatus });
  }

  if (campaign.send_window_enabled || campaign.spacing_enabled) {
    const r = await enqueueWindowedCampaign({ ...campaign, channel: "push" }, undefined);
    const responseBody = { ok: r.ok, campaignId, delivered: 0, failed: 0, total: r.enqueued };
    await logApiCall(admin, projectId, "campaigns", r.ok ? 200 : 402, { campaignId }, responseBody);
    return NextResponse.json(responseBody);
  }

  const result = await dispatchCampaign(campaign);
  const httpStatus = result.ok ? 200 : 402;
  const responseBody = result.ok
    ? { ok: true, campaignId, delivered: result.delivered, failed: result.failed, total: result.total }
    : { error: result.error };
  await logApiCall(admin, projectId, "campaigns", httpStatus, { campaignId }, responseBody);
  return NextResponse.json(responseBody, { status: httpStatus });
}
