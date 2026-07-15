// SMS через Bytehand HTTP API v2 (https://www.bytehand.com/developers/v2).
// Примечание: у Bytehand есть и SMPP-шлюз, но SMPP — постоянное TCP-соединение,
// на serverless (Vercel) его держать нельзя; HTTP API работает с тем же
// аккаунтом и балансом. Ключ — project_secrets.bytehand_service_key.

const BASE = process.env.BYTEHAND_API_URL || "https://api.bytehand.com";

export async function sendSms(
  serviceKey: string,
  phoneDigits: string,
  text: string,
  sender?: string
): Promise<boolean> {
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
    return false;
  }
  return true;
}
