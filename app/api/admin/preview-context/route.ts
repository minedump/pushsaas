import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { expandRefs } from "@/lib/sender";

// Резолвит products/product/categories/category/collections/collection
// внутри sampleData попапа предпросмотра (MessagePreviewModal) против кеша
// фида — тот же expandRefs, что реально применяется в момент отправки (см.
// resolveTemplateData в lib/sender.ts), только здесь на клиентских demo-
// данных формы, а не на template_data кампании/автоматизации. Без этого
// превью показывало бы {"id": "..."} как есть, а не название/цену/картинку.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { projectId, data } = body as { projectId?: string; data?: Record<string, unknown> };
  if (!projectId || !data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "projectId и data обязательны" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const { template, ...rest } = data as Record<string, unknown> & { template?: unknown };
  const [expandedRest, expandedTemplate] = await Promise.all([
    expandRefs(projectId, rest),
    template && typeof template === "object" && !Array.isArray(template) ? expandRefs(projectId, template as Record<string, unknown>) : Promise.resolve(template),
  ]);

  return NextResponse.json({ data: { ...expandedRest, template: expandedTemplate } });
}
