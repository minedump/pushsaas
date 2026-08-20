import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAndDispatch } from "@/lib/sender";
import { phonesToSubscriberIds, captureEmailForPhone } from "@/lib/identity";
import { normalizePhone } from "@/lib/phone";
import { resolvePath } from "@/lib/jsonpath";
import { applyTemplatePaths } from "@/lib/template";

// Universal trigger — one endpoint for API calls AND platform webhooks.
// Auth: Bearer / X-Api-Key / ?key= / Basic-in-URL.
// The whole request body becomes Liquid scope for the automation's
// title/body/url: any top-level field is a bare variable ({{ client_phone }}),
// nested/array access goes through {{ data.client.phone }} / {{ data.items[0] }},
// with the full filter set (where/first/map/...) for array lookups.
//
// The paths (phone / status match / order id) are configured ON THE AUTOMATION
// (config.phone_path, config.status_field, config.status_value, config.order_id_path),
// so the webhook URL stays clean: ?key=…&automation=order_shipped
// Any of them can be overridden per-call via query params below.
//   automation=<key>          which automation (also body.key)
//   when=<path>=<value>       condition override (else config.status_field/value)
//   phone_path=<path>         recipient override (else config.phone_path); empty = broadcast
//   segment=<tag>             broadcast segment; also segment_path (config) / body.segmentTags
//   map=<name>=<path>;...      extra template vars from arbitrary paths
//   dedupe=<path>[,<path>]     idempotency override (else built from config)
export async function POST(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const automationKey = q.get("automation") || (body.key as string) || "";
  if (!automationKey) return NextResponse.json({ error: "automation key required" }, { status: 400 });

  const admin = createAdminClient();

  const { data: proj } = await admin.from("projects").select("is_active").eq("id", projectId).single();
  if (!proj?.is_active) return NextResponse.json({ error: "project blocked" }, { status: 402 });

  // automation carries both the message and the webhook path settings
  const { data: automation } = await admin
    .from("automations")
    .select("id, title, body, click_url, config")
    .eq("project_id", projectId)
    .eq("is_enabled", true)
    .eq("config->>key", automationKey)
    .maybeSingle();
  if (!automation?.title || !automation?.body) {
    return NextResponse.json({ error: "automation not found or disabled" }, { status: 404 });
  }
  const cfg = (automation.config || {}) as {
    transactional?: boolean;
    phone_path?: string;
    status_field?: string;
    status_value?: string;
    order_id_path?: string;
    segment_path?: string;
    email_path?: string;
    actions?: { title: string; url: string }[];
  };

  // condition: query `when` overrides the automation's status match
  let statusField = "";
  let statusValue = "";
  const when = q.get("when");
  if (when) {
    const eq = when.indexOf("=");
    statusField = when.slice(0, eq);
    statusValue = when.slice(eq + 1);
  } else if (cfg.status_field && cfg.status_value) {
    statusField = cfg.status_field;
    statusValue = cfg.status_value;
  }
  if (statusField && String(resolvePath(body, statusField) ?? "") !== statusValue) {
    return NextResponse.json({ ok: true, skipped: "status not matched" });
  }

  // `map` names arbitrary paths (incl. array find-by-property, via
  // lib/jsonpath's own bracket syntax: fields[name=Трек].value) as short
  // top-level Liquid variables — optional, since the full body is already
  // reachable in the message as {{ data.<path> }} without it.
  const named: Record<string, unknown> = {};
  const map = q.get("map");
  if (map) {
    for (const pair of map.split(";")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      named[pair.slice(0, eq).trim()] = resolvePath(body, pair.slice(eq + 1).trim());
    }
  }

  // idempotency: query override, else composite (order id + matched status)
  let dedupeVal = "";
  const dedupeSpec = q.get("dedupe");
  if (dedupeSpec) {
    dedupeVal = dedupeSpec.split(",").map((p) => String(resolvePath(body, p.trim()) ?? "")).join("|");
  } else if (cfg.order_id_path) {
    const parts = [String(resolvePath(body, cfg.order_id_path) ?? "")];
    if (statusField) parts.push(statusValue);
    dedupeVal = parts.join("|");
  }
  if (dedupeVal) {
    const { data: prior } = await admin
      .from("automation_log")
      .select("id")
      .eq("project_id", projectId)
      .contains("detail", { key: automationKey, dedupe: dedupeVal })
      .limit(1);
    if (prior?.length) return NextResponse.json({ ok: true, skipped: "already fired" });
  }

  // recipient resolution:
  //   phone in body            -> targeted to that customer's devices
  //   no phone + transactional -> skip (never broadcast an order message to all)
  //   no phone + broadcast     -> segment (body path / ?segment= / body.segmentTags) or all
  let subscriberIds: string[] | undefined;
  let segmentTags: string[] | undefined;

  const phonePath = q.get("phone_path") ?? cfg.phone_path;
  const phone = phonePath ? String(resolvePath(body, phonePath) ?? "") : "";
  if (phone) {
    subscriberIds = await phonesToSubscriberIds(projectId, [phone]);
    if (!subscriberIds.length) return NextResponse.json({ ok: true, skipped: "no linked device" });

    // обогащение профиля: email рядом с телефоном (по настроенному пути или
    // типичным местам client.email/email) сам попадает в identities —
    // это и есть "механика получения email" для будущего таргетинга по нему.
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone) {
      const emailVal = cfg.email_path
        ? resolvePath(body, cfg.email_path)
        : resolvePath(body, "client.email") ?? resolvePath(body, "email");
      if (emailVal) await captureEmailForPhone(projectId, normalizedPhone, String(emailVal));
    }
  } else if (cfg.transactional) {
    return NextResponse.json({ ok: true, skipped: "no phone (transactional)" });
  } else {
    const segPath = q.get("segment_path") ?? cfg.segment_path;
    const fromPath = segPath ? resolvePath(body, segPath) : undefined;
    segmentTags = q.get("segment")
      ? [q.get("segment") as string]
      : Array.isArray(fromPath)
        ? (fromPath as unknown[]).map(String)
        : fromPath != null && fromPath !== ""
          ? [String(fromPath)]
          : Array.isArray(body.segmentTags)
            ? (body.segmentTags as string[])
            : undefined;
  }

  const result = await createAndDispatch(
    projectId,
    {
      title: applyTemplatePaths(automation.title, body, named),
      body: applyTemplatePaths(automation.body, body, named),
      url: applyTemplatePaths(automation.click_url || "", body, named) || undefined,
      segmentTags: subscriberIds ? undefined : segmentTags,
      actions: cfg.actions,
      type: cfg.transactional ? "transactional" : "marketing",
    },
    subscriberIds
  );

  await admin.from("automation_log").insert({
    project_id: projectId,
    source: q.get("key") ? "webhook" : "api",
    automation_id: automation.id,
    subscriber_id: subscriberIds?.[0] ?? null,
    title: applyTemplatePaths(automation.title, body, named),
    status: result.ok ? "sent" : "failed",
    recipients: result.total,
    detail: { key: automationKey, ...(dedupeVal ? { dedupe: dedupeVal } : {}) },
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 402 });
  return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
}
