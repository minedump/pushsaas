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
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
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
