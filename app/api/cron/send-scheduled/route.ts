import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchCampaign } from "@/lib/sender";

// Dispatches campaigns whose scheduled time has arrived. Protected by CRON_SECRET.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // best-effort: select WITH actions (rich push, migration 0009); if that
  // column isn't migrated yet, fall back to the base columns so scheduled
  // sends for EVERY project don't silently stop firing.
  let due: { id: string; project_id: string; title: string; body: string; icon_url: string | null; image_url: string | null; click_url: string | null; segment_tags: string[] | null; actions?: { title: string; url: string }[] }[] | null = null;
  {
    const { data, error } = await admin
      .from("campaigns")
      .select("id, project_id, title, body, icon_url, image_url, click_url, segment_tags, actions")
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString())
      .limit(50);
    if (!error) due = data;
    else {
      const { data: fallback } = await admin
        .from("campaigns")
        .select("id, project_id, title, body, icon_url, image_url, click_url, segment_tags")
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date().toISOString())
        .limit(50);
      due = (fallback ?? []).map((c) => ({ ...c, actions: [] }));
    }
  }

  const results: Record<string, string> = {};
  for (const c of due ?? []) {
    // claim it first so a concurrent run can't double-send
    await admin.from("campaigns").update({ status: "sending" }).eq("id", c.id);
    const r = await dispatchCampaign(c);
    results[c.id] = r.ok ? `sent ${r.delivered}/${r.total}` : r.error || "failed";
  }

  return NextResponse.json({ processed: Object.keys(results).length, results });
}
