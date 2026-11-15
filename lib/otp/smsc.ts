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
// Живые тесты (аккаунт yulia_wave):
// - Telegram (tg=1) — отправка принимается, а статус (status.php) навсегда
//   зависает на -3 (в очереди) и никогда не переходит в "доставлено". Но код
//   РЕАЛЬНО доходит и вход работает (подтверждено живым пользователем) — это
//   квирк именно статус-API SMSC для Telegram, не провал доставки. Не ломает
//   флоу: /oidc/{projectId}/otp-status реагирует только на явный "failed" от
//   checkSmscDelivery, вечный "pending" ни на что не влияет — код принимается
//   формой ввода независимо от статуса опроса (см. otp-status/route.ts).
// - Email (mail=1) — отправка отклонялась на приёме (error_code 6, "message
//   is denied") с отправителем не с этого аккаунта; заработала сразу же
//   после смены sender/email_from на подтверждённый у SMSC адрес — модерация
//   была именно по отправителю, не по каналу целиком.
// - SMS — как минимум по состоянию на 2026-08-18 всё ещё отклоняется на
//   приёме (error_code 6) независимо от sender (пробовали и с именем, и без)
//   — похоже на отдельную модерацию SMS-канала на стороне SMSC, ещё не
//   пройденную для этого аккаунта. Проверить снова, когда её пройдут.

const BASE = "https://smsc.ru/sys";

type SmscSendResponse = { id?: number | string; cnt?: number; error?: string; error_code?: number };

async function callSend(login: string, password: string, params: Record<string, string>): Promise<SmscSendResponse> {
  // POST, а не GET: HTML-шаблон письма на десятки килобайт не помещается в адресную
  // строку (smsc.ru отвечает 414 уже около 16 000 символов), а в теле запроса проходит.
  const body = new URLSearchParams({ login, psw: password, fmt: "3", charset: "utf-8", ...params });
  const res = await fetch(`${BASE}/send.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
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
export type SmscDeliveryCheck = { state: SmscDeliveryState; detail: string | null };

// Коды статусов SMSC (документация: «Статусы сообщений → Коды статусов»):
//   -3 не найдено, -2 остановлено, -1 ожидает отправки, 0 передано оператору,
//   1 доставлено, 2 прочитано (только e-mail), 3 просрочено, 4 нажата ссылка,
//   20 невозможно доставить, 22 неверный номер, 23 запрещено (антиспам/дубли/
//   чёрный список), 24 недостаточно средств, 25 недоступный номер.
// Доставлено — 1, 2, 4; в пути — -3, -1, 0; остальное — не доставлено.
// Раньше «>= 1» считалось доставкой и 3/20/22–25 ошибочно проходили как успех.
const SMSC_STATUS_LABEL: Record<number, string> = {
  [-3]: "Сообщение не найдено",
  [-2]: "Остановлено",
  [-1]: "Ожидает отправки",
  0: "Передано оператору",
  1: "Доставлено",
  2: "Прочитано",
  3: "Не доставлено: истёк срок",
  4: "Доставлено, ссылка нажата",
  20: "Не доставлено: невозможно доставить",
  22: "Неверный номер",
  23: "Запрещено антиспам-фильтром",
  24: "Недостаточно средств на счёте",
  25: "Номер не принимает сообщения",
};

// GET /sys/status.php — статус конкретного id. target — исходный получатель
// (номер телефона или email), обязателен у SMSC. isTelegram добавляет
// bot=1, как того требует проверка статуса Telegram-сообщений.
// Ограничения SMSC: статус можно спрашивать в течение суток после отправки,
// не чаще 5 одинаковых запросов в минуту.
export async function checkSmscDelivery(
  login: string,
  password: string,
  messageId: string,
  target: string,
  isTelegram = false
): Promise<SmscDeliveryCheck> {
  try {
    const url = new URL(`${BASE}/status.php`);
    url.searchParams.set("login", login);
    url.searchParams.set("psw", password);
    url.searchParams.set("phone", target);
    url.searchParams.set("id", messageId);
    url.searchParams.set("fmt", "3");
    if (isTelegram) url.searchParams.set("bot", "1");
    const res = await fetch(url.toString());
    if (!res.ok) return { state: "pending", detail: null }; // сбой самой проверки — не топим доставку из-за этого
    const data = await res.json().catch(() => null);
    const status = typeof data?.status === "number" ? data.status : undefined;
    if (status === undefined) return { state: "pending", detail: null };
    const detail = SMSC_STATUS_LABEL[status] || `Статус ${status}`;
    if (status === 1 || status === 2 || status === 4) return { state: "delivered", detail };
    if (status === -3 || status === -1 || status === 0) return { state: "pending", detail };
    return { state: "failed", detail };
  } catch {
    return { state: "pending", detail: null };
  }
}
