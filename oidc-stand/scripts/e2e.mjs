// Эмуляция InSales: auth → code → token → проверка ID Token по JWKS
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
import { readFileSync } from "node:fs";

const BASE = process.env.STAND_URL || "https://oidc-stand.vercel.app";
const CLIENT_ID = "pushsaas-stand";
const CLIENT_SECRET = readFileSync(new URL("../keys/client_secret.txt", import.meta.url), "utf8").trim();
const REDIRECT = "https://yuliawave.com/auth_apps/1/open_id/callback";
const NONCE = "nonce-" + Math.random().toString(36).slice(2);

async function run(variant, extra = {}) {
  // 1) страница /auth должна отдаваться
  const authPage = await fetch(
    `${BASE}/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&scope=openid+profile+email&state=st123&nonce=${NONCE}`
  );
  if (!authPage.ok || !(await authPage.text()).includes("Телефон")) throw new Error("auth page failed");

  // 2) сабмит формы -> 302 с code
  const form = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT, state: "st123", nonce: NONCE,
    phone: "+7 999 123-45-67", name: "Тест Стендов", email: extra.email || "",
    variant, otp: "1234"
  });
  const post = await fetch(`${BASE}/auth`, { method: "POST", body: form, redirect: "manual" });
  if (post.status !== 302) throw new Error(`auth POST -> ${post.status}: ${await post.text()}`);
  const loc = new URL(post.headers.get("location"));
  if (!loc.href.startsWith(REDIRECT)) throw new Error("redirect mismatch: " + loc.href);
  if (loc.searchParams.get("state") !== "st123") throw new Error("state lost");
  const code = loc.searchParams.get("code");

  // 3) обмен кода на токен (client_secret_post)
  const tok = await fetch(`${BASE}/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code", code,
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT
    })
  });
  const tokBody = await tok.json();
  if (!tok.ok) throw new Error("token failed: " + JSON.stringify(tokBody));

  // 4) верификация RS256 по JWKS + обязательные проверки RP
  const jwks = createRemoteJWKSet(new URL(`${BASE}/.well-known/jwks.json`));
  const { payload } = await jwtVerify(tokBody.id_token, jwks, { issuer: BASE, audience: CLIENT_ID });
  if (payload.nonce !== NONCE) throw new Error("nonce mismatch");

  // 5) userinfo по access_token — как это делает Ruby-клиент InSales
  const ui = await fetch(`${BASE}/userinfo`, {
    headers: { Authorization: `Bearer ${tokBody.access_token}` }
  });
  if (!ui.ok) throw new Error("userinfo failed: " + ui.status);
  const uiBody = await ui.json();
  if (uiBody.sub !== payload.sub) throw new Error("userinfo sub mismatch");
  console.log("userinfo:", JSON.stringify(uiBody));

  const { iss, aud, exp, iat, ...rest } = payload;
  console.log(`\n=== ${variant}: OK ===`);
  console.log("claims:", JSON.stringify(rest, null, 2));
}

await run("phone_only");
await run("phone_synth_email");
await run("phone_real_email", { email: "real@example.com" });
await run("email_only", { email: "real@example.com" });
console.log("\nВсе 4 варианта прошли: подпись RS256 валидна, nonce/state/aud/iss корректны.");
