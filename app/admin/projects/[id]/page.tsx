import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { Card } from "@/app/ui";
import DashboardMetrics from "./DashboardMetrics";

// Сводка отправок по всем каналам (push/sms/email), не только push.
// Источники: campaigns (ручные/API рассылки любого канала, channel-колонка —
// миграция 0019) и automation_log (событийные/вебхук/welcome-автоматизации —
// они всегда push, см. lib/sender.ts/app/api/cron/run-automations). Суммируем
// оба, иначе "отправлено сегодня" занижено для проекта с автоматизациями.
const MONTH_DAYS = 30;

type Channel = "push" | "sms" | "email";
type ChannelCounts = { push: number; sms: number; email: number; total: number };

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
  // рассылку, включаемому явно через /api/v1/contacts или импорт CSV (см.
  // lib/identity.upsertContact, app/admin/projects/[id]/subscribers/page.tsx —
  // та же логика подсчёта).
  // best-effort: channel — колонка миграции 0019, отсутствие не должно
  // ронять дашборд (просто все рассылки посчитаются как push).
  const [
    { count: pushActive },
    { count: smsActive },
    { count: emailActive },
    { data: activeSubs },
    { data: campaignsFull, error: campaignsErr },
    { data: autoLog },
  ] = await Promise.all([
    supabase.from("subscribers").select("id", { count: "exact", head: true }).eq("project_id", id).eq("is_active", true).eq("paused", false),
    supabase.from("identities").select("id", { count: "exact", head: true }).eq("project_id", id).not("sms_marketing_active_at", "is", null),
    supabase.from("identities").select("id", { count: "exact", head: true }).eq("project_id", id).not("email_marketing_active_at", "is", null),
    supabase.from("subscribers").select("platform").eq("project_id", id).eq("is_active", true),
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
  const byPlatform = (activeSubs ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.platform] = (acc[r.platform] || 0) + 1;
    return acc;
  }, {});
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

  const metrics = { today: sentSince(startOfToday), week: sentSince(startOfWeek), month: sentSince(startOfMonth) };

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Дашборд</h1>

      <div className="text-[13px] text-ink-muted mt-6 mb-2">Отправлено</div>
      <DashboardMetrics metrics={metrics} />

      <div className="text-[13px] text-ink-muted mt-6 mb-2">Активные подписчики</div>
      <div className="flex gap-3 flex-wrap">
        <Tile label="Push" value={pushActive ?? 0} />
        <Tile label="SMS" value={smsActive ?? 0} />
        <Tile label="Email" value={emailActive ?? 0} />
      </div>

      <div className="text-[13px] text-ink-muted mt-6 mb-2">Push по платформам</div>
      <div className="flex gap-3 flex-wrap">
        <Tile label="iPhone (iOS)" value={byPlatform.ios || 0} />
        <Tile label="Android" value={byPlatform.android || 0} />
        <Tile label="Desktop" value={byPlatform.desktop || 0} />
      </div>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex-1 min-w-[150px]">
      <div className="text-ink-muted text-xs">{label}</div>
      <div className="text-[26px] font-bold tabular-nums">{value.toLocaleString("ru-RU")}</div>
    </Card>
  );
}
