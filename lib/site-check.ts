// Проверки фактического подключения сайта мерчанта (кнопка «Проверить»
// на Обзоре). Все запросы — server-side, с таймаутом; сайт может быть за
// CDN, поэтому cache: no-store.
//
// Манифест проверяется по ОБЯЗАТЕЛЬНЫМ пунктам стандарта, а не по тому,
// сгенерирован ли он нами: чужой манифест с display:standalone, названием
// и иконками >=192 проходит.

export type CheckItem = { label: string; ok: boolean; note?: string };
export type StepResult = { ok: boolean; checks: CheckItem[] };

const TIMEOUT_MS = 8000;

async function get(url: string): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "follow",
      headers: { "User-Agent": "PushSaaS-SetupCheck/1.0 (+https://pushsaas.app)" },
    });
    clearTimeout(t);
    return res;
  } catch {
    return null;
  }
}

// Шаг 1: service worker в корне, отдаётся как JavaScript, слушает push
export async function checkServiceWorker(domain: string): Promise<StepResult> {
  const checks: CheckItem[] = [];
  const res = await get(`https://${domain}/service-worker.js`);

  const reachable = !!res && res.status === 200;
  checks.push({
    label: "Файл /service-worker.js открывается (HTTP 200)",
    ok: reachable,
    note: res ? (res.status === 200 ? undefined : `HTTP ${res.status}`) : "сайт недоступен",
  });
  if (!reachable) return { ok: false, checks };

  const ct = res!.headers.get("content-type") || "";
  const mimeOk = /javascript|ecmascript/i.test(ct);
  checks.push({
    label: "Content-Type — JavaScript (иначе браузер не зарегистрирует SW)",
    ok: mimeOk,
    note: mimeOk ? undefined : `сейчас: ${ct || "не задан"}`,
  });

  const text = await res!.text().catch(() => "");
  const hasPush = /addEventListener\(\s*['"]push['"]|\bonpush\b/i.test(text);
  checks.push({
    label: "Обработчик события push присутствует",
    ok: hasPush,
    note: hasPush ? undefined : "файл не похож на push-service-worker — скачайте наш из шага 1",
  });

  return { ok: mimeOk && hasPush, checks };
}

// Шаг 2: сниппет виджета на главной странице
export async function checkSnippet(domain: string, projectId: string): Promise<StepResult> {
  const checks: CheckItem[] = [];
  const res = await get(`https://${domain}/`);
  const reachable = !!res && res.ok;
  checks.push({
    label: "Главная страница открывается",
    ok: reachable,
    note: res ? (res.ok ? undefined : `HTTP ${res.status}`) : "сайт недоступен",
  });
  if (!reachable) return { ok: false, checks };

  const html = await res!.text().catch(() => "");
  const found = html.includes(`/embed/${projectId}.js`);
  checks.push({
    label: "Сниппет виджета найден в HTML",
    ok: found,
    note: found ? undefined : "скрипт /embed/….js этого проекта на странице не обнаружен",
  });
  return { ok: found, checks };
}

// Шаг 3: PWA-манифест — обязательные пункты для установки и пушей на iOS
export async function checkManifest(domain: string): Promise<StepResult> {
  const checks: CheckItem[] = [];
  const res = await get(`https://${domain}/`);
  if (!res || !res.ok) {
    checks.push({ label: "Главная страница открывается", ok: false, note: res ? `HTTP ${res.status}` : "сайт недоступен" });
    return { ok: false, checks };
  }
  const html = await res.text().catch(() => "");

  const linkMatch =
    html.match(/<link[^>]*rel=["']?manifest["']?[^>]*href=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']?manifest["']?[^>]*>/i);
  checks.push({
    label: "В <head> есть <link rel=\"manifest\">",
    ok: !!linkMatch,
    note: linkMatch ? undefined : "добавьте сниппет из шага 3",
  });
  if (!linkMatch) return { ok: false, checks };

  let manifestUrl: string;
  try {
    manifestUrl = new URL(linkMatch[1], `https://${domain}/`).toString();
  } catch {
    checks.push({ label: "Ссылка на манифест корректна", ok: false, note: linkMatch[1] });
    return { ok: false, checks };
  }

  const mres = await get(manifestUrl);
  const fetched = !!mres && mres.ok;
  checks.push({
    label: "Манифест открывается",
    ok: fetched,
    note: fetched ? undefined : mres ? `HTTP ${mres.status}` : "не открывается",
  });
  if (!fetched) return { ok: false, checks };

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await mres!.text());
  } catch {
    checks.push({ label: "Манифест — валидный JSON", ok: false });
    return { ok: false, checks };
  }

  const display = String(manifest.display || "browser");
  const displayOk = display === "standalone" || display === "fullscreen";
  checks.push({
    label: "display: standalone (без него пуши на iPhone не работают)",
    ok: displayOk,
    note: displayOk ? undefined : `сейчас: ${display}`,
  });

  const named = !!(manifest.name || manifest.short_name);
  checks.push({ label: "Указано name или short_name", ok: named });

  const icons = Array.isArray(manifest.icons) ? (manifest.icons as Array<{ sizes?: string }>) : [];
  const bigIcon = icons.some((i) =>
    String(i.sizes || "")
      .split(/\s+/)
      .some((s) => {
        const [w] = s.toLowerCase().split("x").map(Number);
        return w >= 192;
      })
  );
  checks.push({
    label: "Есть иконка 192×192 или больше",
    ok: bigIcon,
    note: bigIcon ? undefined : "нужна хотя бы одна иконка ≥192px",
  });

  // не блокирующие рекомендации
  const hasApple = /<link[^>]*rel=["']?apple-touch-icon/i.test(html);
  if (!hasApple) {
    checks.push({ label: "Рекомендация: apple-touch-icon в <head>", ok: true, note: "не найден — иконка на iPhone может быть скриншотом" });
  }

  return { ok: displayOk && named && bigIcon, checks };
}
