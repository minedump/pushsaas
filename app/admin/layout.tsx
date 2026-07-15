import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminShell from "./AdminShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .order("created_at", { ascending: false });

  return (
    <AdminShell role={profile?.role ?? "client"} projects={projects ?? []}>
      {children}
    </AdminShell>
  );
}
