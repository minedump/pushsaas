import { createAdminClient } from "@/lib/supabase/admin";
import { ALL_SCENE_IDS } from "@/lib/install-guide";
import { renderInstallScene } from "@/lib/install-scenes/render";
import type { ManifestConfig } from "@/lib/manifest";

// Картинка шага окна «Установка приложения»: схему рисуем по шаблону и данным
// проекта (иконка, короткое название и цвет темы из манифеста, адрес сайта).
// Публичный адрес — картинку подгружает <img> на чужом сайте магазина и
// предпросмотр в админке; параметр v только сбрасывает кэш при перегенерации манифеста.
// GET /api/public/install-scene?p=<projectId>&s=<sceneId>&v=<версия>

const UUID = /^[0-9a-fA-F-]{36}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("p") || "";
  const sceneId = url.searchParams.get("s") || "";
  if (!UUID.test(projectId) || !ALL_SCENE_IDS.includes(sceneId)) return new Response("not found", { status: 404 });

  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("name, domain, manifest_config").eq("id", projectId).maybeSingle();
  if (!project) return new Response("not found", { status: 404 });

  const manifest = (project.manifest_config as ManifestConfig | null) || null;
  const short = (manifest?.short_name || project.name || "Магазин").slice(0, 15);
  const domain = (project.domain || "example.com").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").slice(0, 60);
  const color = manifest?.theme_color && /^#[0-9a-fA-F]{6}$/.test(manifest.theme_color) ? manifest.theme_color : "#2c4a66";

  // Иконку вшиваем в SVG data-URI'ем: через <img> внешние ссылки в SVG не грузятся.
  let icon: string | null = null;
  if (manifest?.icons?.apple) {
    const { data: blob } = await admin.storage.from("project-assets").download(`${projectId}/apple-touch-icon.png`);
    if (blob) icon = `data:image/png;base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
  }

  const svg = renderInstallScene(sceneId, { short, domain, color, icon });
  if (!svg) return new Response("not found", { status: 404 });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
