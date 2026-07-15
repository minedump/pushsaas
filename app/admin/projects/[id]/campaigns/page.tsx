import { notFound } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { Badge, ButtonLink, Card } from "@/app/ui";

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

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, title, status, sent_count, delivered_count, failed_count, clicked_count, sent_at, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(100);

  const list = campaigns ?? [];
  const sent = list.filter((c) => c.status === "sent");
  const totalDelivered = sent.reduce((s, c) => s + (c.delivered_count || 0), 0);
  const totalClicked = sent.reduce((s, c) => s + (c.clicked_count || 0), 0);
  const totalSent = sent.reduce((s, c) => s + (c.sent_count || 0), 0);
  const ctr = totalDelivered ? Math.round((totalClicked / totalDelivered) * 100) : 0;

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
  const totalRevenue = [...revenueByCampaign.values()].reduce((s, v) => s + v, 0);

  const chart = sent.slice(0, 10).reverse();
  const maxVal = Math.max(1, ...chart.map((c) => c.delivered_count || 0));

  const statusTone = (s: string) => (s === "sent" ? "good" : s === "failed" ? "bad" : "warn");

  return (
    <main className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold m-0">{project.name} · Кампании</h1>
        <ButtonLink href={`/admin/projects/${id}/campaigns/new`} size="sm">
          <IconPlus size={16} stroke={2} />
          Уведомление
        </ButtonLink>
      </div>

      <div className="flex gap-3 mt-5 flex-wrap">
        <Tile label="Отправлено всего" value={totalSent} />
        <Tile label="Доставлено" value={totalDelivered} />
        <Tile label="Кликов" value={totalClicked} />
        <Tile label="CTR" value={`${ctr}%`} />
        {project.attribution_enabled && <Tile label="Выручка с пушей" value={`${totalRevenue.toLocaleString("ru-RU")} ₽`} />}
      </div>

      {chart.length > 0 && (
        <Card className="mt-5">
          <div className="text-[13px] text-ink-muted mb-3">Доставки и клики по последним рассылкам</div>
          <BarChart data={chart} max={maxVal} />
        </Card>
      )}

      <div className="mt-7">
        <h2 className="text-base font-semibold">История</h2>
        {list.length === 0 ? (
          <Card className="text-ink-muted">Пока не было рассылок.</Card>
        ) : (
          <div className="border border-border rounded-xl overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="bg-surface-2 text-left">
                  <Th>Заголовок</Th>
                  <Th>Статус</Th>
                  <Th right>Доставлено</Th>
                  <Th right>Клики</Th>
                  <Th right>CTR</Th>
                  {project.attribution_enabled && <Th right>Выручка</Th>}
                  <Th>Дата</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const cctr = c.delivered_count ? Math.round((c.clicked_count / c.delivered_count) * 100) : 0;
                  return (
                    <tr key={c.id} className="border-t border-border">
                      <Td>{c.title}</Td>
                      <Td>
                        <Badge tone={statusTone(c.status)} dot>
                          {c.status}
                        </Badge>
                      </Td>
                      <Td right>
                        {c.delivered_count}/{c.sent_count}
                      </Td>
                      <Td right>{c.clicked_count}</Td>
                      {project.attribution_enabled && (
                        <Td right>{(revenueByCampaign.get(c.id) || 0).toLocaleString("ru-RU")} ₽</Td>
                      )}
                      <Td right>{c.status === "sent" ? `${cctr}%` : "—"}</Td>
                      <Td className="text-ink-faint">
                        {new Date(c.sent_at || c.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function BarChart({ data, max }: { data: { id: string; delivered_count: number; clicked_count: number }[]; max: number }) {
  const W = 620, H = 160, pad = 24, gap = 10;
  const bw = (W - pad * 2 - gap * (data.length - 1)) / data.length;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[380px] block">
        {data.map((c, i) => {
          const x = pad + i * (bw + gap);
          const dh = ((c.delivered_count || 0) / max) * (H - pad * 2);
          const ch = ((c.clicked_count || 0) / max) * (H - pad * 2);
          return (
            <g key={c.id}>
              <rect x={x} y={H - pad - dh} width={bw} height={dh} rx={3} fill="var(--accent-line)" />
              <rect x={x} y={H - pad - ch} width={bw} height={ch} rx={3} fill="var(--accent)" />
            </g>
          );
        })}
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--border)" />
      </svg>
      <div className="flex gap-4 text-xs text-ink-muted mt-1.5">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--accent-line)" }} />
          доставлено
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--accent)" }} />
          клики
        </span>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="flex-1 min-w-[150px]">
      <div className="text-ink-muted text-xs">{label}</div>
      <div className="text-[26px] font-bold">{value}</div>
    </Card>
  );
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-ink-faint font-normal whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-3.5 py-3 align-middle ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
);
