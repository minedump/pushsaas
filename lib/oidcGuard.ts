import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/ratelimit";

// Защита формы входа от перебора: считаем не только отправки на один номер (это уже есть в lib/otp, там 9 за
// 10 минут), а ещё и действия посетителя. Иначе бот мог бы пройти по разным номерам и потратить деньги на SMS/Telegram.
//
//  · с одного IP: ограниченное число отправок и новых сессий за 10 минут. Лимиты с запасом: за одним адресом может
//    сидеть много настоящих покупателей (мобильные операторы отдают один IP сотням абонентов);
//  · в одной сессии входа: не больше трёх разных номеров/почт (покупатель ошибся в номере — это нормально, а
//    перебор десятков номеров нет) и не больше восьми отправок за время жизни сессии.
//
// Счётчики лежат в rate_limit_hits (тот же механизм, что у публичных ручек подписки и идентификации).
const WINDOW_MS = 10 * 60 * 1000;
const SESSION_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_IP = 30;
const MAX_STARTS_PER_IP = 60;
const MAX_TARGETS_PER_SESSION = 3;
const MAX_SENDS_PER_SESSION = 8;

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "unknown";
}

// Новая сессия входа с этого IP (старт потока от магазина).
export async function allowSessionStart(req: Request, projectId: string): Promise<boolean> {
  return checkRateLimit(`oidc-start-ip:${projectId}:${clientIp(req)}`, WINDOW_MS, MAX_STARTS_PER_IP);
}

// Отправка кода (первая или повторная) в рамках сессии. target — номер или почта, на которые идёт код.
export async function allowCodeSend(req: Request, projectId: string, sessionId: string, target: string): Promise<boolean> {
  if (!(await checkRateLimit(`oidc-send-ip:${projectId}:${clientIp(req)}`, WINDOW_MS, MAX_SENDS_PER_IP))) return false;
  if (!(await checkRateLimit(`oidc-send-sess:${sessionId}`, SESSION_WINDOW_MS, MAX_SENDS_PER_SESSION))) return false;

  // разные цели в одной сессии: тот же номер можно запрашивать повторно, новый — не больше трёх
  const admin = createAdminClient();
  const prefix = `oidc-tgt:${sessionId}:`;
  const key = `${prefix}${target}`;
  const since = new Date(Date.now() - SESSION_WINDOW_MS).toISOString();
  const { data } = await admin.from("rate_limit_hits").select("key").like("key", `${prefix}%`).gte("created_at", since);
  const known = new Set((data ?? []).map((r) => r.key as string));
  if (known.has(key)) return true;
  if (known.size >= MAX_TARGETS_PER_SESSION) return false;
  await admin.from("rate_limit_hits").insert({ key });
  return true;
}
