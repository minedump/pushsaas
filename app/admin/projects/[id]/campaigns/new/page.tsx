import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import NewCampaignForm from "./NewCampaignForm";

export default async function NewCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ channel?: string; templateId?: string }>;
}) {
  const { id } = await params;
  const { channel: initialChannel, templateId: initialTemplateId } = await searchParams;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, is_active, timezone").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  // Какие провайдеры sms/email настроены (ключи в «Подключениях») — из них
  // можно выбирать при отправке. best-effort: отсутствие haskimail_marketing_stream
  // (миграция 0020) не должно ронять bytehand/smsc. Haskimail — один токен на
  // аккаунт, нужен и токен, и ID рассылочного канала (MessageStream).
  const admin = createAdminClient();
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

  const { data: templates } = await supabase
    .from("templates")
    .select("id, name, channel, subject, html, title, body, url, icon_url, image_url, badge_url, actions")
    .eq("project_id", id)
    .order("updated_at", { ascending: false });

  // Подсказки для мультивыбора сегмента — все теги, встречавшиеся у
  // подписчиков проекта, не ограничение на ввод (новый тег тоже можно ввести).
  const { data: tagRows } = await admin.from("identities").select("tags").eq("project_id", id).limit(5000);
  const segmentOptions = [...new Set((tagRows || []).flatMap((r) => r.tags || []))].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));

  return (
    <NewCampaignForm
      projectId={id}
      providerOptions={providerOptions}
      templates={templates ?? []}
      segmentOptions={segmentOptions}
      initialChannel={initialChannel === "push" || initialChannel === "sms" || initialChannel === "email" ? initialChannel : undefined}
      initialTemplateId={initialTemplateId}
      projectTimezone={project.timezone || "Europe/Moscow"}
    />
  );
}
