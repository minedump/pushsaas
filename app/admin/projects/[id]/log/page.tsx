import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import LogTabs from "./LogTabs";

// Журнал — диагностика срабатываний, а не список отправленных сообщений
// (это уже есть в «Кампаниях»). Ключевое отличие: сюда попадают ПРОПУСКИ
// вебхук-автоматизаций (дедуп, условие не совпало, нет телефона для
// транзакционной) — они никогда не создают строку в campaigns, поэтому в
// «Кампаниях» их принципиально не увидеть.
function fmtDetail(d: Record<string, unknown> | null): string {
  if (!d || typeof d !== "object") return "";
  const parts: string[] = [];
  if (d.orderNumber) parts.push(`заказ №${d.orderNumber}`);
  if (d.key) parts.push(`ключ ${d.key}`);
  if (Array.isArray(d.segmentTags) && d.segmentTags.length) parts.push(`сегмент ${d.segmentTags.join(", ")}`);
  return parts.join(" · ");
}

// Причина, по которой рассылка не смогла стартовать (campaigns.error,
// миграция 0035) — короткие английские коды из lib/sender.ts/крона/
// send-draft, переводим для отображения в «Журнале».
const CAMPAIGN_ERROR_LABEL: Record<string, string> = {
  "no vapid keys": "не настроены VAPID-ключи",
  "insufficient balance": "недостаточно баланса",
  "provider not configured": "не настроен провайдер",
  "unsubscribe link required": "нет обязательной ссылки отписки в письме",
};
function campaignErrorDetail(status: string, error: string | null, sentCount: number): string {
  if (status === "sent") return `0 из ${sentCount} доставлено`;
  return error ? CAMPAIGN_ERROR_LABEL[error] || error : "";
}

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

  const [{ data: autoLogAll }, { data: campaignsSentOrFailed }, { data: otpAll }, { data: apiCallsAll }, { data: subEventsAll }, { data: channelEventsAll }] = await Promise.all([
    supabase
      .from("automation_log")
      .select("id, source, title, status, recipients, detail, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(500),
    // 'sent' тоже нужен: dispatch*Campaign всегда ставит status="sent" по
    // факту завершения попытки, даже если КАЖДЫЙ получатель провалился
    // (delivered_count=0) — это тоже ошибка, просто не на уровне кампании
    // целиком (тот "failed" — только когда отправка не смогла даже начаться,
    // например провайдер не настроен). sent_count>0 отсекает пустую
    // аудиторию (сегмент ни на кого не попал) — это не ошибка, слать было некому.
    supabase
      .from("campaigns")
      .select("id, title, channel, status, sent_count, delivered_count, error, created_at")
      .eq("project_id", id)
      .in("status", ["failed", "sent"])
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("otp_requests")
      .select("id, channel, provider, attempts, expires_at, consumed_at, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(300),
    // /api/v1/trigger сюда не входит — уже в automation_log.
    supabase
      .from("api_call_log")
      .select("id, endpoint, ok, error, detail, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(300),
    // события жизненного цикла push-подписки (миграция 0027) — новая
    // подписка / пауза / возобновление / устройство отвалилось.
    supabase
      .from("push_events")
      .select("id, type, created_at, subscribers(platform)")
      .eq("project_id", id)
      .in("type", ["subscribed", "paused", "resumed", "dead"])
      .order("created_at", { ascending: false })
      .limit(300),
    // включение/отключение SMS/Email-рассылки по identity (миграция 0029) —
    // тот же "События подписчиков", но на уровне контакта, не устройства.
    supabase
      .from("identity_channel_events")
      .select("id, channel, active, contact, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  const failedCampaigns = (campaignsSentOrFailed ?? []).filter((c) => c.status === "failed" || (c.sent_count > 0 && c.delivered_count === 0));

  const apiCallRows = (apiCallsAll ?? []).map((r) => ({
    id: String(r.id),
    endpoint: r.endpoint,
    ok: r.ok,
    error: r.error,
    detail: r.detail as Record<string, unknown> | null,
    created_at: r.created_at,
  }));

  const platformLabel: Record<string, string> = { ios: "iPhone", android: "Android", desktop: "Desktop", unknown: "—" };
  const subEventRows = [
    ...(subEventsAll ?? []).map((r) => {
      const sub = r.subscribers as unknown as { platform: string } | null;
      return {
        id: `push-${r.id}`,
        channel: "push" as const,
        type: r.type,
        detail: platformLabel[sub?.platform || "unknown"] || sub?.platform || "—",
        created_at: r.created_at,
      };
    }),
    ...(channelEventsAll ?? []).map((r) => ({
      id: `chan-${r.id}`,
      channel: r.channel as "sms" | "email",
      type: `${r.channel}_${r.active ? "activated" : "deactivated"}`,
      detail: r.contact || "—",
      created_at: r.created_at,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const loginRows = (otpAll ?? []).map((r) => ({
    id: r.id,
    channel: r.channel,
    provider: r.provider,
    status: loginStatus(r.consumed_at, r.attempts, r.expires_at),
    created_at: r.created_at,
  }));

  const automationRows = (autoLogAll ?? []).map((r) => ({
    id: r.id,
    source: r.source,
    title: r.title || "—",
    status: r.status,
    recipients: r.recipients,
    detail: fmtDetail(r.detail as Record<string, unknown> | null),
    created_at: r.created_at,
  }));

  const errorRows = [
    ...(failedCampaigns ?? []).map((c) => ({
      id: `camp-${c.id}`,
      source: "campaign" as const,
      title: c.title,
      channel: c.channel || "push",
      // c.status === "sent" тут возможен (см. фильтр выше) — это случай "все
      // адресаты провалились", а не сбой на уровне кампании; отображаем как
      // ошибку в любом случае, иначе увидим вводящее в заблуждение зелёное
      // "отправлено" в разделе, который весь про проблемы.
      status: "failed" as const,
      detail: campaignErrorDetail(c.status, c.error, c.sent_count),
      created_at: c.created_at,
    })),
    ...(autoLogAll ?? [])
      .filter((r) => r.status === "failed" || r.status === "skipped")
      .map((r) => ({
        id: `auto-${r.id}`,
        source: "automation" as const,
        title: r.title || "—",
        channel: "push",
        status: r.status,
        detail: fmtDetail(r.detail as Record<string, unknown> | null),
        created_at: r.created_at,
      })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Журнал</h1>

      <div className="mt-6">
        <LogTabs
          automationRows={automationRows}
          errorRows={errorRows}
          loginRows={loginRows}
          apiCallRows={apiCallRows}
          subEventRows={subEventRows}
        />
      </div>
    </main>
  );
}
