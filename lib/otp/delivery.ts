import type { SupabaseClient } from "@supabase/supabase-js";
import { checkSmsDelivery } from "@/lib/otp/sms";
import { checkSmscDelivery } from "@/lib/otp/smsc";
import { checkMtsDelivery } from "@/lib/otp/mts";
import { needsDeliveryPoll } from "@/lib/otp/providers";

// Статус доставки кода входа: опрашиваем провайдера и сохраняем результат в
// otp_requests (delivery_status / delivery_detail), чтобы он был виден в
// «Журнал → Входы» и после того, как покупатель закрыл страницу ввода кода.

export type OtpDeliveryRow = {
  id: string;
  channel: string;
  provider: string | null;
  provider_message_id: string | null;
  phone: string | null;
  email: string | null;
  delivery_status?: string | null;
  delivery_updated_at?: string | null;
};

export type OtpDeliveryState = "pending" | "delivered" | "failed";

type Secrets = {
  smsc_login?: string | null;
  smsc_password?: string | null;
  mts_token?: string | null;
  bytehand_service_key?: string | null;
};

export async function loadDeliverySecrets(admin: SupabaseClient, projectId: string): Promise<Secrets> {
  const { data } = await admin
    .from("project_secrets")
    .select("smsc_login, smsc_password, mts_token, bytehand_service_key")
    .eq("project_id", projectId)
    .maybeSingle();
  return (data as Secrets | null) ?? {};
}

// Один запрос к провайдеру + сохранение. null — проверить нельзя (нет ключей,
// провайдеру опрос не нужен, нет id сообщения).
export async function refreshOtpDelivery(
  admin: SupabaseClient,
  secrets: Secrets,
  otp: OtpDeliveryRow
): Promise<OtpDeliveryState | null> {
  if (!otp.provider_message_id || !needsDeliveryPoll(otp.channel, otp.provider)) return null;
  const target = otp.phone || otp.email;
  if (!target) return null;

  let check: { state: OtpDeliveryState; detail: string | null };
  if (otp.provider === "smsc") {
    if (!secrets.smsc_login || !secrets.smsc_password) return null;
    check = await checkSmscDelivery(secrets.smsc_login, secrets.smsc_password, otp.provider_message_id, target, otp.channel === "telegram");
  } else if (otp.provider === "mts") {
    if (!secrets.mts_token) return null;
    check = await checkMtsDelivery(secrets.mts_token, otp.provider_message_id);
  } else {
    // последний из провайдеров, которым нужен опрос, — Bytehand (sms)
    if (!secrets.bytehand_service_key) return null;
    check = await checkSmsDelivery(secrets.bytehand_service_key, otp.provider_message_id);
  }

  // В базу пишем только итог: «в пути» остаётся «отправлено», но подробность
  // («Передано оператору», «В очереди») обновляем — она видна в журнале.
  const status = check.state === "pending" ? "sent" : check.state;
  await admin
    .from("otp_requests")
    .update({ delivery_status: status, delivery_detail: check.detail, delivery_updated_at: new Date().toISOString() })
    .eq("id", otp.id);
  return check.state;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_RECHECK_MS = 60 * 1000;

// Для страницы журнала: добираем итог по кодам, у которых он ещё «отправлено».
// SMSC отдаёт статус только в течение суток и не любит частых одинаковых
// запросов — берём коды младше суток, не чаще раза в минуту на код, и не более
// `limit` за раз.
export async function refreshPendingOtpDelivery(
  admin: SupabaseClient,
  projectId: string,
  rows: (OtpDeliveryRow & { created_at: string })[],
  limit = 15
): Promise<Map<string, { status: string; detail: string | null }>> {
  const now = Date.now();
  const due = rows
    .filter(
      (r) =>
        r.delivery_status === "sent" &&
        now - Date.parse(r.created_at) < DAY_MS &&
        (!r.delivery_updated_at || now - Date.parse(r.delivery_updated_at) > MIN_RECHECK_MS) &&
        r.provider_message_id &&
        needsDeliveryPoll(r.channel, r.provider)
    )
    .slice(0, limit);
  const out = new Map<string, { status: string; detail: string | null }>();
  if (!due.length) return out;

  const secrets = await loadDeliverySecrets(admin, projectId);
  await Promise.all(
    due.map(async (r) => {
      const state = await refreshOtpDelivery(admin, secrets, r);
      if (!state) return;
      const { data } = await admin.from("otp_requests").select("delivery_status, delivery_detail").eq("id", r.id).maybeSingle();
      if (data?.delivery_status) out.set(r.id, { status: data.delivery_status, detail: data.delivery_detail ?? null });
    })
  );
  return out;
}
