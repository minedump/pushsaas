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
// Проверено на живом аккаунте: отправка, ответ со статусом и обратный запрос с
// id сообщения (message_id совпадает с messageID из ответа на отправку).

const BASE = "https://api.mts.ru/client-omni-adapter_production/1.0.2";

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

// Статус от МТС: в обратном запросе приходит числовой код (300 — доставлено),
// в ответе на запрос статуса — текст (Delivered, NotDelivered, NotSent).
// Окончательные «доставлено» и «не доставлено» отдельно, всё остальное — «ещё в пути».
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

// GET /mcom/messageManagement/messages/{messageID}/status — в data лежит
// история статусов (Sending, затем Delivered), а не один статус.
export type MtsDeliveryCheck = { state: MtsDeliveryState; detail: string | null };
const MTS_DETAIL: Record<MtsDeliveryState, string> = {
  pending: "Отправляется",
  delivered: "Доставлено",
  failed: "Не доставлено",
};

// Причины отказа (internal_errors), которые МТС присылает в обратном запросе вместе со статусом 201 «не отправлено».
// Тексты по таблице кодов из документации МТС Маркетолога; незнакомый код показываем как «Код N».
const MTS_ERROR_LABEL: Record<number, string> = {
  10904: "Абонент в глобальном стоп-листе МТС",
  10905: "Получатель в вашем чёрном списке",
  1537: "Имя отправителя у получателя в чёрном списке",
  9: "Запрещённый абонент",
  10906: "Абонента нет в вашем белом списке",
  171: "Дубликат: такое сообщение уже отправляли",
  11700: "Сработала дедубликация МТС",
  252: "Отправка этому абоненту запрещена",
  254: "Отправка с этого имени отправителя запрещена",
  10605: "Отправка запрещена самим абонентом",
  253: "В тексте запрещённые слова",
  1284: "В тексте запрещённые слова",
  1283: "Текст не соответствует согласованному шаблону",
  1301: "Оператор получателя счёл SMS спамом",
  10100: "Имя отправителя не согласовано",
  610: "Имя отправителя не согласовано",
  10603: "Имя отправителя не подключено",
  1281: "Отправка запрещена правилами маршрутизации",
  10800: "Номер получателя не указан",
  10802: "Некорректный номер получателя",
  611: "Некорректный номер получателя",
  125: "Номер получателя не существует",
  601: "Недопустимая длина сообщения",
  1058: "Недопустимая длина сообщения",
  11900: "Тариф МТС не подключён",
  11903: "Нет подходящего тарифа МТС",
  11901: "Пакет SMS в МТС закончился",
  11902: "Пакет SMS в МТС закончился",
  10608: "Превышен месячный лимит подключения МТС",
  10910: "Финансовая блокировка в МТС",
  950: "Доставка от банковских номеров приостановлена на сутки",
};

// «Абонент в глобальном стоп-листе МТС (10904)»; несколько кодов — через «; ». Пусто, если кодов нет.
export function describeMtsErrors(codes: unknown): string | null {
  if (!Array.isArray(codes)) return null;
  const parts = codes
    .map((c) => Number(c))
    .filter((n) => Number.isFinite(n))
    .map((n) => (MTS_ERROR_LABEL[n] ? `${MTS_ERROR_LABEL[n]} (${n})` : `Код ${n}`));
  return parts.length ? parts.join("; ") : null;
}

export async function checkMtsDelivery(token: string, messageId: string): Promise<MtsDeliveryCheck> {
  const res = (state: MtsDeliveryState): MtsDeliveryCheck => ({ state, detail: MTS_DETAIL[state] });
  try {
    const r = await fetch(`${BASE}/mcom/messageManagement/messages/${encodeURIComponent(messageId)}/status`, { headers: headers(token) });
    if (!r.ok) return { state: "pending", detail: null }; // сбой самой проверки — не топим доставку из-за этого
    const data = (await r.json().catch(() => null)) as { data?: { statuses?: { status?: string; date?: string }[] }[] } | null;
    const history = (data?.data || []).filter((h) => h.statuses?.length);
    if (!history.length) return res("pending");
    // провал в любой записи истории — провал; иначе смотрим последнюю запись по дате
    if (history.some((h) => h.statuses!.some((s) => classifyMtsStatus(s.status) === "failed"))) return res("failed");
    const at = (h: (typeof history)[number]) => Math.max(...h.statuses!.map((s) => Date.parse(s.date || "") || 0));
    const latest = history.reduce((x, y) => (at(y) >= at(x) ? y : x));
    // сообщение из нескольких частей: нужны все «доставлено»
    return res(latest.statuses!.every((s) => classifyMtsStatus(s.status) === "delivered") ? "delivered" : "pending");
  } catch {
    return { state: "pending", detail: null };
  }
}
