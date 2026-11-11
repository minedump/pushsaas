import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import ProductsView, { type ProductRow } from "./ProductsView";

const PAGE_SIZE = 50;

// Каталог товаров проекта: общий кеш (product_feed_items), который пополняют фид и заказы.
// Запись из фида полная и обновляется фидом; запись по заказу неполная (id варианта и товара,
// название, артикул, штрихкод), пока этот вариант не придёт в фиде. Пропавшие из фида товары не
// удаляются: помечаются «в архиве» с нулевым остатком.
export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; source?: string; avail?: string; page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, is_active, product_feed_url, product_feed_updated_at, product_feed_error").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  // доступ к проекту уже проверен выше, каталог читаем админским клиентом (политика таблицы пускает только владельца)
  const admin = createAdminClient();
  const q = (sp.q ?? "").replace(/[%,()*"\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const source = sp.source === "feed" || sp.source === "order" ? sp.source : "all";
  const avail = ["in", "out", "archived", "unknown"].includes(sp.avail ?? "") ? (sp.avail as string) : "all";
  const page = Math.max(1, Number(sp.page) || 1);

  let query = admin
    .from("product_feed_items")
    .select(
      "external_id, group_id, name, variant_label, sku, barcode, price, old_price, image_url, url, categories, params, available, stock, source, archived_at, last_order_at, updated_at",
      { count: "exact" }
    )
    .eq("project_id", id);
  if (q) query = query.or(`name.ilike.%${q}%,variant_label.ilike.%${q}%,sku.ilike.%${q}%,barcode.eq."${q}",external_id.eq."${q}",group_id.eq."${q}"`);
  if (source !== "all") query = query.eq("source", source);
  if (avail === "in") query = query.eq("available", true).is("archived_at", null);
  else if (avail === "out") query = query.eq("available", false).is("archived_at", null);
  else if (avail === "archived") query = query.not("archived_at", "is", null);
  else if (avail === "unknown") query = query.is("available", null);

  const { data: rows, count } = await query.order("name", { ascending: true }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const countOf = async (build: (qb: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { count: c } = await build(base());
    return c ?? 0;
  };
  function base() {
    return admin.from("product_feed_items").select("external_id", { count: "exact", head: true }).eq("project_id", id);
  }
  const [total, fromFeed, fromOrders, archived] = await Promise.all([
    countOf((b) => b),
    countOf((b) => b.eq("source", "feed")),
    countOf((b) => b.eq("source", "order")),
    countOf((b) => b.not("archived_at", "is", null)),
  ]);

  const { data: tzRow } = await supabase.from("projects").select("timezone").eq("id", id).maybeSingle();

  return (
    <ProductsView
      projectId={id}
      rows={(rows ?? []) as unknown as ProductRow[]}
      matched={count ?? 0}
      pageSize={PAGE_SIZE}
      page={page}
      filters={{ q, source, avail }}
      stats={{ total, fromFeed, fromOrders, archived }}
      feed={{ connected: !!project.product_feed_url, updatedAt: project.product_feed_updated_at, error: project.product_feed_error }}
      timezone={(tzRow as { timezone?: string | null } | null)?.timezone || "Europe/Moscow"}
    />
  );
}
