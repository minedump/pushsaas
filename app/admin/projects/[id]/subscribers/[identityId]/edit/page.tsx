import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import EditSubscriberForm from "./EditSubscriberForm";

export default async function EditSubscriberPage({ params }: { params: Promise<{ id: string; identityId: string }> }) {
  const { id, identityId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { data: identity } = await supabase
    .from("identities")
    .select("id, phone, email, name, insales_client_id, tags, sms_marketing_active_at, email_marketing_active_at")
    .eq("id", identityId)
    .eq("project_id", id)
    .maybeSingle();
  if (!identity) notFound();

  return <EditSubscriberForm projectId={id} identity={identity} />;
}
