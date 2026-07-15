import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import { issuerFor } from "@/lib/oidc";
import AuthSettings from "./AuthSettings";

export default async function AuthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS: вернёт проект только владельцу/админу
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, domain, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { data: oidc } = await supabase
    .from("oidc_clients")
    .select("client_id, is_enabled, config")
    .eq("project_id", id)
    .maybeSingle();

  // Наличие токенов каналов (сами значения владельцу не показываем)
  let hasTelegram = false;
  let hasBytehand = false;
  let hasHaskimail = false;
  if (oidc) {
    const admin = createAdminClient();
    const { data: secrets } = await admin
      .from("project_secrets")
      .select("telegram_gateway_token, bytehand_service_key")
      .eq("project_id", id)
      .maybeSingle();
    hasTelegram = !!secrets?.telegram_gateway_token;
    hasBytehand = !!secrets?.bytehand_service_key;

    // best-effort: haskimail_server_token — отдельный запрос (миграция 0010),
    // чтобы отсутствующая колонка не сбивала статус telegram/bytehand выше.
    const { data: emailSecret, error: emailErr } = await admin
      .from("project_secrets")
      .select("haskimail_server_token")
      .eq("project_id", id)
      .maybeSingle();
    hasHaskimail = !emailErr && !!emailSecret?.haskimail_server_token;
  }

  return (
    <main className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">{project.name} · Вход по телефону</h1>
      <p className="text-ink-muted mt-0">
        Покупатель входит в магазин по номеру телефона с кодом из push-уведомления, email, Telegram или SMS. Работает
        через OpenID Connect — InSales поддерживает из коробки. Каждый вход списывает <b>1 push</b> с баланса
        проекта, независимо от канала доставки кода (переотправки кода внутри одного входа не тарифицируются).
      </p>

      <AuthSettings
        projectId={id}
        projectDomain={project.domain}
        issuer={issuerFor(id)}
        appUrl={process.env.NEXT_PUBLIC_APP_URL || ""}
        initial={
          oidc
            ? {
                clientId: oidc.client_id,
                isEnabled: oidc.is_enabled,
                channels: { push: true, email: true, telegram: true, sms: true, ...(oidc.config?.channels || {}) },
                channelOrder: Array.isArray(oidc.config?.channel_order) ? oidc.config.channel_order : [],
                requirePhoneVerification: oidc.config?.require_phone_verification !== false,
                smsSender: oidc.config?.sms_sender || "",
                emailFrom: oidc.config?.email_from || "",
                hasTelegram,
                hasBytehand,
                hasHaskimail,
              }
            : null
        }
      />
    </main>
  );
}
