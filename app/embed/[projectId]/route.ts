import { createAdminClient } from "@/lib/supabase/admin";

// Serves the per-project subscribe widget as JavaScript.
// The client embeds:  <script src="https://APP/embed/PROJECT_ID.js" async></script>
// The public VAPID key is baked in; nothing secret is exposed.
//
// This is the CORE script — window.PushSaaS.{subscribe,identify,event,
// isSubscribed,isAuthenticated} plus automatic, non-optional plumbing
// (отскок привязки устройства, атрибуция кликов). The floating subscribe
// BUTTON, the slide-in PROMPT, and the native-login-button visibility
// control are separate, optional scripts — see /embed/[projectId]/widgets.js
// and /embed/[projectId]/auth-button.js.
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId: raw } = await ctx.params;
  const projectId = raw.replace(/\.js$/, "");

  const admin = createAdminClient();
  // Основной запрос — только "старые" колонки. Виджет обязан отдаваться живым
  // сайтам вне зависимости от того, накатана ли миграция 0009 с атрибуцией.
  const { data: project } = await admin
    .from("projects")
    .select("id, vapid_public_key")
    .eq("id", projectId)
    .maybeSingle();

  const api = process.env.NEXT_PUBLIC_APP_URL || "";

  if (!project?.vapid_public_key) {
    return new Response(`console.error("[PushSaaS] проект не найден: ${projectId}");`, {
      status: 404,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

  // best-effort: атрибуция — отдельный запрос, не роняет основной виджет,
  // если миграция 0009 ещё не применена.
  let attribution: { cookieName: string; windowDays: number } | null = null;
  const { data: attrRow, error: attrErr } = await admin
    .from("projects")
    .select("attribution_enabled, attribution_cookie_name, attribution_window_days")
    .eq("id", projectId)
    .maybeSingle();
  if (!attrErr && attrRow?.attribution_enabled) {
    attribution = { cookieName: attrRow.attribution_cookie_name || "pss_attr", windowDays: attrRow.attribution_window_days || 7 };
  }

  const js = widget(project.id, project.vapid_public_key, api, attribution);
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
  attribution: { cookieName: string; windowDays: number } | null
) {
  return `(function(){
  var PROJECT_ID = ${JSON.stringify(projectId)};
  var PUBLIC_KEY = ${JSON.stringify(publicKey)};
  var API = ${JSON.stringify(api)};

  // Атрибуция заказов к пушам (last-click): сервис-воркер помечает открытую по
  // клику ссылку ?pss_c=<campaignId>, здесь превращаем это в куку first-party —
  // магазин может передать её значение в вебхуке заказа, и мы свяжем заказ с кампанией.
  ${attribution ? attributionSnippet(attribution) : ""}

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

  // PushSaaS.subscribe() — запрашивает разрешение на push и подписывает это
  // устройство. Ничего не знает о кнопке/разметке — визуальный отклик после
  // подписки (если он нужен) обязанность вызывающего кода, см. widgets.js.
  async function subscribe(){
    if(!supported()){ alert("Ваш браузер не поддерживает push. На iPhone: добавьте сайт на экран «Домой» и откройте оттуда."); return; }
    var reg = await navigator.serviceWorker.register("/service-worker.js");
    await navigator.serviceWorker.ready;
    var perm = await Notification.requestPermission();
    if(perm !== "granted") return;
    var sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: urlB64ToUint8Array(PUBLIC_KEY) });
    var res = await fetch(API + "/api/public/subscribe", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ projectId: PROJECT_ID, subscription: sub.toJSON(), userAgent: navigator.userAgent, deviceToken: deviceToken() })
    });
    try {
      var data = await res.json();
      if(data && data.deviceToken) localStorage.setItem(DT_KEY, data.deviceToken);
    } catch(e){}
  }

  // Отскок привязки телефона: страница входа PushSaaS вернула браузер на
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

  // PushSaaS.event(name, payload). Attaches the current device via its push
  // subscription endpoint; only tracks opted-in devices.
  function track(name, payload){
    if(!name || !supported()) return;
    navigator.serviceWorker.ready
      .then(function(r){ return r.pushManager.getSubscription(); })
      .then(function(sub){
        if(!sub) return;
        var body = JSON.stringify({ projectId: PROJECT_ID, endpoint: sub.endpoint, name: name, payload: payload || {} });
        try { navigator.sendBeacon(API + "/api/public/event", new Blob([body], { type: "application/json" })); }
        catch(e){ fetch(API + "/api/public/event", { method:"POST", headers:{"Content-Type":"application/json"}, body: body, keepalive: true }); }
      })
      .catch(function(){});
  }

  // PushSaaS.identify({phone, email, name, insales_client_id}) — вызывается
  // ТЕМОЙ магазина вручную (например, на странице, где покупатель уже
  // авторизован — после ajaxAPI.shop.client.get()). Требует активной
  // push-подписки этого браузера. НЕ создаёт новую связку ключ↔устройство —
  // это только обогащение: name и insales_client_id применятся, только если
  // это устройство уже честно привязано к присланному phone ИЛИ к
  // присланному email через код (независимо друг от друга — см.
  // /api/public/identify).
  function identify(data){
    if(!supported() || !data) return Promise.reject(new Error("no data"));
    return navigator.serviceWorker.ready
      .then(function(r){ return r.pushManager.getSubscription(); })
      .then(function(sub){
        if(!sub) return Promise.reject(new Error("not subscribed — call PushSaaS.subscribe() first"));
        return fetch(API + "/api/public/identify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: PROJECT_ID, endpoint: sub.endpoint,
            phone: data.phone, email: data.email, name: data.name,
            insales_client_id: data.insales_client_id || data.insalesClientId
          })
        }).then(function(r){ return r.json(); });
      });
  }

  // PushSaaS.isSubscribed() — есть ли у ЭТОГО браузера активная push-подписка.
  // Проверка целиком клиентская (сам браузер — источник истины), сети не требует.
  function isSubscribed(){
    if(!supported() || !navigator.serviceWorker.getRegistration) return Promise.resolve(false);
    return navigator.serviceWorker.getRegistration("/service-worker.js")
      .then(function(reg){ return reg ? reg.pushManager.getSubscription() : null; })
      .then(function(sub){ return !!sub; })
      .catch(function(){ return false; });
  }

  // PushSaaS.isAuthenticated() — привязано ли ЭТО устройство к телефону
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

  window.PushSaaS = {
    subscribe: subscribe, event: track, identify: identify,
    isSubscribed: isSubscribed, isAuthenticated: isAuthenticated
  };
})();`;
}

function attributionSnippet(cfg: { cookieName: string; windowDays: number }) {
  return `(function(){
    try {
      var c = new URL(location.href).searchParams.get("pss_c");
      if(!c) return;
      var maxAge = ${cfg.windowDays} * 86400;
      document.cookie = ${JSON.stringify(cfg.cookieName)} + "=" + c + "." + Date.now() + "; path=/; max-age=" + maxAge + "; SameSite=Lax";
      var u = new URL(location.href); u.searchParams.delete("pss_c");
      history.replaceState(null, "", u.toString());
    } catch(e){}
  })();`;
}
