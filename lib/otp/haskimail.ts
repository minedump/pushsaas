// Email через Haskimail (https://haskimail.ru/email-api). ОДИН server token
// на аккаунт (project_secrets.haskimail_server_token) — транзакционный и
// рассылочный трафик на их стороне разделяются полем MessageStream
// (числовой ID канала) в самом запросе, не отдельным токеном. Без поля
// письмо уходит в дефолтный транзакционный канал "outbound" — так и
// продолжает работать вход по коду, если явный ID не задан.
// project_secrets.haskimail_transactional_stream — явный ID для входа по
// коду (опционально), haskimail_marketing_stream — для рассылок.

const BASE = "https://api.haskimail.ru";

export type EmailContent = { subject: string; html: string; text?: string };

export async function sendEmail(
  serverToken: string,
  to: string,
  content: EmailContent,
  from?: string,
  messageStream?: string | number
): Promise<boolean> {
  const res = await fetch(`${BASE}/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Haskimail-Server-Token": serverToken,
    },
    body: JSON.stringify({
      From: from || "noreply@haskimail.ru",
      To: to,
      Subject: content.subject,
      HtmlBody: content.html,
      TextBody: content.text,
      ...(messageStream != null ? { MessageStream: Number(messageStream) } : {}),
    }),
  });
  if (!res.ok) {
    console.error("[haskimail] send failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}
