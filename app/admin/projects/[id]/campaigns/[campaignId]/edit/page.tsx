import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import EditCampaignForm from "./EditCampaignForm";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string; campaignId: string }> }) {
  const { id, campaignId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, is_active, timezone").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { data: campaign } = await supabase
    .from("campaigns")
    .select(
      "id, channel, status, title, body, subject, html_body, icon_url, image_url, click_url, badge_url, segment_tags, platforms, actions, type, template_id, scheduled_at, internal_title, template_data, contacts, provider, send_window_enabled, send_days, send_time_from, send_time_to, send_window_subscriber_tz, spacing_enabled, spacing_minutes"
    )
    .eq("id", campaignId)
    .eq("project_id", id)
    .maybeSingle();
  // Редактировать можно только то, что ещё не ушло — черновик или
  // запланированную (пока ждёт своего времени) рассылку. Провайдер sms/email
  // здесь не выбирается — он резолвится автоматически при реальной отправке
  // (см. /api/admin/campaigns/[id]/send-draft), как и у обычного черновика.
  // Настроенность провайдера всё же проверяем — чтобы предупредить, если его
  // отключили в «Подключениях» уже после создания черновика.
  if (!campaign || (campaign.status !== "draft" && campaign.status !== "scheduled")) notFound();

  const { data: templates } = await supabase
    .from("templates")
    .select("id, name, channel, subject, html, title, body, url, icon_url, image_url, badge_url, actions, context")
    .eq("project_id", id)
    .order("updated_at", { ascending: false });

  const admin = createAdminClient();

  // Подсказки для мультивыбора сегмента — те же теги, что и в форме создания.
  const { data: tagRows } = await admin.from("identities").select("tags").eq("project_id", id).limit(5000);
  const segmentOptions = [...new Set((tagRows || []).flatMap((r) => r.tags || []))].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));

  // Настроены ли провайдеры sms/email (см. campaigns/new/page.tsx — та же логика).
  const { data: secrets } = await admin
    .from("project_secrets")
    .select("bytehand_service_key, smsc_login, smsc_password, haskimail_server_token")
    .eq("project_id", id)
    .maybeSingle();
  const { data: streamSecret, error: streamErr } = await admin
    .from("project_secrets")
    .select("haskimail_marketing_stream")
    .eq("project_id", id)
    .maybeSingle();
  const smscReady = !!secrets?.smsc_login && !!secrets?.smsc_password;
  const haskimailReady = !!secrets?.haskimail_server_token && !streamErr && !!streamSecret?.haskimail_marketing_stream;
  const providerOptions = {
    sms: [
      ...(secrets?.bytehand_service_key ? [{ value: "bytehand", label: "Bytehand" }] : []),
      ...(smscReady ? [{ value: "smsc", label: "SMSC.ru" }] : []),
    ],
    email: [
      ...(haskimailReady ? [{ value: "haskimail", label: "Haskimail" }] : []),
      ...(smscReady ? [{ value: "smsc", label: "SMSC.ru" }] : []),
    ],
  };

  return (
    <EditCampaignForm
      projectId={id}
      campaign={campaign}
      templates={templates ?? []}
      segmentOptions={segmentOptions}
      providerOptions={providerOptions}
      projectTimezone={project.timezone || "Europe/Moscow"}
    />
  );
}
