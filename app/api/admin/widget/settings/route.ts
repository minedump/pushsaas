import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveButtonConfig, resolvePromptConfig } from "@/lib/widget-config";

// Настройки внешнего вида кнопки подписки и слайд-плашки (обе — механики
// /embed/{projectId}/widgets.js) — projects.widget_config. Каждая секция
// сохраняется отдельно (в теле присутствует только button ЛИБО только
// prompt), поэтому просто подменяем свой ключ в текущем конфиге, не трогая
// соседний.
export async function POST(req: Request) {
  const { projectId, button, prompt } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("widget_config").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });

  const current = (project.widget_config as { button?: unknown; prompt?: unknown }) || {};
  const next: { button?: unknown; prompt?: unknown } = { ...current };
  if (button !== undefined) next.button = resolveButtonConfig(button);
  if (prompt !== undefined) next.prompt = resolvePromptConfig(prompt);

  await admin.from("projects").update({ widget_config: next }).eq("id", projectId);
  return NextResponse.json({ ok: true });
}
