import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import DashboardOverview from "./DashboardOverview";

// Сводка отправок по всем каналам (push/sms/email), не только push.
// Источники: campaigns (ручные/API рассылки любого канала, channel-колонка —
// миграция 0019) и automation_log (событийные/вебхук/welcome-автоматизации —
// они всегда push, см. lib/sender.ts/app/api/cron/run-automations). Суммируем
// оба, иначе "отправлено сегодня" занижено для проекта с автоматизациями.
//
// Переключатель Сегодня/Неделя/Месяц общий на весь дашборд (не только
// «Отправлено») — «Активные подписчики»/«Push по платформам» тоже считаются
// за период: не общий счётчик всех активных, а сколько НОВЫХ подписались (и
// остаются активными) именно в выбранном окне — иначе переключатель не менял
// бы эти блоки вообще, что и было исходной жалобой.
const MONTH_DAYS = 30;

type Channel = "push" | "sms" | "email";
type Period = "today" | "week" | "month";
type ChannelCounts = { push: number; sms: number; email: number; total: number };
type ActiveCounts = { push: number; sms: number; email: number };
type PlatformCounts = { ios: number; android: number; desktop: number };

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const startOfWeek = new Date(now.getTime() - 7 * 86_400_000);
  const startOfMonth = new Date(now.getTime() - MONTH_DAYS * 86_400_000);

  // Push — по устройствам (subscribers, не приостановлены), SMS/Email — по
  // людям (identities), причём НЕ по *_verified_at (это доказательство
  // владения номером для входа), а по *_marketing_active_at — согласию на
  // рассылку, включаемому явно через /api/v1/subscribers или импорт CSV (см.
  // lib/identity.upsertContact). Все три запроса сразу тянут поле с датой
  // (created_at / *_marketing_active_at) за весь месяц одним запросом —
  // Сегодня/Неделя потом просто фильтруются в JS (bucketSince), а не через
  // три отдельных похода в базу.
  // best-effort: channel — колонка миграции 0019, отсутствие не должно
  // ронять дашборд (просто все рассылки посчитаются как push).
  const [
    { data: pushRows },
    { data: smsRows },
    { data: emailRows },
    { data: campaignsFull, error: campaignsErr },
    { data: autoLog },
  ] = await Promise.all([
    supabase
      .from("subscribers")
      .select("platform, created_at")
      .eq("project_id", id)
      .eq("is_active", true)
      .eq("paused", false)
      .gte("created_at", startOfMonth.toISOString()),
    supabase
      .from("identities")
      .select("sms_marketing_active_at")
      .eq("project_id", id)
      .not("sms_marketing_active_at", "is", null)
      .gte("sms_marketing_active_at", startOfMonth.toISOString()),
    supabase
      .from("identities")
      .select("email_marketing_active_at")
      .eq("project_id", id)
      .not("email_marketing_active_at", "is", null)
      .gte("email_marketing_active_at", startOfMonth.toISOString()),
    supabase
      .from("campaigns")
      .select("sent_count, sent_at, channel")
      .eq("project_id", id)
      .eq("status", "sent")
      .gte("sent_at", startOfMonth.toISOString()),
    supabase
      .from("automation_log")
      .select("recipients, created_at")
      .eq("project_id", id)
      .eq("status", "sent")
      .gte("created_at", startOfMonth.toISOString()),
  ]);
  const { data: campaignsBasic } = campaignsErr
    ? await supabase
        .from("campaigns")
        .select("sent_count, sent_at")
        .eq("project_id", id)
        .eq("status", "sent")
        .gte("sent_at", startOfMonth.toISOString())
    : { data: null };
  const campaigns = (campaignsFull ?? campaignsBasic ?? []).map((c) => ({ channel: "push" as Channel, ...c }));

  function sentSince(since: Date): ChannelCounts {
    const result: Record<Channel, number> = { push: 0, sms: 0, email: 0 };
    for (const c of campaigns) {
      if (!c.sent_at || new Date(c.sent_at) < since) continue;
      result[c.channel] += c.sent_count || 0;
    }
    for (const r of autoLog ?? []) {
      if (!r.created_at || new Date(r.created_at) < since) continue;
      result.push += r.recipients || 0; // автоматизации сейчас только push
    }
    return { ...result, total: result.push + result.sms + result.email };
  }

  function activeSince(since: Date): ActiveCounts {
    const push = (pushRows ?? []).filter((r) => r.created_at && new Date(r.created_at) >= since).length;
    const sms = (smsRows ?? []).filter((r) => r.sms_marketing_active_at && new Date(r.sms_marketing_active_at) >= since).length;
    const email = (emailRows ?? []).filter((r) => r.email_marketing_active_at && new Date(r.email_marketing_active_at) >= since).length;
    return { push, sms, email };
  }

  function platformsSince(since: Date): PlatformCounts {
    const rows = (pushRows ?? []).filter((r) => r.created_at && new Date(r.created_at) >= since);
    const byPlatform = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.platform] = (acc[r.platform] || 0) + 1;
      return acc;
    }, {});
    return { ios: byPlatform.ios || 0, android: byPlatform.android || 0, desktop: byPlatform.desktop || 0 };
  }

  const periods: Period[] = ["today", "week", "month"];
  const sinceByPeriod: Record<Period, Date> = { today: startOfToday, week: startOfWeek, month: startOfMonth };
  const sent = Object.fromEntries(periods.map((p) => [p, sentSince(sinceByPeriod[p])])) as Record<Period, ChannelCounts>;
  const active = Object.fromEntries(periods.map((p) => [p, activeSince(sinceByPeriod[p])])) as Record<Period, ActiveCounts>;
  const platforms = Object.fromEntries(periods.map((p) => [p, platformsSince(sinceByPeriod[p])])) as Record<Period, PlatformCounts>;

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Дашборд</h1>
      <DashboardOverview sent={sent} active={active} platforms={platforms} />
    </main>
  );
}
