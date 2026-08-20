import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { Badge, Card } from "@/app/ui";

const platformLabel: Record<string, string> = { ios: "iPhone", android: "Android", desktop: "Desktop", unknown: "—" };
const DAYS = 30;

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: baseProject } = await supabase.from("projects").select("id, name, is_active").eq("id", id).maybeSingle();
  if (!baseProject) notFound();
  await ensureProjectAccessible(baseProject.id, baseProject.is_active);

  // best-effort: атрибуция — отдельный запрос, не роняет страницу, если
  // миграция 0009 ещё не применена.
  const { data: attrRow, error: attrErr } = await supabase
    .from("projects")
    .select("attribution_enabled")
    .eq("id", id)
    .maybeSingle();
  const project = { ...baseProject, attribution_enabled: !attrErr && !!attrRow?.attribution_enabled };

  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

  const [{ data: subs }, { data: campaigns }, { data: log }, { data: attribution }] = await Promise.all([
    supabase.from("subscribers").select("platform, is_active, created_at").eq("project_id", id),
    supabase
      .from("campaigns")
      .select("id, status, sent_count, delivered_count, failed_count, clicked_count, title, sent_at")
      .eq("project_id", id)
      .eq("status", "sent"),
    supabase.from("automation_log").select("source, status").eq("project_id", id).gte("created_at", since),
    // выручка показывается всегда (0, если атрибуция не подключена);
    // best-effort: до миграции 0009 таблицы нет — data будет null
    supabase.from("order_attributions").select("revenue").eq("project_id", id),
  ]);

  const subRows = subs ?? [];
  const active = subRows.filter((r) => r.is_active);
  const byPlatform = active.reduce<Record<string, number>>((acc, r) => {
    acc[r.platform] = (acc[r.platform] || 0) + 1;
    return acc;
  }, {});
  const maxPlatform = Math.max(1, ...Object.values(byPlatform));

  // growth: new subscribers per day, last 30 days
  const days: { date: string; count: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    days.push({ date: d.toISOString().slice(0, 10), count: 0 });
  }
  const byDay = new Map(days.map((d) => [d.date, d]));
  for (const r of subRows) {
    const day = r.created_at?.slice(0, 10);
    const bucket = day ? byDay.get(day) : undefined;
    if (bucket) bucket.count++;
  }
  const maxDay = Math.max(1, ...days.map((d) => d.count));

  const camp = campaigns ?? [];
  const totalSent = camp.reduce((s, c) => s + (c.sent_count || 0), 0);
  const totalDelivered = camp.reduce((s, c) => s + (c.delivered_count || 0), 0);
  const totalClicked = camp.reduce((s, c) => s + (c.clicked_count || 0), 0);
  const ctr = totalDelivered ? Math.round((totalClicked / totalDelivered) * 100) : 0;
  const topByCtr = [...camp]
    .filter((c) => (c.delivered_count || 0) > 0)
    .map((c) => ({ ...c, ctr: Math.round(((c.clicked_count || 0) / c.delivered_count) * 100) }))
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 5);

  const chart = [...camp]
    .sort((a, b) => new Date(b.sent_at || 0).getTime() - new Date(a.sent_at || 0).getTime())
    .slice(0, 10)
    .reverse();
  const maxChartVal = Math.max(1, ...chart.map((c) => c.delivered_count || 0));

  const logRows = log ?? [];
  const bySource = logRows.reduce<Record<string, { sent: number; failed: number; skipped: number }>>((acc, r) => {
    acc[r.source] ??= { sent: 0, failed: 0, skipped: 0 };
    acc[r.source][r.status as "sent" | "failed" | "skipped"]++;
    return acc;
  }, {});
  const sourceLabel: Record<string, string> = { event: "Событийные", api: "API", webhook: "Вебхуки", welcome: "Welcome" };

  const revenue = (attribution ?? []).reduce((s, a) => s + Number(a.revenue || 0), 0);
  const orders = (attribution ?? []).length;

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Аналитика</h1>
      <p className="text-ink-muted mt-0 text-[13px]">Сводка за последние {DAYS} дней и по всем рассылкам.</p>

      {/* top tiles */}
      <div className="flex gap-3 mt-5 flex-wrap">
        <Tile label="Активных подписчиков" value={active.length} />
        <Tile label="Отправлено (всего)" value={totalSent} />
        <Tile label="CTR по рассылкам" value={`${ctr}%`} />
        <Tile label="Выручка с пушей" value={`${revenue.toLocaleString("ru-RU")} ₽`} />
      </div>

      {/* delivered/clicked per recent campaign */}
      {chart.length > 0 && (
        <Card className="mt-5">
          <div className="text-[13px] text-ink-muted mb-3">Отправки и клики по последним рассылкам</div>
          <BarChart data={chart} max={maxChartVal} />
        </Card>
      )}

      {/* growth chart */}
      <Card className="mt-5">
        <div className="text-[13px] text-ink-muted mb-3">Рост подписчиков — новые за день, последние {DAYS} дней</div>
        <GrowthChart data={days} max={maxDay} />
      </Card>

      {/* platform split */}
      <Card className="mt-4">
        <div className="text-[13px] text-ink-muted mb-3">Платформы (активные подписчики)</div>
        <div className="flex flex-col gap-2">
          {Object.entries(byPlatform).length === 0 && <div className="text-ink-faint text-sm">Пока нет данных</div>}
          {Object.entries(byPlatform).map(([p, n]) => (
            <div key={p} className="flex items-center gap-3">
              <div className="w-20 text-[13px] text-ink-muted shrink-0">{platformLabel[p] || p}</div>
              <div className="flex-1 bg-surface-2 rounded h-5 overflow-hidden">
                <div className="h-full bg-accent rounded" style={{ width: `${(n / maxPlatform) * 100}%` }} />
              </div>
              <div className="w-10 text-right text-[13px] tabular-nums">{n}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* top campaigns */}
      <Card className="mt-4">
        <div className="text-[13px] text-ink-muted mb-3">Лучшие рассылки по CTR</div>
        {topByCtr.length === 0 ? (
          <div className="text-ink-faint text-sm">Пока нет отправленных рассылок</div>
        ) : (
          <div className="flex flex-col gap-2">
            {topByCtr.map((c, i) => (
              <div key={i} className="flex justify-between text-[13.5px]">
                <span className="truncate">{c.title}</span>
                <span className="tabular-nums text-ink-muted shrink-0 ml-3">{c.ctr}% CTR</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* automation activity */}
      <Card className="mt-4">
        <div className="text-[13px] text-ink-muted mb-3">Активность автоматизаций за {DAYS} дней</div>
        {Object.keys(bySource).length === 0 ? (
          <div className="text-ink-faint text-sm">Пока не было сработок</div>
        ) : (
          <div className="flex flex-col gap-2">
            {Object.entries(bySource).map(([src, s]) => (
              <div key={src} className="flex items-center justify-between text-[13.5px]">
                <span>{sourceLabel[src] || src}</span>
                <div className="flex gap-2">
                  <Badge tone="good">{s.sent} отправлено</Badge>
                  {s.failed > 0 && <Badge tone="bad">{s.failed} ошибок</Badge>}
                  {s.skipped > 0 && <Badge tone="neutral">{s.skipped} пропущено</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <div className="text-[13px] text-ink-muted mb-1">Выручка с пушей (атрибуция заказов)</div>
        <div className="text-[26px] font-bold">{revenue.toLocaleString("ru-RU")} ₽</div>
        <div className="text-[12px] text-ink-faint">{orders} заказов с участием push (модель — последний клик)</div>
        {!project.attribution_enabled && (
          <p className="text-[12.5px] text-ink-faint mt-2 mb-0">
            Атрибуция не подключена — включите её в разделе{" "}
            <a href={`/admin/projects/${id}/api`} className="text-accent">
              API
            </a>
            , и заказы после кликов по пушам начнут засчитываться сюда.
          </p>
        )}
      </Card>
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
          отправлено
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--accent)" }} />
          клики
        </span>
      </div>
    </div>
  );
}

function GrowthChart({ data, max }: { data: { date: string; count: number }[]; max: number }) {
  const W = 640, H = 140, pad = 20;
  const bw = (W - pad * 2) / data.length;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px] block">
        {data.map((d, i) => {
          const h = (d.count / max) * (H - pad * 2);
          return (
            <rect
              key={d.date}
              x={pad + i * bw}
              y={H - pad - h}
              width={Math.max(1, bw - 1)}
              height={h}
              rx={1}
              fill="var(--accent)"
            />
          );
        })}
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--border)" />
      </svg>
      <div className="flex justify-between text-[11px] text-ink-faint mt-1">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
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
