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

// GET /v2/sms/messages/{id} — реальный статус доставки, а не просто "запрос
// принят". Наблюдалось живьём (2026-07-16): "new" сразу после отправки →
// "delivered" через ~5с при успехе. Точный список значений для провала не
// задокументирован публично, поэтому подход защитный: явно перечисляем
// "ещё летит" и "точно доставлено", всё остальное — считаем провалом,
// чтобы не оставлять пользователя ждать код, который не придёт.
export async function checkSmsDelivery(serviceKey: string, messageId: string): Promise<SmsDeliveryState> {
  try {
    const res = await fetch(`${BASE}/v2/sms/messages/${encodeURIComponent(messageId)}`, {
      headers: { "X-Service-Key": serviceKey },
    });
    if (!res.ok) return "pending"; // сбой самой проверки — не топим доставку из-за этого
    const data = await res.json().catch(() => null);
    const state = data?.state as string | undefined;
    if (state === "delivered" || state === "sent") return "delivered";
    if (!state || ["new", "queued", "sending", "accepted", "pending"].includes(state)) return "pending";
    return "failed"; // failed/undelivered/rejected/expired/что угодно неизвестное
  } catch {
    return "pending";
  }
}
