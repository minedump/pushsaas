// SMSC.ru (https://smsc.ru/api/) — один аккаунт обслуживает SMS, Telegram
// (флаг tg=1) и Email (флаг mail=1) через общий send.php/status.php.
// Ключи — project_secrets.smsc_login/smsc_password.
//
// Тот же паттерн, что у Bytehand (lib/otp/sms.ts): отправка подтверждает
// только приём, не доставку — messageId с отправки нужен, чтобы потом
// опросить статус отдельно (см. checkSmscDelivery). Классификация статуса —
// та же защитная логика: явные "точно доставлено"/"точно ещё летит", всё
// остальное — провал, чтобы не держать покупателя перед кодом, который не придёт.
//
// Живой тест 2026-07-17 (аккаунт yulia_wave): Telegram (tg=1) отправка
// принимается нормально, но зависает в статусе -3 (в очереди) без
// разрешения. SMS и Email отклоняются на самой отправке (error_code 6,
// "message is denied") — похоже на неразрешённого отправителя/модерацию на
// стороне SMSC, а не баг интеграции. Формат запросов и ответов подтверждён
// живыми вызовами; факт реальной доставки SMS/Email — нет. Проверить снова,
// когда аккаунт разблокируют.

const BASE = "https://smsc.ru/sys";

type SmscSendResponse = { id?: number | string; cnt?: number; error?: string; error_code?: number };

async function callSend(login: string, password: string, params: Record<string, string>): Promise<SmscSendResponse> {
  const url = new URL(`${BASE}/send.php`);
  url.searchParams.set("login", login);
  url.searchParams.set("psw", password);
  url.searchParams.set("fmt", "3");
  url.searchParams.set("charset", "utf-8");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) return { error: "http_error", error_code: -1 };
  return res.json().catch(() => ({ error: "bad response", error_code: -1 }));
}

export type SmscSendResult = { ok: boolean; messageId?: string };

export async function sendSmsSmsc(login: string, password: string, phoneDigits: string, text: string, sender?: string): Promise<SmscSendResult> {
  const data = await callSend(login, password, { phones: phoneDigits, mes: text, ...(sender ? { sender } : {}) });
  if (data.error || data.id == null) {
    console.error("[smsc] sms send failed", data);
    return { ok: false };
  }
  return { ok: true, messageId: String(data.id) };
}

export async function sendTelegramSmsc(login: string, password: string, phoneDigits: string, text: string): Promise<SmscSendResult> {
  const data = await callSend(login, password, { phones: phoneDigits, mes: text, tg: "1" });
  if (data.error || data.id == null) {
    console.error("[smsc] telegram send failed", data);
    return { ok: false };
  }
  return { ok: true, messageId: String(data.id) };
}

export async function sendEmailSmsc(login: string, password: string, email: string, subject: string, text: string, sender: string): Promise<SmscSendResult> {
  const data = await callSend(login, password, { phones: email, mes: text, subj: subject, sender, mail: "1" });
  if (data.error || data.id == null) {
    console.error("[smsc] email send failed", data);
    return { ok: false };
  }
  return { ok: true, messageId: String(data.id) };
}

export type SmscDeliveryState = "pending" | "delivered" | "failed";

// GET /sys/status.php — статус конкретного id. target — исходный получатель
// (номер телефона или email), обязателен у SMSC. isTelegram добавляет
// bot=1, как того требует проверка статуса Telegram-сообщений.
//
// status: -3/-1/0 — ещё в процессе (очередь/у оператора/отправлено на
// канал), >=1 — подтверждённая доставка (получено/прочитано), всё
// остальное (явный код провала, немодерированное сообщение и т.п.) — провал.
export async function checkSmscDelivery(
  login: string,
  password: string,
  messageId: string,
  target: string,
  isTelegram = false
): Promise<SmscDeliveryState> {
  try {
    const url = new URL(`${BASE}/status.php`);
    url.searchParams.set("login", login);
    url.searchParams.set("psw", password);
    url.searchParams.set("phone", target);
    url.searchParams.set("id", messageId);
    url.searchParams.set("fmt", "3");
    if (isTelegram) url.searchParams.set("bot", "1");
    const res = await fetch(url.toString());
    if (!res.ok) return "pending"; // сбой самой проверки — не топим доставку из-за этого
    const data = await res.json().catch(() => null);
    const status = typeof data?.status === "number" ? data.status : undefined;
    if (status === undefined) return "pending";
    if (status >= 1) return "delivered";
    if (status === -3 || status === -1 || status === 0) return "pending";
    return "failed";
  } catch {
    return "pending";
  }
}
