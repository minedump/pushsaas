import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TZ } from "@/lib/datetime";
import { ProjectTimeProvider } from "./ProjectTimeProvider";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("timezone").eq("id", id).maybeSingle();
  return <ProjectTimeProvider timezone={data?.timezone || DEFAULT_TZ}>{children}</ProjectTimeProvider>;
}
