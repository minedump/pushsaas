import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { Badge, Card } from "@/app/ui";
import AutomationsManager from "./AutomationsManager";

const sourceLabel: Record<string, string> = { event: "Событие", api: "API", webhook: "Вебхук", welcome: "Welcome" };
const statusTone = (s: string) => (s === "sent" ? "good" : s === "failed" ? "bad" : "warn") as "good" | "bad" | "warn";

export default async function AutomationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { data: automations } = await supabase
    .from("automations")
    .select("id, type, is_enabled, delay_minutes, title, body, click_url, config")
    .eq("project_id", id)
    .order("created_at");

  const list = automations ?? [];
  const welcome = list.find((a) => a.type === "welcome") ?? null;
  const events = list.filter((a) => a.type === "event");
  const custom = list.filter((a) => a.type === "custom");

  const { data: logRows } = await supabase
    .from("automation_log")
    .select("id, source, title, status, recipients, detail, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(150);

  const log = logRows ?? [];

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Автоматизации</h1>
      <div className="max-w-2xl">
        <AutomationsManager projectId={id} welcome={welcome} events={events} custom={custom} />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Журнал</h2>
        <p className="text-ink-muted mt-0 text-[13px]">Сработки триггеров: событийные, по API и по вебхукам.</p>

        {log.length === 0 ? (
          <Card className="mt-3 text-ink-muted">Пока пусто — здесь появятся запуски автоматизаций.</Card>
        ) : (
          <div className="mt-3 border border-border rounded-xl overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px] min-w-[640px]">
              <thead>
                <tr className="bg-surface-2 text-left">
                  <Th>Источник</Th>
                  <Th>Автоматизация</Th>
                  <Th>Статус</Th>
                  <Th right>Получатели</Th>
                  <Th>Детали</Th>
                  <Th>Время</Th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <Td>
                      <Badge tone="accent">{sourceLabel[r.source] || r.source}</Badge>
                    </Td>
                    <Td>{r.title || "—"}</Td>
                    <Td>
                      <Badge tone={statusTone(r.status)} dot>
                        {r.status}
                      </Badge>
                    </Td>
                    <Td right>{r.recipients}</Td>
                    <Td className="text-ink-muted">{fmtDetail(r.detail)}</Td>
                    <Td className="text-ink-faint whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function fmtDetail(d: Record<string, unknown> | null): string {
  if (!d || typeof d !== "object") return "";
  const parts: string[] = [];
  if (d.orderNumber) parts.push(`заказ №${d.orderNumber}`);
  if (d.key) parts.push(`ключ ${d.key}`);
  if (Array.isArray(d.segmentTags) && d.segmentTags.length) parts.push(`сегмент ${d.segmentTags.join(", ")}`);
  return parts.join(" · ");
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`px-3.5 py-2.5 text-[11px] uppercase tracking-wider text-ink-faint font-normal whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-3.5 py-3 align-middle ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
);
