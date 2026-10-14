import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkServiceWorker, checkSnippet, checkManifest, type StepResult } from "@/lib/site-check";

// Кнопка «Проверить» на Обзоре: живая проверка шага подключения на сайте
// мерчанта. Результат сохраняется в projects.setup_checks (галочка «Готово»
// переживает перезаход).

export const maxDuration = 30;

type Step = "sw" | "snippet" | "manifest";

export async function POST(req: Request) {
  const { projectId, step } = (await req.json().catch(() => ({}))) as { projectId?: string; step?: Step };
  if (!projectId || !step || !["sw", "snippet", "manifest"].includes(step)) {
    return NextResponse.json({ error: "projectId and step required" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("domain").eq("id", projectId).maybeSingle();
  const domain = (project?.domain || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain) {
    return NextResponse.json({ error: "У проекта не указан домен сайта" }, { status: 400 });
  }

  let result: StepResult;
  if (step === "sw") result = await checkServiceWorker(domain);
  else if (step === "snippet") result = await checkSnippet(domain, projectId);
  else result = await checkManifest(domain);

  // Сохраняем результат целиком (не только «ok»): и успех, и провал, и список
  // пунктов — страница настроек восстанавливает их после перезахода. Ошибки
  // записи не глотаем: логируем и отдаём saved:false, чтобы кнопка не делала
  // вид, что состояние сохранено.
  const checkedAt = new Date().toISOString();
  let saved = false;
  const { data: row, error: readErr } = await admin.from("projects").select("setup_checks").eq("id", projectId).maybeSingle();
  if (readErr) {
    console.error("[verify-setup] read setup_checks failed:", readErr.message);
  } else if (row) {
    const checks = { ...(row.setup_checks || {}), [step]: { ok: result.ok, checks: result.checks, checked_at: checkedAt } };
    const { error: writeErr } = await admin.from("projects").update({ setup_checks: checks }).eq("id", projectId);
    if (writeErr) console.error("[verify-setup] save setup_checks failed:", writeErr.message);
    else saved = true;
  }

  return NextResponse.json({ ...result, checkedAt, saved });
}
