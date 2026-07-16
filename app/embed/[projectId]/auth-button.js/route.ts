import { createAdminClient } from "@/lib/supabase/admin";

// Управление НАТИВНОЙ кнопкой входа InSales («Войти через <приложение>»,
// блок .co-login--social_login) — отдельный, опциональный скрипт.
// Поддерживает: скрыть; либо — текст, иконка, цвет, размер, скругление.
//
// Кастомизация построена на встроенной сетке InSales (core-css.css, шаблоны
// 4-го поколения): добавляем ссылке класс .button — она сразу получает
// нативную геометрию (высота/паддинги/радиус/transition) из темы магазина,
// вместо того чтобы городить свою вёрстку. Размер — родные классы
// .button_size-{s,m,l,xl} и .button_border-round. Цвет — переопределяем
// CSS-переменные темы (--color-btn-bg/--color-btn-border-color) ЛОКАЛЬНО на
// самом элементе через style.setProperty, не трогая тему в целом.
const SIZES = ["s", "m", "l", "xl"] as const;
type Size = (typeof SIZES)[number];

export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId: raw } = await ctx.params;
  const projectId = raw.replace(/\.js$/, "");

  const admin = createAdminClient();
  const { data: oidc } = await admin.from("oidc_clients").select("config").eq("project_id", projectId).maybeSingle();
  const config = oidc?.config || {};

  const opts = {
    hide: !!config.hide_native_login_button,
    text: typeof config.auth_button_text === "string" && config.auth_button_text.trim() ? config.auth_button_text.trim() : null,
    icon: typeof config.auth_button_icon === "string" && config.auth_button_icon.trim() ? config.auth_button_icon.trim() : null,
    color: typeof config.auth_button_color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(config.auth_button_color.trim()) ? config.auth_button_color.trim() : null,
    size: SIZES.includes(config.auth_button_size) ? (config.auth_button_size as Size) : null,
    rounded: !!config.auth_button_rounded,
  };

  return new Response(script(opts), {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

function script(opts: { hide: boolean; text: string | null; icon: string | null; color: string | null; size: string | null; rounded: boolean }) {
  const hasCustomization = !!(opts.text || opts.icon || opts.color || opts.size || opts.rounded);
  return `(function(){
  var HIDE = ${opts.hide ? "true" : "false"};
  var TEXT = ${JSON.stringify(opts.text)};
  var ICON = ${JSON.stringify(opts.icon)};
  var COLOR = ${JSON.stringify(opts.color)};
  var SIZE = ${JSON.stringify(opts.size)};
  var ROUNDED = ${opts.rounded ? "true" : "false"};

  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function(){
    var loginBlock = document.querySelector(".co-login--social_login");
    if(!loginBlock) return;
    // прячем/красим только OIDC-ссылки (a[href*=/open_id]) — рядом могут
    // быть чужие кнопки (VK ID и т.п.), их трогать нельзя
    var links = loginBlock.querySelectorAll('a[href*="/open_id"]');
    links.forEach(function(a){
      if(HIDE){ a.style.display = "none"; return; }
      ${
        hasCustomization
          ? `a.classList.add("button");
      if(SIZE) a.classList.add("button_size-" + SIZE);
      if(ROUNDED) a.classList.add("button_border-round");
      if(COLOR){ a.style.setProperty("--color-btn-bg", COLOR); a.style.setProperty("--color-btn-border-color", COLOR); a.style.setProperty("--color-btn-bg-hover", COLOR); }
      if(TEXT || ICON){
        var span = document.createElement("span");
        span.textContent = TEXT != null ? TEXT : a.textContent;
        a.innerHTML = "";
        if(ICON) a.insertAdjacentHTML("afterbegin", ICON);
        a.appendChild(span);
      }`
          : ""
      }
    });
  });
})();`;
}
