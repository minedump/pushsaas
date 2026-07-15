import { createAdminClient } from "@/lib/supabase/admin";
import { sendPush, type PushPayload } from "@/lib/webpush";
import { applyTemplate } from "@/lib/template";

export type PushAction = { title: string; url: string };

type CampaignRow = {
  id: string;
  project_id: string;
  title: string;
  body: string;
  icon_url: string | null;
  image_url: string | null;
  click_url: string | null;
  segment_tags: string[] | null;
  actions?: PushAction[] | null;
};

export type DispatchResult = { ok: boolean; delivered: number; failed: number; total: number; error?: string };

// Best-effort: drops subscribers with paused=true from an already-fetched list.
// If the `paused` column doesn't exist yet (migration 0009 not applied), the
// probe query errors and we simply exclude nobody — old behaviour, no crash.
async function excludePaused<T extends { id: string }>(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  list: T[] | null
): Promise<T[] | null> {
  if (!list?.length) return list;
  const { data: pausedRows, error } = await admin
    .from("subscribers")
    .select("id")
    .eq("project_id", projectId)
    .eq("paused", true)
    .in("id", list.map((s) => s.id));
  if (error || !pausedRows?.length) return list;
  const paused = new Set(pausedRows.map((r) => r.id));
  return list.filter((s) => !paused.has(s.id));
}

// Sends an existing campaign row to its audience. Shared by the immediate send
// route, the scheduled-send cron, and the client API. Handles atomic balance
// spend (tariff→package), 410 pruning, failure refunds, and count updates.
// subscriberIds — адресная аудитория (отправка по телефону через API v1);
// перекрывает сегментацию по тегам.
export async function dispatchCampaign(campaign: CampaignRow, subscriberIds?: string[]): Promise<DispatchResult> {
  const admin = createAdminClient();

  let q = admin
    .from("subscribers")
    .select("id, endpoint, p256dh, auth, attributes")
    .eq("project_id", campaign.project_id)
    .eq("is_active", true);
  if (subscriberIds?.length) q = q.in("id", subscriberIds);
  else if (campaign.segment_tags && campaign.segment_tags.length) q = q.overlaps("tags", campaign.segment_tags);
  const { data: subsRaw } = await q;

  // best-effort exclusion of paused subscribers — a SEPARATE query, so a
  // not-yet-migrated `paused` column degrades to "nobody paused" instead of
  // erroring (and silently zeroing) the whole audience query above.
  const subs = await excludePaused(admin, campaign.project_id, subsRaw);

  if (!subs?.length) {
    await admin.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", campaign.id);
    return { ok: true, delivered: 0, failed: 0, total: 0 };
  }

  const { data: secret } = await admin
    .from("project_secrets")
    .select("vapid_private_key")
    .eq("project_id", campaign.project_id)
    .single();
  const { data: project } = await admin
    .from("projects")
    .select("vapid_public_key")
    .eq("id", campaign.project_id)
    .single();

  if (!secret?.vapid_private_key || !project?.vapid_public_key) {
    await admin.from("campaigns").update({ status: "failed" }).eq("id", campaign.id);
    return { ok: false, delivered: 0, failed: 0, total: subs.length, error: "no vapid keys" };
  }

  const { data: covered } = await admin.rpc("spend_pushes", { p_project_id: campaign.project_id, p_count: subs.length });
  if (!covered) {
    await admin.from("campaigns").update({ status: "failed" }).eq("id", campaign.id);
    return { ok: false, delivered: 0, failed: 0, total: subs.length, error: "insufficient balance" };
  }

  const vapid = { publicKey: project.vapid_public_key, privateKey: secret.vapid_private_key };
  const api = process.env.NEXT_PUBLIC_APP_URL || "";
  let delivered = 0;
  let failed = 0;
  const dead: string[] = [];

  const CONCURRENCY = 20;
  for (let i = 0; i < subs.length; i += CONCURRENCY) {
    const chunk = subs.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (s) => {
        const attrs = ((s as { attributes?: Record<string, unknown> }).attributes) || {};
        const payload: PushPayload = {
          title: applyTemplate(campaign.title, attrs),
          body: applyTemplate(campaign.body, attrs),
          icon: campaign.icon_url || undefined,
          image: campaign.image_url || undefined,
          url: applyTemplate(campaign.click_url || "/", attrs) || "/",
          actions: campaign.actions?.length ? campaign.actions : undefined,
          campaignId: campaign.id,
          subscriberId: s.id,
          api,
        };
        try {
          await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, vapid);
          delivered++;
        } catch (err: unknown) {
          failed++;
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) dead.push(s.endpoint);
        }
      })
    );
  }

  if (dead.length) await admin.from("subscribers").update({ is_active: false }).in("endpoint", dead);
  if (failed > 0) await admin.rpc("refund_pushes", { p_project_id: campaign.project_id, p_count: failed });

  await admin
    .from("campaigns")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_count: subs.length,
      delivered_count: delivered,
      failed_count: failed,
    })
    .eq("id", campaign.id);

  return { ok: true, delivered, failed, total: subs.length };
}

