import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOneOff } from "@/lib/sender";

// Drains due automation jobs and sends their push. Protected by CRON_SECRET.
// Meant to be hit every minute by an external cron (cron-job.org) —
// Vercel Hobby crons run only daily.
//
// Throughput: drains in batches of 300, looping within the same invocation
// (bounded by iteration count + a time budget) so a backlog across many
// projects doesn't take multiple cron ticks to clear.
export const maxDuration = 60;

const BATCH = 300;
const MAX_ITERATIONS = 5;
const TIME_BUDGET_MS = 45_000;

// Best-effort: ids among `ids` whose subscriber row has paused=true. Returns
// an empty set (excludes nobody) if the column isn't migrated yet — this must
// NEVER be baked into the main select above, or a missing column there errors
// the whole join and silently stops every automation from firing.
async function pausedIdsAmong(admin: ReturnType<typeof createAdminClient>, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await admin.from("subscribers").select("id").eq("paused", true).in("id", ids);
  if (error || !data?.length) return new Set();
  return new Set(data.map((r) => r.id));
}

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
      .from("automation_jobs")
      .select(
        "id, project_id, automation_id, subscriber_id, automations(title, body, click_url, config), subscribers(id, endpoint, p256dh, auth, is_active, attributes)"
      )
      .eq("status", "pending")
      .lte("fire_at", new Date().toISOString())
      .limit(BATCH);

    if (!due?.length) break;
    totalDue += due.length;

    const paused = await pausedIdsAmong(admin, due.map((j) => j.subscriber_id));

    for (const job of due) {
      // claim the job so a concurrent run can't double-send
      const { data: claimed } = await admin
        .from("automation_jobs")
        .update({ status: "sent", updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed?.length) {
        skipped++;
        continue;
      }

      const a = Array.isArray(job.automations) ? job.automations[0] : job.automations;
      const s = Array.isArray(job.subscribers) ? job.subscribers[0] : job.subscribers;
      const attrs = (s as { attributes?: Record<string, unknown> })?.attributes || {};
      const actions = (a?.config as { actions?: { title: string; url: string }[] })?.actions;

      let status: "sent" | "failed" | "skipped" = "skipped";
      if (a?.title && a?.body && s && s.is_active && !paused.has(job.subscriber_id)) {
        const ok = await sendOneOff(
          job.project_id,
          { id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
          { title: a.title, body: a.body, url: a.click_url || "/", actions },
          attrs
        );
        status = ok ? "sent" : "failed";
      }
      if (status === "sent") sent++;
      else skipped++;

      await admin.from("automation_log").insert({
        project_id: job.project_id,
        source: "event",
        automation_id: job.automation_id,
        subscriber_id: job.subscriber_id,
        title: a?.title ?? null,
        status,
        recipients: 1,
      });
    }

    if (due.length < BATCH) break; // допили всё, что было готово
  }

  return NextResponse.json({ due: totalDue, sent, skipped });
}
