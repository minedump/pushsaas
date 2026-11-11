import type { createAdminClient } from "@/lib/supabase/admin";
import type { OrderLine } from "@/lib/orderLines";

// Заказы пополняют общий каталог товаров (product_feed_items): по каждой позиции заказа заводится
// вариант, если его там ещё нет. Запись неполная, но достаточная, чтобы показывать заказ и искать
// товар: id варианта (external_id), id товара (group_id), название, артикул (штрихкод из заказа не берём, он необязательный и приходит только из фида). Цену, категории,
// картинку и остаток из заказа не берём: цена в позиции уже после скидки заказа, остальное в заказе
// не приходит. Всё это пришлёт фид и перезапишет запись целиком.
//
// Правила:
//  · варианта нет в каталоге: заводим запись source = 'order';
//  · запись заведена по заказу (source = 'order'): обновляем название и артикул по самому
//    свежему заказу, остальное не трогаем;
//  · запись из фида (source = 'feed'): название и прочее остаются из фида, отмечаем только время
//    последнего заказа. Фид главнее заказа.
// Позиции без variant_id в каталог не попадают.
export async function cacheOrderProducts(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  lines: OrderLine[],
  orderedAt: string
): Promise<{ created: number; updated: number }> {
  const byVariant = new Map<string, OrderLine>();
  for (const l of lines) if (l.variant_id) byVariant.set(l.variant_id, l);
  if (!byVariant.size) return { created: 0, updated: 0 };

  const ids = [...byVariant.keys()];
  const { data: existing } = await admin.from("product_feed_items").select("external_id, source, last_order_at").eq("project_id", projectId).in("external_id", ids);
  const have = new Map((existing ?? []).map((r) => [r.external_id as string, r as { external_id: string; source: string; last_order_at: string | null }]));

  const toInsert: Record<string, unknown>[] = [];
  let updated = 0;
  for (const [variantId, l] of byVariant) {
    const row = have.get(variantId);
    if (!row) {
      toInsert.push({
        project_id: projectId,
        external_id: variantId,
        group_id: l.product_id,
        name: l.title,
        sku: l.sku,
        source: "order",
        last_order_at: orderedAt,
      });
      continue;
    }
    // отметка последнего заказа: заказ может прийти позже более нового, поэтому время только растёт
    const newer = !row.last_order_at || new Date(orderedAt).getTime() > new Date(row.last_order_at).getTime();
    const patch: Record<string, unknown> = {};
    if (newer) patch.last_order_at = orderedAt;
    if (row.source === "order" && newer) {
      patch.name = l.title;
      patch.sku = l.sku;
      if (l.product_id) patch.group_id = l.product_id;
    }
    if (Object.keys(patch).length) {
      await admin.from("product_feed_items").update(patch).eq("project_id", projectId).eq("external_id", variantId);
      updated++;
    }
  }
  if (toInsert.length) await admin.from("product_feed_items").upsert(toInsert, { onConflict: "project_id,external_id", ignoreDuplicates: true });
  return { created: toInsert.length, updated };
}
