// SMS через Bytehand HTTP API v2 (https://www.bytehand.com/developers/v2).
// Примечание: у Bytehand есть и SMPP-шлюз, но SMPP — постоянное TCP-соединение,
// на serverless (Vercel) его держать нельзя; HTTP API работает с тем же
// аккаунтом и балансом. Ключ — project_secrets.bytehand_service_key.

const BASE = process.env.BYTEHAND_API_URL || "https://api.bytehand.com";

export type SendSmsResult = { ok: boolean; messageId?: string };

export async function sendSms(serviceKey: string, phoneDigits: string, text: string, sender?: string): Promise<SendSmsResult> {
  const res = await fetch(`${BASE}/v2/sms/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Service-Key": serviceKey,
    },
    body: JSON.stringify({
      sender: sender || "SMS",
      receiver: phoneDigits,
      text,
    }),
  });
  if (!res.ok) {
    console.error("[bytehand] send failed", res.status, await res.text().catch(() => ""));
    return { ok: false };
  }
  // { "result": "created", "id": "...", "count": 1 } — проверено на реальном
  // аккаунте (2026-07-16). id нужен, чтобы потом опросить статус доставки.
  const data = await res.json().catch(() => null);
  const messageId = data?.id != null ? String(data.id) : undefined;
  return { ok: true, messageId };
}

export type SmsDeliveryState = "pending" | "delivered" | "failed";
export type DeliveryCheck = { state: SmsDeliveryState; detail: string | null };

// Статусы сообщения у Bytehand (GET /v2/sms/messages/{id}, поле state):
// paused, new, accepted — ещё не ушло/в пути; delivered — доставлено;
// expired, deleted, undeliverable, rejected — не доставлено; unknown —
// оператор не прислал отчёт (по нему нельзя сказать, дошло ли, поэтому
// считаем «в пути», а не провалом — иначе вход зря уйдёт на другой канал).
const BYTEHAND_STATE_LABEL: Record<string, string> = {
  paused: "Приостановлено",
  new: "В очереди",
  accepted: "Передано оператору",
  delivered: "Доставлено",
  expired: "Не доставлено: истёк срок",
  deleted: "Удалено",
  undeliverable: "Не доставлено: номер недоступен",
  rejected: "Отклонено",
  unknown: "Оператор не прислал отчёт",
};

export async function checkSmsDelivery(serviceKey: string, messageId: string): Promise<DeliveryCheck> {
  try {
    const res = await fetch(`${BASE}/v2/sms/messages/${encodeURIComponent(messageId)}`, {
      headers: { "X-Service-Key": serviceKey },
    });
    if (!res.ok) return { state: "pending", detail: null }; // сбой самой проверки — не топим доставку из-за этого
    const data = await res.json().catch(() => null);
    const state = data?.state as string | undefined;
    const detail = state ? BYTEHAND_STATE_LABEL[state] || state : null;
    if (state === "delivered" || state === "sent") return { state: "delivered", detail: BYTEHAND_STATE_LABEL.delivered };
    if (!state || ["new", "queued", "sending", "accepted", "pending", "paused", "unknown"].includes(state)) return { state: "pending", detail };
    return { state: "failed", detail }; // expired/deleted/undeliverable/rejected/что угодно неизвестное
  } catch {
    return { state: "pending", detail: null };
  }
}
