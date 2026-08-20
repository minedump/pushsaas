import crypto from "crypto";
export { hasUnsubscribeTag } from "@/lib/unsubscribeTag";

// Ссылка отписки — без похода в БД для генерации: подпись HMAC поверх
// (projectId, email), проверяемая при переходе по ссылке. Не завязана на
// identity.id — не нужно резолвить получателя заранее, только на отправке
// письма (см. lib/sender.ts: unsubscribeUrl вызывается на каждого
// получателя с уже известным email). timingSafeEqual — сравнение токена не
// должно давать атакующему возможность угадать его по времени ответа.
const SECRET = process.env.UNSUBSCRIBE_SECRET || "";

function sign(projectId: string, email: string): string {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${projectId}:${email.trim().toLowerCase()}`)
    .digest("base64url");
}

export function unsubscribeToken(projectId: string, email: string): string {
  return sign(projectId, email);
}

export function verifyUnsubscribeToken(projectId: string, email: string, token: string): boolean {
  if (!SECRET || !token) return false;
  const expected = Buffer.from(sign(projectId, email));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function unsubscribeUrl(appUrl: string, projectId: string, email: string): string {
  const params = new URLSearchParams({ p: projectId, e: email.trim().toLowerCase(), t: unsubscribeToken(projectId, email) });
  return `${appUrl}/unsubscribe?${params.toString()}`;
}
