import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPush } from "@/lib/webpush";
import { checkSendAbility, sendTelegramCode } from "./telegram";
import { sendSms } from "./sms";
import { sendEmailCode } from "./haskimail";

// Каскад отправки кода подтверждения:
//   1. push — на устройства, уже привязанные к телефону (бесплатно, не тарифицируется)
//   2. email — на почту, известную по прошлым заказам (бесплатно, только для возвратных)
//   3. telegram — Telegram Gateway, $0.01/код (если checkSendAbility одобрил)
//   4. sms — Bytehand (последний рубеж)
// Гигиена: TTL 5 минут, 5 попыток ввода, не более 3 отправок на номер за 10 минут.

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_SENDS = 3;

export type OtpChannel = "push" | "email" | "telegram" | "sms";
export type SendOtpResult =
  | { ok: true; otpId: string; channel: OtpChannel }
  | { ok: false; error: "rate_limited" | "no_channel" | "device_not_linked" };

export const DEFAULT_CHANNEL_ORDER: OtpChannel[] = ["push", "email", "telegram", "sms"];

// Порядок каскада настраивается в проекте (config.channel_order); неизвестные
///пропущенные каналы добавляются в конец в дефолтном порядке — так кривая
// или неполная настройка никогда тихо не выкидывает канал из каскада целиком.
export function resolveOrder(configured: unknown): OtpChannel[] {
  const valid = Array.isArray(configured) ? configured.filter((c): c is OtpChannel => DEFAULT_CHANNEL_ORDER.includes(c)) : [];
  const missing = DEFAULT_CHANNEL_ORDER.filter((c) => !valid.includes(c));
  return [...valid, ...missing];
}

// Email известен, только если он уже сохранён у ПОДТВЕРЖДЁННОЙ личности
// (обычно попадает туда из вебхука заказа — client.email рядом с телефоном).
async function knownEmailFor(projectId: string, phoneDigits: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("identities")
    .select("email")
    .eq("project_id", projectId)
    .eq("phone", phoneDigits)
    .not("phone_verified_at", "is", null)
    .maybeSingle();
  return data?.email || null;
}

function genCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashCode(otpId: string, code: string): string {
  return crypto.createHash("sha256").update(`${otpId}:${code}`).digest("hex");
}

type ChannelConfig = { push?: boolean; email?: boolean; telegram?: boolean; sms?: boolean };

// Отправляет код по каскаду. forceChannel — «отправить ещё раз через …» с UI.
//
// Push отправляется ТОЛЬКО на уже честно привязанные устройства (реальная
// связка телефон+устройство в identity_devices, появившаяся либо через этот
// же каскад ранее, либо через /api/public/identify). Самозаписи "это моё
// устройство, доверьтесь мне" больше нет — это и было единственной лазейкой
// для угона: чужое устройство могло заявить чужой номер и получить его код.
//
// Если для номера нет привязанного устройства, поведение решает тумблер
// require_phone_verification проекта:
//   ВКЛ (по умолчанию, безопасно) — просто продолжаем каскад через
//     email/telegram/sms как обычно (никакого отказа).
//   ВЫКЛ (доверяем сессии InSales вместо своего кода) — отказываем сразу
//     ("device_not_linked"): связку в этом режиме создаёт только identify()
//     при авторизации клиента в магазине, коду тут искать нечего проверять.
export async function sendOtp(
  projectId: string,
  phoneDigits: string,
  opts: { forceChannel?: OtpChannel; explicitEmail?: string } = {}
): Promise<SendOtpResult> {
  const admin = createAdminClient();

  const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await admin
    .from("otp_requests")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("phone", phoneDigits)
    .gte("created_at", windowStart);
  if ((count || 0) >= RATE_MAX_SENDS) return { ok: false, error: "rate_limited" };

  const { data: secrets } = await admin
    .from("project_secrets")
    .select("telegram_gateway_token, bytehand_service_key, vapid_private_key")
    .eq("project_id", projectId)
    .maybeSingle();
  // best-effort: haskimail_server_token — отдельный запрос (миграция 0010),
  // чтобы отсутствующая колонка не роняла весь каскад (push/telegram/sms заодно).
  const { data: emailSecret } = await admin
    .from("project_secrets")
    .select("haskimail_server_token")
    .eq("project_id", projectId)
    .maybeSingle();
  const haskimailToken = emailSecret?.haskimail_server_token || null;
  const { data: oidcClient } = await admin
    .from("oidc_clients")
    .select("config")
    .eq("project_id", projectId)
    .maybeSingle();
  const channels: ChannelConfig = { push: true, email: true, telegram: true, sms: true, ...(oidcClient?.config?.channels || {}) };
  const smsSender: string | undefined = oidcClient?.config?.sms_sender;
  const emailFrom: string | undefined = oidcClient?.config?.email_from;
  const requirePhoneVerification = oidcClient?.config?.require_phone_verification !== false;

  const otpId = crypto.randomUUID();
  const code = genCode();

  const tryOrder: OtpChannel[] = opts.forceChannel ? [opts.forceChannel] : resolveOrder(oidcClient?.config?.channel_order);
  let channel: OtpChannel | null = null;

  for (const ch of tryOrder) {
    if (ch === "push" && channels.push !== false) {
      if (await sendPushCode(projectId, phoneDigits, code, secrets?.vapid_private_key || null)) {
        channel = "push";
        break;
      }
      // нет привязанного устройства для push — см. поведение по тумблеру в комментарии выше
      if (!requirePhoneVerification) {
        return { ok: false, error: "device_not_linked" };
      }
    }
    // email: обычно только для возвратных клиентов — известен по прежним
    // заказам (identities.email). opts.explicitEmail пробивает эту проверку —
    // используется, когда покупатель вводит почту вручную (страница входа
    // просит её как последний рубеж каскада или как стартовый идентификатор).
    if (ch === "email" && channels.email !== false && haskimailToken) {
      const email = opts.explicitEmail || (await knownEmailFor(projectId, phoneDigits));
      if (email && (await sendEmailCode(haskimailToken, email, code, emailFrom))) {
        channel = "email";
        break;
      }
    }
    if (ch === "telegram" && channels.telegram !== false && secrets?.telegram_gateway_token) {
      const reqId = await checkSendAbility(secrets.telegram_gateway_token, phoneDigits);
      if (reqId && (await sendTelegramCode(secrets.telegram_gateway_token, phoneDigits, code, reqId))) {
        channel = "telegram";
        break;
      }
    }
    if (ch === "sms" && channels.sms !== false && secrets?.bytehand_service_key) {
      if (await sendSms(secrets.bytehand_service_key, phoneDigits, `Код подтверждения: ${code}`, smsSender)) {
        channel = "sms";
        break;
      }
    }
  }

  if (!channel) return { ok: false, error: "no_channel" };

  await admin.from("otp_requests").insert({
    id: otpId,
    project_id: projectId,
    phone: phoneDigits,
    code_hash: hashCode(otpId, code),
    channel,
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });

  return { ok: true, otpId, channel };
}

