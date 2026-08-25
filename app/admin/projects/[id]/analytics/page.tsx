import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { Badge, Card } from "@/app/ui";

const channelLabel: Record<string, string> = { push: "Push", sms: "SMS", email: "Email" };
const DAYS = 30;
const MIN_SAMPLE = 3;
const DAY_LABEL: Record<number, string> = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 0: "Вс" };

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, is_active, timezone").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

  const [{ data: subs }, { data: campaigns }, { data: log }, { data: attribution }, { data: channelGrowth }] = await Promise.all([
    supabase.from("subscribers").select("platform, is_active, created_at").eq("project_id", id),
    supabase
      .from("campaigns")
      .select("id, channel, status, sent_count, delivered_count, failed_count, clicked_count, title, sent_at")
      .eq("project_id", id)
      .eq("status", "sent"),
    supabase.from("automation_log").select("source, status").eq("project_id", id).gte("created_at", since),
    // выручка показывается всегда (0, если атрибуция не подключена);
    // best-effort: до миграции 0009 таблицы нет — data будет null. is_paid/
    // paid_amount — миграция 0075, тоже best-effort на случай отставания.
    supabase.from("order_attributions").select("revenue, is_paid, paid_amount").eq("project_id", id),
    // Рост SMS/Email — по событиям включения согласия (identity_channel_events,
    // миграция 0029), т.к. у identities нет своей даты "стал подписчиком".
    // Реальное включение согласия считается тут же, что и повторное
    // (выкл→вкл) — недостаток best-effort-подсчёта, приемлемый для тренда.
    supabase
      .from("identity_channel_events")
      .select("channel, created_at")
      .eq("project_id", id)
      .eq("active", true)
      .in("channel", ["sms", "email"])
      .gte("created_at", since),
  ]);

  // Лучшее время/день для отправки — по факту вовлечённости (клик, для
  // email ещё и открытие) уже состоявшихся доставок, а не догадка. best-
  // effort: только 'delivered' — неудачные попытки не в счёт; последние
  // 5000 записей на канал достаточно даже для активного проекта, не
  // раздувает страницу до бесконечности.
  const { data: recipientRows } = await supabase
    .from("campaign_recipients")
    .select("channel, created_at, clicked_at, opened_at")
    .eq("project_id", id)
    .eq("status", "delivered")
    .order("created_at", { ascending: false })
    .limit(5000);
  const projectTimezone = project.timezone || "Europe/Moscow";
  const bestTimes = computeBestSendTimes(recipientRows ?? [], projectTimezone);

  const subRows = subs ?? [];
  const active = subRows.filter((r) => r.is_active);

  // Рост подписчиков по всем каналам за день — push по дате создания
  // устройства (subscribers.created_at), sms/email по дате включения
  // согласия (identity_channel_events).
  const days: { date: string; push: number; sms: number; email: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    days.push({ date: d.toISOString().slice(0, 10), push: 0, sms: 0, email: 0 });
  }
  const byDay = new Map(days.map((d) => [d.date, d]));
  for (const r of subRows) {
    const day = r.created_at?.slice(0, 10);
    const bucket = day ? byDay.get(day) : undefined;
    if (bucket) bucket.push++;
  }
  for (const e of channelGrowth ?? []) {
    const day = e.created_at?.slice(0, 10);
    const bucket = day ? byDay.get(day) : undefined;
    const ch = e.channel as "sms" | "email";
    if (bucket && (ch === "sms" || ch === "email")) bucket[ch]++;
  }
  const maxDay = Math.max(1, ...days.map((d) => d.push + d.sms + d.email));

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
  const paidRows = (attribution ?? []).filter((a) => a.is_paid);
  const paidOrders = paidRows.length;
  const paidSum = paidRows.reduce((s, a) => s + Number(a.paid_amount || 0), 0);

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Аналитика</h1>
      <p className="text-ink-muted mt-0 text-[13px]">Сводка за последние {DAYS} дней и по всем рассылкам.</p>

      {/* top tiles */}
      <div className="flex gap-3 mt-5 flex-wrap">
        <Tile label="Отправлено (всего)" value={totalSent} />
        <Tile label="CTR по рассылкам" value={`${ctr}%`} />
        <Tile label="Выручка" value={`${revenue.toLocaleString("ru-RU")} ₽`} />
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
        <div className="text-[13px] text-ink-muted mb-3">Рост подписчиков по каналам — новые за день, последние {DAYS} дней</div>
        <GrowthChart data={days} max={maxDay} />
      </Card>

      {/* best send time */}
      <Card className="mt-4">
        <div className="text-[13px] text-ink-muted mb-1">Лучшее время для отправки</div>
        <p className="text-[12px] text-ink-faint mt-0 mb-3">
          По факту вовлечённости уже доставленных рассылок (клики{bestTimes.hasEmail ? ", для email ещё и открытия" : ""}) — часовой пояс
          проекта ({projectTimezone}). Показаны сочетания с {MIN_SAMPLE}+ отправками.
        </p>
        {(["push", "sms", "email"] as const).every((ch) => !bestTimes[ch].length) ? (
          <div className="text-ink-faint text-sm">Пока недостаточно данных — нужно больше доставленных рассылок по каждому каналу.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {(["push", "sms", "email"] as const).map((ch) =>
              bestTimes[ch].length ? (
                <div key={ch}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge tone="accent">{channelLabel[ch]}</Badge>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {bestTimes[ch].map((b, i) => (
                      <div key={i} className="flex items-center justify-between text-[13.5px]">
                        <span className="text-ink">
                          {DAY_LABEL[b.weekday]}, {String(b.hour).padStart(2, "0")}:00–{String((b.hour + 1) % 24).padStart(2, "0")}:00
                        </span>
                        <span className="tabular-nums text-ink-muted">
                          {b.rate}% ({b.engaged} из {b.sent})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}
      </Card>

      {/* top campaigns */}
      <Card className="mt-4">
        <div className="text-[13px] text-ink-muted mb-3">Лучшие рассылки по CTR</div>
        {topByCtr.length === 0 ? (
          <div className="text-ink-faint text-sm">Пока нет отправленных рассылок</div>
        ) : (
          <div className="flex flex-col gap-2">
            {topByCtr.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-[13.5px] gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <Badge tone="accent">{channelLabel[c.channel] || c.channel}</Badge>
                  <span className="truncate">{c.title}</span>
                </span>
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
        <div className="text-[13px] text-ink-muted mb-1">Выручка (атрибуция заказов)</div>
        <div className="text-[26px] font-bold">{revenue.toLocaleString("ru-RU")} ₽</div>
        <div className="text-[12px] text-ink-faint">{orders} заказов с участием рассылок (модель — последний клик)</div>
        {orders === 0 && (
          <p className="text-[12.5px] text-ink-faint mt-2 mb-0">
            Заказов пока не поступало — проверьте вебхук атрибуции в разделе{" "}
            <a href={`/admin/projects/${id}/settings`} className="text-accent">
              Настройки
            </a>
            .
          </p>
        )}

        <div className="border-t border-border mt-3 pt-3">
          <div className="text-[13px] text-ink-muted mb-1">Оплачено (без доставки, со скидками)</div>
          <div className="text-[26px] font-bold">{paidSum.toLocaleString("ru-RU")} ₽</div>
          <div className="text-[12px] text-ink-faint">{paidOrders} оплаченных заказов</div>
          {paidOrders === 0 && (
            <p className="text-[12.5px] text-ink-faint mt-2 mb-0">
              Впишите путь к статусу оплаты в разделе{" "}
              <a href={`/admin/projects/${id}/settings`} className="text-accent">
                Настройки
              </a>{" "}
              — без него заказы никогда не считаются оплаченными.
            </p>
          )}
        </div>
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

const growthColors = { push: "var(--accent)", sms: "var(--good)", email: "var(--warn)" } as const;

function GrowthChart({ data, max }: { data: { date: string; push: number; sms: number; email: number }[]; max: number }) {
  const W = 640, H = 140, pad = 20;
  const bw = (W - pad * 2) / data.length;
  const scale = (H - pad * 2) / max;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px] block">
        {data.map((d, i) => {
          const x = pad + i * bw;
          let y = H - pad;
          return (
            <g key={d.date}>
              {(["push", "sms", "email"] as const).map((ch) => {
                if (!d[ch]) return null;
                const h = d[ch] * scale;
                y -= h;
                return <rect key={ch} x={x} y={y} width={Math.max(1, bw - 1)} height={h} rx={1} fill={growthColors[ch]} />;
              })}
            </g>
          );
        })}
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--border)" />
      </svg>
      <div className="flex justify-between text-[11px] text-ink-faint mt-1">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
      <div className="flex gap-4 text-xs text-ink-muted mt-2">
        {(["push", "sms", "email"] as const).map((ch) => (
          <span key={ch} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: growthColors[ch] }} />
            {channelLabel[ch]}
          </span>
        ))}
      </div>
    </div>
  );
}

// День недели (0=Вс..6=Сб, как Date.getDay) + час в заданном часовом поясе —
// та же конверсия, что и lib/sendWindow.ts, но нужен только weekday/hour,
// без полного zonedToUtc.
function weekdayHour(iso: string, tz: string): { weekday: number; hour: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" });
  const parts = dtf.formatToParts(new Date(iso)).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { weekday, hour };
}

type SendTimeBucket = { weekday: number; hour: number; sent: number; engaged: number; rate: number };

// Группирует уже доставленные рассылки по (день недели, час отправки) в
// часовом поясе проекта и считает вовлечённость (клик — для email ещё и
// открытие) в каждой ячейке — топ-5 сочетаний на канал с достаточной
// выборкой (MIN_SAMPLE), иначе одна случайная удачная отправка искажала бы
// рейтинг.
function computeBestSendTimes(
  rows: { channel: string; created_at: string; clicked_at: string | null; opened_at: string | null }[],
  timezone: string
): Record<"push" | "sms" | "email", SendTimeBucket[]> & { hasEmail: boolean } {
  const byChannel: Record<"push" | "sms" | "email", Map<string, { weekday: number; hour: number; sent: number; engaged: number }>> = {
    push: new Map(),
    sms: new Map(),
    email: new Map(),
  };
  let hasEmail = false;
  for (const r of rows) {
    const ch = r.channel as "push" | "sms" | "email";
    if (!byChannel[ch]) continue;
    if (ch === "email") hasEmail = true;
    const { weekday, hour } = weekdayHour(r.created_at, timezone);
    const key = `${weekday}-${hour}`;
    const bucket = byChannel[ch].get(key) || { weekday, hour, sent: 0, engaged: 0 };
    bucket.sent++;
    const engaged = ch === "email" ? !!r.clicked_at || !!r.opened_at : !!r.clicked_at;
    if (engaged) bucket.engaged++;
    byChannel[ch].set(key, bucket);
  }

  const rank = (ch: "push" | "sms" | "email"): SendTimeBucket[] =>
    [...byChannel[ch].values()]
      .filter((b) => b.sent >= MIN_SAMPLE)
      .map((b) => ({ ...b, rate: Math.round((b.engaged / b.sent) * 100) }))
      .sort((a, b) => b.rate - a.rate || b.sent - a.sent)
      .slice(0, 5);

  return { push: rank("push"), sms: rank("sms"), email: rank("email"), hasEmail };
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="flex-1 min-w-[150px]">
      <div className="text-ink-muted text-xs">{label}</div>
      <div className="text-[26px] font-bold">{value}</div>
    </Card>
  );
}
