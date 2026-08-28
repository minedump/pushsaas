import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import MediaLibrary from "./MediaLibrary";

export default async function MediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const [{ data: assetsRaw }, { data: folders }] = await Promise.all([
    supabase
      .from("media_assets")
      .select("id, name, url, size, mime_type, width, height, folder_id, created_at, created_by")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("media_folders").select("id, name").eq("project_id", id).order("name"),
  ]);

  // Имя+email автора через admin-клиент (см. тот же приём в templates/page.tsx) —
  // автором мог быть суперадмин, чей профиль владельцу проекта обычным
  // select недоступен из-за RLS profiles.
  const creatorIds = [...new Set((assetsRaw ?? []).map((a) => a.created_by).filter(Boolean))] as string[];
  const admin = createAdminClient();
  const { data: creators } = creatorIds.length
    ? await admin.from("profiles").select("id, email, full_name").in("id", creatorIds)
    : { data: [] as { id: string; email: string; full_name: string | null }[] };
  const creatorById = new Map((creators ?? []).map((c) => [c.id, c]));

  const assets = (assetsRaw ?? []).map((a) => ({
    ...a,
    created_by_email: a.created_by ? (creatorById.get(a.created_by)?.email ?? null) : null,
    created_by_name: a.created_by ? (creatorById.get(a.created_by)?.full_name ?? null) : null,
  }));

  return (
    <main className="max-w-4xl mx-auto">
      <MediaLibrary projectId={id} initialAssets={assets} initialFolders={folders ?? []} />
    </main>
  );
}
