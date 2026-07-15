import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NewProjectForm from "./NewProjectForm";

export default async function NewProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // superadmin doesn't create projects for themselves — send them to clients
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle();
  if (profile?.role === "admin") redirect("/superadmin/clients");

  return <NewProjectForm />;
}
