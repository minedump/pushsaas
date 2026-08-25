import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const PRODUCT_COLUMNS = "external_id, group_id, name, price, old_price, image_url, url, categories, params";

// Поиск товаров в кеше фида для ручного выбора (ProductPicker) — по названию
// (?q=...) или превью «N новых» (?mode=newest&count=...&category=...), та же
// логика сортировки, что и resolveProductsByRule в lib/productFeed.ts (не
// переиспользуем функцию напрямую — здесь нужен именно ilike-поиск, которого
// в ней нет).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const { searchParams } = new URL(req.url);
  const admin = createAdminClient();

  if (searchParams.get("mode") === "newest") {
    const count = Math.max(1, Math.min(Number(searchParams.get("count")) || 3, 20));
    const category = searchParams.get("category")?.trim() || null;
    let query = admin.from("product_feed_items").select(PRODUCT_COLUMNS).eq("project_id", projectId).order("first_seen_at", { ascending: false }).limit(count);
    if (category) query = query.contains("categories", [category]);
    const { data } = await query;
    return NextResponse.json({ items: data || [] });
  }

  const q = searchParams.get("q")?.trim() || "";
  if (!q) return NextResponse.json({ items: [] });
  const { data } = await admin.from("product_feed_items").select(PRODUCT_COLUMNS).eq("project_id", projectId).ilike("name", `%${q}%`).order("name").limit(20);
  return NextResponse.json({ items: data || [] });
}
