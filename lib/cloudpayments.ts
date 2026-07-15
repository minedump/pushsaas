import crypto from "crypto";

const API_SECRET = process.env.CLOUDPAYMENTS_API_SECRET || "";
const PUBLIC_ID = process.env.CLOUDPAYMENTS_PUBLIC_ID || "";

// CloudPayments signs webhook bodies: base64( HMAC-SHA256(rawBody, apiSecret) )
// delivered in the `Content-HMAC` header. Compare over the RAW body.
export function verifyWebhookHmac(rawBody: string, headerHmac: string | null): boolean {
  if (!API_SECRET || !headerHmac) return false;
  const digest = crypto.createHmac("sha256", API_SECRET).update(rawBody, "utf8").digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(headerHmac));
  } catch {
    return false;
  }
}

// Charge a previously saved recurring token (auto-renewal via cron).
// Returns { ok, token } — ok=false means the charge was declined/failed.
export async function chargeToken(params: {
  token: string;
  amount: number;
  accountId: string; // = projectId
  description: string;
}): Promise<{ ok: boolean; newToken?: string; reason?: string }> {
  if (!PUBLIC_ID || !API_SECRET) return { ok: false, reason: "CloudPayments не настроен" };

  const auth = Buffer.from(`${PUBLIC_ID}:${API_SECRET}`).toString("base64");
  const res = await fetch("https://api.cloudpayments.ru/payments/tokens/charge", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      Token: params.token,
      Amount: params.amount,
      Currency: "RUB",
      AccountId: params.accountId,
      Description: params.description,
    }),
  });
  const json = await res.json().catch(() => null);
  // Success = HTTP ok + Success flag + a completed transaction (no 3DS for recurring)
  if (json?.Success && json?.Model?.Status === "Completed") {
    return { ok: true, newToken: json.Model.Token };
  }
  return { ok: false, reason: json?.Message || json?.Model?.Reason || "declined" };
}

// First day of next month — the tariff period always ends on the 1st (TryVice).
export function nextPeriodEnd(from = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 0, 0, 0));
}

// Prorate a monthly limit by days remaining until the 1st of next month.
export function proratePushes(monthlyLimit: number, from = new Date()): number {
  const periodEnd = nextPeriodEnd(from);
  const daysInMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).getUTCDate();
  const msLeft = periodEnd.getTime() - from.getTime();
  const daysLeft = Math.max(1, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
  return Math.max(1, Math.round((monthlyLimit * daysLeft) / daysInMonth));
}

export const isCloudPaymentsConfigured = () => Boolean(PUBLIC_ID && API_SECRET);
