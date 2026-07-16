import { ProxyAgent, type Dispatcher } from "undici";

// Часть внешних API (подтверждено: Telegram Gateway — gatewayapi.telegram.org)
// недоступна напрямую с российского хостинга — таймаут на уровне TCP/TLS, не
// ошибка самого API. OUTBOUND_PROXY_URL (формат http://user:pass@host:port) —
// общий на проект прокси для таких случаев; если не задан, outboundFetch —
// обычный fetch без прокси. Заводить его нужно только там, где реально
// наблюдался таймаут — на исправно работающие интеграции (Bytehand,
// Haskimail) заворачивать не нужно, это лишняя точка отказа без причины.
const PROXY_URL = process.env.OUTBOUND_PROXY_URL || "";

let dispatcher: Dispatcher | undefined;
function getDispatcher(): Dispatcher | undefined {
  if (!PROXY_URL) return undefined;
  if (!dispatcher) dispatcher = new ProxyAgent(PROXY_URL);
  return dispatcher;
}

export function outboundFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const d = getDispatcher();
  if (!d) return fetch(url, init);
  return fetch(url, { ...init, dispatcher: d } as RequestInit);
}
