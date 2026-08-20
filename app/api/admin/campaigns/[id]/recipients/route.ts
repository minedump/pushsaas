import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/admin/campaigns/[id]/recipients?projectId=...  -> CSV со статусом
// отправки по каждому адресату (campaign_recipients, миграция 0023) — раньше
// был виден только агрегат delivered_count/failed_count на кампании в целом.
//
// clicked_at (миграция 0024) — персонально по каждому получателю, для всех
// трёх каналов: push узнаётся по subscriber_id (contact и есть id
// подписчика), sms/email — по персональному token в ?pss_r=... (см.
// lib/sender.injectClickTracking, app/api/public/track). Плюс сводка по
// кампании сверху (clicked/ctr), чтобы итог был виден сразу, не только по
// построчному clicked.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await ctx.params;
  const projectId = new URL(req.url).searchParams.get("projectId") || "";
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, title, channel, sent_count, delivered_count, failed_count, clicked_count, opened_count")
    .eq("id", campaignId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Рассылка не найдена" }, { status: 404 });

  const { data: rows } = await admin
    .from("campaign_recipients")
    .select("channel, contact, status, clicked_at, opened_at, created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  const ctr = campaign.delivered_count ? Math.round(((campaign.clicked_count || 0) / campaign.delivered_count) * 100) : 0;
  const summary = [
    ["campaign", campaign.title].map(csvEscape).join(","),
    ["sent", campaign.sent_count].map(csvEscape).join(","),
    ["delivered", campaign.delivered_count].map(csvEscape).join(","),
    ["failed", campaign.failed_count].map(csvEscape).join(","),
    ["clicked", campaign.clicked_count || 0].map(csvEscape).join(","),
    ["ctr", `${ctr}%`].map(csvEscape).join(","),
    // opened — только у email (пиксель открытия, см. injectOpenPixel в
    // lib/sender.ts); у push/sms открытие технически не отслеживается.
    ...(campaign.channel === "email" ? [["opened", campaign.opened_count || 0].map(csvEscape).join(",")] : []),
    "",
  ];

  const header = campaign.channel === "email" ? ["channel", "contact", "status", "clicked", "opened", "created_at"] : ["channel", "contact", "status", "clicked", "created_at"];
  const lines = [...summary, header.join(",")];
  for (const r of rows ?? []) {
    const row =
      campaign.channel === "email"
        ? [r.channel, r.contact, r.status, r.clicked_at ? "да" : "нет", r.opened_at ? "да" : "нет", r.created_at]
        : [r.channel, r.contact, r.status, r.clicked_at ? "да" : "нет", r.created_at];
    lines.push(row.map(csvEscape).join(","));
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campaign-${campaignId}-recipients.csv"`,
    },
  });
}
