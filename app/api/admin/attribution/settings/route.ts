import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// cookiePath больше не принимаем — путь всегда `cookies.<cookieName>`.
// Пути к номеру/сумме заказа захардкожены (number/total_price): формат
// вебхука InSales подтверждён реальным телом заказа, настраивать нечего.
export async function POST(req: Request) {
  const { projectId, enabled, cookieName, windowDays } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const { error } = await admin
    .from("projects")
    .update({
      attribution_enabled: !!enabled,
      attribution_cookie_name: cookieName || "pss_attr",
      attribution_window_days: Number(windowDays) || 7,
      attribution_order_id_path: "number",
      attribution_revenue_path: "total_price",
    })
    .eq("id", projectId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
