import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import AutomationsManager from "./AutomationsManager";

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

  return (
    <main className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold">{project.name} · Автоматизации</h1>
      <AutomationsManager projectId={id} welcome={welcome} events={events} custom={custom} />
    </main>
  );
}
