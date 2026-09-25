import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshProductFeed } from "@/lib/productFeed";

// Периодически перечитывает товарные фиды всех проектов, у кого он указан —
// раз в несколько часов достаточно (цены/наличие не меняются поминутно), в
// отличие от отправочных кронов не нужно раз в минуту. Protected by CRON_SECRET.
export const maxDuration = 60;

// Запас под maxDuration: если один-два больших фида съедают весь бюджет
// прогона, остальные проекты не должны зависать до убийства процесса
// платформой без ответа — лучше отдать частичный результат и продолжить
// на следующем тике (раз в 15 минут).
const TIME_BUDGET_MS = 50_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // Сначала — те, кого дольше всех не обновляли (product_feed_updated_at is
  // null — ни разу не синканные — идут первыми). Если бюджет времени
  // истечёт раньше конца списка, именно эти проекты уже обработаны, а не
  // забракованы в конец очереди — большой фид одного магазина не морит
  // голодом остальных из тика в тик.
  const { data: projects } = await admin
    .from("projects")
    .select("id")
    .not("product_feed_url", "is", null)
    .order("product_feed_updated_at", { ascending: true, nullsFirst: true });

  const startedAt = Date.now();
  const results: Record<string, string> = {};
  let timedOut = false;
  for (const p of projects ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }
    const r = await refreshProductFeed(p.id);
    results[p.id] = r.ok ? `${r.count} товаров` : r.error || "ошибка";
  }
  return NextResponse.json({
    processed: Object.keys(results).length,
    total: projects?.length ?? 0,
    timedOut,
    results,
  });
}
