// Генераторы JS-кода двух опциональных механик подписки (плавающая кнопка,
// слайд-плашка) — раньше жили в отдельном /embed/{projectId}/widgets.js,
// теперь встраиваются прямо в основной /embed/{projectId}.js (см.
// app/embed/[projectId]/route.ts), поэтому и функции генерации, и
// переиспользуемые стилевые константы вынесены сюда одним модулем: его же
// импортирует админка (ButtonPreview.tsx/PromptPreview.tsx), чтобы
// предпросмотр не мог визуально разойтись со сгенерированным скриптом —
// один источник правды на оба потребителя (сервер и React-компонент).
//
// Стили — плоские объекты camelCase-свойство → значение (а не CSS-текст),
// чтобы их можно было напрямую передать в React `style={...}` И собрать в
// cssText() для скрипта — см. toCssText ниже.

import type { ButtonConfig, ButtonPosition, ButtonSize, CornerRadius, PromptConfig } from "./widget-config";

export type StyleMap = Record<string, string | number>;

export function toCssText(style: StyleMap): string {
  return Object.entries(style)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}:${v}`)
    .join(";");
}

// Общий z-index для обеих механик — раньше был повторяющимся литералом
// 99999 в двух местах, теперь одна именованная константа.
export const WIDGET_Z_INDEX = 999999;

export const BELL_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"></path><path d="M9 17v1a3 3 0 0 0 6 0v-1"></path></svg>';
export const CHECK_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5l10 -10"></path></svg>';
// Дробный stroke-width (было 2.67 при 12px, потом 2.29 при 14px) на глаз
// давал линию тоньше расчётной — некруглые значения толщины сглаживаются
// браузером почти до 1px. Проще и надёжнее — тот же размер и та же целая
// толщина линии, что у BELL_SVG (16px, stroke-width 2), без вычислений.
export const CLOSE_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6l-12 12"></path><path d="M6 6l12 12"></path></svg>';

export const BUTTON_POSITION_STYLE: Record<ButtonPosition, StyleMap> = {
  "bottom-right": { right: "18px", bottom: "calc(18px + env(safe-area-inset-bottom, 0px))" },
  "bottom-left": { left: "18px", bottom: "calc(18px + env(safe-area-inset-bottom, 0px))" },
  "top-right": { right: "18px", top: "calc(18px + env(safe-area-inset-top, 0px))" },
  "top-left": { left: "18px", top: "calc(18px + env(safe-area-inset-top, 0px))" },
};
export const BUTTON_SIZE_STYLE: Record<ButtonSize, StyleMap> = {
  s: { padding: "8px 14px", fontSize: "12px", gap: "6px" },
  m: { padding: "12px 18px", fontSize: "14px", gap: "8px" },
  l: { padding: "16px 24px", fontSize: "16px", gap: "10px" },
};

// Радиус — доля от реальной высоты элемента при его текущем размере, а не
// плоский px на все размеры: одинаковый px для s/m/l либо превышал половину
// высоты маленькой кнопки (и "среднее" визуально сливалось с "большим" —
// оба CSS сам обрезает до пилюли), либо был слишком тонким на большой.
// sm ≈ четверть высоты, md ≈ 40% высоты (заметно круглее sm, но ещё не
// пилюля), lg = 999px — гарантированная пилюля при любой высоте (браузер
// сам обрежет радиус до height/2), тот же приём, что у Tailwind rounded-full.
// Высота кнопки = paddingTop+paddingBottom (см. BUTTON_SIZE_STYLE) + fontSize
// (lineHeight:1 в buttonBaseStyle): s=8*2+12=28, m=12*2+14=38, l=16*2+16=48.
export const BUTTON_RADIUS_PX: Record<ButtonSize, Record<CornerRadius, string>> = {
  s: { none: "0px", sm: "7px", md: "11px", lg: "999px" },
  m: { none: "0px", sm: "10px", md: "15px", lg: "999px" },
  l: { none: "0px", sm: "12px", md: "19px", lg: "999px" },
};

// Скругление самой карточки плашки — независимый расчёт от кнопки-виджета:
// карточка прямоугольная и заметно крупнее (даже на десктопе высота ~100+px
// при радиусе максимум 14px), поэтому коллизии "среднее=большое" здесь нет,
// плоские px по уровням остаются наглядными без привязки к высоте.
export const PROMPT_RADIUS_PX: Record<CornerRadius, string> = { none: "0px", sm: "10px", md: "12px", lg: "14px" };

// Скругление кнопок «Разрешить»/«Не сейчас» внутри плашки — своя шкала под
// их собственную высоту (padding "7px 12px" + font 12.5px/1 ≈ 27px), не
// заимствованная у BUTTON_RADIUS_PX: тот же принцип "доля высоты", но
// вход/выход независимы от плавающей кнопки-виджета.
export const PROMPT_BUTTON_RADIUS_PX: Record<CornerRadius, string> = { none: "0px", sm: "7px", md: "11px", lg: "999px" };

export function buttonBaseStyle(config: Pick<ButtonConfig, "position" | "size" | "color" | "textColor" | "borderRadius">): StyleMap {
  return {
    position: "fixed",
    ...BUTTON_POSITION_STYLE[config.position],
    zIndex: WIDGET_Z_INDEX,
    display: "inline-flex",
    alignItems: "center",
    ...BUTTON_SIZE_STYLE[config.size],
    border: "none",
    borderRadius: BUTTON_RADIUS_PX[config.size][config.borderRadius],
    background: config.color,
    color: config.textColor,
    fontWeight: 600,
    fontFamily: "-apple-system,sans-serif",
    lineHeight: 1,
    boxShadow: "0 4px 14px rgba(0,0,0,.2)",
    cursor: "pointer",
  };
}

export function promptBaseStyle(config: Pick<PromptConfig, "cardBg" | "cardTextColor">): StyleMap {
  return {
    position: "fixed",
    zIndex: WIDGET_Z_INDEX,
    background: config.cardBg,
    color: config.cardTextColor,
    fontFamily: "-apple-system,'Segoe UI',sans-serif",
    boxShadow: "0 10px 34px rgba(0,0,0,.18)",
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
  };
}
export function promptMobileStyle(config: Pick<PromptConfig, "cardBg" | "cardTextColor" | "borderRadius">): StyleMap {
  const r = PROMPT_RADIUS_PX[config.borderRadius];
  return {
    ...promptBaseStyle(config),
    left: 0,
    right: 0,
    top: 0,
    paddingTop: "calc(14px + env(safe-area-inset-top, 0px))",
    paddingLeft: "16px",
    paddingRight: "16px",
    paddingBottom: "14px",
    borderRadius: `0 0 ${r} ${r}`,
  };
}
export function promptDesktopStyle(config: Pick<PromptConfig, "cardBg" | "cardTextColor" | "borderRadius">): StyleMap {
  return {
    ...promptBaseStyle(config),
    left: "16px",
    top: "calc(16px + env(safe-area-inset-top, 0px))",
    width: "300px",
    padding: "14px",
    borderRadius: PROMPT_RADIUS_PX[config.borderRadius],
  };
}

// iOS Safari не поддерживает Web Push в обычной вкладке — только для PWA,
// добавленного на экран «Домой» (iOS 16.4+). Определяем это на клиенте
// (аналог серверного detectPlatform() в app/api/public/register-device —
// отдельная копия, скрипт самодостаточный IIFE без внешних импортов).
export const IOS_STANDALONE_CHECK = `
  function isIos(){ return /iphone|ipad|ipod/i.test(navigator.userAgent || ""); }
  function isStandalone(){
    try { return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches; }
    catch(e){ return false; }
  }
  function needsHomeScreen(){ return isIos() && !isStandalone(); }
