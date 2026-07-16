import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPush } from "@/lib/webpush";
import { checkSendAbility, sendTelegramCode } from "./telegram";
import { sendSms } from "./sms";
import { sendEmailCode } from "./haskimail";

// Единый каскад для ОДНОГО известного ключа входа — телефон ИЛИ email
// (никогда оба сразу: у нас нет флоу, который просит подтвердить оба и
// шлёт код по обоим — см. auth/route.ts). Ключ определяет, какие каналы
// вообще применимы:
//   phone → push (на устройства, уже привязанные к этому телефону) →
//           telegram → sms
//   email → push (на устройства, уже привязанные к этой почте) → email
// Push всегда пробуется первым для СВОЕГО типа ключа — бесплатно, но
// пропускается (no_subscription), если для этого ключа ещё нет ни одного
// честно привязанного устройства (новый посетитель).
//
// Email больше не подставляется автоматически из вебхука заказа — если
// каскад дошёл до email, страница входа явно ПРОСИТ ввести адрес (см.
// auth/route.ts) и код идёт именно на введённое.

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_SENDS = 3;

export type OtpChannel = "push" | "email" | "telegram" | "sms";
export type OtpKey = { phone: string } | { email: string };

export type ChannelSkipReason =
  | "not_configured" // канал выключен в проекте или для него нет ключа
  | "no_subscription" // push: нет привязанного активного устройства
  | "provider_error" // sms/telegram: внешний сервис отказал/ошибся
  | "send_failed"; // попытка была, доставка не подтвердилась

export type ChannelAttempt = { channel: OtpChannel; ok: boolean; reason?: ChannelSkipReason };

export type SendOtpResult =
  | { ok: true; otpId: string; channel: OtpChannel; attempts: ChannelAttempt[] }
  | { ok: false; error: "rate_limited" | "no_channel"; attempts: ChannelAttempt[] };

export const DEFAULT_CHANNEL_ORDER: OtpChannel[] = ["push", "email", "telegram", "sms"];

// Порядок каскада настраивается в проекте (config.channel_order); неизвестные
// или пропущенные каналы добавляются в конец в дефолтном порядке — так кривая
// или неполная настройка никогда тихо не выкидывает канал из каскада целиком.
export function resolveOrder(configured: unknown): OtpChannel[] {
  const valid = Array.isArray(configured) ? configured.filter((c): c is OtpChannel => DEFAULT_CHANNEL_ORDER.includes(c)) : [];
  const missing = DEFAULT_CHANNEL_ORDER.filter((c) => !valid.includes(c));
  return [...valid, ...missing];
}

function genCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashCode(otpId: string, code: string): string {
  return crypto.createHash("sha256").update(`${otpId}:${code}`).digest("hex");
}

// Внешний push-сервис (FCM/APNs) иногда отвечает медленно — а пока сервер
// ждёт Promise.all по всем устройствам, пользователь смотрит на пустой экран.
// Жёсткий потолок ожидания на КАЖДЫЙ push, чтобы один медленный эндпоинт не
// тормозил весь вход.
const PUSH_SEND_TIMEOUT_MS = 4000;
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("push_timeout")), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

type ChannelConfig = { push?: boolean; email?: boolean; telegram?: boolean; sms?: boolean };

// Идентичность, уже привязавшая это устройство (identity_devices) — для
// молчаливого узнавания возвратного посетителя ДО показа формы (см.
// auth/route.ts GET): если браузер уже был честно привязан к телефону или
// к email в прошлый раз, можно сразу попробовать push, ничего не спрашивая.
export async function findIdentityByDevice(
  projectId: string,
  subscriberId: string
): Promise<{ id: string; phone: string | null; email: string | null } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("identity_devices")
    .select("identities!inner(id, phone, email, phone_verified_at, email_verified_at, project_id)")
    .eq("subscriber_id", subscriberId)
    .limit(1)
    .maybeSingle();
  const identity = data?.identities as unknown as
    | { id: string; phone: string | null; email: string | null; phone_verified_at: string | null; email_verified_at: string | null; project_id: string }
    | undefined;
  if (!identity || identity.project_id !== projectId) return null;
  // ключ отдаём, только если он реально подтверждён — на всякий случай
  // (identities.phone/email технически могут быть заполнены без *_verified_at
  // сторонним путём, например вебхуком заказа для email)
  const phone = identity.phone_verified_at ? identity.phone : null;
  const email = identity.email_verified_at ? identity.email : null;
  if (!phone && !email) return null;
  return { id: identity.id, phone, email };
}

