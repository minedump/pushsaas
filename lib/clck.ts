import { outboundFetch } from "@/lib/proxy";

// Сокращение ссылок через clck.ru (Яндекс) — публичный API, без ключа.
// GET /--?url=<encoded> -> 200 + короткая ссылка простым текстом, либо
// 4xx + текст ошибки. Нужно для SMS: подмена ссылок под клик-трекинг
// (?pss_c=...) удлиняет URL, а SMS тарифицируется по сегментам — короткая
// ссылка держит длину сообщения предсказуемой.
// outboundFetch (не голый fetch) — прямой fetch с этого хостинга стабильно
// зависал на TCP-connect к clck.ru (~IPv6-маршрут недоступен, подтверждено
// прямым тестом), тот же класс проблемы, что уже решался для Telegram
// Gateway через OUTBOUND_PROXY_URL (см. lib/proxy.ts). Таймаут короче
// дефолтного — при сбое/медленном ответе просто шлём непокороченную ссылку,
// это не должно задерживать отправку кампании.
export async function shortenUrl(url: string): Promise<string> {
  try {
    const res = await outboundFetch(`https://clck.ru/--?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return url;
    const short = (await res.text()).trim();
    return short.startsWith("http") ? short : url;
  } catch {
    return url;
  }
}
