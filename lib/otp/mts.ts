// МТС Маркетолог — REST API по токену, только SMS.
// Документация: https://support.mts.ru/mts_marketolog/rassilki-po-svoei-baze-pro-i-api-k-nim/dokumentatsiya-rest-api
// Токен — project_secrets.mts_token (кабинет → «Рассылки по своей базе PRO» →
// «Интеграции» → «API» → «Создать подключение» → «Создать токен», живёт год и
// продлевается сам). Заголовок: Authorization: Bearer <токен>.
//
// Тот же паттерн, что у Bytehand и SMSC: ответ на отправку подтверждает только
// приём (HTTP 200 у МТС тоже не значит «отправлено»), настоящий статус приходит
// позже — отдельным запросом (checkMtsDelivery) или обратным запросом МТС на наш
// адрес (app/api/public/mts/status). Имя отправителя (naming) обязательно и
// заводится в кабинете МТС, а не через API.
//
// Не проверено на живом аккаунте: код написан по документации, формат ответов
// сверялся только с её примерами.

const BASE = (process.env.MTS_API_URL || "https://api.mts.ru/client-omni-adapter_production/1.0.2").replace(/\/$/, "");

// В одном запросе документация разрешает до 1000 сообщений; берём меньше,
// чтобы запрос не упирался в таймаут и ошибки не накрывали сразу тысячу.
export const MTS_BATCH_SIZE = 200;

export type MtsSendResult = { ok: boolean; messageId?: string };
export type MtsSubmit = { phone: string; text: string };

function headers(token: string): Record<string, string> {
  return { "Content-Type": "application/json;charset=UTF-8", Authorization: `Bearer ${token}` };
}

type SubmitResult = { msid?: string; messageID?: string | number; code?: string };

// Отправка пачки: POST /mcom/messageManagement/messages. Результаты возвращаем
// по номеру получателя (msid) — порядок в ответе документацией не гарантирован.
export async function sendSmsMtsBatch(token: string, submits: MtsSubmit[], sender?: string): Promise<Map<string, MtsSendResult>> {
  const out = new Map<string, MtsSendResult>();
  if (!submits.length) return out;
  if (!sender) {
    console.error("[mts] sender name (naming) is required, set it in the SMS sender field");
    for (const s of submits) out.set(s.phone, { ok: false });
    return out;
  }
  try {
    const res = await fetch(`${BASE}/mcom/messageManagement/messages`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ submits: submits.map((s) => ({ msid: s.phone, message: s.text })), naming: sender }),
    });
    if (!res.ok) {
      console.error("[mts] send failed", res.status, (await res.text().catch(() => "")).slice(0, 300));
      for (const s of submits) out.set(s.phone, { ok: false });
      return out;
    }
    const data = (await res.json().catch(() => null)) as { data?: { submitResults?: SubmitResult[] } } | null;
    for (const r of data?.data?.submitResults || []) {
      if (!r.msid) continue;
      const accepted = r.code === "OK" && r.messageID != null;
      out.set(String(r.msid), accepted ? { ok: true, messageId: String(r.messageID) } : { ok: false });
      if (!accepted) console.error("[mts] message rejected", r.code);
    }
  } catch (e) {
    console.error("[mts] send error", e instanceof Error ? e.message : e);
  }
  // всё, что МТС не вернул в ответе, считаем непринятым
  for (const s of submits) if (!out.has(s.phone)) out.set(s.phone, { ok: false });
  return out;
}

export async function sendSmsMts(token: string, phoneDigits: string, text: string, sender?: string): Promise<MtsSendResult> {
  const map = await sendSmsMtsBatch(token, [{ phone: phoneDigits, text }], sender);
  return map.get(phoneDigits) || { ok: false };
}

export type MtsDeliveryState = "pending" | "delivered" | "failed";

// Статус из ответа МТС (текст у токена, числовые коды — у подключения по
// логину и паролю): окончательные «доставлено» и «не доставлено» отдельно,
// всё остальное считаем «ещё в пути».
export function classifyMtsStatus(status: unknown): MtsDeliveryState {
  if (typeof status === "number" || (typeof status === "string" && /^\d+$/.test(status))) {
    const n = Number(status);
    if (n === 300 || n === 302) return "delivered";
    if (n === 201 || n === 301) return "failed";
    return "pending";
  }
  const s = String(status || "").toLowerCase();
  if (s === "delivered") return "delivered";
  if (s === "notsent" || s === "notdelivered") return "failed";
  return "pending";
}

// GET /mcom/messageManagement/messages/{messageID}/status
export async function checkMtsDelivery(token: string, messageId: string): Promise<MtsDeliveryState> {
  try {
    const res = await fetch(`${BASE}/mcom/messageManagement/messages/${encodeURIComponent(messageId)}/status`, { headers: headers(token) });
    if (!res.ok) return "pending"; // сбой самой проверки — не топим доставку из-за этого
    const data = (await res.json().catch(() => null)) as { data?: { statuses?: { status?: string }[] }[] } | null;
    const statuses = data?.data?.[0]?.statuses || [];
    if (!statuses.length) return "pending";
    // сообщение из нескольких частей: провал любой части — провал, иначе нужны все «доставлено»
    const states = statuses.map((s) => classifyMtsStatus(s.status));
    if (states.includes("failed")) return "failed";
    return states.every((s) => s === "delivered") ? "delivered" : "pending";
  } catch {
    return "pending";
  }
}
