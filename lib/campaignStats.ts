import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type CampaignStat = {
  id: string;
  channel: string;
  title: string;
  sent_at: string | null;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  clicked_count: number;
};

// id контактов, помеченных «Тестовый контакт: не учитывать в аналитике» (Подписчики)
export async function loadExcludedIdentityIds(supabase: Supabase, projectId: string): Promise<Set<string>> {
  const { data } = await supabase.from("identities").select("id").eq("project_id", projectId).eq("exclude_from_analytics", true).limit(5000);
  return new Set((data ?? []).map((r) => r.id as string));
}

// Отправленные рассылки за период со счётчиками БЕЗ тестовых контактов. Счётчики самой рассылки
// (отправлено, доставлено, клики) включают всех получателей, поэтому из них вычитаются строки
// получателей с флагом «не учитывать в аналитике». Клики вычитаются по click_count: счётчик
// рассылки считает и повторные клики. Рассылка, ушедшая только тестовым контактам, в список не попадает.
export async function loadCampaignStats(supabase: Supabase, projectId: string, sinceIso: string, untilIso: string | null, excluded: Set<string>): Promise<CampaignStat[]> {
  let q = supabase
    .from("campaigns")
    .select("id, channel, sent_count, delivered_count, failed_count, clicked_count, title, internal_title, sent_at")
    .eq("project_id", projectId)
    .eq("status", "sent")
    .gte("sent_at", sinceIso);
  if (untilIso) q = q.lte("sent_at", untilIso);
  const { data: campaigns } = await q;
  const list = campaigns ?? [];

  const part = new Map<string, { sent: number; delivered: number; clicks: number }>();
  const ids = list.map((c) => c.id as string);
  if (ids.length && excluded.size) {
    const ex = [...excluded];
    for (let i = 0; i < ex.length; i += 300) {
      for (let from = 0; from < 50_000; from += 1000) {
        const { data: rows } = await supabase
          .from("campaign_recipients")
          .select("campaign_id, status, click_count")
          .in("campaign_id", ids)
          .in("identity_id", ex.slice(i, i + 300))
          .order("id", { ascending: true })
          .range(from, from + 999);
        if (!rows?.length) break;
        for (const r of rows) {
          const e = part.get(r.campaign_id) || { sent: 0, delivered: 0, clicks: 0 };
          e.sent++;
          if (r.status === "delivered") e.delivered++;
          e.clicks += r.click_count || 0;
          part.set(r.campaign_id, e);
        }
        if (rows.length < 1000) break;
      }
    }
  }

  const out: CampaignStat[] = [];
  for (const c of list) {
    const e = part.get(c.id as string);
    if (e && e.sent >= (c.sent_count || 0)) continue;
    out.push({
      id: c.id as string,
      channel: c.channel as string,
      // у рассылок, созданных по API, title пустой или равен тексту: показываем внутреннее название
      title: (c as { internal_title?: string | null }).internal_title || (c.title as string) || "Рассылка",
      sent_at: c.sent_at as string | null,
      sent_count: Math.max(0, (c.sent_count || 0) - (e?.sent ?? 0)),
      delivered_count: Math.max(0, (c.delivered_count || 0) - (e?.delivered ?? 0)),
      failed_count: c.failed_count || 0,
      clicked_count: Math.max(0, (c.clicked_count || 0) - (e?.clicks ?? 0)),
    });
  }
  return out;
}

export type TopCampaign = { id: string; title: string; channel: string; ctr: number; clicked: number; delivered: number };

// Лучшие рассылки по доле кликов от доставленных
export function topByCtr(list: CampaignStat[], limit = 5): TopCampaign[] {
  return list
    .filter((c) => c.delivered_count > 0)
    .map((c) => ({ id: c.id, title: c.title, channel: c.channel, ctr: Math.round((c.clicked_count / c.delivered_count) * 100), clicked: c.clicked_count, delivered: c.delivered_count }))
    .sort((a, b) => b.ctr - a.ctr || b.delivered - a.delivered)
    .slice(0, limit);
}
