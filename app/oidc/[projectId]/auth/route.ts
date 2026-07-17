import { createAdminClient } from "@/lib/supabase/admin";
import { getOidcContext, issuerFor, signParam, verifyParam, oidcLog, type OidcContext } from "@/lib/oidc";
import { issueCodeAndRedirect } from "@/lib/oidc-flow";
import { normalizePhone, maskPhone } from "@/lib/phone";
import { sendOtp, verifyOtp, resolveOrder, describeNoChannel, findIdentityByDevice, type OtpChannel, type OtpKey, type ChannelAttempt } from "@/lib/otp";
import { needsDeliveryPoll } from "@/lib/otp/providers";

// Страница входа по телефону/почте (authorization endpoint).
//
// Единый каскад для ОДНОГО ключа за раз — телефон ИЛИ email, никогда оба
// сразу (нет флоу, который просит подтвердить оба и шлёт код по обоим):
//
//   GET c параметрами RP → сессия → отскок на домен магазина (?pss_link=)
//     виджет предъявляет device_token → /api/public/link пишет
//     device_subscriber_id в сессию → браузер возвращается сюда (?sid&sig)
//   GET ?sid&sig         → сначала МОЛЧА пробуем push на уже узнанное по
//                          этому устройству устройство (identity_devices по
//                          device_subscriber_id) — если это возвратный
//                          посетитель, вообще не показываем форму, сразу
//                          экран кода. Не вышло (новое устройство или push
//                          не сработал) → форма телефона ИЛИ почты, смотря
//                          что первым в channel_order из {email, telegram,
//                          sms} (push сам по себе не форма — ему нечего
//                          спрашивать).
//   POST action=send      → каскад push(по телефону)/telegram/sms для
//                          введённого номера. Не получилось НИ ОДНИМ
//                          каналом → просим email (одна попытка фолбэка).
//   POST action=send_email→ каскад push(по email)/email для введённого
//                          адреса. Не получилось → просим телефон (если это
//                          был старт, а не уже сам фолбэк — тогда тупик).
//   POST action=resend    → повтор конкретным каналом, в рамках ТЕКУЩЕГО
//                          ключа сессии (oidc_auth_sessions.verifying_key).
//   POST action=verify    → identity по ТЕКУЩЕМУ ключу (phone_verified_at
//                          ИЛИ email_verified_at — никогда оба) + привязка
//                          устройства → code → редирект.
//   POST action=delivery_failed → шлёт поллинг с экрана кода (см. codeForm),
//                          когда провайдер подтвердил реальный провал доставки,
//                          а не просто "запрос принят" (Bytehand/SMSC — см.
//                          needsDeliveryPoll). Как и провал send/send_email —
//                          сперва пробуем второй ключ, если ещё не пробовали;
//                          иначе тупик.
//
// Находка теста (2026-07-15): InSales стабильно доходит до /token и
// /userinfo, только если в ID Token есть phone_number — токен с одним email
// у них не дожимается до конца. Значит вход "по почте" рискует не
// довестись на стороне InSales, если магазин настроил каскад так, что
// телефон вообще не участвует (email/telegram/sms без резерва) — этот
// риск на стороне проекта, не платформы (см. buildClaims в lib/oidc.ts).

const SESSION_TTL_MS = 15 * 60 * 1000;
const LINK_TICKET_TTL_MS = 2 * 60 * 1000;

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const normalizeEmail = (e: string) => e.trim().toLowerCase();
const maskEmail = (e: string) => {
  const [user, domain] = e.split("@");
  if (!domain) return e;
  const shown = user.slice(0, Math.min(2, user.length));
  return `${shown}${"*".repeat(Math.max(1, user.length - shown.length))}@${domain}`;
};

const CHANNEL_LABEL: Record<OtpChannel, string> = {
  push: "push-уведомлением на ваше устройство",
  email: "на вашу почту",
  telegram: "в Telegram",
  sms: "по SMS",
};
const RESEND_LABEL: Record<OtpChannel, string> = {
  push: "Отправить код push-уведомлением",
  email: "Отправить код на почту",
  telegram: "Отправить код в Telegram",
  sms: "Отправить код по SMS",
};

