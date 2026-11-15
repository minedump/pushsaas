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

export const AUTH_BUTTON_SIZES = ["s", "m", "l", "xl"] as const;
export type AuthButtonSize = (typeof AUTH_BUTTON_SIZES)[number];
export const AUTH_BUTTON_DEFAULT_SIZE: AuthButtonSize = "m";

export function authButtonBlock(opts: { enabled: boolean; color: string | null; size: AuthButtonSize | null }): string {
  if (!opts.enabled) {
    return `(function(){
  var st = document.createElement("style");
  st.textContent = ".co-login.co-login--social_login{display:none!important}";
  (document.head || document.documentElement).appendChild(st);
})();`;
  }
  return `(function(){
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
export function authButtonBlockFromConfig(isEnabled: boolean, config: Record<string, unknown> | null | undefined): string {
  const c = config || {};
  const color = typeof c.auth_button_color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c.auth_button_color.trim()) ? c.auth_button_color.trim() : null;
  const size = (AUTH_BUTTON_SIZES as readonly unknown[]).includes(c.auth_button_size) ? (c.auth_button_size as AuthButtonSize) : null;
  return authButtonBlock({ enabled: isEnabled, color, size });
}
