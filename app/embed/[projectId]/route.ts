import { createAdminClient } from "@/lib/supabase/admin";
import { resolveButtonConfig, resolvePromptConfig, type ButtonConfig, type PromptConfig } from "@/lib/widget-config";
import { buttonBlock, promptBlock } from "@/lib/widget-scripts";

// Serves the per-project subscribe widget as JavaScript.
// The client embeds ONE script tag:  <script src="https://APP/embed/PROJECT_ID.js" async></script>
// The public VAPID key is baked in; nothing secret is exposed.
//
// window.sendera.{subscribe,identify,event,isSubscribed,isAuthenticated}
// plus automatic, non-optional plumbing (отскок привязки устройства,
// атрибуция кликов) — and the floating subscribe BUTTON + slide-in PROMPT
// (см. lib/widget-scripts.ts), которые сервер добавляет к этому же ответу,
// только если включены в «Виджеты» (иначе ни байта их кода в выдаче).
// The native-login-button visibility control remains a separate, optional
// script — see /embed/[projectId]/auth-button.js.
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId: raw } = await ctx.params;
  const projectId = raw.replace(/\.js$/, "");

  const admin = createAdminClient();
  // Основной запрос — только "старые" колонки. Виджет обязан отдаваться живым
  // сайтам вне зависимости от того, накатана ли миграция 0009 с атрибуцией.
  const { data: project } = await admin
    .from("projects")
    .select("id, vapid_public_key, is_active")
    .eq("id", projectId)
    .maybeSingle();

  const api = process.env.NEXT_PUBLIC_APP_URL || "";

  if (!project?.vapid_public_key) {
    return new Response(`console.error("[sendera] проект не найден: ${projectId}");`, {
      status: 404,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

  // best-effort: атрибуция — отдельный запрос, не роняет основной виджет,
  // если миграция 0009 ещё не применена. Всегда включена (см.
  // lib/attribution.ts — нет отдельного флага "включено"), кука ставится по
  // клику на ЛЮБОЙ канал рассылки (см. pss_c/pss_r в attributionSnippet
  // ниже — не только push), нет заказов с этой кукой — просто нули в отчёте.
  let attribution: { cookieName: string; windowDays: number } | null = null;
  const { data: attrRow, error: attrErr } = await admin
    .from("projects")
    .select("attribution_cookie_name, attribution_window_days")
    .eq("id", projectId)
    .maybeSingle();
  if (!attrErr && attrRow) {
    attribution = { cookieName: attrRow.attribution_cookie_name || "pss_attr", windowDays: attrRow.attribution_window_days || 7 };
  }

  // best-effort: номер счётчика Метрики (см. «Настройки») — отдельный
  // запрос по той же причине, что и атрибуция выше.
  let ymCounterId: string | null = null;
  const { data: ymRow, error: ymErr } = await admin.from("projects").select("ym_counter_id").eq("id", projectId).maybeSingle();
  if (!ymErr && ymRow?.ym_counter_id) ymCounterId = ymRow.ym_counter_id;

  // best-effort: настройки кнопки/плашки подписки (см. «Виджеты») — тем же
  // паттерном, что атрибуция/Метрика выше. Резолверы сами подставляют
  // дефолты на кривые/отсутствующие данные.
  const { data: widgetRow, error: widgetErr } = await admin.from("projects").select("widget_config").eq("id", projectId).maybeSingle();
  const widgetConfig = (!widgetErr && (widgetRow?.widget_config as { button?: unknown; prompt?: unknown } | null)) || {};
  const button = resolveButtonConfig(widgetConfig.button);
  const prompt = resolvePromptConfig(widgetConfig.prompt);

  const js = widget(project.id, project.vapid_public_key, api, attribution, ymCounterId, button, prompt, project.is_active !== false);
  return new Response(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function widget(
  projectId: string,
  publicKey: string,
  api: string,
  attribution: { cookieName: string; windowDays: number } | null,
  ymCounterId: string | null,
  button: ButtonConfig,
  prompt: PromptConfig,
  isActive: boolean
) {
  return `(function(){
  var PROJECT_ID = ${JSON.stringify(projectId)};
  var PUBLIC_KEY = ${JSON.stringify(publicKey)};
  var API = ${JSON.stringify(api)};
  var YM_COUNTER_ID = ${JSON.stringify(ymCounterId)};
  // Заблокированный проект (не оплачен/превышен лимит подписчиков, см.
  // «Биллинг») — точка входа виджета не должна работать так же, как и
  // точка отправки: sendera.subscribe() отказывает молча, кнопка/плашка
  // подписки вообще не добавляются в разметку (см. конец файла).
  var BLOCKED = ${isActive ? "false" : "true"};

  // ClientID Яндекс.Метрики этого посетителя — читаем через официальный
  // ym(counterId,'getClientID',cb), а не куку _ym_uid напрямую: та не
  // привязана к конкретному счётчику, если их на странице несколько. Если
  // счётчик не настроен в «Настройки» или ym ещё не готов (стаб от
  // сниппета Метрики появляется синхронно, но реальный клиент может не
  // ответить) — резолвим null за 1.5с, чтобы не подвешивать subscribe().
  function getYmClientId(){
    if(!YM_COUNTER_ID || typeof window.ym !== "function") return Promise.resolve(null);
    return new Promise(function(resolve){
      var done = false;
      var timer = setTimeout(function(){ if(!done){ done = true; resolve(null); } }, 1500);
      try {
        window.ym(YM_COUNTER_ID, "getClientID", function(clientId){
          if(done) return;
          done = true; clearTimeout(timer);
          resolve(clientId || null);
        });
      } catch(e){
        if(!done){ done = true; clearTimeout(timer); resolve(null); }
      }
    });
  }

  // Клик-трекинг + атрибуция заказов к рассылкам (last-click): ссылки в
  // push/SMS/email помечаются ?pss_c=<campaignId> (push — сервис-воркером,
  // SMS/email — при отправке, см. lib/sender.ts injectClickTracking). Здесь
  // всегда шлём клик в тот же campaigns.clicked_count, что уже используется
  // в CTR/аналитике; если атрибуция включена — вдобавок ставим куку
  // first-party, магазин передаёт её в вебхуке заказа, и мы свяжем заказ с кампанией.
  ${attributionSnippet(attribution)}

  function urlB64ToUint8Array(b64){
    var pad = "=".repeat((4 - b64.length % 4) % 4);
    var base64 = (b64 + pad).replace(/-/g,"+").replace(/_/g,"/");
    var raw = atob(base64); var out = new Uint8Array(raw.length);
    for (var i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i);
    return out;
  }

  function supported(){ return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }

  var DT_KEY = "pss_dt_" + PROJECT_ID;
  function deviceToken(){ try { return localStorage.getItem(DT_KEY); } catch(e){ return null; } }

  // sendera.subscribe() — запрашивает разрешение на push и подписывает это
  // устройство. Ничего не знает о кнопке/разметке — визуальный отклик после
  // подписки (если он нужен) обязанность вызывающего кода, см. widgets.js.
  async function subscribe(){
    if(BLOCKED){ console.error("[sendera] проект заблокирован (биллинг) — подписка недоступна"); return; }
    if(!supported()){ alert("Ваш браузер не поддерживает push. На iPhone: добавьте сайт на экран «Домой» и откройте оттуда."); return; }
    var reg = await navigator.serviceWorker.register("/service-worker.js");
    await navigator.serviceWorker.ready;
    var perm = await Notification.requestPermission();
    if(perm !== "granted") return;
    var sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: urlB64ToUint8Array(PUBLIC_KEY) });
    var ymClientId = await getYmClientId();
    var timezone = null;
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch(e){}
    var res = await fetch(API + "/api/public/subscribe", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ projectId: PROJECT_ID, subscription: sub.toJSON(), userAgent: navigator.userAgent, deviceToken: deviceToken(), ymClientId: ymClientId, timezone: timezone })
    });
    try {
      var data = await res.json();
      if(data && data.deviceToken) localStorage.setItem(DT_KEY, data.deviceToken);
    } catch(e){}
  }

  // Отскок привязки телефона: страница входа SENDERA вернула браузер на
  // домен магазина с ?pss_link=<одноразовый тикет>. Предъявляем НАШ
  // device_token (только из localStorage, никогда из URL) и продолжаем вход.
  (function handleLink(){
    var ticket;
    try { ticket = new URL(location.href).searchParams.get("pss_link"); } catch(e){ return; }
    if(!ticket) return;
    fetch(API + "/api/public/link", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ projectId: PROJECT_ID, ticket: ticket, deviceToken: deviceToken() })
    }).then(function(r){ return r.json(); }).then(function(d){
      if(d && d.continue){ location.replace(d.continue); return; }
      var u = new URL(location.href); u.searchParams.delete("pss_link");
      history.replaceState(null, "", u.toString());
    }).catch(function(){
      var u = new URL(location.href); u.searchParams.delete("pss_link");
      history.replaceState(null, "", u.toString());
    });
  })();

  // Возврат со страницы кода SENDERA: ?pss_auth_failed=1 — авторизация не
  // состоялась по тех. причине на нашей стороне (см. otp-status/route.ts),
  // не обычный отскок. Ничего не переподписываем и не трогаем deviceToken —
  // только убираем маркер из адресной строки, чтобы страница логина
  // магазина показалась пользователю чистой для повторной попытки.
  (function handleAuthFailed(){
    var url;
    try { url = new URL(location.href); } catch(e){ return; }
    if(url.searchParams.get("pss_auth_failed") !== "1") return;
    console.warn("[sendera] авторизация не удалась по технической причине, попробуйте другой способ входа");
    url.searchParams.delete("pss_auth_failed");
    history.replaceState(null, "", url.toString());
  })();

  // Тихое узнавание устройства заранее, ДО клика "Войти" — если браузер уже
  // подписан, сообщаем это /api/public/recognize на каждой загрузке страницы.
  // В ответ на НАШЕМ домене выставляется подписанная кука; когда покупатель
  // потом реально нажмёт "Войти", страница входа увидит эту куку сразу и
  // сможет узнать устройство без отскока сюда за device_token (см.
  // /oidc/{projectId}/auth). Современные браузеры (особенно Safari) могут
  // заблокировать cross-site куку — тогда просто не сработает, вход поедет
  // по старому, более медленному пути отскока; ничего не ломается.
  (function recognizeDevice(){
    var dt = deviceToken();
    if(!dt) return;
    fetch(API + "/api/public/recognize", {
      method:"POST", credentials:"include", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ projectId: PROJECT_ID, deviceToken: dt })
    }).catch(function(){});
  })();

  // Устройство БЕЗ push тоже должно уметь трекаться/обогащаться (событие,
  // identify) — не только push-подписанные. deviceToken() — единственный
  // независимый от push идентификатор браузера; если его ещё нет (ни разу
  // не подписывались на push), заводим "анонимную" строку subscribers через
  // /api/public/register-device (см. migration 0071) — один раз, дальше он
  // просто лежит в localStorage. Если позже человек всё же подпишется на
  // push, /api/public/subscribe узнает эту же строку по device_token и
  // просто дозаполнит её реальной подпиской, а не заведёт вторую.
  var deviceTokenPromise = null;
  function ensureDeviceToken(){
    var dt = deviceToken();
    if(dt) return Promise.resolve(dt);
    if(BLOCKED) return Promise.resolve(null);
    if(deviceTokenPromise) return deviceTokenPromise;
    var timezone = null;
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch(e){}
    deviceTokenPromise = fetch(API + "/api/public/register-device", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ projectId: PROJECT_ID, userAgent: navigator.userAgent, timezone: timezone })
    }).then(function(r){ return r.json(); }).then(function(d){
      if(d && d.deviceToken){ try { localStorage.setItem(DT_KEY, d.deviceToken); } catch(e){} return d.deviceToken; }
      return null;
    }).catch(function(){ return null; });
    return deviceTokenPromise;
  }
  ensureDeviceToken();

  // Текущая push-подписка ЭТОГО браузера, если она есть и браузер вообще
  // поддерживает push API — иначе null (никогда не бросает).
  function currentPushSub(){
    // getRegistration(), не .ready — та зависает НАВСЕГДА (никогда не
    // резолвится и не реджектится), если сервис-воркер на этом источнике
    // ни разу не регистрировался (subscribe() ещё не вызывали) — а именно
    // так выглядит любое устройство, ещё не подписавшееся на push. .ready
    // ждёт, пока КАКОЙ-ТО воркер станет активным, а не проверяет текущее
    // состояние — из-за этого track()/event() молча не отправлялись вообще
    // ни для одного анонимного (без push) устройства. getRegistration, как
    // и в isSubscribed() ниже, резолвится сразу — undefined, если регистрации нет.
    if(!supported() || !navigator.serviceWorker.getRegistration) return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration("/service-worker.js")
      .then(function(reg){ return reg ? reg.pushManager.getSubscription() : null; })
      .catch(function(){ return null; });
  }

  // sendera.event(name, payload) — по push-подписке, если она есть, иначе по
  // device_token: устройство без push тоже трекается (см. ensureDeviceToken
  // выше и migration 0071), просто персонализация дальше уйдёт по
  // email/SMS, а не push.
  function track(name, payload){
    if(!name) return;
    function sendWith(body){
      var json = JSON.stringify(body);
      var url = API + "/api/public/event";
      // fetch+keepalive — основной способ: sendBeacon с JSON-телом кросс-доменно
      // не долетает (отдаёт true, но запрос не уходит) в некоторых окружениях,
      // хотя переживает уход со страницы так же надёжно, как sendBeacon.
      try {
        fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body: json, keepalive: true })
          .catch(function(){ try { navigator.sendBeacon(url, new Blob([json], { type: "application/json" })); } catch(e){} });
      } catch(e){
        try { navigator.sendBeacon(url, new Blob([json], { type: "application/json" })); } catch(e2){}
      }
    }
    currentPushSub().then(function(sub){
      if(sub){ sendWith({ projectId: PROJECT_ID, endpoint: sub.endpoint, name: name, payload: payload || {} }); return; }
      ensureDeviceToken().then(function(dt){
        if(!dt) return;
        sendWith({ projectId: PROJECT_ID, deviceToken: dt, name: name, payload: payload || {} });
      });
    });
  }

  // sendera.identify({phone, email, name, insales_client_id}) — вызывается
  // ТЕМОЙ магазина вручную (например, на странице, где покупатель уже
  // авторизован — после ajaxAPI.shop.client.get()). НЕ требует push —
  // работает и по push-подписке (если есть), и по device_token (см. выше).
  // НЕ создаёт новую связку ключ↔устройство — это только обогащение: name и
  // insales_client_id применятся, только если это устройство уже честно
  // привязано к присланному phone ИЛИ к присланному email через код
  // (независимо друг от друга — см. /api/public/identify).
  function identify(data){
    if(!data) return Promise.reject(new Error("no data"));
    function sendWith(idBody){
      return fetch(API + "/api/public/identify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({
          projectId: PROJECT_ID,
          phone: data.phone, email: data.email, name: data.name,
          insales_client_id: data.insales_client_id || data.insalesClientId
        }, idBody))
      }).then(function(r){ return r.json(); });
    }
    return currentPushSub().then(function(sub){
      if(sub) return sendWith({ endpoint: sub.endpoint });
      return ensureDeviceToken().then(function(dt){
        if(!dt) return Promise.reject(new Error("no device"));
        return sendWith({ deviceToken: dt });
      });
    });
  }

  // sendera.isSubscribed() — есть ли у ЭТОГО браузера активная push-подписка.
  // Проверка целиком клиентская (сам браузер — источник истины), сети не требует.
  function isSubscribed(){
    if(!supported() || !navigator.serviceWorker.getRegistration) return Promise.resolve(false);
    return navigator.serviceWorker.getRegistration("/service-worker.js")
      .then(function(reg){ return reg ? reg.pushManager.getSubscription() : null; })
      .then(function(sub){ return !!sub; })
      .catch(function(){ return false; });
  }

  // sendera.isAuthenticated() — привязано ли ЭТО устройство к телефону
  // и/или к email, независимо подтверждённым реальным кодом (через
  // /oidc/*/auth). { authenticated, phone, email } — без самих значений,
  // только факт привязки; phone и email могут быть true одновременно,
  // по отдельности или оба false.
  function isAuthenticated(){
    if(!supported() || !navigator.serviceWorker.getRegistration) return Promise.resolve({ authenticated:false, phone:false, email:false });
    return navigator.serviceWorker.getRegistration("/service-worker.js")
      .then(function(reg){ return reg ? reg.pushManager.getSubscription() : null; })
      .then(function(sub){
        if(!sub) return { authenticated:false, phone:false, email:false };
        return fetch(API + "/api/public/status", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ projectId: PROJECT_ID, endpoint: sub.endpoint })
        }).then(function(r){ return r.json(); });
      })
      .catch(function(){ return { authenticated:false, phone:false, email:false }; });
  }

  window.sendera = {
    subscribe: subscribe, event: track, identify: identify,
    isSubscribed: isSubscribed, isAuthenticated: isAuthenticated
  };
})();
${isActive && button.enabled ? buttonBlock(projectId, button) : ""}
${isActive && prompt.enabled ? promptBlock(projectId, prompt) : ""}`;
}

function attributionSnippet(cfg: { cookieName: string; windowDays: number } | null) {
  return `(function(){
    try {
      var url0 = new URL(location.href);
      var c = url0.searchParams.get("pss_c");
      if(!c) return;
      var r = url0.searchParams.get("pss_r"); // персональный токен sms/email-клика (миграция 0024), у push его нет
      fetch(API + "/api/public/track", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ type: "clicked", campaignId: c, token: r || undefined })
      }).catch(function(){});
      ${cfg ? `var maxAge = ${cfg.windowDays} * 86400;
      document.cookie = ${JSON.stringify(cfg.cookieName)} + "=" + c + "." + Date.now() + "; path=/; max-age=" + maxAge + "; SameSite=Lax";` : ""}
      var u = new URL(location.href); u.searchParams.delete("pss_c"); u.searchParams.delete("pss_r");
      history.replaceState(null, "", u.toString());
    } catch(e){}
  })();`;
}
