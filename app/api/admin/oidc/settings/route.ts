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
    providers,
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
    haskimailTransactionalStream,
    haskimailMarketingStream,
    smscLogin,
    smscPassword,
  } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  // client и secrets независимы друг от друга — читаем параллельно вместо
  // двух последовательных round-trip'ов к Supabase (заметная доля задержки
  // сохранения при удалённой БД).
  const [{ data: client }, { data: secrets }] = await Promise.all([
    admin.from("oidc_clients").select("config").eq("project_id", projectId).maybeSingle(),
    admin
      .from("project_secrets")
      .select("telegram_gateway_token, bytehand_service_key, haskimail_server_token, smsc_login, smsc_password")
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);

  // Секреты (в т.ч. haskimail_marketing_stream) теперь используются не только
  // авторизацией, но и кампаниями/API — их можно сохранить и без включённого
  // входа по телефону. Настройки самого OIDC-каскада (channels/providers/
  // кнопка входа) по-прежнему требуют client — применять их не к чему без него.
  if (!client) {
    const secretOnly: Record<string, string | null> = {};
    if (telegramToken !== undefined) secretOnly.telegram_gateway_token = telegramToken || null;
    if (bytehandKey !== undefined) secretOnly.bytehand_service_key = bytehandKey || null;
    if (haskimailToken !== undefined) secretOnly.haskimail_server_token = haskimailToken || null;
    if (haskimailTransactionalStream !== undefined) secretOnly.haskimail_transactional_stream = haskimailTransactionalStream || null;
    if (haskimailMarketingStream !== undefined) secretOnly.haskimail_marketing_stream = haskimailMarketingStream || null;
    if (smscLogin !== undefined) secretOnly.smsc_login = smscLogin || null;
    if (smscPassword !== undefined) secretOnly.smsc_password = smscPassword || null;
    if (Object.keys(secretOnly).length) {
      await admin.from("project_secrets").update(secretOnly).eq("project_id", projectId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Сначала включите вход по телефону" }, { status: 400 });
  }

  // secrets уже прочитаны выше параллельно с client — текущее (до этого
  // сохранения) наличие секретов + то, что придёт в этом же вызове, чтобы
  // включаемый канал не остался без данных для отправки.

  // какой провайдер будет активен на каждый канал ПОСЛЕ этого сохранения —
  // от этого зависит, каких именно ключей достаточно для willHave ниже.
  const nextProviders = { ...(client.config?.providers || {}), ...(providers && typeof providers === "object" ? providers : {}) };
  const willHaveSmsc =
    (smscLogin !== undefined ? !!smscLogin : !!secrets?.smsc_login) && (smscPassword !== undefined ? !!smscPassword : !!secrets?.smsc_password);
  const willHaveEmailFrom = !!(emailFrom !== undefined ? emailFrom : client.config?.email_from || "").toString().trim();

  const willHave = {
    telegram: nextProviders.telegram === "smsc" ? willHaveSmsc : telegramToken !== undefined ? !!telegramToken : !!secrets?.telegram_gateway_token,
    sms: nextProviders.sms === "smsc" ? willHaveSmsc : bytehandKey !== undefined ? !!bytehandKey : !!secrets?.bytehand_service_key,
    // email-канал сверх токена ещё требует заполненного отправителя (From) —
    // без него сервис-провайдер либо отклонит письмо, либо, что хуже,
    // отправит с неверифицированного домена и уйдёт в спам.
    email:
      (nextProviders.email === "smsc" ? willHaveSmsc : haskimailToken !== undefined ? !!haskimailToken : !!secrets?.haskimail_server_token) &&
      willHaveEmailFrom,
  };

  const config = { ...(client.config || {}) };
  // Актуальное состояние каналов (сохранённое + то, что придёт этим вызовом)
  // нужно ЗАРАНЕЕ — от него зависит проверка isEnabled ниже, даже если сам
  // запрос channels не трогает (например, отдельный клик по «Вход включён»).
  const savedChannels: Record<string, boolean> = { push: true, email: true, telegram: true, sms: true, ...(config.channels || {}) };
  let effectiveChannels = savedChannels;
  if (channels && typeof channels === "object") {
    const nextChannels = { ...savedChannels, ...channels };
    // сервер — последняя линия защиты: канал не включится без ключа/отправителя,
    // даже если запрос пришёл не из нашей формы (которая уже блокирует это в UI).
    for (const ch of ["telegram", "sms", "email"] as const) {
      if (nextChannels[ch] && !willHave[ch]) nextChannels[ch] = false;
    }
    config.channels = nextChannels;
    effectiveChannels = nextChannels;
  }
  if (providers && typeof providers === "object") {
    config.providers = nextProviders;
  }

  // Вход нельзя включить без хотя бы одного реально работающего канала с
  // кодом — push сам по себе никого не онбордит (работает только для уже
  // узнанных устройств), поэтому не считается «настроенным каналом» здесь.
  if (isEnabled === true) {
    const hasWorkingChannel = (["email", "telegram", "sms"] as const).some((ch) => effectiveChannels[ch] !== false && willHave[ch]);
    if (!hasWorkingChannel) {
      return NextResponse.json(
        {
          error:
            "Сначала настройте и включите хотя бы один канал с кодом (Email, Telegram или SMS) — push один не подойдёт, он работает только для уже узнанных устройств.",
        },
        { status: 400 }
      );
    }
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

  const secretUpdates: Record<string, string | null> = {};
  if (telegramToken !== undefined) secretUpdates.telegram_gateway_token = telegramToken || null;
  if (bytehandKey !== undefined) secretUpdates.bytehand_service_key = bytehandKey || null;
  if (haskimailToken !== undefined) secretUpdates.haskimail_server_token = haskimailToken || null;
  if (haskimailTransactionalStream !== undefined) secretUpdates.haskimail_transactional_stream = haskimailTransactionalStream || null;
  if (haskimailMarketingStream !== undefined) secretUpdates.haskimail_marketing_stream = haskimailMarketingStream || null;
  if (smscLogin !== undefined) secretUpdates.smsc_login = smscLogin || null;
  if (smscPassword !== undefined) secretUpdates.smsc_password = smscPassword || null;

  // Две независимые таблицы — пишем параллельно, не по очереди.
  await Promise.all([
    admin.from("oidc_clients").update(updates).eq("project_id", projectId),
    Object.keys(secretUpdates).length
      ? admin.from("project_secrets").update(secretUpdates).eq("project_id", projectId)
      : Promise.resolve(),
  ]);

  return NextResponse.json({ ok: true });
}