function page(title: string, inner: string): Response {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
  body{font:16px/1.5 system-ui,-apple-system,sans-serif;max-width:420px;margin:8vh auto 0;padding:0 1.2rem;color:#16202a}
  h2{font-size:20px;margin:0 0 1rem}
  label{display:block;margin:.9rem 0 .25rem;font-size:14px;color:#45505c}
  input{width:100%;padding:.65rem .75rem;border:1px solid #c3ccd6;border-radius:8px;font-size:17px;box-sizing:border-box}
  button{width:100%;margin-top:1.1rem;padding:.75rem;border:0;border-radius:8px;background:#2c4a66;color:#fff;font-size:16px;cursor:pointer}
  button:disabled{opacity:.6;cursor:default}
  .alt{background:none;color:#2c4a66;text-decoration:underline;font-size:14px;margin-top:.6rem;padding:.3rem}
  .note{font-size:14px;color:#5a6570;margin-top:.7rem}
  .err{background:#fdecec;border:1px solid #e8a0a0;color:#8a2525;border-radius:8px;padding:.6rem .8rem;font-size:14px;margin-bottom:.8rem}
</style></head><body>${inner}
<p class="note" style="margin-top:3rem;font-size:12px">Работает на PushSaaS · вход по номеру телефона</p>
<script>
  // Двойной клик/повторный сабмит на медленной сети = два запроса кода
  // на одну попытку (двойное списание, дублирующийся SMS/push). Блокируем
  // кнопку конкретной формы сразу при сабмите — саму отправку это не
  // прерывает, браузер уже собрал данные к этому моменту.
  document.querySelectorAll("form").forEach(function(f){
    f.addEventListener("submit", function(){
      f.querySelectorAll("button").forEach(function(b){ b.disabled = true; });
    });
  });
</script>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function hidden(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
}

function phoneForm(action: string, sid: string, sig: string, opts: { err?: string; viaFallback?: boolean } = {}): Response {
  return page(
    "Вход по телефону",
    `<h2>Вход по номеру телефона</h2>
     ${opts.err ? `<div class="err">${esc(opts.err)}</div>` : ""}
     <form method="POST" action="${esc(action)}">
       ${hidden({ sid, sig, action: "send" })}
       <label for="phone">Телефон</label>
       <input type="tel" id="phone" name="phone" placeholder="+7 999 123-45-67" required autocomplete="tel" autofocus>
       <button type="submit">Получить код</button>
     </form>
     <p class="note">${
       opts.viaFallback
         ? "Не получилось другим способом — подтвердите номер телефона."
         : "Отправим код подтверждения — push-уведомлением, в Telegram или по SMS."
     }</p>`
  );
}

function emailForm(action: string, sid: string, sig: string, opts: { err?: string; viaFallback?: boolean } = {}): Response {
  return page(
    "Вход по почте",
    `<h2>Вход по почте</h2>
     ${opts.err ? `<div class="err">${esc(opts.err)}</div>` : ""}
     <form method="POST" action="${esc(action)}">
       ${hidden({ sid, sig, action: "send_email" })}
       <label for="email">Email</label>
       <input type="email" id="email" name="email" placeholder="you@example.com" required autocomplete="email" autofocus>
       <button type="submit">Получить код</button>
     </form>
     <p class="note">${
       opts.viaFallback ? "Не получилось другим способом — введите почту, отправим код на неё." : "Отправим код подтверждения на вашу почту."
     }</p>`
  );
}

function codeForm(
  action: string,
  sid: string,
  sig: string,
  channel: OtpChannel,
  provider: string | null,
  maskedTarget: string,
  askName: boolean,
  key: "phone" | "email",
  opts: { err?: string } = {}
): Response {
  const resendChannels: OtpChannel[] = key === "email" ? ["push", "email"] : ["push", "telegram", "sms"];
  // Некоторые провайдеры (Bytehand на sms, SMSC на любом из своих трёх
  // каналов — см. needsDeliveryPoll) подтверждают на отправке только приём,
  // не доставку — опрашиваем статус, пока ждём ввод кода. При подтверждённом
  // провале не уходим сразу из авторизации — сабмитим на action=delivery_failed,
  // который сам решит: пробовать второй ключ дальше по каскаду или, если его
  // уже пробовали, вернуть в магазин (см. POST action=delivery_failed ниже и
  // /oidc/{projectId}/otp-status).
  // Бэкофф вместо фиксированного интервала: первую минуту проверяем часто
  // (мало ли провайдер решит быстро), дальше — реже, чтобы не долбить их API
  // впустую. Суммарно укладываемся в TTL самого кода (5 минут) с запасом —
  // иначе есть шанс, что реальный поздний провал долетит уже после того, как
  // код истечёт сам, и пользователь просто увидит "код истёк" без объяснения.
  const pollScript = needsDeliveryPoll(channel, provider)
    ? `<script>(function(){
  var tries = 0;
  function nextDelay(){ return tries <= 10 ? 4000 : 15000; }
  function poll(){
    tries++;
    if (tries > 25) return;
    setTimeout(function(){
      fetch(${JSON.stringify(action.replace(/\/auth$/, "/otp-status"))}, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: ${JSON.stringify(sid)}, sig: ${JSON.stringify(sig)} })
      }).then(function(r){ return r.json(); }).then(function(d){
        if(d.status === "failed"){
          var f = document.createElement("form");
          f.method = "POST"; f.action = ${JSON.stringify(action)};
          [["sid",${JSON.stringify(sid)}],["sig",${JSON.stringify(sig)}],["action","delivery_failed"]].forEach(function(kv){
            var i = document.createElement("input"); i.type = "hidden"; i.name = kv[0]; i.value = kv[1];
            f.appendChild(i);
          });
          document.body.appendChild(f);
          f.submit();
          return;
        }
        poll();
      }).catch(poll);
    }, nextDelay());
  }
  poll();
})();</script>`
    : "";
  return page(
    "Код подтверждения",
    `<h2>Введите код</h2>
     ${opts.err ? `<div class="err">${esc(opts.err)}</div>` : ""}
     <p class="note">Код отправлен ${CHANNEL_LABEL[channel]} · ${esc(maskedTarget)}</p>
     <form method="POST" action="${esc(action)}">
       ${hidden({ sid, sig, action: "verify" })}
       <label for="code">Код из сообщения</label>
       <input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required autofocus>
       ${askName ? `<label for="name">Ваше имя (регистрация)</label><input type="text" id="name" name="name" autocomplete="name">` : ""}
       <button type="submit">Подтвердить и войти</button>
     </form>
     ${resendChannels
       .filter((c) => c !== channel)
       .map((c) => resendForm(action, sid, sig, c, RESEND_LABEL[c]))
       .join("")}
     ${pollScript}`
  );
}

function resendForm(action: string, sid: string, sig: string, channel: string, label: string): string {
  return `<form method="POST" action="${esc(action)}" style="margin:0">
    ${hidden({ sid, sig, action: "resend", channel })}
    <button type="submit" class="alt">${esc(label)}</button>
  </form>`;
}

// Тупик каскада (оба ключа перепробованы, ни один канал не сработал, или
// доставка реально провалилась — см. otp-status): возвращаем человека туда
// же, откуда пришёл отскок, с меткой ?pss_auth_failed=1 — чтобы виджет её
// узнал (и чтобы это отличалось от обычного возврата по ?pss_link=), а
// InSales показал свою страницу входа заново вместо тупика на нашей форме.
// Без домена проекта возвращать некуда — тогда null, и вызывающий код
// остаётся на своей форме с текстовым сообщением.
function authFailedRedirect(ctx: OidcContext): Response | null {
  if (!ctx.projectDomain) return null;
  return Response.redirect(`https://${ctx.projectDomain}/client_account/session/new?pss_auth_failed=1`, 302);
}

function redirectHostAllowed(ctx: OidcContext, redirectUri: string): boolean {
  try {
    const u = new URL(redirectUri);
    if (u.protocol !== "https:") return false;
    const host = u.hostname;
    if (ctx.projectDomain && (host === ctx.projectDomain || host.endsWith("." + ctx.projectDomain))) return true;
    return /\.myinsales\.ru$/.test(host); // технические домены InSales
  } catch {
    return false;
  }
}

// Какой ключ спрашивать первым: первый НЕ-push канал в настроенном порядке.
// Push сам не форма — ему нечего спрашивать (см. tryRecognizeDevice), он
// молчаливо пробуется до формы. Среди остальных: email первым → почта;
// telegram/sms первыми (или email выключен) → телефон, как обычно.
function startKeyFor(ctx: OidcContext): "phone" | "email" {
  const order = resolveOrder(ctx.config?.channel_order).filter((c) => c !== "push");
  return order[0] === "email" && ctx.config?.channels?.email !== false ? "email" : "phone";
}

type SessionRow = {
  id: string;
  phone: string | null;
  otp_id: string | null;
  status: string;
  device_subscriber_id: string | null;
  pending_email: string | null;
  verifying_key: "phone" | "email" | null;
  expires_at: string;
};

async function loadSession(projectId: string, sid: string, sig: string): Promise<SessionRow | null> {
  if (!sid || !sig || !verifyParam(sid, sig)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("oidc_auth_sessions")
    .select("id, phone, otp_id, status, device_subscriber_id, pending_email, verifying_key, expires_at")
    .eq("id", sid)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data || new Date(data.expires_at) < new Date() || data.status !== "pending") return null;
  return data as SessionRow;
}

// Реальный канал/провайдер уже отправленного кода (для корректной подсказки
// «где искать» и для поллинга при перерисовке формы после ошибки ввода/переотправки).
async function channelOf(otpId: string | null): Promise<{ channel: OtpChannel; provider: string | null }> {
  if (!otpId) return { channel: "sms", provider: null };
  const admin = createAdminClient();
  const { data } = await admin.from("otp_requests").select("channel, provider").eq("id", otpId).maybeSingle();
  return { channel: (data?.channel as OtpChannel) || "sms", provider: data?.provider ?? null };
}

async function askNameFor(projectId: string, phone: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("identities").select("name").eq("project_id", projectId).eq("phone", phone).maybeSingle();
  return !data?.name;
}

async function askNameForEmail(projectId: string, email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("identities").select("name").eq("project_id", projectId).eq("email", email).maybeSingle();
  return !data?.name;
}

type SendAttempt =
  | { ok: true; otpId: string; channel: OtpChannel; provider: string | null; attempts: ChannelAttempt[] }
  | { ok: false; error: "rate_limited" | "no_channel"; message: string; attempts: ChannelAttempt[] };

// Списание 1 push за ПЕРВУЮ попытку отправки кода в сессии (firstSend =
// otp_id ещё не выставлен) — общая точка для формы телефона, формы почты и
// молчаливого узнавания устройства. Переотправки в той же сессии (otp_id
// уже есть) бесплатны — их обрабатывает action=resend отдельно.
async function attemptSend(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  session: SessionRow,
  key: OtpKey,
  opts?: { forceChannel?: OtpChannel }
): Promise<SendAttempt> {
  const firstSend = !session.otp_id;
  if (firstSend) {
    const { data: covered } = await admin.rpc("spend_pushes", { p_project_id: projectId, p_count: 1 });
    if (!covered) {
      return {
        ok: false,
        error: "no_channel",
        message: "Вход временно недоступен — попробуйте позже или обратитесь в магазин.",
        attempts: [],
      };
    }
  }
  const sent = await sendOtp(projectId, key, opts);
  if (!sent.ok) {
    if (firstSend) await admin.rpc("refund_pushes", { p_project_id: projectId, p_count: 1 });
    const message = sent.error === "rate_limited" ? "Слишком много попыток — подождите 10 минут" : describeNoChannel(sent.attempts);
    return { ok: false, error: sent.error, message, attempts: sent.attempts };
  }
  return { ok: true, otpId: sent.otpId, channel: sent.channel, provider: sent.provider, attempts: sent.attempts };
}

// Молчаливое узнавание возвратного посетителя ДО показа формы: если этот
// браузер (device_subscriber_id из отскока) уже честно привязан к телефону
// ИЛИ к email с прошлого раза, пробуем push сразу — без единого вопроса.
// Не получилось (нет привязки, push не настроен/не сработал) — null, и
// GET показывает обычную форму.
async function tryRecognizeDevice(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  session: SessionRow
): Promise<{ channel: OtpChannel; provider: string | null; key: "phone" | "email"; target: string } | null> {
  if (!session.device_subscriber_id) return null;
  const identity = await findIdentityByDevice(projectId, session.device_subscriber_id);
  if (!identity) return null;

  const key: "phone" | "email" = identity.phone ? "phone" : "email";
  const target = (identity.phone || identity.email)!;
  const otpKey: OtpKey = key === "phone" ? { phone: target } : { email: target };

  const r = await attemptSend(admin, projectId, session, otpKey, { forceChannel: "push" });
  if (!r.ok) return null;

  await admin
    .from("oidc_auth_sessions")
    .update({
      otp_id: r.otpId,
      verifying_key: key,
      ...(key === "phone" ? { phone: target } : { pending_email: target }),
    })
    .eq("id", session.id);

  return { channel: r.channel, provider: r.provider, key, target };
}

export async function GET(req: Request, routeCtx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await routeCtx.params;
  const ctx = await getOidcContext(projectId);
  if (!ctx || !ctx.isEnabled) return new Response("Вход не настроен", { status: 404 });

  const action = `${issuerFor(projectId)}/auth`;
  const q = new URL(req.url).searchParams;
  const admin = createAdminClient();
  const startForm = (sid: string, sig: string) => (startKeyFor(ctx) === "email" ? emailForm(action, sid, sig) : phoneForm(action, sid, sig));

  // возврат после опознавательного отскока
  if (q.get("sid")) {
    const session = await loadSession(projectId, q.get("sid")!, q.get("sig") || "");
    if (!session) return new Response("Сессия входа истекла — вернитесь в магазин и попробуйте снова.", { status: 400 });

    // Молчаливое узнавание по push уважает настроенный порядок каналов:
    // если магазин явно поставил push НЕ первым (телефон/SMS раньше него),
    // не перепрыгиваем вперёд без спроса — сразу показываем форму.
    const pushFirst = resolveOrder(ctx.config?.channel_order)[0] === "push" && ctx.config?.channels?.push !== false;
    const recognized = pushFirst ? await tryRecognizeDevice(admin, projectId, session) : null;
    if (recognized) {
      const askName = recognized.key === "phone" ? await askNameFor(projectId, recognized.target) : await askNameForEmail(projectId, recognized.target);
      const maskedTarget = recognized.key === "phone" ? maskPhone(recognized.target) : maskEmail(recognized.target);
      return codeForm(action, session.id, signParam(session.id), recognized.channel, recognized.provider, maskedTarget, askName, recognized.key);
    }
    return startForm(session.id, signParam(session.id));
  }

  // старт флоу от RP (InSales)
  const rp = {
    client_id: q.get("client_id") || "",
    redirect_uri: q.get("redirect_uri") || "",
    state: q.get("state") || "",
    nonce: q.get("nonce") || "",
  };
  const redirectHost = (() => {
    try {
      return new URL(rp.redirect_uri).hostname;
    } catch {
      return rp.redirect_uri;
    }
  })();
  if (rp.client_id !== ctx.clientId) {
    oidcLog("auth:start", { projectId, redirectHost, outcome: "unknown_client_id" });
    return new Response("unknown client_id", { status: 400 });
  }
  if (!redirectHostAllowed(ctx, rp.redirect_uri)) {
    oidcLog("auth:start", { projectId, redirectHost, outcome: "redirect_not_allowed" });
    return new Response("redirect_uri not allowed", { status: 400 });
  }

  // опознавательный отскок: виджет на домене магазина сообщит, каким
  // push-устройством владеет этот браузер (identity_id = null → identify).
  // Приземляемся на страницу входа InSales (там же, откуда стартовал клик по
  // кнопке), а не на главную — не мелькает посторонняя страница магазина,
  // и сниппет там точно должен быть загружен (там же рендерится сама кнопка).
  //
  // Сессия и тикет создаются ОДНИМ RPC-вызовом вместо двух последовательных
  // insert'ов — на счету каждый круговой поход к БД до самого первого
  // редиректа, пока пользователь смотрит на пустой экран.
  if (ctx.projectDomain) {
    const { data: startedRaw } = await admin
      .rpc("start_oidc_session", {
        p_project_id: projectId,
        p_redirect_uri: rp.redirect_uri,
        p_state: rp.state || null,
        p_nonce: rp.nonce || null,
        p_session_ttl_seconds: SESSION_TTL_MS / 1000,
        p_ticket_ttl_seconds: LINK_TICKET_TTL_MS / 1000,
      })
      .maybeSingle();
    const started = startedRaw as { session_id: string; ticket_id: string } | null;
    if (started?.session_id && started?.ticket_id) {
      oidcLog("auth:start", { projectId, redirectHost, sessionId: started.session_id, hasDomain: true });
      return Response.redirect(`https://${ctx.projectDomain}/client_account/session/new?pss_link=${started.ticket_id}`, 302);
    }
  }

  const { data: session } = await admin
    .from("oidc_auth_sessions")
    .insert({
      project_id: projectId,
      redirect_uri: rp.redirect_uri,
      state: rp.state || null,
      nonce: rp.nonce || null,
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (!session) return new Response("session error", { status: 500 });
  oidcLog("auth:start", { projectId, redirectHost, sessionId: session.id, hasDomain: !!ctx.projectDomain });

  return startForm(session.id, signParam(session.id));
}

export async function POST(req: Request, routeCtx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await routeCtx.params;
  const ctx = await getOidcContext(projectId);
  if (!ctx || !ctx.isEnabled) return new Response("Вход не настроен", { status: 404 });

  const action = `${issuerFor(projectId)}/auth`;
  const body = Object.fromEntries(new URLSearchParams(await req.text()));
  const admin = createAdminClient();

  const session = await loadSession(projectId, body.sid || "", body.sig || "");
  if (!session) return new Response("Сессия входа истекла — вернитесь в магазин и попробуйте снова.", { status: 400 });
  const sig = signParam(session.id);

  if (body.action === "use_phone") {
    return phoneForm(action, session.id, sig);
  }

  if (body.action === "send") {
    const phone = normalizePhone(body.phone || "");
    if (!phone) return phoneForm(action, session.id, sig, { err: "Проверьте номер телефона" });
    await admin.from("oidc_auth_sessions").update({ phone }).eq("id", session.id);

    const r = await attemptSend(admin, projectId, session, { phone });
    if (!r.ok) {
      // email уже пробовали в этой сессии (пришли из email-фолбэка) —
      // обоих ключей не хватило, дальше отступать некуда — возвращаем в
      // магазин вместо тупика на нашей форме
      if (session.pending_email) {
        return authFailedRedirect(ctx) ?? phoneForm(action, session.id, sig, { err: "Не получилось отправить код ни одним способом. Попробуйте позже." });
      }
      return emailForm(action, session.id, sig, { viaFallback: true });
    }
    await admin.from("oidc_auth_sessions").update({ otp_id: r.otpId, verifying_key: "phone" }).eq("id", session.id);
    return codeForm(action, session.id, sig, r.channel, r.provider, maskPhone(phone), await askNameFor(projectId, phone), "phone");
  }

  if (body.action === "send_email") {
    const email = normalizeEmail(body.email || "");
    if (!isValidEmail(email)) {
      return emailForm(action, session.id, sig, { err: "Проверьте адрес почты", viaFallback: !!session.phone });
    }

    const r = await attemptSend(admin, projectId, session, { email });
    if (!r.ok) {
      // телефон уже пробовали (пришли из phone-фолбэка) — тупик, возвращаем
      // в магазин вместо тупика на нашей форме
      if (session.phone) {
        return (
          authFailedRedirect(ctx) ??
          emailForm(action, session.id, sig, { err: "Не получилось отправить код ни одним способом. Попробуйте позже.", viaFallback: true })
        );
      }
      await admin.from("oidc_auth_sessions").update({ pending_email: email }).eq("id", session.id);
      return phoneForm(action, session.id, sig, { viaFallback: true });
    }
    await admin.from("oidc_auth_sessions").update({ pending_email: email, otp_id: r.otpId, verifying_key: "email" }).eq("id", session.id);
    return codeForm(action, session.id, sig, r.channel, r.provider, maskEmail(email), await askNameForEmail(projectId, email), "email");
  }

  // Провайдер подтвердил реальный провал доставки (см. otp-status/route.ts —
  // Bytehand/SMSC), поллинг на экране кода это обнаружил. Дальше по каскаду
  // для ЭТОГО ключа отступать некуда (остальные каналы уже не вышли на этапе
  // send/send_email, иначе не дошли бы досюда) — пробуем второй ключ, если
  // ещё не пробовали в этой сессии, точно так же, как при провале самой отправки.
  if (body.action === "delivery_failed") {
    if (!session.otp_id || !session.verifying_key) return new Response("bad session", { status: 400 });
    const key = session.verifying_key;
    const target = key === "phone" ? session.phone : session.pending_email;
    if (!target) return new Response("bad session", { status: 400 });

    const { data: otp } = await admin.from("otp_requests").select("channel, provider, consumed_at").eq("id", session.otp_id).maybeSingle();
    // otp.consumed_at при живой (ещё pending) сессии может быть выставлен
    // только отметкой о провале доставки в otp-status — успешная проверка
    // кода переводит саму сессию в "verified", а loadSession уже отфильтровал
    // такие сессии выше.
    if (!otp || !needsDeliveryPoll(otp.channel as OtpChannel, otp.provider) || !otp.consumed_at) {
      const askName = key === "phone" ? await askNameFor(projectId, target) : await askNameForEmail(projectId, target);
      const maskedTarget = key === "phone" ? maskPhone(target) : maskEmail(target);
      return codeForm(action, session.id, sig, (otp?.channel as OtpChannel) || "sms", otp?.provider ?? null, maskedTarget, askName, key);
    }

    if (key === "phone") {
      if (session.pending_email) {
        return authFailedRedirect(ctx) ?? phoneForm(action, session.id, sig, { err: "Не получилось отправить код ни одним способом. Попробуйте позже." });
      }
      return emailForm(action, session.id, sig, { viaFallback: true });
    }
    if (session.phone) {
      return (
        authFailedRedirect(ctx) ??
        emailForm(action, session.id, sig, { err: "Не получилось отправить код ни одним способом. Попробуйте позже.", viaFallback: true })
      );
    }
    return phoneForm(action, session.id, sig, { viaFallback: true });
  }

  if (!session.otp_id || !session.verifying_key) return new Response("bad session", { status: 400 });
  const key = session.verifying_key;
  const target = key === "phone" ? session.phone : session.pending_email;
  if (!target) return new Response("bad session", { status: 400 });
  const askName = key === "phone" ? await askNameFor(projectId, target) : await askNameForEmail(projectId, target);
  const maskedTarget = key === "phone" ? maskPhone(target) : maskEmail(target);
  const otpKey: OtpKey = key === "phone" ? { phone: target } : { email: target };

  if (body.action === "resend") {
    const allowed: OtpChannel[] = key === "phone" ? ["push", "telegram", "sms"] : ["push", "email"];
    const requested = body.channel as OtpChannel;
    const channel = allowed.includes(requested) ? requested : allowed[allowed.length - 1];
    const sent = await sendOtp(projectId, otpKey, { forceChannel: channel });
    if (!sent.ok) {
      const msg = sent.error === "rate_limited" ? "Слишком много отправок — подождите 10 минут" : describeNoChannel(sent.attempts);
      const prev = await channelOf(session.otp_id);
      return codeForm(action, session.id, sig, prev.channel, prev.provider, maskedTarget, askName, key, { err: msg });
    }
    await admin.from("oidc_auth_sessions").update({ otp_id: sent.otpId }).eq("id", session.id);
    return codeForm(action, session.id, sig, sent.channel, sent.provider, maskedTarget, askName, key);
  }

  if (body.action === "verify") {
    const result = await verifyOtp(session.otp_id, (body.code || "").trim());
    if (result !== "ok") {
      const msg =
        result === "wrong"
          ? "Неверный код"
          : result === "too_many"
            ? "Слишком много попыток — запросите новый код"
            : "Код истёк — запросите новый";
      const prev = await channelOf(session.otp_id);
      return codeForm(action, session.id, sig, prev.channel, prev.provider, maskedTarget, askName, key, { err: msg });
    }

    // подтверждён ИМЕННО этот ключ — identity создаётся/находится по нему;
    // второй ключ (если на identity уже что-то есть от вебхука заказа и
    // т.п.) этим не трогаем и не помечаем подтверждённым.
    const { data: identity } = await admin
      .from("identities")
      .upsert(
        key === "phone"
          ? { project_id: projectId, phone: target, phone_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : { project_id: projectId, email: target, email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: key === "phone" ? "project_id,phone" : "project_id,email" }
      )
      .select("id, name")
      .single();
    if (!identity) return new Response("identity error", { status: 500 });

    const name = (body.name || "").trim();
    if (name && !identity.name) await admin.from("identities").update({ name }).eq("id", identity.id);

    if (session.device_subscriber_id) {
      await admin.from("identity_devices").upsert(
        { identity_id: identity.id, subscriber_id: session.device_subscriber_id, last_used_at: new Date().toISOString() },
        { onConflict: "identity_id,subscriber_id" }
      );
    }

    await admin.from("oidc_auth_sessions").update({ identity_id: identity.id, status: "verified" }).eq("id", session.id);
    oidcLog("auth:verified", { projectId, sessionId: session.id, identityId: identity.id, key });
    return issueCodeAndRedirect(session.id);
  }

  return new Response("bad action", { status: 400 });
}
