import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveLoginStyle } from "@/lib/login-style";
import { normalizeAuthFailedUrl } from "@/lib/oidc";
import { SMS_PROVIDERS, TELEGRAM_PROVIDERS, EMAIL_PROVIDERS } from "@/lib/otp/providers";

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
    otpTemplates,
    authButtonColor,
    authButtonSize,
    authFailedUrl,
    loginStyle,
    smsSender,
    emailFrom,
    telegramToken,
    bytehandKey,
    haskimailToken,
    haskimailTransactionalStream,
    haskimailMarketingStream,
    smscLogin,
    smscPassword,
    mtsToken,
  } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  // client и secrets независимы друг от друга — читаем параллельно вместо
  // двух последовательных round-trip'ов к Supabase (заметная доля задержки
  // сохранения при удалённой БД).
  const [{ data: client }, { data: secrets }] = await Promise.all([
    admin.from("oidc_clients").select("client_id, config").eq("project_id", projectId).maybeSingle(),
    admin
      .from("project_secrets")
      .select("telegram_gateway_token, bytehand_service_key, haskimail_server_token, smsc_login, smsc_password, mts_token")
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);

  // Секреты (в т.ч. haskimail_marketing_stream) теперь используются не только
  // авторизацией, но и кампаниями/API — их можно сохранить и без включённого
  // входа по телефону. Настройки самого OIDC-каскада (channels/providers/
  // кнопка входа) по-прежнему требуют client — применять их не к чему без него.
  if (!client?.client_id) {
    const secretOnly: Record<string, string | null> = {};
    if (telegramToken !== undefined) secretOnly.telegram_gateway_token = telegramToken || null;
    if (bytehandKey !== undefined) secretOnly.bytehand_service_key = bytehandKey || null;
    if (haskimailToken !== undefined) secretOnly.haskimail_server_token = haskimailToken || null;
    if (haskimailTransactionalStream !== undefined) secretOnly.haskimail_transactional_stream = haskimailTransactionalStream || null;
    if (haskimailMarketingStream !== undefined) secretOnly.haskimail_marketing_stream = haskimailMarketingStream || null;
    if (smscLogin !== undefined) secretOnly.smsc_login = smscLogin || null;
    if (smscPassword !== undefined) secretOnly.smsc_password = smscPassword || null;
    if (mtsToken !== undefined) secretOnly.mts_token = mtsToken || null;
    // подписи отправителя живут в config и нужны подключениям без входа по телефону
    const stubConfig = { ...(client?.config || {}) };
    if (smsSender !== undefined) stubConfig.sms_sender = smsSender || null;
    if (emailFrom !== undefined) stubConfig.email_from = emailFrom || null;
    const hasSender = smsSender !== undefined || emailFrom !== undefined;
    if (Object.keys(secretOnly).length || hasSender) {
      await Promise.all([
        Object.keys(secretOnly).length ? admin.from("project_secrets").update(secretOnly).eq("project_id", projectId) : Promise.resolve(),
        hasSender ? admin.from("oidc_clients").upsert({ project_id: projectId, config: stubConfig }, { onConflict: "project_id" }) : Promise.resolve(),
      ]);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Сначала включите вход по телефону" }, { status: 400 });
  }

  // secrets уже прочитаны выше параллельно с client — текущее (до этого
  // сохранения) наличие секретов + то, что придёт в этом же вызове, чтобы
  // включаемый канал не остался без данных для отправки.

  // какой провайдер будет активен на каждый канал ПОСЛЕ этого сохранения —
  // от этого зависит, каких именно ключей достаточно для willHave ниже.
  const nextProviders: Record<string, string> = { ...(client.config?.providers || {}), ...(providers && typeof providers === "object" ? providers : {}) };
  const willHaveSmsc =
    (smscLogin !== undefined ? !!smscLogin : !!secrets?.smsc_login) && (smscPassword !== undefined ? !!smscPassword : !!secrets?.smsc_password);
  const willHaveMts = mtsToken !== undefined ? !!mtsToken : !!secrets?.mts_token;
  const willHaveBytehand = bytehandKey !== undefined ? !!bytehandKey : !!secrets?.bytehand_service_key;
  const willHaveTelegramGateway = telegramToken !== undefined ? !!telegramToken : !!secrets?.telegram_gateway_token;
  const willHaveHaskimail = haskimailToken !== undefined ? !!haskimailToken : !!secrets?.haskimail_server_token;
  const willHaveEmailFrom = !!(emailFrom !== undefined ? emailFrom : client.config?.email_from || "").toString().trim();

  // Настроен ли провайдер (есть ли для него ключи) — та же истина, что показывает форма
  const providerReady: Record<string, boolean> = {
    bytehand: willHaveBytehand,
    smsc: willHaveSmsc,
    mts: willHaveMts,
    telegram_gateway: willHaveTelegramGateway,
    haskimail: willHaveHaskimail,
  };

  // Какой провайдер реально работает на канале: сохранённый выбор, если он ещё настроен, иначе первый настроенный
  // (так же выбирает форма «Авторизация»). Раньше при несохранённом выборе сервер смотрел на ключ Bytehand и молча
  // выключал канал, хотя в форме был показан и настроен, например, МТС Маркетолог.
  function resolveProvider(ch: "sms" | "telegram" | "email"): string | undefined {
    const list = ch === "sms" ? SMS_PROVIDERS : ch === "telegram" ? TELEGRAM_PROVIDERS : EMAIL_PROVIDERS;
    const saved = nextProviders[ch];
    if (saved && list.some((p) => p.id === saved) && providerReady[saved]) return saved;
    return list.find((p) => providerReady[p.id])?.id;
  }
  const resolvedProvider = { sms: resolveProvider("sms"), telegram: resolveProvider("telegram"), email: resolveProvider("email") };

  const willHave = {
    telegram: !!resolvedProvider.telegram,
    sms: !!resolvedProvider.sms,
    // email-канал сверх токена ещё требует заполненного отправителя (From) —
    // без него сервис-провайдер либо отклонит письмо, либо, что хуже,
    // отправит с неверифицированного домена и уйдёт в спам.
    email: !!resolvedProvider.email && willHaveEmailFrom,
  };

  const config = { ...(client.config || {}) };
  // Актуальное состояние каналов (сохранённое + то, что придёт этим вызовом)
  // нужно ЗАРАНЕЕ — от него зависит проверка isEnabled ниже, даже если сам
  // запрос channels не трогает (например, отдельный клик по «Вход включён»).
  const savedChannels: Record<string, boolean> = { push: false, email: false, telegram: false, sms: false, ...(config.channels || {}) };
  let effectiveChannels = savedChannels;
  if (channels && typeof channels === "object") {
    const nextChannels = { ...savedChannels, ...channels };
    // сервер — последняя линия защиты: канал не включится без ключа/отправителя, даже если запрос пришёл не из
    // нашей формы (которая уже блокирует это в UI). Отказ возвращаем явной ошибкой, а не «успехом» с выключенным каналом.
    for (const ch of ["telegram", "sms", "email"] as const) {
      if (channels[ch] === true && !willHave[ch]) {
        return NextResponse.json(
          { error: ch === "email" && !willHaveEmailFrom ? "Сначала укажите email-отправителя (From) в разделе «Подключения»" : "Сначала настройте интеграцию в разделе «Подключения»" },
          { status: 400 }
        );
      }
      // включаемому каналу фиксируем провайдера, которого показывает форма: отправка берёт его из настроек
      if (channels[ch] === true && resolvedProvider[ch]) nextProviders[ch] = resolvedProvider[ch] as string;
    }
    config.channels = nextChannels;
    config.providers = nextProviders;
    effectiveChannels = nextChannels;
  }
  if (providers && typeof providers === "object") {
    config.providers = nextProviders;
  }
  // Шаблон кода входа на push/sms/email (см. lib/otp/index.ts loadOtpTemplate)
  // — telegram сюда не входит (Gateway API не несёт произвольный контент).
  // Пустая строка/null = сброс на встроенный текст по умолчанию.
  if (otpTemplates && typeof otpTemplates === "object") {
    const next: Record<string, string | null> = { ...(config.otp_templates || {}) };
    for (const ch of ["push", "sms", "email"] as const) {
      if (ch in otpTemplates) next[ch] = otpTemplates[ch] || null;
    }
    config.otp_templates = next;
  }

  // Вход нельзя включить без хотя бы одного реально работающего канала с
  // кодом — push сам по себе никого не онбордит (работает только для уже
  // узнанных устройств), поэтому не считается «настроенным каналом» здесь.
  if (isEnabled === true) {
    const hasWorkingChannel = (["email", "telegram", "sms"] as const).some((ch) => effectiveChannels[ch] === true && willHave[ch]);
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
  if (authButtonColor !== undefined) {
    const c = (authButtonColor || "").trim();
    config.auth_button_color = /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : null;
  }
  if (authButtonSize !== undefined) config.auth_button_size = ["s", "m", "l", "xl"].includes(authButtonSize) ? authButtonSize : null;
  if (loginStyle !== undefined) config.login_style = resolveLoginStyle(loginStyle);
  if (smsSender !== undefined) config.sms_sender = smsSender || null;
  if (emailFrom !== undefined) config.email_from = emailFrom || null;
  // Страница возврата при неудачном входе: только на сайте проекта (иначе открытое перенаправление)
  if (authFailedUrl !== undefined) {
    const { data: proj } = await admin.from("projects").select("domain").eq("id", projectId).maybeSingle();
    const n = normalizeAuthFailedUrl(authFailedUrl, proj?.domain || null);
    if (!n.ok) return NextResponse.json({ error: n.error }, { status: 400 });
    config.auth_failed_url = n.value;
  }

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
  if (mtsToken !== undefined) secretUpdates.mts_token = mtsToken || null;

  // Две независимые таблицы — пишем параллельно, не по очереди.
  await Promise.all([
    admin.from("oidc_clients").update(updates).eq("project_id", projectId),
    Object.keys(secretUpdates).length
      ? admin.from("project_secrets").update(secretUpdates).eq("project_id", projectId)
      : Promise.resolve(),
  ]);

  return NextResponse.json({ ok: true });
}
