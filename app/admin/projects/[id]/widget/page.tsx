import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { resolveButtonConfig, resolvePromptConfig } from "@/lib/widget-config";
import WidgetSettings from "./WidgetSettings";

export default async function WidgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, is_active, widget_config").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const config = (project.widget_config as { button?: unknown; prompt?: unknown } | null) || {};

  return (
    <main className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold">Виджеты</h1>

      <WidgetSettings projectId={id} initialButton={resolveButtonConfig(config.button)} initialPrompt={resolvePromptConfig(config.prompt)} />
    </main>
  );
}
