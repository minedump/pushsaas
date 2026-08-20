import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import IntegrationsSettings from "./IntegrationsSettings";

export default async function ConnectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, domain, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  // Ключи провайдеров (Haskimail/Telegram Gateway/Bytehand/SMSC) живут в
  // project_secrets — не зависят от того, включена ли авторизация: эти же
  // креды используются кампаниями (SMS/Email) и публичным API.
  // oidc_clients.config — только для sms_sender/email_from (общие подписи
  // отправителя) и не обязателен: без него поля просто начинаются пустыми.
  const admin = createAdminClient();
  // Три независимых запроса — читаем параллельно, не по очереди (иначе
  // страница ждёт три последовательных round-trip'а к Supabase зря).
  const [{ data: oidc }, { data: secrets }, { data: streamSecret, error: streamErr }] = await Promise.all([
    supabase.from("oidc_clients").select("config").eq("project_id", id).maybeSingle(),
    admin
      .from("project_secrets")
      .select("telegram_gateway_token, bytehand_service_key, haskimail_server_token, smsc_login, smsc_password")
      .eq("project_id", id)
      .maybeSingle(),
    // best-effort: haskimail_marketing_stream/haskimail_transactional_stream —
    // новые колонки (миграции 0020/0021), отсутствие не должно ронять остальные флаги.
    admin
      .from("project_secrets")
      .select("haskimail_marketing_stream, haskimail_transactional_stream")
      .eq("project_id", id)
      .maybeSingle(),
  ]);

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Подключения</h1>

      <IntegrationsSettings
        projectId={project.id}
        initial={{
          smsSender: oidc?.config?.sms_sender || "",
          emailFrom: oidc?.config?.email_from || "",
          hasTelegram: !!secrets?.telegram_gateway_token,
          hasBytehand: !!secrets?.bytehand_service_key,
          hasHaskimail: !!secrets?.haskimail_server_token,
          hasHaskimailStream: !streamErr && !!streamSecret?.haskimail_marketing_stream,
          hasHaskimailTransactionalStream: !streamErr && !!streamSecret?.haskimail_transactional_stream,
          hasSmsc: !!secrets?.smsc_login && !!secrets?.smsc_password,
        }}
      />
    </main>
  );
}
