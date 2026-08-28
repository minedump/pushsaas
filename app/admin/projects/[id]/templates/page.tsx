import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import TemplatesManager from "./TemplatesManager";

export default async function TemplatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const [{ data: templatesRaw }, { data: folders }] = await Promise.all([
    supabase
      .from("templates")
      .select("id, name, channel, folder_id, subject, html, title, body, url, icon_url, image_url, badge_url, actions, context, created_at, updated_at, created_by")
      .eq("project_id", id)
      .order("updated_at", { ascending: false }),
    supabase.from("template_folders").select("id, name").eq("project_id", id).order("name"),
  ]);

  // Имя+email автора через admin-клиент (обход RLS profiles) — автором мог
  // быть суперадмин, чей профиль владельцу проекта обычным select недоступен.
  const creatorIds = [...new Set((templatesRaw ?? []).map((t) => t.created_by).filter(Boolean))] as string[];
  const admin = createAdminClient();
  const { data: creators } = creatorIds.length
    ? await admin.from("profiles").select("id, email, full_name").in("id", creatorIds)
    : { data: [] as { id: string; email: string; full_name: string | null }[] };
  const creatorById = new Map((creators ?? []).map((c) => [c.id, c]));

  const templates = (templatesRaw ?? []).map((t) => ({
    ...t,
    created_by_email: t.created_by ? (creatorById.get(t.created_by)?.email ?? null) : null,
    created_by_name: t.created_by ? (creatorById.get(t.created_by)?.full_name ?? null) : null,
  }));

  return (
    <main className="max-w-4xl mx-auto">
      <TemplatesManager projectId={id} initialTemplates={templates} initialFolders={folders ?? []} />
    </main>
  );
}
