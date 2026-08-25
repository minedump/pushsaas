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
    .select("id, phone, email, name, insales_client_id, tags, sms_marketing_active_at, email_marketing_active_at, attributes")
    .eq("id", identityId)
    .eq("project_id", id)
    .maybeSingle();
  if (!identity) notFound();

  // Доп. поля контакта (например loyalty_tier из CSV-импорта) — набор
  // ключей, встречавшихся хотя бы у ОДНОГО контакта проекта, чтобы поле,
  // расширенное у одного подписчика, было видно и заполняемо у остальных
  // (см. EditSubscriberForm — блок «Доп. поля»), не только у того, кому его
  // изначально проставили импортом.
  const { data: allAttrs } = await supabase.from("identities").select("attributes").eq("project_id", id);
  const attributeKeys = [...new Set((allAttrs ?? []).flatMap((i) => Object.keys((i.attributes as object) || {})))].sort((a, b) =>
    a.localeCompare(b, "ru")
  );

  return <EditSubscriberForm projectId={id} identity={identity} attributeKeys={attributeKeys} />;
}
