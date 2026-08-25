import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { resolveProductsByRule, type ProductsRule } from "@/lib/productFeed";

// Резолвит правило (конкретные id либо «N новых») в товары из кеша фида —
// используется ProductPicker (гидрация названий уже выбранных товаров и
// превью «новых») и формами рассылок, которые пишут в campaigns напрямую
// через Supabase-клиент (EditCampaignForm), минуя /api/admin/campaigns/send —
// там резолв правила больше неоткуда взять, кроме отдельного запроса.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const { rule } = (await req.json().catch(() => ({}))) as { rule?: ProductsRule };
  if (!rule || (rule.mode !== "manual" && rule.mode !== "newest")) return NextResponse.json({ items: [] });

  const items = await resolveProductsByRule(projectId, rule);
  return NextResponse.json({ items });
}
