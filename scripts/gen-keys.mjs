import { createHmac } from "node:crypto";

/**
 * Генератор ключей доступа для self-hosted развёртывания.
 * PostgREST, storage-api и GoTrue принимают/подписывают JWT общим секретом:
 *   node scripts/gen-keys.mjs "<JWT_SECRET>"
 */
const secret = process.argv[2];
if (!secret || secret.length < 32) {
  console.error("Нужен JWT_SECRET не короче 32 символов:\n  node scripts/gen-keys.mjs \"$(openssl rand -hex 32)\"");
  process.exit(1);
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (role) => {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role, iss: "supabase", iat: now, exp: now + 20 * 365 * 24 * 3600 });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};
console.log("SUPABASE_ANON_KEY=" + sign("anon"));
console.log("SUPABASE_SERVICE_ROLE_KEY=" + sign("service_role"));
