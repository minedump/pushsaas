import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCampaignJobNow } from "@/lib/sender";

// Drains due campaign_jobs — пер-получательские задания кампаний с
// включённым окном отправки/защитой от наложения (см. lib/sender.ts
// enqueueWindowedCampaign, migration 0056). Тот же принцип, что и
// run-automations: claim (status pending -> sent атомарно, конкурентный
// запуск не задвоит отправку), обработка ПОСЛЕДОВАТЕЛЬНО в цикле — счётчики
// campaigns.delivered_count/failed_count читаются-и-пишутся без отдельной
// блокировки (bumpCampaignCounts), это безопасно только при
// последовательной обработке в пределах одного запуска.
export const maxDuration = 60;

const BATCH = 300;
const MAX_ITERATIONS = 5;
const TIME_BUDGET_MS = 45_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const startedAt = Date.now();
  let sent = 0;
  let skipped = 0;
  let totalDue = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;

    const { data: due } = await admin
      .from("campaign_jobs")
      .select("id, campaign_id, project_id, channel, subscriber_id, contact")
      .eq("status", "pending")
      .lte("fire_at", new Date().toISOString())
      .limit(BATCH);

    if (!due?.length) break;
    totalDue += due.length;

    for (const job of due) {
      // claim the job so a concurrent run can't double-send
      const { data: claimed } = await admin
        .from("campaign_jobs")
        .update({ status: "sent", updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed?.length) {
        skipped++;
        continue;
      }

      const status = await sendCampaignJobNow(admin, job as { id: string; campaign_id: string; project_id: string; channel: "push" | "sms" | "email"; subscriber_id: string | null; contact: string | null });
      if (status === "sent") sent++;
      else skipped++;
    }

    if (due.length < BATCH) break;
  }

  return NextResponse.json({ due: totalDue, sent, skipped });
}
