import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePath } from "@/lib/jsonpath";
import { phonesToSubscriberIds } from "@/lib/identity";
import { logApiCall } from "@/lib/apiLog";

// POST /api/v1/attribute — order-attribution intake (last-click). Separate from
// /api/v1/trigger on purpose: this endpoint records revenue, it never sends a push.
//
// The cookie our own tracking script sets (see embed widget) encodes
// "<campaignId>.<timestampMs>". InSales captures ANY cookie the merchant lists
// under Настройки → /admin2/checkout → «Список cookies, которые требуется
// сохранить при оформлении заказа» into the order body at cookies.<name> —
// confirmed against a real order payload. So the path is always
// `cookies.<attribution_cookie_name>`, never a merchant-specific guess —
// the merchant just has to list the SAME name there as configured below.
export async function POST(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("attribution_enabled, attribution_cookie_name, attribution_window_days, attribution_order_id_path, attribution_revenue_path")
    .eq("id", projectId)
    .single();

  if (!project?.attribution_enabled) return NextResponse.json({ ok: true, skipped: "attribution disabled" });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const cookieName = project.attribution_cookie_name || "pss_attr";
  const cookieVal = String(resolvePath(body, `cookies.${cookieName}`) ?? "");
  const dot = cookieVal.lastIndexOf(".");
  if (dot < 0) return NextResponse.json({ ok: true, skipped: "no attribution cookie in payload" });

  const campaignId = cookieVal.slice(0, dot);
  const clickedAt = Number(cookieVal.slice(dot + 1));
  if (!campaignId || !Number.isFinite(clickedAt)) {
    await logApiCall(admin, projectId, "attribute", false, "malformed cookie", {});
    return NextResponse.json({ ok: true, skipped: "malformed cookie" });
  }

  const windowMs = (project.attribution_window_days || 7) * 86_400_000;
  if (Date.now() - clickedAt > windowMs) {
    return NextResponse.json({ ok: true, skipped: "outside attribution window" });
  }

  const { data: campaign } = await admin
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!campaign) {
    await logApiCall(admin, projectId, "attribute", false, "campaign not found", { campaignId });
    return NextResponse.json({ ok: true, skipped: "campaign not found" });
  }

  const orderNumber = String(resolvePath(body, project.attribution_order_id_path || "number") ?? "");
  const revenue = Number(resolvePath(body, project.attribution_revenue_path || "total_price") ?? 0) || 0;

  // best-effort: resolve the customer's device for record-keeping (not required)
  let subscriberId: string | null = null;
  const phone = String(resolvePath(body, "client.phone") ?? resolvePath(body, "phone") ?? "");
  if (phone) {
    const ids = await phonesToSubscriberIds(projectId, [phone]);
    subscriberId = ids[0] ?? null;
  }

  await admin.from("order_attributions").insert({
    project_id: projectId,
    campaign_id: campaign.id,
    subscriber_id: subscriberId,
    order_number: orderNumber || null,
    revenue,
    raw_cookie: cookieVal,
  });

  await logApiCall(admin, projectId, "attribute", true, null, { campaignId, orderNumber, revenue });
  return NextResponse.json({ ok: true, recorded: true, campaignId, revenue });
}
