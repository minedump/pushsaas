import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import LogTabs from "./LogTabs";

// Журнал — диагностика, а не список отправленных сообщений (это уже есть в
// «Кампаниях»). «Ошибки отправки» — только реальные рассылки (campaigns),
// провалившиеся или пропущенные (пустая аудитория), в том же формате
// колонок, что таблица «Рассылки» (см. CampaignsTable).

// см. lib/otp/index.ts MAX_ATTEMPTS — тот же порог, чтобы "исчерпаны
// попытки" в журнале совпадало с реальным поведением верификации.
const MAX_OTP_ATTEMPTS = 5;
function loginStatus(consumedAt: string | null, attempts: number, expiresAt: string): "verified" | "locked" | "expired" | "pending" {
  if (consumedAt) return "verified";
  if (attempts >= MAX_OTP_ATTEMPTS) return "locked";
  if (new Date(expiresAt) < new Date()) return "expired";
  return "pending";
}

export default async function LogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const [{ data: campaignsSentOrFailed }, { data: otpAll }, { data: apiCallsAll }] = await Promise.all([
    // 'sent' тоже нужен: dispatch*Campaign всегда ставит status="sent" по
    // факту завершения попытки, даже если КАЖДЫЙ получатель провалился
    // (delivered_count=0, "ошибка") или если сегмент ни на кого не попал
    // (sent_count=0, "пропущена") — тот "failed" на уровне статуса кампании
    // только когда отправка не смогла даже начаться (например, провайдер не
    // настроен).
    supabase
      .from("campaigns")
      .select("id, title, channel, status, sent_count, delivered_count, created_at, type, initiator, template_id")
      .eq("project_id", id)
      .in("status", ["failed", "sent"])
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("otp_requests")
      .select("id, channel, provider, phone, email, attempts, expires_at, consumed_at, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(300),
    // /api/v1/trigger сюда не входит — уже виден по своим кампаниям. Только
    // POST/PUT (см. logApiCall в lib/apiLog.ts) — GET/DELETE тут
    // принципиально не появятся, вкладка «API» про "что нам прислали и что
    // мы ответили".
    supabase
      .from("api_call_log")
      .select("id, endpoint, ok, status_code, error, request_body, response_body, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const failedCampaigns = (campaignsSentOrFailed ?? [])
    .filter((c) => c.status === "failed" || c.sent_count === 0 || (c.sent_count > 0 && c.delivered_count === 0))
    .map((c) => ({ ...c, errStatus: (c.status === "failed" ? "failed" : c.sent_count === 0 ? "skipped" : "failed") as "failed" | "skipped" }));

  const apiCallRows = (apiCallsAll ?? []).map((r) => ({
    id: String(r.id),
    endpoint: r.endpoint,
    ok: r.ok,
    statusCode: r.status_code as number | null,
    error: r.error,
    requestBody: r.request_body as Record<string, unknown> | null,
    responseBody: r.response_body as Record<string, unknown> | null,
    created_at: r.created_at,
  }));

  const loginRows = (otpAll ?? []).map((r) => ({
    id: r.id,
    channel: r.channel,
    provider: r.provider,
    contact: r.channel === "email" ? r.email : r.phone,
    status: loginStatus(r.consumed_at, r.attempts, r.expires_at),
    created_at: r.created_at,
  }));

  // «Ошибки отправки» — формат колонок таблицы «Рассылки» (см.
  // CampaignsTable) без статистики доставки (у провалившихся/пропущенных
  // рассылок она всегда нулевая — не несёт ценности, см. LogTabs.tsx).
  // Название шаблона и реальный инициатор (welcome/event/trigger/recurring)
  // — тот же join, что в campaigns/page.tsx, только на подмножестве
  // провалившихся/пропущенных id.
  const failedCampaignIds = failedCampaigns.map((c) => c.id);
  const [{ data: errTemplateRows }, { data: errSourceRows }] = await Promise.all([
    (() => {
      const templateIds = [...new Set(failedCampaigns.map((c) => c.template_id).filter((v): v is string => !!v))];
      return templateIds.length ? supabase.from("templates").select("id, name").in("id", templateIds) : Promise.resolve({ data: [] as { id: string; name: string }[] });
    })(),
    failedCampaignIds.length
      ? supabase.from("automation_log").select("campaign_id, source").eq("project_id", id).not("campaign_id", "is", null).in("campaign_id", failedCampaignIds)
      : Promise.resolve({ data: [] as { campaign_id: string | null; source: string }[] }),
  ]);
  const errTemplateNameById = new Map((errTemplateRows ?? []).map((t) => [t.id, t.name]));
  const errSourceByCampaignId = new Map((errSourceRows ?? []).map((r) => [r.campaign_id as string, r.source]));
  function errInitiator(campaignId: string, initiator: string | null): "manual" | "api" | "welcome" | "event" | "trigger" | "recurring" | "automation" | "auth" {
    const autoSource = errSourceByCampaignId.get(campaignId);
    if (autoSource === "welcome") return "welcome";
    if (autoSource === "event") return "event";
    if (autoSource === "webhook") return "trigger";
    if (autoSource === "recurring") return "recurring";
    if (initiator === "api") return "api";
    if (initiator === "automation") return "automation";
    return "manual";
  }

  const errorRows = failedCampaigns
    .map((c) => ({
      id: c.id,
      title: c.title,
      channel: c.channel || "push",
      templateId: c.template_id as string | null,
      templateName: c.template_id ? errTemplateNameById.get(c.template_id) || null : null,
      type: (c.type === "transactional" ? "transactional" : "marketing") as "transactional" | "marketing",
      initiator: errInitiator(c.id, c.initiator),
      status: c.errStatus,
      created_at: c.created_at,
    }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Журнал</h1>

      <div className="mt-6">
        <LogTabs projectId={id} errorRows={errorRows} loginRows={loginRows} apiCallRows={apiCallRows} />
      </div>
    </main>
  );
}