// Отправляет код по каскаду для ОДНОГО ключа (phone или email — см. OtpKey).
// forceChannel — «отправить ещё раз через …» с UI, пропускает остальные.
//
// Push отправляется ТОЛЬКО на уже честно привязанные устройства (реальная
// связка ключ+устройство в identity_devices, появившаяся через реальный код
// в этом же каскаде ранее). Самозаписи "это моё устройство, доверьтесь мне"
// нет — это была бы лазейка для угона.
export async function sendOtp(projectId: string, key: OtpKey, opts: { forceChannel?: OtpChannel } = {}): Promise<SendOtpResult> {
  const admin = createAdminClient();
  const attempts: ChannelAttempt[] = [];
  const isPhone = "phone" in key;
  const rateKey = isPhone ? key.phone : key.email;
  const rateColumn = isPhone ? "phone" : "email";

  const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await admin
    .from("otp_requests")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq(rateColumn, rateKey)
    .gte("created_at", windowStart);
  if ((count || 0) >= RATE_MAX_SENDS) return { ok: false, error: "rate_limited", attempts };

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
  const { data: oidcClient } = await admin.from("oidc_clients").select("config").eq("project_id", projectId).maybeSingle();
  const channels: ChannelConfig = { push: true, email: true, telegram: true, sms: true, ...(oidcClient?.config?.channels || {}) };
  const smsSender: string | undefined = oidcClient?.config?.sms_sender;
  const emailFrom: string | undefined = oidcClient?.config?.email_from;

  const otpId = crypto.randomUUID();
  const code = genCode();

  // Применимые для этого ключа каналы: phone → push/telegram/sms, email → push/email.
  const applicable: OtpChannel[] = isPhone ? ["push", "telegram", "sms"] : ["push", "email"];
  const configuredOrder = resolveOrder(oidcClient?.config?.channel_order).filter((c) => applicable.includes(c));
  const tryOrder: OtpChannel[] = opts.forceChannel ? [opts.forceChannel] : configuredOrder;
  let channel: OtpChannel | null = null;

  for (const ch of tryOrder) {
    if (ch === "push") {
      if (channels.push === false) {
        attempts.push({ channel: ch, ok: false, reason: "not_configured" });
        continue;
      }
      const r = await sendPushCode(projectId, key, code, secrets?.vapid_private_key || null);
      attempts.push({ channel: ch, ok: r.ok, reason: r.reason });
      if (r.ok) { channel = ch; break; }
      continue;
    }
    if (ch === "email" && !isPhone) {
      if (channels.email === false || !haskimailToken) {
        attempts.push({ channel: ch, ok: false, reason: "not_configured" });
        continue;
      }
      const sent = await sendEmailCode(haskimailToken, key.email, code, emailFrom);
      attempts.push({ channel: ch, ok: sent, reason: sent ? undefined : "send_failed" });
      if (sent) { channel = ch; break; }
      continue;
    }
    if (ch === "telegram" && isPhone) {
      if (channels.telegram === false || !secrets?.telegram_gateway_token) {
        attempts.push({ channel: ch, ok: false, reason: "not_configured" });
        continue;
      }
      const reqId = await checkSendAbility(secrets.telegram_gateway_token, key.phone);
      if (!reqId) {
        attempts.push({ channel: ch, ok: false, reason: "provider_error" });
        continue;
      }
      const sent = await sendTelegramCode(secrets.telegram_gateway_token, key.phone, code, reqId);
      attempts.push({ channel: ch, ok: sent, reason: sent ? undefined : "provider_error" });
      if (sent) { channel = ch; break; }
      continue;
    }
    if (ch === "sms" && isPhone) {
      if (channels.sms === false || !secrets?.bytehand_service_key) {
        attempts.push({ channel: ch, ok: false, reason: "not_configured" });
        continue;
      }
      const sent = await sendSms(secrets.bytehand_service_key, key.phone, `Код подтверждения: ${code}`, smsSender);
      attempts.push({ channel: ch, ok: sent, reason: sent ? undefined : "provider_error" });
      if (sent) { channel = ch; break; }
      continue;
    }
  }

  if (!channel) return { ok: false, error: "no_channel", attempts };

  await admin.from("otp_requests").insert({
    id: otpId,
    project_id: projectId,
    phone: isPhone ? key.phone : null,
    email: isPhone ? null : key.email,
    code_hash: hashCode(otpId, code),
    channel,
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });

  return { ok: true, otpId, channel, attempts };
}

