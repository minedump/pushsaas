import { SignJWT } from "jose";
import { CLIENT_ID, CLIENT_SECRET, FAKE_OTP, readBody, log } from "../lib/config.js";

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(q) {
  const debug = JSON.stringify(q, null, 2);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Тестовый вход — PushSaaS стенд</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem;color:#111}
  fieldset{border:1px solid #ccc;border-radius:8px;margin:0 0 1rem;padding:1rem}
  label{display:block;margin:.5rem 0 .2rem}
  input[type=text],input[type=tel],input[type=email]{width:100%;padding:.5rem;border:1px solid #bbb;border-radius:6px;box-sizing:border-box}
  .otp{background:#fff7d6;border:1px dashed #d4a900;border-radius:8px;padding:.6rem 1rem;margin:1rem 0;font-size:15px}
  .otp b{font-size:22px;letter-spacing:4px}
  button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:.7rem 1.4rem;font-size:16px;cursor:pointer;width:100%}
  details{margin-top:1.5rem;color:#555}
  pre{background:#f4f4f5;padding:.7rem;border-radius:8px;overflow-x:auto;font-size:12px}
  .variant label{display:flex;gap:.5rem;align-items:flex-start;margin:.35rem 0;font-size:14px}
  .variant input{margin-top:.25rem}
</style></head><body>
<h2>Вход через PushSaaS (тестовый стенд)</h2>
<form method="POST" action="/auth">
  <input type="hidden" name="client_id" value="${esc(q.client_id)}">
  <input type="hidden" name="redirect_uri" value="${esc(q.redirect_uri)}">
  <input type="hidden" name="state" value="${esc(q.state)}">
  <input type="hidden" name="nonce" value="${esc(q.nonce)}">
  <fieldset>
    <label for="phone">Телефон</label>
    <input type="tel" id="phone" name="phone" placeholder="+7 999 123-45-67" required autocomplete="tel">
    <label for="name">Имя</label>
    <input type="text" id="name" name="name" value="Тест Стендов">
    <label for="email">Email (для вариантов с почтой)</label>
    <input type="email" id="email" name="email" placeholder="user@example.com">
  </fieldset>
  <fieldset class="variant">
    <legend>Состав claims в ID Token</legend>
    <label><input type="radio" name="variant" value="phone_only" checked> A: только phone_number (без email) — главный тест</label>
    <label><input type="radio" name="variant" value="phone_synth_email"> B: phone_number + синтетический email (79991234567@id.стенд)</label>
    <label><input type="radio" name="variant" value="phone_real_email"> C: phone_number + настоящий email</label>
    <label><input type="radio" name="variant" value="email_only"> D: только email (контроль — как в старой доке)</label>
  </fieldset>
  <div class="otp">ТЕСТ-РЕЖИМ: код подтверждения — <b>${FAKE_OTP}</b> (в бою придёт push/Telegram/SMS)</div>
  <label for="otp">Код подтверждения</label>
  <input type="text" id="otp" name="otp" inputmode="numeric" required style="margin-bottom:1rem">
  <button type="submit">Подтвердить и войти</button>
</form>
<details><summary>Параметры запроса от InSales</summary><pre>${esc(debug)}</pre></details>
</body></html>`;
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");

  if (req.method === "GET") {
    const q = Object.fromEntries(url.searchParams);
    log("auth:get", q);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(page(q));
    return;
  }

  if (req.method === "POST") {
    const body = Object.fromEntries(new URLSearchParams(await readBody(req)));
    log("auth:post", { ...body, otp: "***" });

    if (body.otp !== FAKE_OTP) {
      res.statusCode = 400;
      res.end("Неверный код. Вернитесь назад и введите код из жёлтого блока.");
      return;
    }
    if (body.client_id !== CLIENT_ID) {
      res.statusCode = 400;
      res.end(`unknown client_id: ${esc(body.client_id)}`);
      return;
    }

    // authorization code — короткоживущий HS256 JWT, БД не нужна
    const code = await new SignJWT({
      phone: body.phone,
      email: body.email || "",
      name: body.name || "",
      variant: body.variant,
      nonce: body.nonce || "",
      redirect_uri: body.redirect_uri
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(CLIENT_ID)
      .setExpirationTime("5m")
      .setIssuedAt()
      .sign(new TextEncoder().encode(CLIENT_SECRET));

    const target = new URL(body.redirect_uri);
    target.searchParams.set("code", code);
    if (body.state) target.searchParams.set("state", body.state);
    log("auth:redirect", { to: target.origin + target.pathname });
    res.statusCode = 302;
    res.setHeader("Location", target.toString());
    res.end();
    return;
  }

  res.statusCode = 405;
  res.end("method not allowed");
}
