// Виджет «Окно уведомлений» — генератор JS. Один блок на весь цикл подписки:
//
//   устройство ещё не решило   → окно с пользой («Включить» / «Не сейчас»), по правилам config.show;
//   «Не сейчас»                → окно прячется на паузу, затем остаётся иконка-колокольчик
//                                 (правила config.bellShow, пауза считается от закрытия окна);
//   запретил в браузере        → окно не предлагается; иконка открывает инструкцию «как включить»
//                                 под устройство и браузер посетителя;
//   подписан                   → сам ничего не показывает; метод открывает инструкцию «как отключить»;
//   iPhone вне «Домой»         → окно с шагами «добавить на экран Домой».
//
// Методы: sendera.openNotifyWidget() — открыть окно по текущему состоянию устройства,
// sendera.closeNotifyWidget(), ссылка с параметром ?sendera_notify=1.
//
// mode: "live" — обычная выдача; "preview" — «Посмотреть на сайте» (всё показывается сразу, у
// посетителя ничего не запоминается); "static" — предпросмотр в админке: сам ничего не делает,
// окном управляет window.__pssNotify.show(view, tab) (код админки, тот же скрипт, что на сайте).

import { CLOSE_SVG, BELL_SVG, CHECK_SVG, BUTTON_POSITION_STYLE, IOS_STANDALONE_CHECK, WIDGET_Z_INDEX, toCssText } from "./widget-scripts";
import { gateScript } from "./widget-gate";
import { GUIDE_TAB_LABEL, type NotifyConfig } from "./notify-config";
import { WINDOW_BUTTON_RADIUS_PX, WINDOW_RADIUS_PX, type CornerRadius } from "./widget-config";

export type NotifyMode = "live" | "preview" | "static";
export const NOTIFY_QUERY_PARAM = "sendera_notify";
export const NOTIFY_VIEWS = ["offer", "blocked", "subscribed", "home", "done", "unsupported"] as const;
export type NotifyView = (typeof NOTIFY_VIEWS)[number];

const BELL_SIZE_PX = { s: 40, m: 48, l: 56 } as const;
const BELL_ICON_PX = { s: 18, m: 22, l: 26 } as const;
// как у остальных виджетов: «большое» скругление — полностью круглая иконка
const BELL_RADIUS: Record<CornerRadius, string> = { none: "0", sm: "10px", md: "16px", lg: "50%" };

