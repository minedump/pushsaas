import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import EditTemplateForm from "./EditTemplateForm";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string; templateId: string }> }) {
  const { id, templateId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { data: template } = await supabase
    .from("templates")
    .select("id, name, channel, folder_id, subject, html, title, body, url, icon_url, image_url, badge_url, actions")
    .eq("id", templateId)
    .eq("project_id", id)
    .maybeSingle();
  if (!template) notFound();

  const { data: folders } = await supabase.from("template_folders").select("id, name").eq("project_id", id).order("name");

  return <EditTemplateForm projectId={id} template={template} folders={folders ?? []} />;
}
