// Telegram Gateway (gateway.telegram.org) — коды верификации на номер телефона.
// $0.01 за доставленный код; checkSendAbility бесплатен, если доставка невозможна.
// Токен берётся из project_secrets.telegram_gateway_token (per project).
//
// С части российских хостингов gatewayapi.telegram.org недоступен напрямую
// (TCP-таймаут, не ошибка API) — живьём наблюдали UND_ERR_CONNECT_TIMEOUT.
// outboundFetch идёт через OUTBOUND_PROXY_URL, если он задан.

import { outboundFetch } from "@/lib/proxy";

const BASE = "https://gatewayapi.telegram.org";

type GatewayResponse<T> = { ok: boolean; result?: T; error?: string };

async function call<T>(token: string, method: string, body: Record<string, unknown>): Promise<GatewayResponse<T>> {
  const res = await outboundFetch(`${BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false, error: "bad gateway response" }));
}

// Можно ли доставить код на этот номер (получатель — пользователь Telegram).
// Возвращает request_id, который надо передать в sendVerificationMessage —
// тогда запрос checkSendAbility не тарифицируется отдельно.
export async function checkSendAbility(token: string, phoneDigits: string): Promise<string | null> {
  const r = await call<{ request_id: string }>(token, "checkSendAbility", {
    phone_number: "+" + phoneDigits,
  });
  return r.ok && r.result?.request_id ? r.result.request_id : null;
}

export async function sendTelegramCode(
  token: string,
  phoneDigits: string,
  code: string,
  requestId?: string
): Promise<boolean> {
  const r = await call<{ request_id: string }>(token, "sendVerificationMessage", {
    phone_number: "+" + phoneDigits,
    code,
    ttl: 300,
    ...(requestId ? { request_id: requestId } : {}),
  });
  return r.ok;
}
