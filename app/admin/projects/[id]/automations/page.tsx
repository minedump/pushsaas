import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import AutomationsManager from "./AutomationsManager";

export default async function AutomationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const [{ data: automations }, { data: templatesRaw }, { data: priorityRow, error: priorityErr }, { data: tagRows }] = await Promise.all([
    supabase
      .from("automations")
      .select(
        "id, type, channel, is_enabled, delay_minutes, template_id, provider, segment_tags, name, title, body, click_url, platforms, config, spacing_enabled, spacing_minutes, send_window_enabled, send_days, send_time_from, send_time_to, send_window_subscriber_tz, cascade, channel_templates, is_transactional, next_fire_at"
      )
      .eq("project_id", id)
      .order("created_at"),
    supabase
      .from("templates")
      .select("id, name, channel, title, body, url, icon_url, image_url, badge_url, actions, subject, html, context")
      .eq("project_id", id)
      .order("name"),
    // best-effort: до миграции 0045/0047 колонок нет — деградируем к дефолтам
    supabase.from("projects").select("welcome_channel_priority, welcome_channel_enabled, welcome_channel_provider, timezone").eq("id", id).maybeSingle(),
    // Подсказки для мультивыбора сегмента — те же теги, что видит форма
    // рассылки (campaigns/new/page.tsx).
    supabase.from("identities").select("tags").eq("project_id", id).limit(5000),
  ]);

  const list = automations ?? [];
  const welcomes = list.filter((a) => a.type === "welcome");
  const events = list.filter((a) => a.type === "event");
  const custom = list.filter((a) => a.type === "custom");
  const recurring = list.filter((a) => a.type === "recurring");
  const templates = templatesRaw ?? [];
  const segmentOptions = [...new Set((tagRows || []).flatMap((r) => r.tags || []))].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
  const welcomeChannelPriority = (!priorityErr && (priorityRow?.welcome_channel_priority as string[] | null)) || ["push", "sms", "email"];
  const welcomeChannelEnabled = (!priorityErr && (priorityRow?.welcome_channel_enabled as Record<string, boolean> | null)) || {
    push: true,
    sms: true,
    email: true,
  };
  const welcomeChannelProvider = (!priorityErr && (priorityRow?.welcome_channel_provider as Record<string, string> | null)) || {};
  const projectTimezone = (!priorityErr && priorityRow?.timezone) || "Europe/Moscow";

  // Настроенные провайдеры sms/email (для выбора «через какое подключение
  // слать welcome») — тот же best-effort паттерн, что и в auth/page.tsx.
  const admin = createAdminClient();
  const { data: secrets } = await admin
    .from("project_secrets")
    .select("bytehand_service_key, smsc_login, smsc_password, haskimail_server_token")
    .eq("project_id", id)
    .maybeSingle();
  const hasBytehand = !!secrets?.bytehand_service_key;
  const hasSmsc = !!secrets?.smsc_login && !!secrets?.smsc_password;
  const hasHaskimail = !!secrets?.haskimail_server_token;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Автоматизации</h1>
      <AutomationsManager
        projectId={id}
        appUrl={appUrl}
        welcomes={welcomes}
        templates={templates}
        events={events}
        custom={custom}
        recurring={recurring}
        priorityOrder={welcomeChannelPriority}
        channelEnabled={welcomeChannelEnabled}
        channelProvider={welcomeChannelProvider}
        hasBytehand={hasBytehand}
        hasSmsc={hasSmsc}
        hasHaskimail={hasHaskimail}
        segmentOptions={segmentOptions}
        projectTimezone={projectTimezone}
      />
    </main>
  );
}
