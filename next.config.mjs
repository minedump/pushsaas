/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // компактный автономный сервер для Docker
  experimental: {
    optimizePackageImports: ["@tabler/icons-react"],
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
