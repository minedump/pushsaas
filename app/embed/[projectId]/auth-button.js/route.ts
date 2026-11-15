import { createAdminClient } from "@/lib/supabase/admin";
import { minifyJs } from "@/lib/minify-js";
import { AUTH_BUTTON_SIZES, buildAuthButtonScript, type AuthButtonSize } from "@/lib/authButtonScript";

// Скрипт кнопки входа InSales: прячет блок входа, пока вход выключен, иначе превращает ссылку «Войти через …»
// в кнопку темы магазина (классы .button и размер), при желании с цветом. Логика и разметка — lib/authButtonScript.ts.
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId: raw } = await ctx.params;
  const projectId = raw.replace(/\.js$/, "");

  const admin = createAdminClient();
  const { data: oidc } = await admin.from("oidc_clients").select("config, is_enabled").eq("project_id", projectId).maybeSingle();
  const config = oidc?.config || {};

  const script = buildAuthButtonScript({
    // кнопка входа скрыта, пока вход выключен (переключатель «Статус входа»)
    hide: !oidc?.is_enabled,
    color: typeof config.auth_button_color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(config.auth_button_color.trim()) ? config.auth_button_color.trim() : null,
    size: AUTH_BUTTON_SIZES.includes(config.auth_button_size) ? (config.auth_button_size as AuthButtonSize) : null,
  });

  return new Response(await minifyJs(script), {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