// Push-код на привязанные устройства. Не списывает баланс — сервисный пуш.
async function sendPushCode(
  projectId: string,
  phoneDigits: string,
  code: string,
  vapidPrivate: string | null
): Promise<boolean> {
  if (!vapidPrivate) return false;
  const admin = createAdminClient();

  const { data: identity } = await admin
    .from("identities")
    .select("id")
    .eq("project_id", projectId)
    .eq("phone", phoneDigits)
    .not("phone_verified_at", "is", null)
    .maybeSingle();
  if (!identity) return false;

  const { data: links } = await admin
    .from("identity_devices")
    .select("subscriber_id, subscribers!inner(id, endpoint, p256dh, auth, is_active)")
    .eq("identity_id", identity.id);
  const subs = (links || [])
    .map((l) => l.subscribers as unknown as { id: string; endpoint: string; p256dh: string; auth: string; is_active: boolean })
    .filter((s) => s?.is_active);
  if (!subs.length) return false;

  const { data: project } = await admin.from("projects").select("vapid_public_key").eq("id", projectId).single();
  if (!project?.vapid_public_key) return false;

  const vapid = { publicKey: project.vapid_public_key, privateKey: vapidPrivate };
  const results = await Promise.all(
    subs.map((s) =>
      sendPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        // TTL у web-push задан сутки, но код живёт 5 минут — укажем это в тексте
        { title: "Код входа", body: `Ваш код: ${code} (действует 5 минут)`, url: "/" },
        vapid
      ).then(
        () => true,
        () => false
      )
    )
  );
  return results.some(Boolean);
}

export type VerifyOtpResult = "ok" | "wrong" | "expired" | "too_many";

export async function verifyOtp(otpId: string, code: string): Promise<VerifyOtpResult> {
  const admin = createAdminClient();
  const { data: otp } = await admin
    .from("otp_requests")
    .select("id, code_hash, attempts, expires_at, consumed_at")
    .eq("id", otpId)
    .maybeSingle();

  if (!otp || otp.consumed_at) return "expired";
  if (new Date(otp.expires_at) < new Date()) return "expired";
  if (otp.attempts >= MAX_ATTEMPTS) return "too_many";

  await admin.from("otp_requests").update({ attempts: otp.attempts + 1 }).eq("id", otpId);

  if (hashCode(otpId, code) !== otp.code_hash) return otp.attempts + 1 >= MAX_ATTEMPTS ? "too_many" : "wrong";

  await admin.from("otp_requests").update({ consumed_at: new Date().toISOString() }).eq("id", otpId);
  return "ok";
}
