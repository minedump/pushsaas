import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { PREVIEW_WIDGETS, makePreviewToken, type PreviewWidget } from "@/lib/widget-preview";

// Токен для «Посмотреть на сайте» (см. lib/widget-preview.ts): подписанный,
// на проект и один виджет, живёт 30 минут. Адрес страницы сайта админка
// собирает сама и дописывает токен параметром.
export async function POST(req: Request) {
  const { projectId, widget } = (await req.json().catch(() => ({}))) as { projectId?: string; widget?: string };
  if (!projectId || !widget || !(PREVIEW_WIDGETS as readonly string[]).includes(widget)) {
    return NextResponse.json({ error: "projectId and widget required" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const { token, expiresAt } = makePreviewToken(projectId, widget as PreviewWidget);
  return NextResponse.json({ token, expiresAt });
}
