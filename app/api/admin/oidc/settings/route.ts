import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Настройки входа по телефону: каналы каскада + их порядок, подпись SMS,
// email-отправитель, видимость нативной кнопки InSales, токены каналов.
// Токены: непустая строка — сохранить; null — стереть; отсутствие поля — не трогать.
export async function POST(req: Request) {
  const {
    projectId,
    isEnabled,
    channels,
    channelOrder,
    hideNativeLoginButton,
    authButtonText,
    authButtonIcon,
    authButtonColor,
    authButtonSize,
    authButtonRounded,
    smsSender,
    emailFrom,
    telegramToken,
    bytehandKey,
    haskimailToken,
  } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  const { data: client } = await admin
    .from("oidc_clients")
    .select("config")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Сначала включите вход по телефону" }, { status: 400 });

  // текущее (до этого сохранения) наличие секретов + то, что придёт в этом
  // же вызове — чтобы включаемый канал не остался без данных для отправки.
  const { data: secrets } = await admin
    .from("project_secrets")
    .select("telegram_gateway_token, bytehand_service_key, haskimail_server_token")
    .eq("project_id", projectId)
    .maybeSingle();
  const willHave = {
    telegram: telegramToken !== undefined ? !!telegramToken : !!secrets?.telegram_gateway_token,
    sms: bytehandKey !== undefined ? !!bytehandKey : !!secrets?.bytehand_service_key,
    // email-канал сверх токена ещё требует заполненного отправителя (From) —
    // без него сервис-провайдер либо отклонит письмо, либо, что хуже,
    // отправит с неверифицированного в Haskimail домена и уйдёт в спам.
    email: (haskimailToken !== undefined ? !!haskimailToken : !!secrets?.haskimail_server_token) && !!(emailFrom !== undefined ? emailFrom : client.config?.email_from || "").toString().trim(),
  };

  const config = { ...(client.config || {}) };
  if (channels && typeof channels === "object") {
    const nextChannels = { ...(config.channels || {}), ...channels };
    // сервер — последняя линия защиты: канал не включится без ключа/отправителя,
    // даже если запрос пришёл не из нашей формы (которая уже блокирует это в UI).
    for (const ch of ["telegram", "sms", "email"] as const) {
      if (nextChannels[ch] && !willHave[ch]) nextChannels[ch] = false;
    }
    config.channels = nextChannels;
  }
  if (Array.isArray(channelOrder)) config.channel_order = channelOrder.filter((c: unknown) => typeof c === "string");
  if (hideNativeLoginButton !== undefined) config.hide_native_login_button = !!hideNativeLoginButton;
  if (authButtonText !== undefined) config.auth_button_text = (authButtonText || "").trim() || null;
  if (authButtonIcon !== undefined) config.auth_button_icon = (authButtonIcon || "").trim() || null;
  if (authButtonColor !== undefined) {
    const c = (authButtonColor || "").trim();
    config.auth_button_color = /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : null;
  }
  if (authButtonSize !== undefined) config.auth_button_size = ["s", "m", "l", "xl"].includes(authButtonSize) ? authButtonSize : null;
  if (authButtonRounded !== undefined) config.auth_button_rounded = !!authButtonRounded;
  if (smsSender !== undefined) config.sms_sender = smsSender || null;
  if (emailFrom !== undefined) config.email_from = emailFrom || null;

  const updates: Record<string, unknown> = { config };
  if (isEnabled !== undefined) updates.is_enabled = !!isEnabled;
  await admin.from("oidc_clients").update(updates).eq("project_id", projectId);

  const secretUpdates: Record<string, string | null> = {};
  if (telegramToken !== undefined) secretUpdates.telegram_gateway_token = telegramToken || null;
  if (bytehandKey !== undefined) secretUpdates.bytehand_service_key = bytehandKey || null;
  if (haskimailToken !== undefined) secretUpdates.haskimail_server_token = haskimailToken || null;
  if (Object.keys(secretUpdates).length) {
    await admin.from("project_secrets").update(secretUpdates).eq("project_id", projectId);
  }

  return NextResponse.json({ ok: true });
}
