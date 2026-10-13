import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveButtonConfig, resolvePromptConfig } from "@/lib/widget-config";
import { resolveInstallConfig } from "@/lib/install-guide";

// Настройки виджетов — projects.widget_config: кнопка подписки, слайд-плашка и
// окно «Установка приложения». Каждая секция сохраняется отдельно (в теле
// присутствует только button, только prompt ЛИБО только install), поэтому
// просто подменяем свой ключ в текущем конфиге, не трогая соседние.
export async function POST(req: Request) {
  const { projectId, button, prompt, install } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("widget_config").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });

  const current = (project.widget_config as { button?: unknown; prompt?: unknown; install?: unknown }) || {};
  const next: { button?: unknown; prompt?: unknown; install?: unknown } = { ...current };
  if (button !== undefined) next.button = resolveButtonConfig(button);
  if (prompt !== undefined) next.prompt = resolvePromptConfig(prompt);
  if (install !== undefined) next.install = resolveInstallConfig(install, projectId);

  await admin.from("projects").update({ widget_config: next }).eq("id", projectId);
  return NextResponse.json({ ok: true });
}