// Inserts a campaign row. `actions` (rich-push buttons, migration 0009) is
// attempted first; if the column isn't migrated yet, retries WITHOUT it so
// campaign creation — the core send path, hit by every push — never breaks
// on a not-yet-applied migration. Shared by every campaign-creating caller.
export async function insertCampaign(
  admin: ReturnType<typeof createAdminClient>,
  row: {
    project_id: string;
    title: string;
    body: string;
    icon_url: string | null;
    image_url: string | null;
    click_url: string | null;
    segment_tags: string[];
    actions: PushAction[];
    status: string;
    scheduled_at?: string | null;
    created_by?: string;
  }
): Promise<CampaignRow | null> {
  const withActions = "id, project_id, title, body, icon_url, image_url, click_url, segment_tags, actions";
  const { data, error } = await admin.from("campaigns").insert(row).select(withActions).single();
  if (!error) return data;

  const { actions, ...withoutActions } = row;
  void actions;
  const { data: fallback } = await admin
    .from("campaigns")
    .insert(withoutActions)
    .select("id, project_id, title, body, icon_url, image_url, click_url, segment_tags")
    .single();
  return fallback ? { ...fallback, actions: [] } : null;
}

// Creates a campaign row from raw content and dispatches it immediately.
// Shared by the client API (/api/v1/send, /api/v1/trigger).
export async function createAndDispatch(
  projectId: string,
  content: {
    title: string;
    body: string;
    icon?: string;
    image?: string;
    url?: string;
    segmentTags?: string[];
    actions?: PushAction[];
  },
  subscriberIds?: string[]
): Promise<DispatchResult> {
  const admin = createAdminClient();
  const campaign = await insertCampaign(admin, {
    project_id: projectId,
    title: content.title,
    body: content.body,
    icon_url: content.icon || null,
    image_url: content.image || null,
    click_url: content.url || null,
    segment_tags: content.segmentTags || [],
    actions: content.actions || [],
    status: "sending",
  });
  if (!campaign) return { ok: false, delivered: 0, failed: 0, total: 0, error: "campaign create failed" };
  return dispatchCampaign(campaign, subscriberIds);
}

// Sends a single one-off push to one subscriber (welcome automation).
// Spends 1 unit; refunds on failure. No campaign row.
export async function sendOneOff(
  projectId: string,
  subscriber: { id: string; endpoint: string; p256dh: string; auth: string },
  content: { title: string; body: string; url?: string; actions?: PushAction[] },
  attrs: Record<string, unknown> = {}
): Promise<boolean> {
  const admin = createAdminClient();

  const { data: secret } = await admin.from("project_secrets").select("vapid_private_key").eq("project_id", projectId).single();
  const { data: project } = await admin.from("projects").select("vapid_public_key").eq("id", projectId).single();
  if (!secret?.vapid_private_key || !project?.vapid_public_key) return false;

  const { data: covered } = await admin.rpc("spend_pushes", { p_project_id: projectId, p_count: 1 });
  if (!covered) return false;

  try {
    await sendPush(
      { endpoint: subscriber.endpoint, keys: { p256dh: subscriber.p256dh, auth: subscriber.auth } },
      {
        title: applyTemplate(content.title, attrs),
        body: applyTemplate(content.body, attrs),
        url: applyTemplate(content.url || "/", attrs) || "/",
        actions: content.actions?.length ? content.actions : undefined,
        subscriberId: subscriber.id,
        api: process.env.NEXT_PUBLIC_APP_URL || "",
      },
      { publicKey: project.vapid_public_key, privateKey: secret.vapid_private_key }
    );
    return true;
  } catch {
    await admin.rpc("refund_pushes", { p_project_id: projectId, p_count: 1 });
    return false;
  }
}
