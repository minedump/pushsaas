// Скрипт кнопки входа InSales («Войти через <приложение>», блок .co-login.co-login--social_login).
// Отдаётся по /embed/{projectId}/auth-button.js (см. app/embed/[projectId]/auth-button.js/route.ts).
//
// В магазине InSales вход через OpenID Connect выглядит как обычная ссылка:
//   <div class="co-login co-login--social_login ...">
//     <div class="co-social_login"> ... <div class="co-social_login-list_inner">
//       <a rel="nofollow" data-method="post" href="/o_auth_apps/<id>/open_id?...">Имя приложения</a>
// Что делает скрипт:
//  - вход выключен: прячет весь блок .co-login.co-login--social_login (стилем сразу, чтобы кнопка не мигала);
//  - вход включён: ссылке на /open_id добавляются стандартные классы кнопки темы магазина — .button и
//    размер .button_size-{s|m|l|xl} (по умолчанию m), и она встаёт в дизайн магазина: геометрия, скругление
//    и состояния задаются темой;
//  - цвет (необязательно): переопределяются CSS-переменные кнопок темы инлайн-стилем на самой ссылке,
//    остальная тема не затрагивается.
// Текст кнопки всегда родной: это «Имя приложения», заданное в настройках авторизации InSales.

export const AUTH_BUTTON_SIZES = ["s", "m", "l", "xl"] as const;
export type AuthButtonSize = (typeof AUTH_BUTTON_SIZES)[number];
export const AUTH_BUTTON_DEFAULT_SIZE: AuthButtonSize = "m";

export function buildAuthButtonScript(opts: { hide: boolean; color: string | null; size: AuthButtonSize | null }): string {
  return `(function(){
  var HIDE = ${opts.hide ? "true" : "false"};
  var COLOR = ${JSON.stringify(opts.color)};
  var SIZE = ${JSON.stringify(opts.size || AUTH_BUTTON_DEFAULT_SIZE)};

  // Вход выключен: прячем весь блок входа InSales стилем сразу, не дожидаясь разметки страницы
  if(HIDE){
    var st = document.createElement("style");
    st.textContent = ".co-login.co-login--social_login{display:none!important}";
    (document.head || document.documentElement).appendChild(st);
    return;
  }

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
