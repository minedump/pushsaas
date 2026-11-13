import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import EditCampaignForm from "./edit/EditCampaignForm";

// Просмотр уже отправленной (или отправляемой, неудачной, отменённой) рассылки: та же форма, что у черновика,
// но все настройки заблокированы и показаны такими, с какими рассылка уходила. Менять можно только название.
// Черновик и запланированная рассылка редактируются на странице /edit.
export default async function CampaignViewPage({ params }: { params: Promise<{ id: string; campaignId: string }> }) {
  const { id, campaignId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, is_active, timezone").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { data: campaign } = await supabase
    .from("campaigns")
    .select(
      "id, channel, status, title, body, subject, html_body, icon_url, image_url, click_url, badge_url, segment_tags, platforms, actions, type, template_id, scheduled_at, internal_title, template_data, contacts, provider, send_window_enabled, send_days, send_time_from, send_time_to, send_window_subscriber_tz, spacing_enabled, spacing_minutes, initiator, created_at, sent_at, sent_count, delivered_count, failed_count, clicked_count, confirmed_count, unsubscribed_count, error"
    )
    .eq("id", campaignId)
    .eq("project_id", id)
    .maybeSingle();
  if (!campaign) notFound();
  if (campaign.status === "draft" || campaign.status === "scheduled") redirect(`/admin/projects/${id}/campaigns/${campaignId}/edit`);

  const { data: templates } = await supabase
    .from("templates")
    .select("id, name, channel, subject, html, title, body, url, icon_url, image_url, badge_url, actions, context")
    .eq("project_id", id);

  // Провайдер показываем как есть, даже если его потом отключили в «Подключениях»
  const providerOptions = {
    sms: [
      { value: "bytehand", label: "Bytehand" },
      { value: "smsc", label: "SMSC.ru" },
      { value: "mts", label: "МТС Маркетолог" },
    ],
    email: [
      { value: "haskimail", label: "Haskimail" },
      { value: "smsc", label: "SMSC.ru" },
    ],
  };

  return (
    <EditCampaignForm
      projectId={id}
      campaign={campaign}
      templates={templates ?? []}
      segmentOptions={[]}
      providerOptions={providerOptions}
      projectTimezone={project.timezone || "Europe/Moscow"}
      readOnly
    />
  );
}