function tint(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}1f` : "rgba(128,128,128,.16)";
}

// Одни и те же стили у скрипта и (через него же) у предпросмотра в админке.
export function notifyCss(c: NotifyConfig): string {
  const accent = c.color;
  const dr = WINDOW_RADIUS_PX[c.borderRadius];
  const br = WINDOW_BUTTON_RADIUS_PX[c.buttonRadius];
  const size = BELL_SIZE_PX[c.bellSize];
  const icon = BELL_ICON_PX[c.bellSize];
  const line = "rgba(128,128,128,.28)";
  return [
    `#sendera-notify{position:fixed;top:0;right:0;bottom:0;left:0;z-index:${WIDGET_Z_INDEX};display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(14,22,34,.45);opacity:0;transition:opacity .2s ease;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}`,
    `#sendera-notify *{box-sizing:border-box}`,
    `#sendera-notify.pss-n-in{opacity:1}`,
    `#sendera-notify .pss-n-dlg{position:relative;background:${c.cardBg};color:${c.cardTextColor};width:100%;max-width:400px;max-height:min(92vh,720px);border-radius:${dr};display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);transform:translateY(10px);transition:transform .22s ease;outline:none}`,
    `#sendera-notify.pss-n-in .pss-n-dlg{transform:none}`,
    `#sendera-notify button{font-family:inherit}`,
    `#sendera-notify .pss-n-x{position:absolute;top:10px;right:10px;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:inherit;opacity:.5;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}`,
    `#sendera-notify .pss-n-x:hover{opacity:.9;background:rgba(128,128,128,.14)}`,
    `#sendera-notify .pss-n-body{padding:26px 22px 8px;overflow-y:auto;overscroll-behavior:contain;min-height:0;display:flex;flex-direction:column;gap:12px}`,
    `#sendera-notify .pss-n-badge{width:48px;height:48px;border-radius:50%;background:${tint(accent)};color:${accent};display:flex;align-items:center;justify-content:center;flex:none}`,
    `#sendera-notify .pss-n-badge svg{width:24px;height:24px}`,
    `#sendera-notify .pss-n-title{font-size:19px;font-weight:600;line-height:1.25;padding-right:26px}`,
    `#sendera-notify .pss-n-intro{margin:0;font-size:14px;line-height:1.5;opacity:.72}`,
    `#sendera-notify .pss-n-list{list-style:none;margin:2px 0 0;padding:0;display:flex;flex-direction:column;gap:9px}`,
    `#sendera-notify .pss-n-li{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.4}`,
    `#sendera-notify .pss-n-li svg{flex:none;margin-top:1px;color:${accent}}`,
    `#sendera-notify .pss-n-tabs{display:flex;flex-wrap:wrap;gap:6px}`,
    `#sendera-notify .pss-n-tab{border:1px solid ${line};background:transparent;color:inherit;border-radius:999px;padding:6px 12px;font-size:13px;line-height:1.2;cursor:pointer;opacity:.75}`,
    `#sendera-notify .pss-n-tab[aria-pressed="true"]{border-color:${accent};background:${tint(accent)};opacity:1;font-weight:600}`,
    `#sendera-notify .pss-n-label{margin:2px 0 0;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;opacity:.55}`,
    `#sendera-notify .pss-n-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}`,
    `#sendera-notify .pss-n-step{display:flex;gap:12px;align-items:flex-start}`,
    `#sendera-notify .pss-n-num{flex:none;width:24px;height:24px;border-radius:50%;background:${tint(accent)};color:${accent};font-size:12.5px;font-weight:600;display:flex;align-items:center;justify-content:center}`,
    `#sendera-notify .pss-n-stext{font-size:14px;line-height:1.45;padding-top:2px}`,
    `#sendera-notify .pss-n-stext strong{font-weight:600}`,
    `#sendera-notify .pss-n-status{margin:0;font-size:13px;line-height:1.4;color:#b45309}`,
    `#sendera-notify .pss-n-foot{padding:14px 22px 20px;display:flex;flex-direction:column;gap:6px;flex:none}`,
    `#sendera-notify .pss-n-primary{height:44px;border:0;border-radius:${br};background:${accent};color:${c.textColor};font-size:15px;font-weight:600;line-height:1;cursor:pointer}`,
    `#sendera-notify .pss-n-primary:disabled{opacity:.6;cursor:default}`,
    `#sendera-notify .pss-n-secondary{height:40px;border:0;border-radius:${br};background:transparent;color:inherit;opacity:.65;font-size:14px;font-weight:500;line-height:1;cursor:pointer}`,
    `#sendera-notify .pss-n-secondary:hover{opacity:1;background:rgba(128,128,128,.1)}`,
    `#sendera-notify .pss-n-note{margin:2px 0 0;text-align:center;font-size:12px;opacity:.5}`,
    `#sendera-notify button:focus-visible{outline:2px solid ${accent};outline-offset:2px}`,
    `@media (max-width:640px){#sendera-notify{align-items:flex-end;padding:0}#sendera-notify .pss-n-dlg{max-width:none;border-radius:${dr} ${dr} 0 0;max-height:90vh;transform:translateY(24px);padding-bottom:env(safe-area-inset-bottom,0px)}}`,
    `@media (prefers-reduced-motion:reduce){#sendera-notify,#sendera-notify .pss-n-dlg,#sendera-notify-bell{transition:none}}`,
    `#sendera-notify-bell{position:fixed;${toCssText(BUTTON_POSITION_STYLE[c.bellPosition])};z-index:${WIDGET_Z_INDEX};width:${size}px;height:${size}px;border:0;border-radius:${BELL_RADIUS[c.bellRadius]};background:${c.bellColor};color:${c.bellTextColor};display:flex;align-items:center;justify-content:center;padding:0;box-shadow:0 4px 14px rgba(0,0,0,.2);cursor:pointer;opacity:0;transition:opacity .3s ease,transform .15s ease}`,
    `#sendera-notify-bell.pss-n-in{opacity:1}`,
    `#sendera-notify-bell:hover{transform:scale(1.06)}`,
    `#sendera-notify-bell:focus-visible{outline:2px solid ${c.bellColor};outline-offset:3px}`,
    `#sendera-notify-bell svg{width:${icon}px;height:${icon}px}`,
  ].join("");
}

// JSON в виде, безопасном для вставки в JS-код ответа и в <script> (предпросмотр в админке).
function jsLiteral(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028))
    .join("\\u2028")
    .split(String.fromCharCode(0x2029))
    .join("\\u2029");
}

