import { notFound } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { ButtonLink, Card } from "@/app/ui";
import CampaignsTable from "./CampaignsTable";

export default async function CampaignsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  // best-effort: channel/type/initiator — колонки миграций 0019/0025,
  // отсутствие не должно ронять список (просто все строки без явного канала
  // = push, без типа = marketing/manual — те же дефолты, что и в БД).
  const { data: campaignsFull, error: campaignsErr } = await supabase
    .from("campaigns")
    .select("id, title, internal_title, status, channel, sent_count, delivered_count, failed_count, clicked_count, sent_at, created_at, type, initiator, template_id")
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

  const list = (campaigns ?? []).map((c) => ({
    channel: "push" as string,
    type: "marketing" as string,
    initiator: "manual" as string,
    internal_title: null as string | null,
    template_id: null as string | null,
    ...c,
  }));

  // Название шаблона в таблице — со ссылкой на его редактирование (см.
  // CampaignsTable), поэтому подтягиваем имена одним запросом по всем
  // использованным id, а не только их количество.
  const templateIds = [...new Set(list.map((c) => c.template_id).filter((v): v is string => !!v))];
  const { data: templateRows } = templateIds.length
    ? await supabase.from("templates").select("id, name").in("id", templateIds)
    : { data: [] as { id: string; name: string }[] };
  const templateNameById = new Map((templateRows ?? []).map((t) => [t.id, t.name]));

  // Выручка показывается всегда — заказов пока нет, значит карты пустые и
  // все строки просто читают 0 (см. lib/attribution.ts — вебхуку не нужно
  // отдельное "включение", он либо получает данные, либо нет).
  let revenueByCampaign = new Map<string, number>();
  let ordersByCampaign = new Map<string, number>();
  let paidByCampaign = new Map<string, number>();
  let paidOrdersByCampaign = new Map<string, number>();
  if (list.length) {
    const { data: attrRows } = await supabase
      .from("order_attributions")
      .select("campaign_id, revenue, is_paid, paid_amount")
      .in("campaign_id", list.map((c) => c.id));
    revenueByCampaign = (attrRows ?? []).reduce((m, r) => {
      if (r.campaign_id) m.set(r.campaign_id, (m.get(r.campaign_id) || 0) + Number(r.revenue || 0));
      return m;
    }, new Map<string, number>());
    // Каждая строка order_attributions — один заказ (см. /api/v1/attribute,
    // один UPSERT на заказ — миграция 0074 дедупит по номеру заказа),
    // поэтому число заказов кампании — просто количество строк с её
    // campaign_id, без отдельного запроса.
    ordersByCampaign = (attrRows ?? []).reduce((m, r) => {
      if (r.campaign_id) m.set(r.campaign_id, (m.get(r.campaign_id) || 0) + 1);
      return m;
    }, new Map<string, number>());
    const paidRows = (attrRows ?? []).filter((r) => r.is_paid);
    paidByCampaign = paidRows.reduce((m, r) => {
      if (r.campaign_id) m.set(r.campaign_id, (m.get(r.campaign_id) || 0) + Number(r.paid_amount || 0));
      return m;
    }, new Map<string, number>());
    paidOrdersByCampaign = paidRows.reduce((m, r) => {
      if (r.campaign_id) m.set(r.campaign_id, (m.get(r.campaign_id) || 0) + 1);
      return m;
    }, new Map<string, number>());
  }

  // campaigns.initiator сам по себе не различает welcome/событийную/
  // триггерную автоматизацию (все три пишут либо "automation", либо, для
  // триггерной рассылки по сегменту, даже "api" — тот же путь, что и прямой
  // вызов POST /api/v1/campaigns, см. lib/sender.ts createAndDispatch). Кто
  // именно инициировал конкретную рассылку, надёжно видно только через
  // automation_log.source по campaign_id — join делаем тут же одним запросом.
  const { data: autoSourceRows } = list.length
    ? await supabase
        .from("automation_log")
        .select("campaign_id, source")
        .eq("project_id", id)
        .not("campaign_id", "is", null)
        .in("campaign_id", list.map((c) => c.id))
    : { data: [] as { campaign_id: string | null; source: string }[] };
  const sourceByCampaignId = new Map((autoSourceRows ?? []).map((r) => [r.campaign_id as string, r.source]));

  const campaignRows = list.map((c) => {
    const autoSource = sourceByCampaignId.get(c.id);
    const initiator: "manual" | "api" | "welcome" | "event" | "trigger" | "recurring" | "automation" | "auth" =
      autoSource === "welcome"
        ? "welcome"
        : autoSource === "event"
          ? "event"
          : autoSource === "webhook"
            ? "trigger"
            : autoSource === "recurring"
              ? "recurring"
              : c.initiator === "api"
                ? "api"
                : c.initiator === "automation"
                  ? "automation"
                  : "manual";
    return {
      id: c.id,
      campaignId: c.id as string | null,
      title: c.title,
      internal_title: c.internal_title,
      channel: c.channel,
      type: (c.type === "transactional" ? "transactional" : "marketing") as "transactional" | "marketing",
      initiator,
      status: c.status,
      sent_count: c.sent_count,
      delivered_count: c.delivered_count,
      clicked_count: c.clicked_count,
      revenue: revenueByCampaign.get(c.id) || 0,
      orders: ordersByCampaign.get(c.id) || 0,
      paid: paidByCampaign.get(c.id) || 0,
      paidOrders: paidOrdersByCampaign.get(c.id) || 0,
      created_at: c.sent_at || c.created_at,
      templateId: c.template_id,
      templateName: c.template_id ? templateNameById.get(c.template_id) || null : null,
    };
  });

  // Event/welcome-автоматизации теперь тоже заводят campaigns-строку на
  // каждую отправку (см. lib/sender.sendOneOff/sendWelcomeNow) — те уже
  // отражены выше через campaignRows. Берём отсюда ТОЛЬКО строки без
  // campaign_id — попытки, не дошедшие до реальной отправки (нет активного
  // устройства/шаблона и т.п.), иначе одна отправка попала бы в список
  // дважды. Пропущенные (status: skipped — условие не совпало, уже
  // отправляли и т.п.) сюда не идут: это не попытки отправки, им не место
  // среди рассылок — см. вкладку «Автоматизации» в Журнале.
  const { data: autoLog } = await supabase
    .from("automation_log")
    .select("id, title, status, recipients, source, channel, campaign_id, created_at")
    .eq("project_id", id)
    .in("source", ["event", "welcome"])
    .is("campaign_id", null)
    .neq("status", "skipped")
    .order("created_at", { ascending: false })
    .limit(300);
  const automationRows = (autoLog ?? []).map((r) => ({
    id: `auto-${r.id}`,
    campaignId: null as string | null,
    title: r.title || (r.source === "welcome" ? "Welcome-автоматизация" : "Событийная автоматизация"),
    internal_title: null as string | null,
    channel: r.channel || "push",
    type: "marketing" as const,
    initiator: (r.source === "welcome" ? "welcome" : "event") as "welcome" | "event",
    status: r.status,
    sent_count: r.recipients,
    delivered_count: r.status === "sent" ? r.recipients : 0,
    clicked_count: 0,
    revenue: 0,
    orders: 0,
    paid: 0,
    paidOrders: 0,
    created_at: r.created_at,
    templateId: null as string | null,
    templateName: null as string | null,
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
    orders: 0,
    paid: 0,
    paidOrders: 0,
    created_at: r.created_at,
    templateId: null as string | null,
    templateName: null as string | null,
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
          <CampaignsTable rows={rows} projectId={id} />
        )}
      </div>
    </main>
  );
}
