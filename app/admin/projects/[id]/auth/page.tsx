import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import { issuerFor } from "@/lib/oidc";
import { resolveLoginStyle } from "@/lib/login-style";
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
  let hasSmsc = false;
  if (oidc) {
    const admin = createAdminClient();
    const { data: secrets } = await admin
      .from("project_secrets")
      .select("telegram_gateway_token, bytehand_service_key")
      .eq("project_id", id)
      .maybeSingle();
    hasTelegram = !!secrets?.telegram_gateway_token;
    hasBytehand = !!secrets?.bytehand_service_key;

    // best-effort: haskimail_server_token/smsc_* — отдельные запросы (миграции
    // 0010/0017), чтобы отсутствующая колонка не сбивала статус telegram/bytehand выше.
    const { data: emailSecret, error: emailErr } = await admin
      .from("project_secrets")
      .select("haskimail_server_token")
      .eq("project_id", id)
      .maybeSingle();
    hasHaskimail = !emailErr && !!emailSecret?.haskimail_server_token;

    const { data: smscSecret, error: smscErr } = await admin
      .from("project_secrets")
      .select("smsc_login, smsc_password")
      .eq("project_id", id)
      .maybeSingle();
    hasSmsc = !smscErr && !!smscSecret?.smsc_login && !!smscSecret?.smsc_password;
  }
  const hasEmailFrom = !!oidc?.config?.email_from?.toString().trim();

  const { data: templates } = await supabase
    .from("templates")
    .select("id, name, channel")
    .eq("project_id", id)
    .in("channel", ["push", "sms", "email"])
    .order("name");

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Авторизация</h1>

      <AuthSettings
        projectId={id}
        projectDomain={project.domain}
        issuer={issuerFor(id)}
        templates={templates ?? []}
        initial={
          oidc
            ? {
                clientId: oidc.client_id,
                isEnabled: oidc.is_enabled,
                channels: { push: true, email: true, telegram: true, sms: true, ...(oidc.config?.channels || {}) },
                channelOrder: Array.isArray(oidc.config?.channel_order) ? oidc.config.channel_order : [],
                providers: oidc.config?.providers || {},
                otpTemplates: oidc.config?.otp_templates || {},
                hideNativeLoginButton: !!oidc.config?.hide_native_login_button,
                authButtonText: oidc.config?.auth_button_text || "",
                authButtonIcon: oidc.config?.auth_button_icon || "",
                authButtonColor: oidc.config?.auth_button_color || "",
                authButtonSize: oidc.config?.auth_button_size || "",
                authButtonRounded: !!oidc.config?.auth_button_rounded,
                loginStyle: resolveLoginStyle(oidc.config?.login_style),
                hasTelegram,
                hasBytehand,
                hasHaskimail,
                hasSmsc,
                hasEmailFrom,
              }
            : null
        }
      />
    </main>
  );
}
