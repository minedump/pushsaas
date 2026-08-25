import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { refreshProductFeed } from "@/lib/productFeed";

// Ручное обновление кеша товарного фида — кнопка «Обновить сейчас» в
// Настройках. По расписанию тот же refreshProductFeed вызывает крон
// refresh-product-feeds.
export async function POST(req: Request) {
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const result = await refreshProductFeed(projectId);
  if (!result.ok) return NextResponse.json({ error: result.error || "Ошибка обновления фида" }, { status: 400 });
  return NextResponse.json({ ok: true, count: result.count, skipped: !!result.skipped });
}
