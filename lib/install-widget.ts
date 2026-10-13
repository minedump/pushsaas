// Окно «Установка приложения»: пошаговая инструкция, как добавить сайт на экран
// телефона. Открывается методами sendera.openInstallGuide() (с вкладками iPhone
// и Android), openInstallGuideIos(), openInstallGuideAndroid() и закрывается
// sendera.closeInstallGuide(). Своих кнопок открытия не рисует — их ставит код
// сайта. Разметка и стили продублированы в InstallPreview.tsx (админка) на тех
// же константах INSTALL_UI, чтобы предпросмотр не расходился со скриптом.

import { CLOSE_SVG, WIDGET_Z_INDEX } from "./widget-scripts";
import { INSTALL_BUTTON_RADIUS_PX, installStepImageUrl, type InstallConfig, type InstallStep } from "./install-guide";

// Цвета и размеры окна — одни и те же для скрипта и предпросмотра.
export const INSTALL_UI = {
  overlay: "rgba(14,22,34,.5)",
  dialogBg: "#ffffff",
  text: "#16202a",
  muted: "#566477",
  faint: "#8794a6",
  line: "#e3e7ec",
  tileBorder: "#c9d1dc",
  imgBorder: "#dbe3ec",
  imgBg: "#eef3f8",
  font: "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
} as const;

// Силуэты телефонов на плитках переключателя (общие для скрипта и админки).
export const PHONE_IOS_SVG =
  '<svg width="20" height="30" viewBox="0 0 20 30" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="1.5" width="16" height="27" rx="5"/><rect x="7" y="5" width="6" height="2" rx="1" fill="currentColor" stroke="none"/></svg>';
export const PHONE_ANDROID_SVG =
  '<svg width="20" height="30" viewBox="0 0 20 30" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="1.5" width="16" height="27" rx="2.5"/><circle cx="10" cy="5.5" r="1.2" fill="currentColor" stroke="none"/></svg>';

// Лёгкая подложка выбранной плитки в цвет кнопки (10% прозрачности).
export function installTint(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}1a` : INSTALL_UI.imgBg;
}

function installCss(config: InstallConfig): string {
  const u = INSTALL_UI;
  const radius = INSTALL_BUTTON_RADIUS_PX[config.buttonRadius];
  const c = config.buttonColor;
  return [
    `#sendera-install{position:fixed;top:0;right:0;bottom:0;left:0;z-index:${WIDGET_Z_INDEX};display:flex;align-items:center;justify-content:center;padding:16px;background:${u.overlay};opacity:0;transition:opacity .2s ease;font-family:${u.font};-webkit-text-size-adjust:100%}`,
    `#sendera-install *{box-sizing:border-box}`,
    `#sendera-install.pss-i-in{opacity:1}`,
    `#sendera-install .pss-i-dlg{background:${u.dialogBg};color:${u.text};width:100%;max-width:460px;max-height:min(92vh,780px);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);transform:translateY(10px);transition:transform .22s ease;outline:none}`,
    `#sendera-install.pss-i-in .pss-i-dlg{transform:none}`,
    `#sendera-install .pss-i-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid ${u.line};flex:none}`,
    `#sendera-install .pss-i-title{font-size:16px;font-weight:600;line-height:1.25}`,
    `#sendera-install .pss-i-x{flex:none;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:${u.faint};cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}`,
    `#sendera-install .pss-i-x:hover{background:#f2f4f7}`,
    `#sendera-install .pss-i-body{padding:14px 16px;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:14px;min-height:0}`,
    `#sendera-install .pss-i-intro{margin:0;font-size:13.5px;line-height:1.5;color:${u.muted}}`,
    `#sendera-install .pss-i-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px}`,
    `#sendera-install .pss-i-tab{border:1px solid ${u.tileBorder};background:${u.dialogBg};color:${u.muted};border-radius:12px;padding:10px 8px 9px;display:flex;flex-direction:column;align-items:center;gap:6px;font-family:inherit;font-size:13.5px;font-weight:500;line-height:1.2;cursor:pointer}`,
    `#sendera-install .pss-i-tab[aria-pressed="true"]{border-color:${c};box-shadow:0 0 0 1px ${c};background:${installTint(c)};color:${u.text}}`,
    `#sendera-install .pss-i-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:20px}`,
    `#sendera-install .pss-i-step{display:block}`,
    `#sendera-install .pss-i-label{margin:0 0 4px;font-size:13px;font-weight:600;line-height:1.3;color:${u.muted}}`,
    `#sendera-install .pss-i-text{margin:0;font-size:14px;line-height:1.45;}`,
    `#sendera-install .pss-i-text strong{font-weight:600}`,
    `#sendera-install .pss-i-img{display:block;width:100%;height:auto;margin-top:8px;border-radius:10px;border:1px solid ${u.imgBorder};background:${u.imgBg}}`,
    `#sendera-install .pss-i-empty{font-size:13.5px;color:${u.muted}}`,
    `#sendera-install .pss-i-foot{padding:12px 16px 16px;border-top:1px solid ${u.line};flex:none}`,
    `#sendera-install .pss-i-done{width:100%;height:40px;border:0;border-radius:${radius}px;background:${c};color:${config.buttonTextColor};font-family:inherit;font-size:14px;font-weight:600;line-height:1;cursor:pointer}`,
    `@media (max-width:640px){#sendera-install{align-items:flex-end;padding:0}#sendera-install .pss-i-dlg{max-width:none;border-radius:18px 18px 0 0;max-height:90vh;transform:translateY(24px);padding-bottom:env(safe-area-inset-bottom,0px)}}`,
    `@media (prefers-reduced-motion:reduce){#sendera-install,#sendera-install .pss-i-dlg{transition:none}}`,
  ].join("");
}

