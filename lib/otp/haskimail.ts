// Email через Haskimail (https://haskimail.ru/email-api). Ключ — project_secrets.haskimail_server_token.
// Канал только для АВТОРИЗАЦИИ (возвратных клиентов, у которых email уже есть
// в identities), не для маркетинга.

const BASE = "https://api.haskimail.ru";

export async function sendEmailCode(
  serverToken: string,
  to: string,
  code: string,
  from?: string
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
      Subject: `Код входа: ${code}`,
      HtmlBody: `<p>Ваш код для входа: <b style="font-size:20px">${code}</b></p><p style="color:#888">Действует 5 минут.</p>`,
      TextBody: `Ваш код для входа: ${code} (действует 5 минут)`,
    }),
  });
  if (!res.ok) {
    console.error("[haskimail] send failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}
