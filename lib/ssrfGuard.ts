import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Защита от SSRF для фетчей по URL, который задаёт сам клиент/админ (сейчас —
// projects.product_feed_url, см. lib/productFeed.ts). Без этой проверки
// админ проекта мог указать http://gateway:8000/... (внутренний Supabase-
// gateway этого же self-hosted стенда), 169.254.169.254 (cloud metadata) или
// адрес другого контейнера в той же docker-сети и получить (полу-)слепой
// SSRF во внутреннюю сеть через сервер, дёргающий фид по расписанию.
// Секьюрити-аудит 2026-09-01.

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  // имена сервисов внутренней docker-сети (см. docker-compose.yml) —
  // резолвятся только изнутри контейнера приложения, снаружи такого хоста
  // не существует, поэтому в легитимном фиде взяться неоткуда
  "gateway",
  "db",
  "auth",
  "rest",
  "storage",
  "app",
]);

function isPrivateOrReservedIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true; // не похоже на IPv4 — закрываемся
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 — сюда же попадают docker-подсети по умолчанию
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local, включая cloud metadata 169.254.169.254
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateOrReservedIp(mapped[1]);
    return false;
  }
  return true; // не распознали формат — закрываемся, не открываемся
}

async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("некорректный URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("допустимы только http/https ссылки");
  const hostname = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) throw new Error("этот адрес недоступен");
  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) throw new Error("этот адрес недоступен");
    return u;
  }
  const records = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!records.length) throw new Error("не удалось разрешить адрес");
  for (const r of records) {
    if (isPrivateOrReservedIp(r.address)) throw new Error("этот адрес недоступен");
  }
  return u;
}

// Фетч с проверкой SSRF на КАЖДЫЙ хоп редиректа — сервер, отдающий фид, мог
// бы иначе пройти первую проверку публичным адресом и 302-нуть на внутренний.
// follow вручную, не через fetch's redirect:"follow" — тому мы не можем
// вклиниться между хопами.
export async function fetchPublicUrl(rawUrl: string, init?: RequestInit & { maxRedirects?: number }): Promise<Response> {
  const maxRedirects = init?.maxRedirects ?? 5;
  let current = rawUrl;
  for (let hop = 0; ; hop++) {
    await assertPublicHttpUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= maxRedirects) throw new Error("слишком много редиректов");
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    return res;
  }
}
