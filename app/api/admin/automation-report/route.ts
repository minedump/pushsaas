import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { generateAutomationReportHtml } from "@/lib/automationReport";

// GET /api/admin/automation-report?projectId=... -> HTML-презентация на
// скачивание (кнопка «Скачать отчёт» в разделе «Автоматизации» админки).
// Тот же паттерн, что и app/api/admin/subscribers/export/route.ts: доступ по
// сессии (assertProjectAccess), сами данные — через admin-клиент внутри
// generateAutomationReportHtml (там несколько джойнов подряд, RLS на
// каждом шаге была бы лишним трением).
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") || "";
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const html = await generateAutomationReportHtml(projectId);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="sendera-automations-${projectId}.html"`,
    },
  });
}
