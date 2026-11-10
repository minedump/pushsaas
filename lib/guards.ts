import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Проект заблокирован вручную: его владельца отправляет на страницу «Проект
// заблокирован», остальное недоступно. Суперадмина блокировка не касается.
export async function ensureProjectAccessible(projectId: string, isActive: boolean) {
  if (isActive) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle();
  if (profile?.role !== "admin") redirect(`/admin/projects/${projectId}/blocked`);
}
