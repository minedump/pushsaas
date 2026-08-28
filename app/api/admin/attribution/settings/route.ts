import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyError } from "@/lib/errors";

// Пути к полям заказа (number/total_price/items_price/financial_status) —
// захардкожены в /api/v1/attribute, подтверждены реальным заказом InSales
// (создание + смена статуса на оплачен). Настраивать нечего — только имя
// куки и окно атрибуции. Флага "включено" нет — вебхук всегда живой по
// своему токену (см. lib/attribution.ts).
export async function POST(req: Request) {
  const { projectId, cookieName, windowDays } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const { error } = await admin
    .from("projects")
    .update({
      attribution_cookie_name: cookieName || "pss_attr",
      attribution_window_days: Number(windowDays) || 7,
      attribution_order_id_path: "number",
      attribution_revenue_path: "total_price",
    })
    .eq("id", projectId);

  if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
