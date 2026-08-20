import { createAdminClient } from "@/lib/supabase/admin";
import { resolveButtonConfig, resolvePromptConfig, type ButtonConfig, type ButtonPosition, type ButtonSize, type PromptConfig } from "@/lib/widget-config";

// Механики подписки поверх основного /embed/PROJECT_ID.js — плавающая
// кнопка и слайд-плашка (мягкий запрос перед системным диалогом браузера).
// Один файл вместо двух отдельных скриптов: сервер решает, какие механики
// вообще попадают в выдаваемый код — если механика выключена, её кода в
// файле просто нет. Каждая механика — самостоятельный блок (свой ready(),
// свои проверки), поэтому позже сюда можно добавить условия показа
// (задержка, скролл, выход со страницы и т.п.) отдельно для каждой, не
// трогая остальные и не заводя новый файл.
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId: raw } = await ctx.params;
  const projectId = raw.replace(/\.js$/, "");

  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("id, widget_config").eq("id", projectId).maybeSingle();
  if (!project) {
    return new Response(`console.error("[sendera] проект не найден: ${projectId}");`, {
      status: 404,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

  const raw2 = (project.widget_config as { button?: unknown; prompt?: unknown } | null) || {};
  const button = resolveButtonConfig(raw2.button);
  const prompt = resolvePromptConfig(raw2.prompt);

  const blocks: string[] = [];
  if (button.enabled) blocks.push(buttonBlock(button));
  if (prompt.enabled) blocks.push(promptBlock(projectId, prompt));

  const body = blocks.length
    ? `(function(){\n${blocks.join("\n\n")}\n})();`
    : `// [sendera] кнопка и плашка подписки выключены в настройках проекта`;

  return new Response(body, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

const POSITION_CSS: Record<ButtonPosition, string> = {
  "bottom-right": "right:18px;bottom:18px",
  "bottom-left": "left:18px;bottom:18px",
  "top-right": "right:18px;top:18px",
  "top-left": "left:18px;top:18px",
};
const SIZE_CSS: Record<ButtonSize, string> = {
  s: "padding:8px 14px;font-size:12px;gap:6px",
  m: "padding:12px 18px;font-size:14px;gap:8px",
  l: "padding:16px 24px;font-size:16px;gap:10px",
};

function buttonBlock(config: ButtonConfig): string {
  return `(function(){
  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  var BELL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"></path><path d="M9 17v1a3 3 0 0 0 6 0v-1"></path></svg>';
  var CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5l10 -10"></path></svg>';

  ready(function(){
    if(!window.sendera){ console.error("[sendera] подключите основной скрипт /embed/{projectId}.js раньше widgets.js"); return; }
    if(document.querySelector('[data-sendera="manual"]')) return;
    if(!("serviceWorker" in navigator && "PushManager" in window && "Notification" in window)) return;
    if(document.getElementById("sendera-btn")) return;

    var btn = document.createElement("button");
    btn.id = "sendera-btn";
    btn.innerHTML = BELL + '<span>${escapeJs(config.text)}</span>';
    btn.style.cssText = "position:fixed;${POSITION_CSS[config.position]};z-index:99999;display:inline-flex;align-items:center;${SIZE_CSS[config.size]};border:none;border-radius:24px;background:${config.color};color:#fff;font-weight:600;font-family:-apple-system,sans-serif;line-height:1;box-shadow:0 4px 14px rgba(0,0,0,.2);cursor:pointer";
    btn.addEventListener("click", function(){
      window.sendera.subscribe().then(function(){ return window.sendera.isSubscribed(); }).then(function(yes){
        if(yes){ btn.innerHTML = CHECK + '<span>Вы подписаны</span>'; btn.disabled = true; }
      });
    });
    document.body.appendChild(btn);
  });
})();`;
}

function promptBlock(projectId: string, config: PromptConfig): string {
  const DISMISS_KEY = `pss_prompt_dismissed_${projectId}`;
  const title = escapeHtml(config.title);
  const body = escapeHtml(config.body);
  const color = config.color;

  return `(function(){
  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  function supported(){ return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  var BELL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"></path><path d="M9 17v1a3 3 0 0 0 6 0v-1"></path></svg>';
  var DISMISS_KEY = ${JSON.stringify(DISMISS_KEY)};
  function dismissed(){ try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch(e){ return false; } }
  function dismiss(){ try { localStorage.setItem(DISMISS_KEY, "1"); } catch(e){} }

  ready(function(){
    if(!window.sendera){ console.error("[sendera] подключите основной скрипт /embed/{projectId}.js раньше widgets.js"); return; }
    if(!supported() || Notification.permission !== "default" || dismissed()) return;
    if(document.getElementById("sendera-prompt")) return;

    window.sendera.isSubscribed().then(function(already){
      if(already) return;

      var mobile = window.matchMedia("(max-width: 640px)").matches;
      var card = document.createElement("div");
      card.id = "sendera-prompt";
      card.innerHTML =
        '<div class="pss-p-icon" style="color:${color}">' + BELL + '</div>' +
        '<div class="pss-p-text">' +
          '<div class="pss-p-title">${title}</div>' +
          '<div class="pss-p-body">${body}</div>' +
        '</div>' +
        '<div class="pss-p-actions">' +
          '<button type="button" class="pss-p-later">Не сейчас</button>' +
          '<button type="button" class="pss-p-allow" style="background:${color}">Разрешить</button>' +
        '</div>';

      var baseCss = "position:fixed;z-index:99999;background:#fff;color:#16202a;font-family:-apple-system,'Segoe UI',sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.18);transition:transform .28s ease,opacity .28s ease";
      card.style.cssText = mobile
        ? baseCss + ";left:0;right:0;top:0;padding:14px 16px;display:flex;align-items:flex-start;gap:10px;border-radius:0 0 14px 14px;transform:translateY(-100%)"
        : baseCss + ";left:16px;top:16px;width:300px;padding:14px;display:flex;align-items:flex-start;gap:10px;border-radius:14px;opacity:0;transform:translateY(-6px) scale(.96)";

      var style = document.createElement("style");
      style.textContent =
        "#sendera-prompt .pss-p-icon{flex:0 0 auto;display:flex;padding-top:1px}" +
        "#sendera-prompt .pss-p-text{flex:1 1 auto;min-width:0}" +
        "#sendera-prompt .pss-p-title{font-size:14px;font-weight:600;line-height:1.3}" +
        "#sendera-prompt .pss-p-body{font-size:12.5px;color:#5a6570;line-height:1.35;margin-top:2px}" +
        "#sendera-prompt .pss-p-actions{flex:0 0 auto;display:flex;flex-direction:column;gap:6px}" +
        "#sendera-prompt button{border:none;border-radius:8px;font:600 12.5px/1 -apple-system,sans-serif;padding:7px 12px;cursor:pointer;white-space:nowrap}" +
        "#sendera-prompt .pss-p-allow{color:#fff}" +
        "#sendera-prompt .pss-p-later{background:#f0f2f4;color:#45505c}" +
        "@media (max-width:640px){#sendera-prompt{flex-wrap:wrap}#sendera-prompt .pss-p-actions{flex-direction:row;width:100%;margin-top:8px}#sendera-prompt button{flex:1 1 0}}";
      document.head.appendChild(style);
      document.body.appendChild(card);

      requestAnimationFrame(function(){
        requestAnimationFrame(function(){
          card.style.transform = mobile ? "translateY(0)" : "translateY(0) scale(1)";
          card.style.opacity = "1";
        });
      });

      function close(){
        card.style.opacity = "0";
        card.style.transform = mobile ? "translateY(-100%)" : "translateY(-6px) scale(.96)";
        setTimeout(function(){ card.remove(); style.remove(); }, 280);
      }

      card.querySelector(".pss-p-later").addEventListener("click", function(){ dismiss(); close(); });
      card.querySelector(".pss-p-allow").addEventListener("click", function(){
        card.querySelectorAll("button").forEach(function(b){ b.disabled = true; });
        window.sendera.subscribe().finally(close);
      });
    });
  });
})();`;
}

function escapeJs(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/</g, "\\x3C");
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
