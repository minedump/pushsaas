import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminShell from "../admin/AdminShell";

// /superadmin/* is also guarded by middleware (role=admin). This layout reuses
// the same shell so navigation is unified across client and superadmin zones.
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") redirect("/admin");

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .order("created_at", { ascending: false });

  return (
    <AdminShell role="admin" projects={projects ?? []}>
      {children}
    </AdminShell>
  );
}
