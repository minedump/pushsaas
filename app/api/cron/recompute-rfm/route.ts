import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logFieldChanges } from "@/lib/identity";

// Пересчитывает RFM-теги (rfm:champions/loyal/at_risk/new/sleeping/regular)
// на identities.tags по данным order_attributions — единственный механизм
// таргетинга в проекте уже теги (.overlaps("tags", segmentTags), см.
// lib/identity.ts resolvePushSegmentIds и lib/sender.ts), так что RFM как
// теги даёт поиск/сегментацию бесплатно, без новых экранов.
//
// Упрощение полной RFM-матрицы 5×5×5 до 6 читаемых сегментов — см. toSegment
// ниже. Скоринг (квинтили) — per-project: распределение чеков у разных
// магазинов разное, глобальные квинтили были бы бессмысленны.
//
// Та же fair-scheduling + time-boxing схема, что и в refresh-product-feeds
// (см. app/api/cron/refresh-product-feeds/route.ts): проекты по возрастанию
// rfm_computed_at (давно не пересчитанные — первые), ранний выход по
// TIME_BUDGET_MS не даёт одному большому магазину заморить остальные.
export const maxDuration = 60;
const TIME_BUDGET_MS = 50_000;
const MIN_IDENTITIES_FOR_SCORING = 5;

type Segment = "champions" | "loyal" | "at_risk" | "new" | "sleeping" | "regular";

function toSegment(r: number, f: number, m: number): Segment {
  if (r >= 4 && f >= 4 && m >= 4) return "champions";
  // at_risk идёт раньше loyal: частый покупатель, давно молчащий (низкий R),
  // важнее поймать как "требует внимания", а не как просто "лояльный" —
  // иначе высокочастотные, но замолчавшие клиенты никогда не попадут в этот
  // сегмент (loyal по одной частоте ловил бы их первым).
  if (r <= 2 && f >= 3) return "at_risk";
  if (f >= 4) return "loyal";
  if (r >= 4 && f <= 2) return "new";
  if (r <= 2 && f <= 2) return "sleeping";
  return "regular";
}

// Ранжирует values по возрастанию и раскладывает по 5 примерно равным
// корзинам (5 — самые большие значения). Индексы результата соответствуют
// исходному порядку values.
function quantileScores(values: number[]): number[] {
  const n = values.length;
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const scores = new Array(n).fill(1);
  order.forEach((origIdx, rank) => {
    scores[origIdx] = Math.min(5, Math.floor((rank * 5) / n) + 1);
  });
  return scores;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: projects } = await admin
    .from("projects")
    .select("id")
    .order("rfm_computed_at", { ascending: true, nullsFirst: true });

  const startedAt = Date.now();
  const results: Record<string, string> = {};
  let timedOut = false;

  for (const p of projects ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    const { data: orders } = await admin
      .from("order_attributions")
      .select("identity_id, paid_amount, created_at")
      .eq("project_id", p.id)
      .eq("is_paid", true)
      .not("identity_id", "is", null);

    const byIdentity = new Map<string, { count: number; total: number; lastAt: number }>();
    for (const o of orders ?? []) {
      const id = o.identity_id as string;
      const amount = Number(o.paid_amount) || 0;
      const at = new Date(o.created_at as string).getTime();
      const cur = byIdentity.get(id);
      if (!cur) {
        byIdentity.set(id, { count: 1, total: amount, lastAt: at });
      } else {
        cur.count += 1;
        cur.total += amount;
        if (at > cur.lastAt) cur.lastAt = at;
      }
    }

    if (byIdentity.size < MIN_IDENTITIES_FOR_SCORING) {
      await admin.from("projects").update({ rfm_computed_at: new Date().toISOString() }).eq("id", p.id);
      results[p.id] = `skipped (${byIdentity.size} identities with paid orders, need ${MIN_IDENTITIES_FOR_SCORING})`;
      continue;
    }

    const ids = [...byIdentity.keys()];
    const now = Date.now();
    const recencyDaysNegated = ids.map((id) => -((now - byIdentity.get(id)!.lastAt) / 86_400_000));
    const frequency = ids.map((id) => byIdentity.get(id)!.count);
    const monetary = ids.map((id) => byIdentity.get(id)!.total);

    const rScores = quantileScores(recencyDaysNegated);
    const fScores = quantileScores(frequency);
    const mScores = quantileScores(monetary);

    const { data: identityRows } = await admin.from("identities").select("id, tags").in("id", ids);
    const tagsById = new Map((identityRows ?? []).map((r) => [r.id, (r.tags as string[]) || []]));

    let tagged = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const segment = toSegment(rScores[i], fScores[i], mScores[i]);
      const current = tagsById.get(id) ?? [];
      const next = [...current.filter((t) => !t.startsWith("rfm:")), `rfm:${segment}`];
      const changed = current.length !== next.length || !current.every((t) => next.includes(t));
      if (!changed) continue;
      await admin.from("identities").update({ tags: next }).eq("id", id);
      logFieldChanges(admin, p.id, id, { tags: current }, { tags: next });
      tagged++;
    }

    await admin.from("projects").update({ rfm_computed_at: new Date().toISOString() }).eq("id", p.id);
    results[p.id] = `ok (${byIdentity.size} identities scored, ${tagged} tags changed)`;
  }

  return NextResponse.json({ processed: Object.keys(results).length, total: projects?.length ?? 0, timedOut, results });
}
