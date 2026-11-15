/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // компактный автономный сервер для Docker
  experimental: {
    optimizePackageImports: ["@tabler/icons-react"],
  },
  // Базовые security-заголовки (security-аудит 2026-09-01) — раньше не было
  // ни одного. Не блокируют встраивание /embed/{id}.js на сторонних сайтах
  // магазинов (CSP/X-Frame-Options управляют тем, что делают НАШИ страницы,
  // а не тем, кто вправе <script src> подключить наш файл) и не трогают
  // gateway'ные CORS-заголовки в docker/gateway.conf (те — для отдельного
  // проксируемого пути /supabase/*, здесь не пересекаются). 'unsafe-inline'
  // у script/style — вынужденно: OIDC-страницы входа (app/oidc/.../route.ts)
  // рендерят сырой HTML с инлайновыми <style>/<script> без nonce-инфраструктуры.
  async headers() {
    const csp = (formAction) =>
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        formAction,
      ].join("; ");
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    ];
    return [
      // все страницы, кроме входа покупателя (/oidc/...): формы отправляются только на этот же адрес
      {
        source: "/:path((?!oidc(?:/|$)).*)",
        headers: [...common, { key: "Content-Security-Policy", value: csp("form-action 'self'") }],
      },
      {
        source: "/",
        headers: [...common, { key: "Content-Security-Policy", value: csp("form-action 'self'") }],
      },
      // Страница входа покупателя: после ввода кода форма отправляется на наш адрес, а ответ — редирект обратно в магазин
      // (другой домен). Браузер применяет form-action и к такому редиректу, поэтому при 'self' вход зависал на кнопке
      // «Подтвердить и войти». Допускаем https: — домен возврата уже проверяется сервером по списку разрешённых.
      {
        source: "/oidc/:path*",
        headers: [...common, { key: "Content-Security-Policy", value: csp("form-action 'self' https:") }],
      },
    ];
  },
  async rewrites() {
    return [
      // OIDC discovery: /.well-known/* внутри issuer проекта -> route-handlers
      {
        source: "/oidc/:projectId/.well-known/openid-configuration",
        destination: "/oidc/:projectId/discovery",
      },
      {
        source: "/oidc/:projectId/.well-known/jwks.json",
        destination: "/oidc/:projectId/jwks",
      },
      // self-hosted docker-compose.yml (см. NEXT_PUBLIC_SUPABASE_URL там):
      // и браузер, и сервер обращаются к Supabase-совместимому API через
      // ЭТО приложение по одному адресу — supabase-ssr иначе не может
      // договориться сам с собой об имени сессионной cookie (оно выводится
      // из хоста NEXT_PUBLIC_SUPABASE_URL; если у браузера и у сервера он
      // разный — cookie одного не совпадает по имени с тем, что ищет
      // другой, и getUser() решает, что сессии нет, хотя она есть).
      // На боевом деплое без self-hosted стека (TimeWeb + облачный Supabase)
      // этот путь просто никогда не используется — NEXT_PUBLIC_SUPABASE_URL
      // там указывает прямо на supabase.co, .../supabase здесь мёртвый код.
      {
        source: "/supabase/:path*",
        destination: "http://gateway:8000/:path*",
      },
    ];
  },
};

export default nextConfig;