// Push-код на устройства, уже привязанные (identity_devices) к identity,
// найденной по этому ключу — телефону или email, симметрично. Не списывает
// баланс — сервисный пуш.
async function sendPushCode(projectId: string, key: OtpKey, code: string, vapidPrivate: string | null): Promise<{ ok: boolean; reason?: ChannelSkipReason }> {
  if (!vapidPrivate) return { ok: false, reason: "not_configured" };
  const admin = createAdminClient();
  const isPhone = "phone" in key;

  const { data: identity } = await admin
    .from("identities")
    .select("id")
    .eq("project_id", projectId)
    .eq(isPhone ? "phone" : "email", isPhone ? key.phone : key.email)
    .not(isPhone ? "phone_verified_at" : "email_verified_at", "is", null)
    .maybeSingle();
  if (!identity) return { ok: false, reason: "no_subscription" };

  const { data: links } = await admin
    .from("identity_devices")
    .select("subscriber_id, subscribers!inner(id, endpoint, p256dh, auth, is_active)")
    .eq("identity_id", identity.id);
  const subs = (links || [])
    .map((l) => l.subscribers as unknown as { id: string; endpoint: string; p256dh: string; auth: string; is_active: boolean })
    .filter((s) => s?.is_active);
  if (!subs.length) return { ok: false, reason: "no_subscription" };

  const { data: project } = await admin.from("projects").select("vapid_public_key").eq("id", projectId).single();
  if (!project?.vapid_public_key) return { ok: false, reason: "not_configured" };

  const vapid = { publicKey: project.vapid_public_key, privateKey: vapidPrivate };
  const results = await Promise.all(
    subs.map((s) =>
      withTimeout(
        sendPush(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          // TTL у web-push задан сутки, но код живёт 5 минут — укажем это в тексте
          { title: "Код входа", body: `Ваш код: ${code} (действует 5 минут)`, url: "/" },
          vapid
        ),
        PUSH_SEND_TIMEOUT_MS
      ).then(
        () => true,
        () => false
      )
    )
  );
  const anySuccess = results.some(Boolean);
  return anySuccess ? { ok: true } : { ok: false, reason: "send_failed" };
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

// Человекочитаемое объяснение, почему код не удалось отправить ни одним
// каналом — берёт самую полезную причину из попыток (провайдерская ошибка
// важнее, чем «канал не настроен» — это то, что реально можно почитать).
export function describeNoChannel(attempts: ChannelAttempt[]): string {
  const priority: ChannelSkipReason[] = ["provider_error", "send_failed", "no_subscription", "not_configured"];
  for (const reason of priority) {
    const hit = attempts.find((a) => a.reason === reason);
    if (!hit) continue;
    switch (reason) {
      case "provider_error":
      case "send_failed":
        return "Не удалось отправить код — попробуйте ещё раз через минуту.";
      case "no_subscription":
        return "У вас ещё нет push-подписки на этом устройстве. Подпишитесь на уведомления на сайте магазина или попробуйте позже.";
      case "not_configured":
        return "Вход временно недоступен — магазин ещё не настроил ни один способ доставки кода.";
    }
  }
  return "Не удалось отправить код. Подпишитесь на уведомления на сайте магазина или попробуйте позже.";
}
