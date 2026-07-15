import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chargeToken, nextPeriodEnd } from "@/lib/cloudpayments";

// Daily renewal sweep. Protected by CRON_SECRET (query ?key= or Bearer header).
// For each paid project whose period has ended:
//   · no saved card  -> block immediately (nothing to charge)
//   · card present    -> charge full tariff price; success = renew_success,
//                        failure = renew_fail (blocks on the 3rd try).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // due = active, paid tariff, period ended
  const { data: due } = await admin
    .from("projects")
    .select("id, name, tariff_id, current_period_end, tariffs!inner(price_rub, monthly_push_limit)")
    .lte("current_period_end", nowIso)
    .eq("is_active", true)
    .gt("tariffs.price_rub", 0);

  const results: Record<string, string> = {};

  for (const p of due ?? []) {
    // supabase types the joined relation as array|object; normalise
    const tariff = Array.isArray(p.tariffs) ? p.tariffs[0] : p.tariffs;
    const price = Number(tariff?.price_rub || 0);
    const limit = Number(tariff?.monthly_push_limit || 0);

    const { data: secret } = await admin
      .from("project_secrets")
      .select("cp_card_token")
      .eq("project_id", p.id)
      .maybeSingle();

    if (!secret?.cp_card_token) {
      await admin.rpc("block_project", { p_project_id: p.id });
      results[p.id] = "blocked (no card)";
      continue;
    }

    const charge = await chargeToken({
      token: secret.cp_card_token,
      amount: price,
      accountId: p.id,
      description: `Продление тарифа — ${p.name}`,
    });

    if (charge.ok) {
      await admin.rpc("renew_success", {
        p_project_id: p.id,
        p_pushes: limit,
        p_period_end: nextPeriodEnd().toISOString(),
        p_amount: price,
      });
      if (charge.newToken && charge.newToken !== secret.cp_card_token) {
        await admin.from("project_secrets").update({ cp_card_token: charge.newToken }).eq("project_id", p.id);
      }
      results[p.id] = "renewed";
    } else {
      const { data: blocked } = await admin.rpc("renew_fail", { p_project_id: p.id });
      results[p.id] = blocked ? "blocked (3rd fail)" : "retry scheduled";
    }
  }

  return NextResponse.json({ processed: Object.keys(results).length, results });
}
