// Реестр провайдеров на канал — единая точка правды для бэкенд-каскада
// (lib/otp/index.ts) и админ-UI (AuthSettings.tsx). Новая интеграция для
// уже существующего канала = одна строка в соответствующем списке здесь,
// а не правки в обоих местах порознь.
//
// Никаких server-only импортов (createAdminClient и т.п.) — этот файл
// подключается и из клиентского компонента настроек.

export type SmsProvider = "bytehand" | "smsc";
export type TelegramProvider = "telegram_gateway" | "smsc";
export type EmailProvider = "haskimail" | "smsc";

export const DEFAULT_SMS_PROVIDER: SmsProvider = "bytehand";
export const DEFAULT_TELEGRAM_PROVIDER: TelegramProvider = "telegram_gateway";
export const DEFAULT_EMAIL_PROVIDER: EmailProvider = "haskimail";

export const SMS_PROVIDERS: { id: SmsProvider; label: string }[] = [
  { id: "bytehand", label: "Bytehand" },
  { id: "smsc", label: "SMSC.ru" },
];
export const TELEGRAM_PROVIDERS: { id: TelegramProvider; label: string }[] = [
  { id: "telegram_gateway", label: "Telegram Gateway (официальный)" },
  { id: "smsc", label: "SMSC.ru" },
];
export const EMAIL_PROVIDERS: { id: EmailProvider; label: string }[] = [
  { id: "haskimail", label: "Haskimail" },
  { id: "smsc", label: "SMSC.ru" },
];

export function resolveSmsProvider(configured: unknown): SmsProvider {
  return configured === "smsc" ? "smsc" : DEFAULT_SMS_PROVIDER;
}
export function resolveTelegramProvider(configured: unknown): TelegramProvider {
  return configured === "smsc" ? "smsc" : DEFAULT_TELEGRAM_PROVIDER;
}
export function resolveEmailProvider(configured: unknown): EmailProvider {
  return configured === "smsc" ? "smsc" : DEFAULT_EMAIL_PROVIDER;
}

// SMSC принимает и подтверждает отправку немедленно, но реальная доставка
// (или провал) выясняется асинхронно через отдельный статус — тот же паттерн,
// что у Bytehand для SMS (см. lib/otp/sms.ts). Telegram Gateway и Haskimail
// возвращают синхронный результат, который уже И ЕСТЬ факт доставки —
// поллинг им не нужен.
export function needsDeliveryPoll(channel: string, provider: string | null | undefined): boolean {
  if (channel === "sms") return true; // bytehand и smsc — оба асинхронные
  if (channel === "telegram") return provider === "smsc";
  if (channel === "email") return provider === "smsc";
  return false;
}