export function notifyBlock(projectId: string, config: NotifyConfig, mode: NotifyMode = "live", installOn = false): string {
  const preview = mode !== "live";
  const data = {
    windowEnabled: config.windowEnabled,
    bellEnabled: config.bellEnabled,
    title: config.title,
    intro: config.intro,
    benefits: config.benefits,
    enableText: config.enableText,
    laterText: config.laterText,
    note: config.note,
    blockedTitle: config.blockedTitle,
    blockedIntro: config.blockedIntro,
    checkText: config.checkText,
    stillOffText: config.stillOffText,
    subscribedTitle: config.subscribedTitle,
    subscribedIntro: config.subscribedIntro,
    doneTitle: config.doneTitle,
    homeTitle: config.homeTitle,
    homeIntro: config.homeIntro,
    homeMoreText: config.homeMoreText,
    closeText: config.closeText,
    bellLabel: config.bellLabel,
    guides: config.guides,
    tabs: [
      ["ios", GUIDE_TAB_LABEL.ios],
      ["android", GUIDE_TAB_LABEL.android],
      ["chrome", GUIDE_TAB_LABEL.chrome],
      ["firefox", GUIDE_TAB_LABEL.firefox],
      ["safari", GUIDE_TAB_LABEL.safari],
    ],
  };
  return `(function(){
  if(!window.sendera) return;
  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ${IOS_STANDALONE_CHECK}
  ${gateScript(projectId, "window", config.show, preview, { name: "GW" })}
  ${gateScript(projectId, "bell", config.bellShow, preview, { name: "GB", stateKey: "window" })}
  var CFG = ${jsLiteral(data)};
  var CSS = ${jsLiteral(notifyCss(config))};
  var X_SVG = ${jsLiteral(CLOSE_SVG)}, BELL = ${jsLiteral(BELL_SVG)}, CHECK = ${jsLiteral(CHECK_SVG)};
  var PREVIEW = ${preview ? "true" : "false"}, STATIC = ${mode === "static" ? "true" : "false"}, INSTALL_ON = ${installOn ? "true" : "false"};
  var root = null, cur = null, bellEl = null, prevOverflow = "", lastFocus = null, onKey = null, styleEl = null;

  function h(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }
  // **жирный** — названия кнопок и пунктов меню; текст всегда вставляем как текст, не как разметку
  function richText(parent, s){
    var parts = String(s).split("**");
    for(var i = 0; i < parts.length; i++){
      if(!parts[i]) continue;
      if(i % 2){ var b = document.createElement("strong"); b.textContent = parts[i]; parent.appendChild(b); }
      else parent.appendChild(document.createTextNode(parts[i]));
    }
  }
  function ensureStyle(){
    if(styleEl && styleEl.parentNode) return;
    styleEl = document.createElement("style"); styleEl.id = "sendera-notify-css"; styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
  }
  function ev(name, p){ try { window.sendera.event(name, p || {}); } catch(e){} }
  function supported(){ return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }

  // Какой тип устройства и браузера у посетителя: от этого зависят шаги в инструкции.
  function detectTab(){
    var ua = navigator.userAgent || "";
    if(isIos() || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)) return "ios";
    if(/Android/i.test(ua)) return "android";
    if(/Firefox|FxiOS/i.test(ua)) return "firefox";
    if(/Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR|YaBrowser|CriOS/i.test(ua)) return "safari";
    return "chrome";
  }
  function onIphoneOutsideHome(){ return needsHomeScreen(); }

  // Состояние устройства: home — iPhone вне «Домой»; unsupported; subscribed; denied; default.
  function status(){
    if(PREVIEW){ return window.sendera.isSubscribed().then(function(s){ return s ? "subscribed" : "default"; }); }
    if(needsHomeScreen()) return Promise.resolve("home");
    if(!supported()) return Promise.resolve("unsupported");
    return window.sendera.isSubscribed().then(function(sub){
      if(sub) return "subscribed";
      return Notification.permission === "denied" ? "denied" : "default";
    });
  }
  function viewFor(st){ return st === "subscribed" ? "subscribed" : st === "denied" ? "blocked" : st === "home" ? "home" : st === "unsupported" ? "unsupported" : "offer"; }

  // ——— окно ———
  function removeNow(){
    if(!root) return;
    if(root.parentNode) root.parentNode.removeChild(root);
    root = null; cur = null;
    if(onKey){ document.removeEventListener("keydown", onKey); onKey = null; }
    document.body.style.overflow = prevOverflow;
  }
  function closeWin(){
    if(!root) return;
    var node = root;
    root = null; cur = null;
    if(onKey){ document.removeEventListener("keydown", onKey); onKey = null; }
    document.body.style.overflow = prevOverflow;
    node.classList.remove("pss-n-in");
    setTimeout(function(){ if(node.parentNode) node.parentNode.removeChild(node); }, 200);
    if(bellEl) bellEl.style.display = "";
    try { if(lastFocus && lastFocus.focus) lastFocus.focus(); } catch(e){}
  }
  // Закрытие предложения, которое показали сами: это отказ «Не сейчас», от него считаются пауза и лимит.
  function dismissClose(via){
    if(cur && (cur.view === "offer" || cur.view === "home")){
      if(cur.auto) GW.dismiss();
      ev("widget_notify_dismissed", { via: via, auto: !!cur.auto, view: cur.view });
    }
    closeWin();
  }

  function badge(svg){ var b = h("div", "pss-n-badge"); b.innerHTML = svg; return b; }
  function stepsList(list){
    var ol = h("ol", "pss-n-steps");
    list.forEach(function(t, i){
      var li = h("li", "pss-n-step");
      li.appendChild(h("span", "pss-n-num", String(i + 1)));
      var tx = h("span", "pss-n-stext"); richText(tx, t); li.appendChild(tx);
      ol.appendChild(li);
    });
    return ol;
  }
  // Шаги для вкладки: «включить» на iPhone вне «Домой» — сначала добавить сайт на экран.
  function stepsFor(tab, kind){
    var g = CFG.guides;
    if(tab === "ios") return (kind === "enable" && onIphoneOutsideHome() ? g.iosHome : g.ios)[kind];
    return g[tab][kind];
  }

  function paint(){
    var dlg = root.firstChild;
    var keepScroll = 0, old = dlg.querySelector(".pss-n-body"); if(old) keepScroll = old.scrollTop;
    dlg.textContent = "";
    var v = cur.view;
    var x = h("button", "pss-n-x"); x.type = "button"; x.setAttribute("aria-label", CFG.closeText); x.innerHTML = X_SVG;
    x.addEventListener("click", function(){ dismissClose("x"); });
    var body = h("div", "pss-n-body"), foot = h("div", "pss-n-foot");
    var title = h("div", "pss-n-title"); title.id = "sendera-notify-title";
    dlg.setAttribute("aria-labelledby", title.id);

    // Вкладки устройств — только в предпросмотре админки (STATIC), чтобы переключать инструкции.
    // Посетителю на сайте устройство определяется само (detectTab), выбор не показываем.
    function tabs(){
      var row = h("div", "pss-n-tabs"); row.setAttribute("role", "group");
      CFG.tabs.forEach(function(t){
        var b = h("button", "pss-n-tab", t[1]); b.type = "button"; b.setAttribute("aria-pressed", String(cur.tab === t[0]));
        b.addEventListener("click", function(){ if(cur.tab !== t[0]){ cur.tab = t[0]; ev("widget_notify_platform", { platform: t[0] }); paint(); } });
        row.appendChild(b);
      });
      return row;
    }
    function closeBtn(primary, label){
      var b = h("button", primary ? "pss-n-primary" : "pss-n-secondary", label || CFG.closeText); b.type = "button";
      b.addEventListener("click", function(){ closeWin(); });
      return b;
    }

    if(v === "offer"){
      body.appendChild(badge(BELL));
      title.textContent = CFG.title; body.appendChild(title);
      if(CFG.intro) body.appendChild(h("p", "pss-n-intro", CFG.intro));
      if(CFG.benefits.length){
        var ul = h("ul", "pss-n-list");
        CFG.benefits.forEach(function(t){
          var li = h("li", "pss-n-li"); var ic = h("span"); ic.style.display = "inline-flex"; ic.innerHTML = CHECK;
          li.appendChild(ic); li.appendChild(h("span", null, t)); ul.appendChild(li);
        });
        body.appendChild(ul);
      }
      var go = h("button", "pss-n-primary", CFG.enableText); go.type = "button";
      go.addEventListener("click", function(){ enable(go); });
      var later = h("button", "pss-n-secondary", CFG.laterText); later.type = "button";
      later.addEventListener("click", function(){ dismissClose("later"); });
      foot.appendChild(go); foot.appendChild(later);
      if(CFG.note) foot.appendChild(h("p", "pss-n-note", CFG.note));
    } else if(v === "blocked"){
      body.appendChild(badge(BELL));
      title.textContent = CFG.blockedTitle; body.appendChild(title);
      body.appendChild(h("p", "pss-n-intro", CFG.blockedIntro));
      if(STATIC) body.appendChild(tabs());
      body.appendChild(stepsList(stepsFor(cur.tab, "enable")));
      cur.status = h("p", "pss-n-status"); cur.status.style.display = "none"; cur.status.setAttribute("role", "status"); body.appendChild(cur.status);
      var chk = h("button", "pss-n-primary", CFG.checkText); chk.type = "button";
      chk.addEventListener("click", function(){ recheck(chk); });
      foot.appendChild(chk); foot.appendChild(closeBtn(false));
    } else if(v === "subscribed"){
      body.appendChild(badge(CHECK));
      title.textContent = CFG.subscribedTitle; body.appendChild(title);
      body.appendChild(h("p", "pss-n-intro", CFG.subscribedIntro));
      if(STATIC) body.appendChild(tabs());
      body.appendChild(stepsList(stepsFor(cur.tab, "disable")));
      foot.appendChild(closeBtn(true));
    } else if(v === "home"){
      body.appendChild(badge(BELL));
      title.textContent = CFG.homeTitle; body.appendChild(title);
      body.appendChild(h("p", "pss-n-intro", CFG.homeIntro));
      body.appendChild(stepsList(CFG.guides.iosHome.enable));
      foot.appendChild(closeBtn(true));
      // если включено окно «Установка приложения», даём перейти к нему с картинками
      if(INSTALL_ON && window.sendera.openInstallGuideIos){
        var more = h("button", "pss-n-secondary", CFG.homeMoreText); more.type = "button";
        more.addEventListener("click", function(){ closeWin(); window.sendera.openInstallGuideIos(); });
        foot.appendChild(more);
      }
    } else if(v === "done"){
      body.appendChild(badge(CHECK));
      title.textContent = CFG.doneTitle; body.appendChild(title);
    } else {
      body.appendChild(badge(BELL));
      title.textContent = "Браузер не поддерживает уведомления"; body.appendChild(title);
      body.appendChild(h("p", "pss-n-intro", "Откройте сайт в современном Chrome, Safari или Firefox: там уведомления можно включить."));
      foot.appendChild(closeBtn(true));
    }
    dlg.appendChild(x); dlg.appendChild(body);
    if(foot.childNodes.length) dlg.appendChild(foot);
    else body.style.paddingBottom = "26px";
    body.scrollTop = keepScroll;
  }

  // view: offer | blocked | subscribed | home | done | unsupported; o: { auto, via, tab }
  function openWin(view, o){
    o = o || {};
    removeNow();
    ensureStyle();
    lastFocus = document.activeElement;
    root = h("div"); root.id = "sendera-notify";
    var dlg = h("div", "pss-n-dlg"); dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true"); dlg.tabIndex = -1;
    root.appendChild(dlg);
    cur = { view: view, auto: !!o.auto, tab: o.tab || detectTab(), status: null };
    paint();
    root.addEventListener("click", function(e){ if(e.target === root) dismissClose("overlay"); });
    onKey = function(e){ if(e.key === "Escape") dismissClose("esc"); };
    document.addEventListener("keydown", onKey);
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(root);
    if(bellEl) bellEl.style.display = "none";
    void root.offsetWidth; // зафиксировать начальные стили, иначе плавное появление не запустится
    root.classList.add("pss-n-in");
    // В превью админки (STATIC) скрипт живёт в iframe: фокус в нём прокручивает страницу настроек
    // к рамке и уводит курсор из поля, которое сейчас правят. На сайте фокус нужен для доступности.
    if(!STATIC){ try { dlg.focus(); } catch(e){} }
    ev("widget_notify_opened", { view: view, via: o.via || "api", platform: cur.tab });
  }

  // ——— действия ———
  function finishSubscribed(){
    ev("widget_notify_result", { result: "granted" });
    removeBell();
    if(cur){ cur.view = "done"; paint(); }
    setTimeout(function(){ if(cur && cur.view === "done") closeWin(); }, 2200);
  }
  function enable(btn){
    ev("widget_notify_enable_clicked", {});
    btn.disabled = true;
    var p;
    try { p = window.sendera.subscribe(); } catch(e){ p = Promise.resolve(); }
    Promise.resolve(p).catch(function(){}).then(status).then(function(st){
      if(st === "subscribed") return finishSubscribed();
      if(st === "denied"){
        // запретил в системном окне — предложение больше не нужно, остаётся иконка с инструкцией
        ev("widget_notify_result", { result: "denied" });
        closeWin(); showBell();
        return;
      }
      // закрыл системное окно, ничего не выбрав: для окна это тоже «не сейчас»
      ev("widget_notify_result", { result: "dismissed" });
      GW.dismiss();
      closeWin();
    });
  }
  function recheck(btn){
    ev("widget_notify_check_clicked", {});
    if(!PREVIEW && "Notification" in window && Notification.permission === "granted"){
      btn.disabled = true;
      Promise.resolve().then(function(){ return window.sendera.subscribe(); }).catch(function(){}).then(status).then(function(st){
        if(st === "subscribed") finishSubscribed();
        else { btn.disabled = false; if(cur && cur.status){ cur.status.textContent = CFG.stillOffText; cur.status.style.display = ""; } }
      });
      return;
    }
    if(cur && cur.status){ cur.status.textContent = CFG.stillOffText; cur.status.style.display = ""; }
  }

  // ——— иконка ———
  function removeBell(){ if(bellEl){ if(bellEl.parentNode) bellEl.parentNode.removeChild(bellEl); bellEl = null; } }
  function showBell(){
    if(!CFG.bellEnabled || bellEl || document.getElementById("sendera-notify-bell")) return;
    ensureStyle();
    var b = h("button"); b.type = "button"; b.id = "sendera-notify-bell";
    b.setAttribute("aria-label", CFG.bellLabel); b.title = CFG.bellLabel; b.setAttribute("data-nosnippet", "");
    b.innerHTML = BELL;
    b.addEventListener("click", function(){
      ev("widget_notify_bell_clicked", {});
      status().then(function(st){ openWin(viewFor(st), { via: "bell" }); });
    });
    if(root) b.style.display = "none";
    document.body.appendChild(b);
    bellEl = b;
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ b.classList.add("pss-n-in"); }); });
    ev("widget_notify_bell_shown", {});
  }

  // ——— методы для кода сайта ———
  window.sendera.openNotifyWidget = function(){ status().then(function(st){ openWin(viewFor(st), { via: "api" }); }); };
  window.sendera.closeNotifyWidget = function(){ closeWin(); };

  if(STATIC){
    window.__pssNotify = { show: function(view, tab){ openWin(view, { via: "static", tab: tab }); }, bell: showBell, hide: function(){ removeNow(); removeBell(); } };
    return;
  }

  // Открытие по ссылке: ?${NOTIFY_QUERY_PARAM}=1 — окно по состоянию устройства, один раз; параметр убираем из адреса.
  (function(){
    var u, v;
    try { u = new URL(location.href); v = u.searchParams.get(${JSON.stringify(NOTIFY_QUERY_PARAM)}); } catch(e){ return; }
    if(v === null) return;
    try { u.searchParams.delete(${JSON.stringify(NOTIFY_QUERY_PARAM)}); history.replaceState(null, "", u.toString()); } catch(e){}
    ready(function(){ status().then(function(st){ openWin(viewFor(st), { via: "url" }); }); });
  })();

  ready(function(){
    if(PREVIEW){
      // «Посмотреть на сайте»: окно и иконка сразу
      if(CFG.bellEnabled) showBell();
      if(CFG.windowEnabled || !CFG.bellEnabled) openWin("offer", { via: "preview" });
      return;
    }
    status().then(function(st){
      if(st === "unsupported" || st === "subscribed") return;

      // Окно с предложением: по правилам показа, пока устройство ещё не решило (или iPhone вне «Домой»).
      if(CFG.windowEnabled && st !== "denied" && !GW.blocked()){
        GW.whenReady(function(){
          // не спорим за один и тот же момент с плашкой, кнопкой-окном и другим открытым окном
          if(root || document.getElementById("sendera-prompt") || document.getElementById("sendera-install")) return;
          status().then(function(s2){ if(s2 === "default" || s2 === "home") openWin(viewFor(s2), { auto: true, via: "auto" }); });
        });
      }

      // Иконка: после закрытия окна (когда пройдёт пауза), если окно выключено, или если запретили в браузере.
      if(CFG.bellEnabled){
        var windowDone = !CFG.windowEnabled || st === "denied" || GW.state().n > 0;
        if(windowDone && !GB.blocked()){
          GB.whenReady(function(){ status().then(function(s2){ if(s2 !== "subscribed" && s2 !== "unsupported") showBell(); }); });
        }
      }
    });
  });
})();`;
}
