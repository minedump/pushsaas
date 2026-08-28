import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
    .select(
      "id, name, channel, folder_id, subject, html, title, body, url, icon_url, image_url, badge_url, actions, context, created_at, created_by"
    )
    .eq("id", templateId)
    .eq("project_id", id)
    .maybeSingle();
  if (!template) notFound();

  const { data: folders } = await supabase.from("template_folders").select("id, name").eq("project_id", id).order("name");

  // Имя+email автора через admin-клиент (см. тот же приём в templates/page.tsx) —
  // автором мог быть суперадмин, чей профиль владельцу проекта обычным
  // select недоступен из-за RLS profiles.
  let createdByName: string | null = null;
  let createdByEmail: string | null = null;
  if (template.created_by) {
    const admin = createAdminClient();
    const { data: creator } = await admin.from("profiles").select("email, full_name").eq("id", template.created_by).maybeSingle();
    createdByName = creator?.full_name ?? null;
    createdByEmail = creator?.email ?? null;
  }

  return (
    <EditTemplateForm
      projectId={id}
      template={template}
      folders={folders ?? []}
      createdAt={template.created_at}
      createdByName={createdByName}
      createdByEmail={createdByEmail}
    />
  );
}
