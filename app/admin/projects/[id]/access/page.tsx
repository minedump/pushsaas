import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import AccessManager from "./AccessManager";

export default async function ProjectAccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, is_active, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (!project || !user) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  // Доступ к проекту уже подтверждён политикой выше; email и имена людей
  // лежат в profiles, которые клиенту напрямую не видны, поэтому читаем
  // их сервисным клиентом.
  const admin = createAdminClient();
  const { data: memberRows } = await admin
    .from("project_members")
    .select("user_id, created_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: true });

  const ids = [project.owner_id, ...(memberRows ?? []).map((m) => m.user_id)].filter(Boolean) as string[];
  const { data: profiles } = await admin.from("profiles").select("id, email, full_name").in("id", ids);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const owner = {
    userId: project.owner_id as string,
    email: byId.get(project.owner_id)?.email ?? "—",
    name: byId.get(project.owner_id)?.full_name ?? null,
  };
  const members = (memberRows ?? []).map((m) => ({
    userId: m.user_id,
    email: byId.get(m.user_id)?.email ?? "—",
    name: byId.get(m.user_id)?.full_name ?? null,
    createdAt: m.created_at,
  }));

  return (
    <AccessManager
      projectId={project.id}
      currentUserId={user.id}
      owner={owner}
      initialMembers={members}
    />
  );
}
