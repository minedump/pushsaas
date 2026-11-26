// Клиентская часть единого стандарта «когда показывать» (см. lib/widget-rules.ts).
// gateScript() возвращает кусок JS, который виджет вставляет внутрь своей самовызывающейся
// функции. Он объявляет переменную G:
//   G.blocked()      — показывать нельзя прямо сейчас: идёт пауза после закрытия, исчерпан лимит
//                      закрытий или страница не подходит. Проверяется один раз при запуске;
//   G.whenReady(fn)  — вызывает fn один раз, когда выполнены все условия: страница полностью
//                      загружена и прошла задержка, просмотрено нужное число страниц, набрано
//                      нужное время на сайте, вкладка открыта;
//   G.dismiss()      — запоминает закрытие (время и счётчик) — от него считаются пауза и лимит;
//   G.shown()        — запоминает время автоматического показа, не трогая счётчик: пауза начинается
//                      уже с показа, и соседние вкладки не покажут виджет второй раз, даже если
//                      в первой его так и не закрыли;
//   G.state()        — { t: время последнего закрытия, n: сколько раз закрывали }.
// Счётчики страниц и времени общие для всех виджетов на странице (window.__pssM) и живут в
// sessionStorage — то есть считаются за визит, а не копятся годами. Время идёт только пока вкладка
// видима. Закрытия хранятся в localStorage на устройстве.
// preview=true («Посмотреть на сайте»): все условия игнорируются, виджет показывается сразу,
// у посетителя ничего не запоминается.

import type { ShowRules } from "./widget-rules";

// opts.name — имя переменной (по умолчанию G; нужно, когда в одном виджете два набора правил);
// opts.stateKey — чьи закрытия учитывать при паузе и лимите (иконка считает паузу от закрытия окна).
export function gateScript(
  projectId: string,
  key: string,
  rules: ShowRules,
  preview: boolean,
  opts: { name?: string; stateKey?: string } = {}
): string {
  const name = opts.name || "G";
  const cfg = {
    d: rules.delaySeconds * 1000,
    p: rules.minPageViews,
    t: rules.minTimeOnSiteSeconds * 1000,
    pause: rules.pauseHours * 3600000,
    max: rules.maxDismissals,
    mode: rules.pagesMode,
    pats: rules.pagePatterns,
  };
  return `
  var ${name} = (function(){
    var R = ${JSON.stringify(cfg)};
    var PREVIEW = ${preview ? "true" : "false"};
    var KEY = ${JSON.stringify(`pss_${opts.stateKey || key}_dismissed_${projectId}`)};
    var PV = ${JSON.stringify(`pss_pv_${projectId}`)};
    var TM = ${JSON.stringify(`pss_tm_${projectId}`)};

    // Страницы и время за визит — один счётчик на все виджеты страницы.
    var M = window.__pssM;
    if(!M){
      M = window.__pssM = { pv: 1, base: 0, since: Date.now(), vis: !document.hidden };
      try {
        M.pv = Number(sessionStorage.getItem(PV) || "0") + 1;
        sessionStorage.setItem(PV, String(M.pv));
        M.base = Number(sessionStorage.getItem(TM) || "0") || 0;
      } catch(e){}
      M.active = function(){ return M.base + (M.vis ? Date.now() - M.since : 0); };
      M.save = function(){ try { sessionStorage.setItem(TM, String(Math.round(M.active()))); } catch(e){} };
      M.stop = function(){ M.base = M.active(); M.vis = false; M.save(); };
      M.go = function(){ M.since = Date.now(); M.vis = !document.hidden; };
      document.addEventListener("visibilitychange", function(){ if(document.hidden) M.stop(); else M.go(); });
      window.addEventListener("pagehide", M.stop);
      window.addEventListener("pageshow", function(e){ if(e.persisted) M.go(); });
      setInterval(M.save, 5000);
    }

    function trimSlash(s){ while(s.length > 1 && s.charAt(s.length - 1) === "/") s = s.slice(0, -1); return s; }
    // Совпадение адреса с шаблоном: «*» — любая часть, без «*» — точный адрес (слэш в конце не важен).
    function wild(pat, path){
      var parts = pat.split("*");
      if(parts.length === 1) return trimSlash(pat) === trimSlash(path);
      if(pat.slice(-2) === "/*" && trimSlash(path) === (pat.slice(0, -2) || "/")) return true;
      var first = parts[0], last = parts[parts.length - 1];
      if(path.indexOf(first) !== 0) return false;
      var pos = first.length;
      for(var i = 1; i < parts.length - 1; i++){
        var j = path.indexOf(parts[i], pos);
        if(j < 0) return false;
        pos = j + parts[i].length;
      }
      return path.length - last.length >= pos && path.slice(path.length - last.length) === last;
    }
    function pageOk(){
      if(R.mode === "all" || !R.pats.length) return true;
      var path = (location.pathname || "/").toLowerCase();
      var hit = false;
      for(var i = 0; i < R.pats.length; i++){ if(wild(R.pats[i], path)){ hit = true; break; } }
      return R.mode === "only" ? hit : !hit;
    }

    // Старый формат — просто время закрытия числом, читаем и его.
    function state(){
      try {
        var raw = localStorage.getItem(KEY);
        if(!raw) return { t: 0, n: 0 };
        if(raw.charAt(0) === "{"){ var o = JSON.parse(raw); return { t: Number(o.t) || 0, n: Number(o.n) || 0 }; }
        return { t: Number(raw) || 0, n: 1 };
      } catch(e){ return { t: 0, n: 0 }; }
    }
    function dismiss(){
      if(PREVIEW) return;
      var s = state();
      try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), n: s.n + 1 })); } catch(e){}
    }
    function shown(){
      if(PREVIEW) return;
      var s = state();
      try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), n: s.n })); } catch(e){}
    }
    function blocked(){
      if(PREVIEW) return false;
      var s = state();
      if(R.max > 0 && s.n >= R.max) return true;
      if(s.t && Date.now() - s.t < R.pause) return true;
      return !pageOk();
    }

    function loadedAt(){
      try {
        var n = performance.getEntriesByType("navigation")[0];
        if(n && n.loadEventEnd > 0) return performance.timeOrigin + n.loadEventEnd;
      } catch(e){}
      return Date.now();
    }
    function whenReady(fn){
      if(PREVIEW){ fn(); return; }
      var done = false, timer = null, t0 = 0;
      function check(){
        clearTimeout(timer);
        if(done || !t0 || document.hidden || blocked()) return;
        if(M.pv < R.p) return;
        var wait = Math.max(t0 + R.d - Date.now(), R.t - M.active(), 0);
        if(wait > 0){ timer = setTimeout(check, wait + 30); return; }
        done = true; fn();
      }
      document.addEventListener("visibilitychange", check);
      function onLoad(){ t0 = loadedAt(); check(); }
      if(document.readyState === "complete") onLoad(); else window.addEventListener("load", onLoad);
    }

    return { blocked: blocked, whenReady: whenReady, dismiss: dismiss, shown: shown, state: state };
  })();
`;
}
