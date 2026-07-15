/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // компактный автономный сервер для Docker
  experimental: {
    optimizePackageImports: ["@tabler/icons-react"],
  },
  // OIDC discovery: /.well-known/* внутри issuer проекта -> route-handlers
  async rewrites() {
    return [
      {
        source: "/oidc/:projectId/.well-known/openid-configuration",
        destination: "/oidc/:projectId/discovery",
      },
      {
        source: "/oidc/:projectId/.well-known/jwks.json",
        destination: "/oidc/:projectId/jwks",
      },
    ];
  },
};

export default nextConfig;
