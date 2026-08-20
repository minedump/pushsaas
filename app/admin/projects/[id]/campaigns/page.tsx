import { notFound } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { ButtonLink, Card } from "@/app/ui";
import CampaignsTable from "./CampaignsTable";

export default async function CampaignsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: baseProject } = await supabase.from("projects").select("id, name, is_active").eq("id", id).maybeSingle();
  if (!baseProject) notFound();
  await ensureProjectAccessible(baseProject.id, baseProject.is_active);

  // best-effort: атрибуция — отдельный запрос, не роняет страницу, если
  // миграция 0009 ещё не применена (колонок пока нет). Настройки — в разделе API.
  const { data: attrRow, error: attrErr } = await supabase
    .from("projects")
    .select("attribution_enabled")
    .eq("id", id)
    .maybeSingle();
  const project = {
    ...baseProject,
    attribution_enabled: !attrErr && !!attrRow?.attribution_enabled,
  };

  // best-effort: channel/type/initiator — колонки миграций 0019/0025,
  // отсутствие не должно ронять список (просто все строки без явного канала
  // = push, без типа = marketing/manual — те же дефолты, что и в БД).
  const { data: campaignsFull, error: campaignsErr } = await supabase
    .from("campaigns")
    .select("id, title, internal_title, status, channel, sent_count, delivered_count, failed_count, clicked_count, sent_at, created_at, type, initiator")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(500);
  const { data: campaignsBasic } = campaignsErr
    ? await supabase
        .from("campaigns")
        .select("id, title, status, sent_count, delivered_count, failed_count, clicked_count, sent_at, created_at")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: null };
  const campaigns = campaignsFull ?? campaignsBasic;

  const list = (campaigns ?? []).map((c) => ({ channel: "push" as string, type: "marketing" as string, initiator: "manual" as string, internal_title: null as string | null, ...c }));

  let revenueByCampaign = new Map<string, number>();
  if (project.attribution_enabled && list.length) {
    const { data: attrRows } = await supabase
      .from("order_attributions")
      .select("campaign_id, revenue")
      .in("campaign_id", list.map((c) => c.id));
    revenueByCampaign = (attrRows ?? []).reduce((m, r) => {
      if (r.campaign_id) m.set(r.campaign_id, (m.get(r.campaign_id) || 0) + Number(r.revenue || 0));
      return m;
    }, new Map<string, number>());
  }

  const campaignRows = list.map((c) => ({
    id: c.id,
    campaignId: c.id as string | null,
    title: c.title,
    internal_title: c.internal_title,
    channel: c.channel,
    type: (c.type === "transactional" ? "transactional" : "marketing") as "transactional" | "marketing",
    initiator: (c.initiator === "api" ? "api" : "manual") as "manual" | "api" | "automation" | "auth",
    status: c.status,
    sent_count: c.sent_count,
    delivered_count: c.delivered_count,
    clicked_count: c.clicked_count,
    revenue: revenueByCampaign.get(c.id) || 0,
    created_at: c.sent_at || c.created_at,
  }));

  // Event/welcome-автоматизации не создают строку в campaigns (см.
  // lib/sender.sendOneOff) — только в automation_log, поэтому берём их
  // ОТСЮДА отдельно. Вебхук/api-автоматизации (source webhook/api) СЮДА не
  // включаем — они уже отражены выше через campaigns (createAndDispatch тоже
  // создаёт кампанию), иначе одна отправка попала бы в список дважды.
  const { data: autoLog } = await supabase
    .from("automation_log")
    .select("id, title, status, recipients, source, created_at")
    .eq("project_id", id)
    .in("source", ["event", "welcome"])
    .order("created_at", { ascending: false })
    .limit(300);
  const automationRows = (autoLog ?? []).map((r) => ({
    id: `auto-${r.id}`,
    campaignId: null as string | null,
    title: r.title || (r.source === "welcome" ? "Welcome-автоматизация" : "Событийная автоматизация"),
    internal_title: null as string | null,
    channel: "push",
    type: "marketing" as const,
    initiator: "automation" as const,
    status: r.status,
    sent_count: r.recipients,
    delivered_count: r.status === "sent" ? r.recipients : 0,
    clicked_count: 0,
    revenue: 0,
    created_at: r.created_at,
  }));

  // Вход по коду — всегда транзакционные, никогда не создают campaigns-строку.
  const { data: otpRows } = await supabase
    .from("otp_requests")
    .select("id, channel, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(300);
  const CHANNEL_TITLE: Record<string, string> = { push: "Push", email: "Email", telegram: "Telegram", sms: "SMS" };
  const authRows = (otpRows ?? []).map((r) => ({
    id: `otp-${r.id}`,
    campaignId: null as string | null,
    title: `Вход — код (${CHANNEL_TITLE[r.channel] || r.channel})`,
    internal_title: null as string | null,
    channel: r.channel === "telegram" ? "sms" : r.channel,
    type: "transactional" as const,
    initiator: "auth" as const,
    status: "sent",
    sent_count: 1,
    delivered_count: 1,
    clicked_count: 0,
    revenue: 0,
    created_at: r.created_at,
  }));

  const rows = [...campaignRows, ...automationRows, ...authRows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <main className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Рассылки</h1>
        <ButtonLink href={`/admin/projects/${id}/campaigns/new`}>
          <IconPlus size={16} stroke={2} />
          Новая рассылка
        </ButtonLink>
      </div>

      <div className="mt-7">
        {rows.length === 0 ? (
          <Card className="text-ink-muted">Пока не было рассылок.</Card>
        ) : (
          <CampaignsTable rows={rows} attributionEnabled={project.attribution_enabled} projectId={id} />
        )}
      </div>
    </main>
  );
}
