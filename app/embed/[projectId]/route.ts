import { createAdminClient } from "@/lib/supabase/admin";

// Serves the per-project subscribe widget as JavaScript.
// The client embeds:  <script src="https://APP/embed/PROJECT_ID.js" async></script>
// The public VAPID key is baked in; nothing secret is exposed.
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
    var btn = document.getElementById("pushsaas-btn");
    if(btn){ btn.innerHTML = CHECK + '<span>Вы подписаны</span>'; btn.disabled = true; }

    // Покупатель уже авторизован в InSales — привязываем телефон/почту сразу,
    // без отдельного клика. Молча ничего не делает, если проект не включил
    // доверие к сессии магазина (сервер ответит verification_required).
    getInsalesClient().then(function(client){
      if(client) return identify({ phone: client.phone, email: client.email, name: client.name });
    }).catch(function(){});
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

  var BELL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"></path><path d="M9 17v1a3 3 0 0 0 6 0v-1"></path></svg>';
  var CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5l10 -10"></path></svg>';

  // Event tracker: pushsaas('event','cart_updated',{...}). Attaches the current
  // device via its push subscription endpoint; only tracks opted-in devices.
  function track(type, name, payload){
    if(type !== "event" || !name || !supported()) return;
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

  // identify: PushSaaS.identify({phone, email, name}) — вызывается ТЕМОЙ
  // магазина на странице, где покупатель уже авторизован (после
  // ajaxAPI.shop.client.get()). Требует активной push-подписки этого браузера.
  // Работает только если владелец проекта явно включил доверие к сессии
  // магазина (иначе сервер ответит ошибкой verification_required).
  function identify(data){
    if(!supported() || !data || !data.phone) return Promise.reject(new Error("no phone"));
    return navigator.serviceWorker.ready
      .then(function(r){ return r.pushManager.getSubscription(); })
      .then(function(sub){
        if(!sub) return Promise.reject(new Error("not subscribed — call PushSaaS.subscribe() first"));
        return fetch(API + "/api/public/identify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: PROJECT_ID, endpoint: sub.endpoint, phone: data.phone, email: data.email, name: data.name })
        }).then(function(r){ return r.json(); });
      });
  }

  // Авто-детект InSales: ajaxAPI грузится самим InSales на каждой странице
  // магазина (common.v2.js), никакой интеграции со стороны темы не нужно.
  // Если покупатель авторизован — забираем его телефон/почту сами.
  function getInsalesClient(){
    try {
      if(!window.ajaxAPI || !window.ajaxAPI.shop || !window.ajaxAPI.shop.client || typeof window.ajaxAPI.shop.client.get !== "function") {
        return Promise.resolve(null);
      }
      return new Promise(function(resolve){
        window.ajaxAPI.shop.client.get()
          .done(function(d){ resolve((d && d.authorized && d.phone) ? d : null); })
          .fail(function(){ resolve(null); });
      });
    } catch(e){ return Promise.resolve(null); }
  }

  window.pushsaas = track;
  window.PushSaaS = { subscribe: subscribe, event: function(name, payload){ track("event", name, payload); }, identify: identify };

  // Auto-inject a floating button unless the host opts out with data-pushsaas="manual".
  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function(){
    var current = document.currentScript;
    var manual = document.querySelector('[data-pushsaas="manual"]');
    if(manual) return;
    if(!supported()) return;
    var btn = document.createElement("button");
    btn.id = "pushsaas-btn";
    btn.innerHTML = BELL + '<span>Уведомления</span>';
    btn.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:99999;display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border:none;border-radius:24px;background:#2c4a66;color:#fff;font:600 14px/1 -apple-system,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.2);cursor:pointer";
    btn.addEventListener("click", subscribe);
    document.body.appendChild(btn);
  });

  // Возврат авторизованного покупателя, который уже подписан на этом
  // устройстве: тихо освежаем телефон/почту, без нового запроса разрешения
  // (Notification.requestPermission можно вызвать только по клику, а тут его
  // и не требуется — подписка уже есть).
  ready(function(){
    if(!supported()) return;
    navigator.serviceWorker.getRegistration()
      .then(function(reg){ return reg && reg.pushManager.getSubscription(); })
      .then(function(sub){ return sub && getInsalesClient(); })
      .then(function(client){
        if(client) return identify({ phone: client.phone, email: client.email, name: client.name });
      })
      .catch(function(){});
  });

  // Прячем нативную кнопку InSales «Войти через <наше приложение>», если её
  // сейчас лучше не показывать (см. /api/public/login-visibility): при
  // выключенном тумбле подтверждения — только если у этого устройства нет
  // связки с телефоном (иначе вход мгновенно и без объяснений откажет).
  // При включённом тумбле — не трогаем, всегда показана (вход сработает
  // через email/Telegram/SMS даже без готовой связки).
  // Прячем ТОЛЬКО OIDC-ссылки (a[href*=/open_id]), а не весь блок — рядом
  // могут быть чужие кнопки (VK ID и т.п.), их трогать нельзя.
  // Fail-safe: любая ошибка — оставляем кнопки как есть, не прячем.
  ready(function(){
    var loginBlock = document.querySelector(".co-login--social_login");
    if(!loginBlock) return;
    var oidcLinks = loginBlock.querySelectorAll('a[href*="/open_id"]');
    if(!oidcLinks.length) return;
    function currentEndpoint(){
      if(!("serviceWorker" in navigator)) return Promise.resolve(null);
      return navigator.serviceWorker.getRegistration()
        .then(function(reg){ return reg && reg.pushManager.getSubscription(); })
        .then(function(sub){ return sub ? sub.endpoint : null; })
        .catch(function(){ return null; });
    }
    currentEndpoint()
      .then(function(ep){
        return fetch(API + "/api/public/login-visibility", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: PROJECT_ID, endpoint: ep })
        }).then(function(r){ return r.json(); });
      })
      .then(function(d){
        if(d && d.show === false){
          oidcLinks.forEach(function(a){ a.style.display = "none"; });
        }
      })
      .catch(function(){});
  });
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