// JSON в виде, безопасном для вставки в JS-код ответа.
function jsLiteral(v: unknown): string {
  // U+2028/U+2029 в строковых литералах JS допустимы только в новых движках — экранируем явно
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028)).join("\\u2028")
    .split(String.fromCharCode(0x2029)).join("\\u2029");
}

export function installBlock(api: string, projectId: string, config: InstallConfig, version: string): string {
  const steps = (list: InstallStep[]) => list.map((s) => ({ t: s.text, img: installStepImageUrl(api, projectId, s, version) }));
  const data = {
    title: config.title,
    intro: config.intro,
    buttonText: config.buttonText,
    steps: { ios: steps(config.ios), android: steps(config.android) },
  };
  return `(function(){
  if(!window.sendera) return;
  var CFG = ${jsLiteral(data)};
  var CSS = ${jsLiteral(installCss(config))};
  var X_SVG = ${jsLiteral(CLOSE_SVG)};
  var PH = ${jsLiteral({ ios: PHONE_IOS_SVG, android: PHONE_ANDROID_SVG })};
  var root = null, prevOverflow = "", lastFocus = null, onKey = null, styleEl = null;

  function h(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }
  // **жирный** — как названия кнопок в инструкции; текст всегда вставляем как текст, не как разметку
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
    styleEl = document.createElement("style"); styleEl.id = "sendera-install-css"; styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
  }
  function defaultPlatform(){ return /android/i.test(navigator.userAgent || "") ? "android" : "ios"; }

  function close(){
    if(!root) return;
    var node = root; root = null;
    if(onKey){ document.removeEventListener("keydown", onKey); onKey = null; }
    document.body.style.overflow = prevOverflow;
    node.classList.remove("pss-i-in");
    setTimeout(function(){ if(node.parentNode) node.parentNode.removeChild(node); }, 200);
    try { if(lastFocus && lastFocus.focus) lastFocus.focus(); } catch(e){}
  }

  // mode: "tabs" — обе платформы с переключателем, "ios" / "android" — одна платформа без вкладок
  function open(mode, platform){
    if(root){
      var old = root; root = null;
      if(old.parentNode) old.parentNode.removeChild(old);
      if(onKey){ document.removeEventListener("keydown", onKey); onKey = null; }
      document.body.style.overflow = prevOverflow;
    }
    ensureStyle();
    lastFocus = document.activeElement;

    root = h("div"); root.id = "sendera-install";
    var dlg = h("div", "pss-i-dlg"); dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true"); dlg.tabIndex = -1;
    var head = h("div", "pss-i-head");
    var ttl = h("div", "pss-i-title", CFG.title); ttl.id = "sendera-install-title"; dlg.setAttribute("aria-labelledby", ttl.id);
    var x = h("button", "pss-i-x"); x.type = "button"; x.setAttribute("aria-label", "Закрыть"); x.innerHTML = X_SVG;
    head.appendChild(ttl); head.appendChild(x);

    var body = h("div", "pss-i-body");
    if(CFG.intro) body.appendChild(h("p", "pss-i-intro", CFG.intro));
    var tabs = null, tabBtns = {};
    if(mode === "tabs"){
      tabs = h("div", "pss-i-tabs"); tabs.setAttribute("role", "group");
      [["ios", "iPhone"], ["android", "Android"]].forEach(function(p){
        var b = h("button", "pss-i-tab"); b.type = "button"; b.innerHTML = PH[p[0]]; b.appendChild(document.createTextNode(p[1]));
        b.addEventListener("click", function(){ if(platform !== p[0]){ paint(p[0]); window.sendera.event("widget_install_platform", { platform: p[0] }); } });
        tabBtns[p[0]] = b; tabs.appendChild(b);
      });
      body.appendChild(tabs);
    }
    var list = h("ol", "pss-i-steps"); body.appendChild(list);

    function paint(p){
      platform = p;
      if(tabs) for(var k in tabBtns) tabBtns[k].setAttribute("aria-pressed", String(k === p));
      list.textContent = "";
      var steps = CFG.steps[p] || [];
      if(!steps.length){ list.appendChild(h("li", "pss-i-empty", "Инструкция для этой платформы пока не заполнена.")); return; }
      steps.forEach(function(s, i){
        var li = h("li", "pss-i-step");
        li.appendChild(h("p", "pss-i-label", "Шаг " + (i + 1)));
        var wrap = li; var t = h("p", "pss-i-text"); richText(t, s.t); wrap.appendChild(t);
        if(s.img){
          var img = h("img", "pss-i-img"); img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.src = s.img;
          img.addEventListener("error", function(){ img.style.display = "none"; });
          wrap.appendChild(img);
        }
        list.appendChild(li);
      });
      body.scrollTop = 0;
    }
    paint(platform);

    var foot = h("div", "pss-i-foot");
    var done = h("button", "pss-i-done", CFG.buttonText); done.type = "button";
    foot.appendChild(done);
    dlg.appendChild(head); dlg.appendChild(body); dlg.appendChild(foot);
    root.appendChild(dlg);

    x.addEventListener("click", close);
    done.addEventListener("click", function(){ window.sendera.event("widget_install_done", { platform: platform }); close(); });
    root.addEventListener("click", function(e){ if(e.target === root) close(); });
    onKey = function(e){ if(e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);

    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(root);
    // читаем offsetWidth, чтобы браузер зафиксировал начальные стили — иначе плавное появление не запустится
    void root.offsetWidth;
    root.classList.add("pss-i-in");
    try { dlg.focus(); } catch(e){}
    window.sendera.event("widget_install_opened", { mode: mode, platform: platform });
  }

  window.sendera.openInstallGuide = function(){ open("tabs", defaultPlatform()); };
  window.sendera.openInstallGuideIos = function(){ open("ios", "ios"); };
  window.sendera.openInstallGuideAndroid = function(){ open("android", "android"); };
  window.sendera.closeInstallGuide = close;
})();`;
}