`;

// Счётчик просмотренных страниц за визит (sessionStorage — сбрасывается с
// закрытием вкладки/браузера, не копится вечно). Общий на кнопку и плашку:
// обе механики независимо оборачиваются в свой IIFE, поэтому дедуп через
// window.__pssPvCounted — какая бы механика ни запустилась первой на этой
// странице, счётчик увеличится только один раз.
function pageViewsCheck(projectId: string): string {
  return `
  var PV_KEY = ${JSON.stringify(`pss_pv_${projectId}`)};
  function pageViews(){
    try {
      if(!window.__pssPvCounted){
        window.__pssPvCounted = true;
        var n = Number(sessionStorage.getItem(PV_KEY) || "0") + 1;
        sessionStorage.setItem(PV_KEY, String(n));
      }
      return Number(sessionStorage.getItem(PV_KEY) || "1");
    } catch(e){ return 1; }
  }
`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

// Плавающая кнопка — при клике сразу вызывает sendera.subscribe() (значит и
// системный диалог сразу, без промежуточного шага). Скрывается: если уже
// подписан (проверка при рендере, не только пост-фактум клика), если
// закрыта крестиком (пауза config.dismissDays), и на iOS вне standalone
// показывает вместо себя инструкцию «на экран Домой» вместо подписки.
export function buttonBlock(projectId: string, config: ButtonConfig): string {
  const baseCss = toCssText(buttonBaseStyle(config));
  return `(function(){
  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ${IOS_STANDALONE_CHECK}
  ${pageViewsCheck(projectId)}
  var DISMISS_KEY = ${JSON.stringify(`pss_button_dismissed_${projectId}`)};
  var DISMISS_DAYS = ${config.dismissDays};
  var DELAY_SECONDS = ${config.delaySeconds};
  var MIN_PAGE_VIEWS = ${config.minPageViews};

  ready(function(){
    if(!window.sendera){ console.error("[sendera] подключите скрипт /embed/{projectId}.js"); return; }
    var homeScreen = needsHomeScreen();
    if(!homeScreen && !("serviceWorker" in navigator && "PushManager" in window && "Notification" in window)) return;
    if(document.getElementById("sendera-btn")) return;

    function dismissed(){ try { var raw = localStorage.getItem(DISMISS_KEY); if(!raw) return false; return (Date.now() - Number(raw)) < DISMISS_DAYS * 86400000; } catch(e){ return false; } }
    if(dismissed()) return;
    if(pageViews() < MIN_PAGE_VIEWS) return;

    function render(){
      window.sendera.isSubscribed().then(function(already){
        if(already) return;
        if(document.getElementById("sendera-prompt")) return; // плашка уже занимает экран — не спорим за один и тот же момент
        if(document.getElementById("sendera-btn")) return; // могли успеть показать за время задержки (второй вызов render на другой странице SPA)

        var btn = document.createElement("button");
        btn.id = "sendera-btn";
        btn.style.cssText = "${baseCss}";

        var closeBtn = document.createElement("span");
        closeBtn.setAttribute("aria-label","Закрыть");
        closeBtn.style.cssText = "margin-left:8px;opacity:.7;display:inline-flex;cursor:pointer";
        closeBtn.innerHTML = '${CLOSE_SVG}';
        closeBtn.addEventListener("click", function(e){
          e.stopPropagation();
          try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch(err){}
          window.sendera.event("widget_button_dismissed", {});
          btn.remove();
        });

        var label = document.createElement("span");
        label.textContent = ${JSON.stringify(config.text)};

        if(homeScreen){
          btn.innerHTML = '${BELL_SVG}';
          btn.appendChild(label);
          label.textContent = "Добавьте на экран «Домой»";
          btn.appendChild(closeBtn);
          btn.addEventListener("click", function(){ alert("Нажмите «Поделиться», затем «На экран «Домой»» — после этого уведомления заработают."); });
          document.body.appendChild(btn);
          window.sendera.event("widget_button_shown", {});
          return;
        }

        btn.innerHTML = '${BELL_SVG}';
        btn.appendChild(label);
        btn.appendChild(closeBtn);
        btn.addEventListener("click", function(){
          window.sendera.event("widget_button_clicked", {});
          window.sendera.subscribe().then(function(){ return window.sendera.isSubscribed(); }).then(function(yes){
            if(yes){ btn.innerHTML = '${CHECK_SVG}'; var s=document.createElement("span"); s.textContent="Вы подписаны"; btn.appendChild(s); btn.disabled = true; }
          });
        });
        document.body.appendChild(btn);
        window.sendera.event("widget_button_shown", {});
      });
    }
    if(DELAY_SECONDS > 0) setTimeout(render, DELAY_SECONDS * 1000); else render();
  });
})();`;
}

// Слайд-плашка — мягкий шаг ДО настоящего системного диалога: рендерится
// только если разрешение ещё не решено (Notification.permission==="default"),
// не закрыта недавно (dismissDays), и устройство ещё не подписано. На iOS
// вне standalone вместо кнопки «Разрешить» — инструкция «на экран Домой».
export function promptBlock(projectId: string, config: PromptConfig): string {
  const DISMISS_KEY = `pss_prompt_dismissed_${projectId}`;
  const title = escapeHtml(config.title);
  const body = escapeHtml(config.body);
  const color = config.color;
  const textColor = config.textColor;
  const secondaryColor = config.secondaryColor;
  const secondaryBg = config.secondaryBg;
  const cardTextColor = config.cardTextColor;
  const actionRadius = PROMPT_BUTTON_RADIUS_PX[config.borderRadius];
  const mobileCss = toCssText({ ...promptMobileStyle(config), transition: "transform .28s ease,opacity .28s ease", transform: "translateY(-100%)" });
  const desktopCss = toCssText({ ...promptDesktopStyle(config), transition: "transform .28s ease,opacity .28s ease", opacity: 0, transform: "translateY(-6px) scale(.96)" });

  return `(function(){
  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  function supported(){ return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  ${IOS_STANDALONE_CHECK}
  ${pageViewsCheck(projectId)}
  var BELL = '${BELL_SVG}';
  var DISMISS_KEY = ${JSON.stringify(DISMISS_KEY)};
  var DISMISS_DAYS = ${config.dismissDays};
  var DELAY_SECONDS = ${config.delaySeconds};
  var MIN_PAGE_VIEWS = ${config.minPageViews};
  function dismissed(){ try { var raw = localStorage.getItem(DISMISS_KEY); if(!raw) return false; return (Date.now() - Number(raw)) < DISMISS_DAYS * 86400000; } catch(e){ return false; } }
  function dismiss(){ try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch(e){} }

  ready(function(){
    if(!window.sendera){ console.error("[sendera] подключите скрипт /embed/{projectId}.js"); return; }
    if(dismissed()) return;
    var homeScreen = needsHomeScreen();
    if(!homeScreen){
      if(!supported() || Notification.permission !== "default") return;
    }
    if(document.getElementById("sendera-prompt")) return;
    if(pageViews() < MIN_PAGE_VIEWS) return;

    function render(){
      window.sendera.isSubscribed().then(function(already){
        if(already) return;
        if(document.getElementById("sendera-prompt")) return;

        var mobile = window.matchMedia("(max-width: 640px)").matches;
        var card = document.createElement("div");
        card.id = "sendera-prompt";
        card.innerHTML =
          '<div class="pss-p-icon" style="color:${color}">' + BELL + '</div>' +
          '<div class="pss-p-text">' +
            '<div class="pss-p-title">${title}</div>' +
            '<div class="pss-p-body">' + (homeScreen ? 'Добавьте сайт на экран «Домой», чтобы получать уведомления на iPhone.' : '${body}') + '</div>' +
          '</div>' +
          '<div class="pss-p-actions">' +
            '<button type="button" class="pss-p-later" style="background:${secondaryBg};color:${secondaryColor}">Не сейчас</button>' +
            (homeScreen ? '' : '<button type="button" class="pss-p-allow" style="background:${color};color:${textColor}">Разрешить</button>') +
          '</div>';

        card.style.cssText = mobile ? "${mobileCss}" : "${desktopCss}";

        var style = document.createElement("style");
        style.textContent =
          "#sendera-prompt .pss-p-icon{flex:0 0 auto;display:flex;padding-top:1px}" +
          "#sendera-prompt .pss-p-text{flex:1 1 auto;min-width:0}" +
          "#sendera-prompt .pss-p-title{font-size:14px;font-weight:600;line-height:1.3}" +
          "#sendera-prompt .pss-p-body{font-size:12.5px;color:${cardTextColor};opacity:.65;line-height:1.35;margin-top:2px}" +
          "#sendera-prompt .pss-p-actions{flex:0 0 auto;display:flex;flex-direction:column;gap:6px}" +
          "#sendera-prompt button{border:none;border-radius:${actionRadius};font:600 12.5px/1 -apple-system,sans-serif;padding:7px 12px;cursor:pointer;white-space:nowrap}" +
          "@media (max-width:640px){#sendera-prompt{flex-wrap:wrap}#sendera-prompt .pss-p-actions{flex-direction:row;width:100%;margin-top:8px}#sendera-prompt button{flex:1 1 0}}";
        document.head.appendChild(style);
        document.body.appendChild(card);
        window.sendera.event("widget_prompt_shown", {});

        var btnFloating = document.getElementById("sendera-btn");
        if(btnFloating) btnFloating.style.display = "none"; // не спорим за один и тот же момент с кнопкой

        requestAnimationFrame(function(){
          requestAnimationFrame(function(){
            card.style.transform = mobile ? "translateY(0)" : "translateY(0) scale(1)";
            card.style.opacity = "1";
          });
        });

        function close(){
          card.style.opacity = "0";
          card.style.transform = mobile ? "translateY(-100%)" : "translateY(-6px) scale(.96)";
          setTimeout(function(){ card.remove(); style.remove(); if(btnFloating) btnFloating.style.display = ""; }, 280);
        }

        card.querySelector(".pss-p-later").addEventListener("click", function(){ window.sendera.event("widget_prompt_dismissed", {}); dismiss(); close(); });
        var allow = card.querySelector(".pss-p-allow");
        if(allow) allow.addEventListener("click", function(){
          window.sendera.event("widget_prompt_clicked", {});
          card.querySelectorAll("button").forEach(function(b){ b.disabled = true; });
          window.sendera.subscribe().finally(close);
        });
      });
    }
    if(DELAY_SECONDS > 0) setTimeout(render, DELAY_SECONDS * 1000); else render();
  });
})();`;
}
