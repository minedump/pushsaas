import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchCampaign, dispatchSmsCampaign, dispatchEmailCampaign, resolveChannelProvider } from "@/lib/sender";
import { hasUnsubscribeTag } from "@/lib/unsubscribeTag";

// Dispatches campaigns whose scheduled time has arrived. Protected by CRON_SECRET.
// Все три канала (push/sms/email) поддерживают планирование — не только push.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // best-effort: select WITH actions/badge_url/template_data; if any of
  // those columns isn't migrated yet, fall back to the base columns so
  // scheduled sends for EVERY project don't silently stop firing.
  let due:
    | {
        id: string;
        project_id: string;
        channel?: "push" | "sms" | "email";
        title: string;
        body: string;
        subject?: string | null;
        html_body?: string | null;
        icon_url: string | null;
        image_url: string | null;
        click_url: string | null;
        badge_url?: string | null;
        provider?: string | null;
        segment_tags: string[] | null;
        actions?: { title: string; url: string }[];
        template_data?: Record<string, unknown> | null;
        type?: "transactional" | "marketing";
        contacts?: string[] | null;
      }[]
    | null = null;
  {
    const { data, error } = await admin
      .from("campaigns")
      .select(
        "id, project_id, channel, title, body, subject, html_body, icon_url, image_url, click_url, badge_url, provider, segment_tags, actions, template_data, type, contacts"
      )
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString())
      .limit(50);
    if (!error) due = data;
    else {
      const { data: fallback } = await admin
        .from("campaigns")
        .select("id, project_id, title, body, icon_url, image_url, click_url, segment_tags, type")
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

    if (c.channel === "sms" || c.channel === "email") {
      if (c.channel === "email" && c.type !== "transactional" && !hasUnsubscribeTag(c.html_body || "")) {
        await admin.from("campaigns").update({ status: "failed" }).eq("id", c.id);
        results[c.id] = "unsubscribe link required";
        continue;
      }
      let provider = c.provider || null;
      if (!provider) {
        provider = await resolveChannelProvider(admin, c.project_id, c.channel, null, c.type === "transactional" ? "transactional" : "marketing");
        if (!provider) {
          await admin.from("campaigns").update({ status: "failed" }).eq("id", c.id);
          results[c.id] = "no provider configured";
          continue;
        }
        await admin.from("campaigns").update({ provider }).eq("id", c.id);
      }
      const row = {
        ...c,
        channel: c.channel,
        provider,
        subject: c.subject ?? null,
        html_body: c.html_body ?? null,
        type: c.type === "transactional" ? ("transactional" as const) : ("marketing" as const),
      };
      const r = c.channel === "sms" ? await dispatchSmsCampaign(row) : await dispatchEmailCampaign(row);
      results[c.id] = r.ok ? `sent ${r.delivered}/${r.total}` : r.error || "failed";
      continue;
    }

    const r = await dispatchCampaign(c);
    results[c.id] = r.ok ? `sent ${r.delivered}/${r.total}` : r.error || "failed";
  }

  return NextResponse.json({ processed: Object.keys(results).length, results });
}
