import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshProductFeed } from "@/lib/productFeed";

// Периодически перечитывает товарные фиды всех проектов, у кого он указан —
// раз в несколько часов достаточно (цены/наличие не меняются поминутно), в
// отличие от отправочных кронов не нужно раз в минуту. Protected by CRON_SECRET.
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: projects } = await admin.from("projects").select("id").not("product_feed_url", "is", null);

  const results: Record<string, string> = {};
  for (const p of projects ?? []) {
    const r = await refreshProductFeed(p.id);
    results[p.id] = r.ok ? `${r.count} товаров` : r.error || "ошибка";
  }
  return NextResponse.json({ processed: Object.keys(results).length, results });
}
