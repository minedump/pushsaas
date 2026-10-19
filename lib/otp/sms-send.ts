import { sendSms } from "./sms";
import { sendSmsSmsc } from "./smsc";
import { sendSmsMts } from "./mts";

// Единая точка отправки SMS по провайдеру проекта. Раньше выбор между
// Bytehand и SMSC дублировался тернарником в нескольких местах (рассылки,
// автоматизации, тест, ключи API); теперь новый провайдер добавляется здесь.
// Клиентам (админке) этот файл не нужен: он серверный.
export type SmsSecrets = {
  bytehand_service_key?: string | null;
  smsc_login?: string | null;
  smsc_password?: string | null;
  mts_token?: string | null;
};
export const SMS_SECRET_COLUMNS = "bytehand_service_key, smsc_login, smsc_password, mts_token" as const;

// Есть ли у проекта всё нужное для отправки через этого провайдера.
export function smsProviderReady(provider: string | null | undefined, secrets: SmsSecrets | null | undefined): boolean {
  if (!secrets) return false;
  if (provider === "smsc") return !!secrets.smsc_login && !!secrets.smsc_password;
  if (provider === "mts") return !!secrets.mts_token;
  return !!secrets.bytehand_service_key; // bytehand — провайдер по умолчанию
}

export async function sendSmsByProvider(
  provider: string | null | undefined,
  secrets: SmsSecrets,
  phoneDigits: string,
  text: string,
  sender?: string
): Promise<{ ok: boolean; messageId?: string }> {
  if (provider === "smsc") return sendSmsSmsc(secrets.smsc_login!, secrets.smsc_password!, phoneDigits, text, sender);
  if (provider === "mts") return sendSmsMts(secrets.mts_token!, phoneDigits, text, sender);
  return sendSms(secrets.bytehand_service_key!, phoneDigits, text, sender);
}
