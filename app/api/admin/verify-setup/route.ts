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

  // Сохраняем итог шага (ok и время) — страница настроек покажет галочку после
  // перезахода. Ошибки записи пользователю не показываем, только в лог.
  // Запись атомарная (функция в БД меняет только ключ этого шага): три
  // одновременные проверки не затирают результаты друг друга.
  const { error: saveErr } = await admin.rpc("set_setup_check", { p_project: projectId, p_step: step, p_ok: result.ok });
  if (saveErr) console.error("[verify-setup] save setup_checks failed:", saveErr.message);

  // подробности (какой пункт не прошёл) наружу не отдаём — интерфейсу нужен только итог
  return NextResponse.json({ ok: result.ok });
}
