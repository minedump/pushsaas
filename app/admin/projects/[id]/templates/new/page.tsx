import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import NewTemplateForm from "./NewTemplateForm";

export default async function NewTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ channel?: string; folderId?: string }>;
}) {
  const { id } = await params;
  const { channel, folderId } = await searchParams;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { data: folders } = await supabase.from("template_folders").select("id, name").eq("project_id", id).order("name");

  return (
    <NewTemplateForm
      projectId={id}
      folders={folders ?? []}
      initialChannel={channel === "push" || channel === "sms" || channel === "email" ? channel : undefined}
      initialFolderId={folderId}
    />
  );
}
