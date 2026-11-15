// Кнопка входа InSales («Войти через <приложение>», блок .co-login.co-login--social_login).
// Код встроен в основной скрипт сайта /embed/{projectId}.js (app/embed/[projectId]/route.ts) по принципу виджетов:
// отдельного подключения не нужно.
//
// В магазине InSales вход через OpenID Connect выглядит как обычная ссылка:
//   <div class="co-login co-login--social_login ...">
//     <div class="co-social_login"> ... <div class="co-social_login-list_inner">
//       <a rel="nofollow" data-method="post" href="/o_auth_apps/<id>/open_id?...">Имя приложения</a>
// Что делает код:
//  - вход выключен: добавляется только короткий стиль, прячущий весь блок .co-login.co-login--social_login (сразу, чтобы
//    кнопка не мигала); никакого остального кода кнопки в скрипт не попадает;
//  - вход включён: ссылке на /open_id добавляются стандартные классы кнопки темы магазина — .button и размер
//    .button_size-{s|m|l|xl} (по умолчанию m), и она встаёт в дизайн магазина: геометрия, скругление и состояния задаются
//    темой; цвет (необязательно) переопределяет CSS-переменные кнопок темы инлайн-стилем на самой ссылке.
// Текст кнопки всегда родной: это «Имя приложения», заданное в настройках авторизации InSales.
//
// Обогащение профиля (вход включён): после входа через нашу форму магазин возвращает покупателя на
// /client_account/session/new?from_oauth=true и тут же перекидывает дальше. Код ничего не требует от шаблона:
//  - на странице возврата (в адресе from_oauth=true) запоминает это в sessionStorage и сразу пробует отправить данные;
//  - на следующей странице (предыдущая — страница с from_oauth=true, либо переход пришёл с нашей страницы входа:
//    после цепочки редиректов браузер оставляет в referrer только адрес сайта-источника, то есть наш, либо метка в
//    sessionStorage свежее 10 минут)
//    один раз запрашивает объект клиента у магазина (ajaxAPI.shop.client.get) и вызывает identify: имя, фамилия,
//    отчество, телефон, почта и id клиента попадают в контакт. Выключен вход — этого кода в скрипте нет.

export const AUTH_BUTTON_SIZES = ["s", "m", "l", "xl"] as const;
export type AuthButtonSize = (typeof AUTH_BUTTON_SIZES)[number];
export const AUTH_BUTTON_DEFAULT_SIZE: AuthButtonSize = "m";

// Блок стоит ПОСЛЕ основного скрипта (вне его области видимости), поэтому берёт идентификатор проекта параметром,
// а identify() — из window.sendera.
function authEnrichBlock(projectId: string, appOrigin: string): string {
  return `(function(){
  var RETURN = /[?&]from_oauth=true(?:[&#]|$)/;
  var KEY = "pss_oauth_" + ${JSON.stringify(projectId)};
  var APP = ${JSON.stringify(appOrigin)};
  var ss = null;
  try { ss = window.sessionStorage; } catch(e){}
  var landing = RETURN.test(location.search);
  var run = false;
  if(landing){
    run = true;
    if(ss){ try { ss.setItem(KEY, String(Date.now())); } catch(e){} }
  } else {
    var pending = false;
    if(ss){ try { var t = parseInt(ss.getItem(KEY) || "0", 10); pending = !!t && Date.now() - t < 600000; } catch(e){} }
    var ref = document.referrer || "";
    if(RETURN.test(ref) || (APP && ref.indexOf(APP) === 0) || pending){
      run = true;
      if(ss){ try { ss.removeItem(KEY); } catch(e){} }
    }
  }
  if(!run) return;
  var tries = 25;
  (function wait(){
    if(window.ajaxAPI && ajaxAPI.shop && ajaxAPI.shop.client){
      try {
        ajaxAPI.shop.client.get().done(function(c){
          if(!c) return;
          if(!window.sendera || !window.sendera.identify) return;
          window.sendera.identify({ phone: c.phone, email: c.email, name: c.name, surname: c.surname, middlename: c.middlename, insales_client_id: c.id }).catch(function(){});
        });
      } catch(e){}
    } else if(tries-- > 0){
      setTimeout(wait, 200);
    }
  })();
})();`;
}

export function authButtonBlock(opts: { enabled: boolean; color: string | null; size: AuthButtonSize | null; projectId: string; appOrigin: string }): string {
  if (!opts.enabled) {
    return `(function(){
  var st = document.createElement("style");
  st.textContent = ".co-login.co-login--social_login{display:none!important}";
  (document.head || document.documentElement).appendChild(st);
})();`;
  }
  return `${authEnrichBlock(opts.projectId, opts.appOrigin)}
(function(){
  var COLOR = ${JSON.stringify(opts.color)};
  var SIZE = ${JSON.stringify(opts.size || AUTH_BUTTON_DEFAULT_SIZE)};
  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function(){
    var loginBlock = document.querySelector(".co-login.co-login--social_login");
    if(!loginBlock) return;
    // красим только нашу ссылку (a[href*=/open_id]): рядом могут быть чужие способы входа (VK ID и т.п.)
    var links = loginBlock.querySelectorAll('a[href*="/open_id"]');
    links.forEach(function(a){
      a.classList.add("button");
      a.classList.add("button_size-" + SIZE);
      if(COLOR){
        a.style.setProperty("--color-btn-bg", COLOR);
        a.style.setProperty("--color-btn-border-color", COLOR);
        a.style.setProperty("--color-btn-bg-hover", COLOR);
      }
    });
  });
})();`;
}

// Настройки кнопки из oidc_clients (вход включён + config) -> код для вставки
export function authButtonBlockFromConfig(isEnabled: boolean, config: Record<string, unknown> | null | undefined, projectId: string, appOrigin: string): string {
  const c = config || {};
  const color = typeof c.auth_button_color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c.auth_button_color.trim()) ? c.auth_button_color.trim() : null;
  const size = (AUTH_BUTTON_SIZES as readonly unknown[]).includes(c.auth_button_size) ? (c.auth_button_size as AuthButtonSize) : null;
  return authButtonBlock({ enabled: isEnabled, color, size, projectId, appOrigin });
}
