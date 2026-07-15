import { createAdminClient } from "@/lib/supabase/admin";
import { getOidcContext, issuerFor, signParam, verifyParam, oidcLog, type OidcContext } from "@/lib/oidc";
import { issueCodeAndRedirect } from "@/lib/oidc-flow";
import { normalizePhone, maskPhone } from "@/lib/phone";
import { sendOtp, verifyOtp, resolveOrder, type OtpChannel } from "@/lib/otp";
import { checkRateLimit } from "@/lib/ratelimit";

// Страница входа по телефону/почте (authorization endpoint).
//
// Флоу с опознавательным отскоком (works push-only, без Telegram/SMS):
//   GET c параметрами RP  → сессия → отскок на домен магазина (?pss_link=)
//     виджет предъявляет device_token → /api/public/link пишет
//     device_subscriber_id в сессию → браузер возвращается сюда (?sid&sig)
//   GET ?sid&sig          → форма телефона ИЛИ почты (если email первый
//                           в каскаде — config.channel_order[0]==='email')
//   POST action=send      → каскад для введённого телефона (push на
//                           привязанные устройства → email → telegram → sms)
//   POST action=send_email→ (а) email уже знаком по прежнему заказу — сразу
//                           резолвим телефон и шлём код обычным каскадом;
//                           (б) телефон уже есть в сессии (каскад исчерпан) —
//                           шлём код именно на эту, новую для нас почту;
//                           (в) телефона ещё нет (старт с почты) — почта не
//                           опознана, просим телефон, помня введённую почту
//   POST action=resend    → повтор конкретным каналом
//   POST action=use_phone → переключиться с формы почты на форму телефона
//   POST action=verify    → identity (+ email из pending_email, если там
//                           было пусто) + привязка устройства → code → редирект
//
// Находка теста (2026-07-15): InSales стабильно доходит до /token и
// /userinfo, только если в ID Token есть phone_number. Токен без телефона
// (чистый email) у них не дожимается до конца. Поэтому наша identity ВСЕГДА
// требует телефон (identities.phone not null) — даже вход "по почте" в
// итоге подтверждается номером и отправляет в InSales оба поля.

const SESSION_TTL_MS = 15 * 60 * 1000;
const LINK_TICKET_TTL_MS = 2 * 60 * 1000;

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const normalizeEmail = (e: string) => e.trim().toLowerCase();

