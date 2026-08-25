import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { clearProductFeed } from "@/lib/productFeed";

// Удаляет фид проекта целиком (ссылку + весь кеш product_feed_items) —
// «Удалить фид» в Настройках, чтобы можно было подключить другой фид с
// чистого кеша, не смешивая позиции разных источников.
export async function DELETE(req: Request) {
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  await clearProductFeed(projectId);
  return NextResponse.json({ ok: true });
}
