import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Public click/event tracking, called from the service worker on notificationclick.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  const { type, campaignId, subscriberId } = (await req.json().catch(() => ({}))) as {
    type?: string;
    campaignId?: string;
    subscriberId?: string;
  };

  if (type !== "clicked" || !campaignId) {
    return NextResponse.json({ ok: false }, { status: 400, headers: CORS });
  }

  const admin = createAdminClient();

  // resolve project for the event row + bump the campaign's click counter
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, project_id, clicked_count")
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaign) return NextResponse.json({ ok: false }, { status: 404, headers: CORS });

  await admin.from("push_events").insert({
    project_id: campaign.project_id,
    campaign_id: campaignId,
    subscriber_id: subscriberId || null,
    type: "clicked",
  });

  await admin
    .from("campaigns")
    .update({ clicked_count: (campaign.clicked_count || 0) + 1 })
    .eq("id", campaignId);

  return NextResponse.json({ ok: true }, { headers: CORS });
}