const CHANNEL_LABEL: Record<OtpChannel, string> = {
  push: "push-уведомлением на ваше устройство",
  email: "на вашу почту",
  telegram: "в Telegram",
  sms: "по SMS",
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
  .alt{background:none;color:#2c4a66;text-decoration:underline;font-size:14px;margin-top:.6rem;padding:.3rem}
  .note{font-size:14px;color:#5a6570;margin-top:.7rem}
  .err{background:#fdecec;border:1px solid #e8a0a0;color:#8a2525;border-radius:8px;padding:.6rem .8rem;font-size:14px;margin-bottom:.8rem}
</style></head><body>${inner}
<p class="note" style="margin-top:3rem;font-size:12px">Работает на PushSaaS · вход по номеру телефона</p>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function hidden(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
}

function phoneForm(action: string, sid: string, sig: string, err?: string): Response {
  return page(
    "Вход по телефону",
    `<h2>Вход по номеру телефона</h2>
     ${err ? `<div class="err">${esc(err)}</div>` : ""}
     <form method="POST" action="${esc(action)}">
       ${hidden({ sid, sig, action: "send" })}
       <label for="phone">Телефон</label>
       <input type="tel" id="phone" name="phone" placeholder="+7 999 123-45-67" required autocomplete="tel" autofocus>
       <button type="submit">Получить код</button>
     </form>
     <p class="note">Отправим код подтверждения — push-уведомлением, в Telegram или по SMS.</p>`
  );
}

function emailForm(action: string, sid: string, sig: string, opts: { phoneKnown?: boolean; err?: string } = {}): Response {
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
     ${
       opts.phoneKnown
         ? `<p class="note">Не пришёл код другим способом — введите почту, отправим код на неё.</p>`
         : `<p class="note">Если у вас нет аккаунта с этой почтой, попросим подтвердить номер телефона.</p>
            <form method="POST" action="${esc(action)}" style="margin-top:.4rem">
              ${hidden({ sid, sig, action: "use_phone" })}
              <button type="submit" class="alt">Войти по номеру телефона</button>
            </form>`
     }`
  );
}

function codeForm(
  action: string,
  sid: string,
  sig: string,
  channel: OtpChannel,
  phoneMasked: string,
  askName: boolean,
  err?: string
): Response {
  return page(
    "Код подтверждения",
    `<h2>Введите код</h2>
     ${err ? `<div class="err">${esc(err)}</div>` : ""}
     <p class="note">Код отправлен ${CHANNEL_LABEL[channel]} · ${esc(phoneMasked)}</p>
     <form method="POST" action="${esc(action)}">
       ${hidden({ sid, sig, action: "verify" })}
       <label for="code">Код из сообщения</label>
       <input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required autofocus>
       ${askName ? `<label for="name">Ваше имя (регистрация)</label><input type="text" id="name" name="name" autocomplete="name">` : ""}
       <button type="submit">Подтвердить и войти</button>
     </form>
     ${channel !== "push" ? resendForm(action, sid, sig, "push", "Отправить код push-уведомлением") : ""}
     ${channel !== "email" ? resendForm(action, sid, sig, "email", "Отправить код на почту") : ""}
     ${channel !== "telegram" ? resendForm(action, sid, sig, "telegram", "Отправить код в Telegram") : ""}
     ${channel !== "sms" ? resendForm(action, sid, sig, "sms", "Отправить код по SMS") : ""}`
  );
}

function resendForm(action: string, sid: string, sig: string, channel: string, label: string): string {
  return `<form method="POST" action="${esc(action)}" style="margin:0">
    ${hidden({ sid, sig, action: "resend", channel })}
    <button type="submit" class="alt">${esc(label)}</button>
  </form>`;
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

// Вход стартует с формы почты, только если магазин поставил email первым
// каналом каскада — иначе (по умолчанию) стартуем с телефона, как обычно.
function emailFirstFor(ctx: OidcContext): boolean {
  const order = resolveOrder(ctx.config?.channel_order);
  return order[0] === "email" && ctx.config?.channels?.email !== false;
}

type SessionRow = {
  id: string;
  phone: string | null;
  otp_id: string | null;
  status: string;
  device_subscriber_id: string | null;
  pending_email: string | null;
  expires_at: string;
};

async function loadSession(projectId: string, sid: string, sig: string): Promise<SessionRow | null> {
  if (!sid || !sig || !verifyParam(sid, sig)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("oidc_auth_sessions")
    .select("id, phone, otp_id, status, device_subscriber_id, pending_email, expires_at")
    .eq("id", sid)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data || new Date(data.expires_at) < new Date() || data.status !== "pending") return null;
  return data;
}

// Реальный канал уже отправленного кода (для корректной подсказки «где искать»
// при перерисовке формы после ошибки ввода/переотправки).
async function channelOf(otpId: string | null): Promise<OtpChannel> {
  if (!otpId) return "sms";
  const admin = createAdminClient();
  const { data } = await admin.from("otp_requests").select("channel").eq("id", otpId).maybeSingle();
  return (data?.channel as OtpChannel) || "sms";
}

async function askNameFor(projectId: string, phone: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("identities")
    .select("name")
    .eq("project_id", projectId)
    .eq("phone", phone)
    .maybeSingle();
  return !data?.name;
}

// Известна ли эта почта по прежнему подтверждённому телефону — используется
// и для старта с почты (item 3), и для мгновенного резолва номера.
async function findIdentityByEmail(projectId: string, email: string): Promise<{ phone: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("identities")
    .select("phone")
    .eq("project_id", projectId)
    .eq("email", email)
    .not("phone_verified_at", "is", null)
    .maybeSingle();
  return data || null;
}

async function hasHaskimailToken(projectId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("project_secrets")
    .select("haskimail_server_token")
    .eq("project_id", projectId)
    .maybeSingle();
  return !!data?.haskimail_server_token;
}

type SendAttempt =
  | { ok: true; otpId: string; channel: OtpChannel }
  | { ok: false; error: "rate_limited" | "no_channel" | "device_not_linked"; message: string };

// Списание 1 push за ПЕРВУЮ попытку отправки кода в сессии (firstSend =
// otp_id ещё не выставлен) — общая точка для формы телефона, обеих ветвей
// формы почты и явной отправки на новый адрес. Переотправки в той же
// сессии (otp_id уже есть) бесплатны — их обрабатывает action=resend отдельно.
async function attemptSend(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  session: SessionRow,
  phone: string,
  opts?: { forceChannel?: OtpChannel; explicitEmail?: string }
): Promise<SendAttempt> {
  const firstSend = !session.otp_id;
  if (firstSend) {
    const { data: covered } = await admin.rpc("spend_pushes", { p_project_id: projectId, p_count: 1 });
    if (!covered) {
      return { ok: false, error: "no_channel", message: "Вход временно недоступен — попробуйте позже или обратитесь в магазин." };
    }
  }
  const sent = await sendOtp(projectId, phone, opts);
  if (!sent.ok) {
    if (firstSend) await admin.rpc("refund_pushes", { p_project_id: projectId, p_count: 1 });
    const message =
      sent.error === "rate_limited"
        ? "Слишком много попыток — подождите 10 минут"
        : sent.error === "device_not_linked"
          ? "Это устройство ещё не привязано к номеру. Войдите в личный кабинет магазина и подпишитесь на уведомления, чтобы привязать устройство."
          : "Не удалось отправить код. Подпишитесь на уведомления на сайте магазина или попробуйте позже.";
    return { ok: false, error: sent.error, message };
  }
  return { ok: true, otpId: sent.otpId, channel: sent.channel };
}

export async function GET(req: Request, routeCtx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await routeCtx.params;
  const ctx = await getOidcContext(projectId);
  if (!ctx || !ctx.isEnabled) return new Response("Вход не настроен", { status: 404 });

  const action = `${issuerFor(projectId)}/auth`;
  const q = new URL(req.url).searchParams;
  const admin = createAdminClient();
  const startForm = (sid: string, sig: string) => (emailFirstFor(ctx) ? emailForm(action, sid, sig) : phoneForm(action, sid, sig));

  // возврат после опознавательного отскока — сразу форма
  if (q.get("sid")) {
    const session = await loadSession(projectId, q.get("sid")!, q.get("sig") || "");
    if (!session) return new Response("Сессия входа истекла — вернитесь в магазин и попробуйте снова.", { status: 400 });
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

  // опознавательный отскок: виджет на домене магазина сообщит, каким
  // push-устройством владеет этот браузер (identity_id = null → identify).
  // Приземляемся на страницу входа InSales (там же, откуда стартовал клик по
  // кнопке), а не на главную — не мелькает посторонняя страница магазина,
  // и сниппет там точно должен быть загружен (там же рендерится сама кнопка).
  if (ctx.projectDomain) {
    const { data: ticket } = await admin
      .from("link_tickets")
      .insert({
        project_id: projectId,
        identity_id: null,
        session_id: session.id,
        expires_at: new Date(Date.now() + LINK_TICKET_TTL_MS).toISOString(),
      })
      .select("id")
      .single();
    if (ticket) {
      return Response.redirect(`https://${ctx.projectDomain}/client_account/session/new?pss_link=${ticket.id}`, 302);
    }
  }

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
    if (!phone) return phoneForm(action, session.id, sig, "Проверьте номер телефона");
    // помним телефон уже сейчас — даже если отправка кода не удастся,
    // фолбэк на почту не должен заставлять вводить его заново
    await admin.from("oidc_auth_sessions").update({ phone }).eq("id", session.id);

    const r = await attemptSend(admin, projectId, session, phone);
    if (!r.ok) {
      if (r.error === "no_channel" && ctx.config?.channels?.email !== false && (await hasHaskimailToken(projectId))) {
        return emailForm(action, session.id, sig, { phoneKnown: true });
      }
      return phoneForm(action, session.id, sig, r.message);
    }
    await admin.from("oidc_auth_sessions").update({ otp_id: r.otpId }).eq("id", session.id);
    return codeForm(action, session.id, sig, r.channel, maskPhone(phone), await askNameFor(projectId, phone));
  }

  if (body.action === "send_email") {
    const email = normalizeEmail(body.email || "");
    if (!isValidEmail(email)) {
      return emailForm(action, session.id, sig, { phoneKnown: !!session.phone, err: "Проверьте адрес почты" });
    }

    // (б) телефон уже есть в сессии (каскад для него исчерпан) — шлём код
    // явно на эту, новую для нас почту; при верификации она уйдёт в identity.
    // ВАЖНО: здесь НЕЛЬЗЯ искать email среди чужих identities — если введённый
    // адрес случайно совпадёт с чужой зарегистрированной почтой, флоу тихо
    // переключился бы на чужой аккаунт и слил бы посетителю маскированный
    // номер постороннего клиента (даже без входа под ним — код всё равно
    // уходит настоящему владельцу, но сам факт "эта почта существует" и
    // кусок чужого номера — уже утечка). Телефон, который человек уже
    // подтверждал по ходу этой сессии, — единственный источник истины.
    if (session.phone) {
      if (ctx.config?.channels?.email === false) {
        return emailForm(action, session.id, sig, { phoneKnown: true, err: "Email-канал отключён магазином" });
      }
      const r = await attemptSend(admin, projectId, session, session.phone, { forceChannel: "email", explicitEmail: email });
      if (!r.ok) return emailForm(action, session.id, sig, { phoneKnown: true, err: r.message });
      await admin.from("oidc_auth_sessions").update({ pending_email: email, otp_id: r.otpId }).eq("id", session.id);
      return codeForm(action, session.id, sig, r.channel, maskPhone(session.phone), await askNameFor(projectId, session.phone));
    }

    // (а) вход стартовал с почты (телефона в сессии ещё нет) — тут поиск по
    // email уместен, это и есть смысл "войти по почте". Троттлим отдельно
    // от лимита на отправку кода — сам подбор чужих email ничего не шлёт,
    // поэтому phone-скоуп-лимит в sendOtp его не ловит.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const lookupAllowed = await checkRateLimit(`email_lookup:${projectId}:${ip}`, 60_000, 10);
    if (!lookupAllowed) {
      return emailForm(action, session.id, sig, { err: "Слишком много попыток — подождите минуту" });
    }

    const found = await findIdentityByEmail(projectId, email);
    if (found) {
      await admin.from("oidc_auth_sessions").update({ phone: found.phone }).eq("id", session.id);
      const r = await attemptSend(admin, projectId, session, found.phone);
      if (!r.ok) return emailForm(action, session.id, sig, { err: r.message });
      await admin.from("oidc_auth_sessions").update({ otp_id: r.otpId }).eq("id", session.id);
      return codeForm(action, session.id, sig, r.channel, maskPhone(found.phone), await askNameFor(projectId, found.phone));
    }

    // (в) почта нам не знакома — просим телефон, не забывая введённую почту
    // (сольётся в identity после верификации, только если там будет пусто)
    await admin.from("oidc_auth_sessions").update({ pending_email: email }).eq("id", session.id);
    return phoneForm(action, session.id, sig, "Эту почту мы не нашли — подтвердите номер телефона.");
  }

  if (!session.phone || !session.otp_id) return new Response("bad session", { status: 400 });
  const askName = await askNameFor(projectId, session.phone);

  if (body.action === "resend") {
    const channel = (["push", "email", "telegram", "sms"].includes(body.channel) ? body.channel : "sms") as OtpChannel;
    const sent = await sendOtp(projectId, session.phone, {
      forceChannel: channel,
      ...(channel === "email" && session.pending_email ? { explicitEmail: session.pending_email } : {}),
    });
    if (!sent.ok) {
      const msg =
        sent.error === "rate_limited"
          ? "Слишком много отправок — подождите 10 минут"
          : sent.error === "device_not_linked"
            ? "Устройство не привязано к номеру — этот канал недоступен."
            : "Канал недоступен";
      return codeForm(action, session.id, sig, await channelOf(session.otp_id), maskPhone(session.phone), askName, msg);
    }
    await admin.from("oidc_auth_sessions").update({ otp_id: sent.otpId }).eq("id", session.id);
    return codeForm(action, session.id, sig, sent.channel, maskPhone(session.phone), askName);
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
      return codeForm(action, session.id, sig, await channelOf(session.otp_id), maskPhone(session.phone), askName, msg);
    }

    // телефон подтверждён — identity + привязка текущего устройства
    const { data: identity } = await admin
      .from("identities")
      .upsert(
        {
          project_id: projectId,
          phone: session.phone,
          phone_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "project_id,phone" }
      )
      .select("id, name")
      .single();
    if (!identity) return new Response("identity error", { status: 500 });

    const name = (body.name || "").trim();
    if (name && !identity.name) await admin.from("identities").update({ name }).eq("id", identity.id);

    // почта, введённая вручную по ходу входа (email как фолбэк или как
    // стартовый идентификатор, не найденный сразу) — сливаем, только если
    // на identity ещё ничего не было (не затираем уже известную почту)
    if (session.pending_email) {
      await admin.from("identities").update({ email: session.pending_email }).eq("id", identity.id).is("email", null);
    }

    if (session.device_subscriber_id) {
      await admin.from("identity_devices").upsert(
        {
          identity_id: identity.id,
          subscriber_id: session.device_subscriber_id,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "identity_id,subscriber_id" }
      );
    }

    await admin
      .from("oidc_auth_sessions")
      .update({ identity_id: identity.id, status: "verified" })
      .eq("id", session.id);

    oidcLog("auth:verified", { projectId, sessionId: session.id, identityId: identity.id });
    return issueCodeAndRedirect(session.id);
  }

  return new Response("bad action", { status: 400 });
}
