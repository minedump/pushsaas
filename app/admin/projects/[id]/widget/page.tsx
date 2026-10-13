import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { resolveButtonConfig, resolvePromptConfig } from "@/lib/widget-config";
import { resolveInstallConfig } from "@/lib/install-guide";
import WidgetSettings from "./WidgetSettings";

export default async function WidgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, is_active, widget_config, manifest_config").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const config = (project.widget_config as { button?: unknown; prompt?: unknown; install?: unknown } | null) || {};
  // версия схем в окне «Установка приложения» — метка последней генерации манифеста
  const manifest = project.manifest_config as { generated_at?: string } | null;
  const installVersion = String(manifest?.generated_at || "0").replace(/\D/g, "");

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Виджеты</h1>

      <WidgetSettings
        projectId={id}
        initialButton={resolveButtonConfig(config.button)}
        initialPrompt={resolvePromptConfig(config.prompt)}
        initialInstall={resolveInstallConfig(config.install, id)}
        installVersion={installVersion}
        hasManifest={!!manifest}
      />
    </main>
  );
}
