import { createAdminClient } from "@/lib/supabase/admin";
import { resolveButtonConfig, resolvePromptConfig } from "@/lib/widget-config";
import { buttonBlock, promptBlock } from "@/lib/widget-scripts";
import { resolveInstallConfig } from "@/lib/install-guide";
import { installBlock } from "@/lib/install-widget";
import { minifyJs } from "@/lib/minify-js";
import { PREVIEW_PARAM, readPreviewToken, type PreviewWidget } from "@/lib/widget-preview";

// Скрипт «Посмотреть на сайте» (см. lib/widget-preview.ts). Основной скрипт
// подгружает его только если в адресе страницы есть ?sendera_preview=<токен>.
// Без действующей подписанной ссылки из админки отдаётся пустой 403, поэтому
// код выключенного виджета посторонним не достаётся.
//
// В режиме предпросмотра: виджет показывается сразу, подписка и события —
// заглушки (разрешение на push не запрашивается, в аналитику ничего не
// уходит, у посетителя ничего не запоминается), показываются СОХРАНЁННЫЕ
// настройки.
const HEADERS = {
  "Content-Type": "application/javascript; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId: raw } = await ctx.params;
  const projectId = raw.replace(/\.js$/, "");
  const widget = readPreviewToken(projectId, new URL(req.url).searchParams.get("t"));
  if (!widget) return new Response("", { status: 403, headers: HEADERS });

  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("id, widget_config, manifest_config").eq("id", projectId).maybeSingle();
  if (!project) return new Response("", { status: 404, headers: HEADERS });

  const api = process.env.NEXT_PUBLIC_APP_URL || "";
  const cfg = (project.widget_config as { button?: unknown; prompt?: unknown; install?: unknown } | null) || {};
  const installVersion = String((project.manifest_config as { generated_at?: string } | null)?.generated_at || "0").replace(/\D/g, "");

  let block: string;
  if (widget === "button") block = buttonBlock(project.id, resolveButtonConfig(cfg.button), true);
  else if (widget === "prompt") block = promptBlock(project.id, resolvePromptConfig(cfg.prompt), true);
  else block = installBlock(api, project.id, resolveInstallConfig(cfg.install, project.id), installVersion);

  const js = [previewShell(project.id, widget), block, previewTail(widget)].join("\n");
  return new Response(await minifyJs(js), { headers: HEADERS });
}

// Подменяет window.sendera копией с заглушками подписки и событий (остальные
// методы остаются настоящими), убирает уже стоящие на странице виджеты и
// рисует плашку «Режим предпросмотра» с кнопкой выхода.
function previewShell(projectId: string, widget: PreviewWidget) {
  const atBottom = widget === "prompt";
  return `(function(){
  var PID = ${JSON.stringify(projectId)};
  var IDS = ["sendera-btn", "sendera-prompt", "sendera-install"];
  var orig = window.sendera;
  if(!orig){ console.error("[sendera] подключите скрипт /embed/{projectId}.js"); return; }
  if(window.__pssPreview) return;
  window.__pssPreview = true;
  function removeWidgets(){ IDS.forEach(function(id){ var n = document.getElementById(id); if(n && n.parentNode) n.parentNode.removeChild(n); }); }
  removeWidgets();
  var subscribed = false;
  window.sendera = Object.assign({}, orig, {
    event: function(){},
    subscribe: function(){ subscribed = true; return Promise.resolve(); },
    isSubscribed: function(){ return Promise.resolve(subscribed); }
  });
  function badge(){
    var b = document.createElement("div");
    b.id = "sendera-preview-badge";
    b.setAttribute("data-nosnippet", "");
    b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);${atBottom ? "bottom" : "top"}:12px;z-index:2147483647;display:flex;align-items:center;gap:10px;padding:7px 8px 7px 14px;border-radius:999px;background:#16191e;color:#fff;font:600 12.5px/1 -apple-system,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25)";
    var t = document.createElement("span"); t.textContent = "Предпросмотр виджета";
    var x = document.createElement("button"); x.type = "button"; x.textContent = "Закрыть";
    x.style.cssText = "border:none;border-radius:999px;padding:6px 11px;background:#fff;color:#16191e;font:600 12px/1 -apple-system,sans-serif;cursor:pointer";
    x.addEventListener("click", function(){
      removeWidgets();
      if(b.parentNode) b.parentNode.removeChild(b);
      window.sendera = orig;
      window.__pssPreview = false;
      try { sessionStorage.removeItem("pss_preview_" + PID); } catch(e){}
      try { var u = new URL(location.href); u.searchParams.delete(${JSON.stringify(PREVIEW_PARAM)}); history.replaceState(null, "", u.toString()); } catch(e){}
    });
    b.appendChild(t); b.appendChild(x);
    document.body.appendChild(b);
  }
  if(document.readyState !== "loading") badge(); else document.addEventListener("DOMContentLoaded", badge);
})();`;
}

// Окно установки открывается только вызовом — в предпросмотре вызываем сами.
function previewTail(widget: PreviewWidget) {
  if (widget !== "install") return "";
  return `(function(){
  if(!window.__pssPreview || !window.sendera || !window.sendera.openInstallGuide) return;
  function go(){ window.sendera.openInstallGuide(); }
  if(document.readyState !== "loading") go(); else document.addEventListener("DOMContentLoaded", go);
})();`;
}
