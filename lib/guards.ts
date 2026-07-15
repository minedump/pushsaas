import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// TryVice AppWrapper behaviour: a blocked project sends its OWNER to billing
// (only billing/profile stay reachable). Superadmin is never affected.
export async function ensureProjectAccessible(projectId: string, isActive: boolean) {
  if (isActive) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle();
  if (profile?.role !== "admin") redirect(`/admin/projects/${projectId}/billing`);
}
