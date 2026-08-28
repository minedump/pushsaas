import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAutomationTemplates, normalizeStatusChecks, toAutomation, AUTOMATION_SELECT } from "@/lib/automations";
import { validateSchedule, computeNextFireAt } from "@/lib/recurring";
import { logApiCall } from "@/lib/apiLog";

// GET /api/v1/automations?type=&channel=&enabled=   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
//
// Список автоматизаций проекта (раздел «Автоматизации»), новые первыми.
// ?type=welcome|event|custom|recurring, ?channel=push|sms|email,
// ?enabled=true|false — необязательные фильтры.
export async function GET(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const type = q.get("type");
  const channel = q.get("channel");
  const enabled = q.get("enabled");

  const admin = createAdminClient();
  let query = admin.from("automations").select(AUTOMATION_SELECT).eq("project_id", projectId).order("created_at", { ascending: false });
  if (type === "welcome" || type === "event" || type === "custom" || type === "recurring") query = query.eq("type", type);
  if (channel === "push" || channel === "sms" || channel === "email") query = query.eq("channel", channel);
  if (enabled === "true") query = query.eq("is_enabled", true);
  if (enabled === "false") query = query.eq("is_enabled", false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ automations: [] });
  return NextResponse.json({ automations: (data || []).map(toAutomation) });
}

// POST /api/v1/automations   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
//
// Создаёт автоматизацию любого из четырёх типов (type — обязательное поле):
// welcome (приветственная — срабатывает на новую подписку/identify), event
// (событийная — срабатывает на sendera.event(), например брошенная корзина),
// custom (триггерная по вебхуку — срабатывает на POST /api/v1/trigger),
// recurring (повторяющаяся — сегменту по календарному расписанию, поле
// schedule обязательно, см. lib/recurring.ts). Полное описание тела запроса
// — GET /api/v1/docs.
//
// channel+templateId ИЛИ cascade:true+channelTemplates — ровно один из двух
// способов задать содержимое, как и в ручном создании. email-содержимое
// обязано иметь {{ unsubscribe_url }} (проверяется до вставки) — кроме
// isTransactional:true (сервисные уведомления, например трек-номер заказа):
// им ссылка отписки не нужна, и получателя не фильтрует его согласие на
// маркетинг по каналу.
export async function POST(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const {
    type,
    name,
    isEnabled,
    channel,
    cascade,
    channelTemplates,
    templateId,
    isTransactional,
    provider,
    platforms,
    segmentTags,
    respectsPriority,
    delayMinutes,
    triggerEvent,
    cancelEvents,
    key,
    recipientMode,
    phonePath,
    emailPath,
    externalIdPath,
    orderIdPath,
    segmentPath,
    productIdPath,
    listType,
    trackFieldPath,
    trackMode,
    statusChecks,
    spacing,
    sendWindow,
    schedule,
  } = body;

  if (type !== "welcome" && type !== "event" && type !== "custom" && type !== "recurring") {
    return NextResponse.json({ error: "type must be welcome, event, custom or recurring" }, { status: 400 });
  }
  if (!String(name ?? "").trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const isCascade = !!cascade;
  const isTransactionalMsg = !!isTransactional;
  const resolved = await resolveAutomationTemplates(admin, projectId, { cascade: isCascade, channel, templateId, channelTemplates, transactional: isTransactionalMsg });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });

  const pushApplicable = isCascade ? !!(channelTemplates && typeof channelTemplates === "object" && (channelTemplates as Record<string, unknown>).push) : channel === "push";
  const platformsArr = Array.isArray(platforms) ? platforms : [];

  const row: Record<string, unknown> = {
    project_id: projectId,
    type,
    name: String(name).trim(),
    is_enabled: isEnabled !== false,
    is_transactional: isTransactionalMsg,
    ...resolved.row,
    provider: !isCascade && provider ? String(provider) : null,
    platforms: pushApplicable && platformsArr.length && platformsArr.length < 3 ? platformsArr : [],
    spacing_enabled: !!(spacing && typeof spacing === "object" && spacing.enabled),
    spacing_minutes: spacing && typeof spacing === "object" && spacing.enabled && spacing.minutes ? Number(spacing.minutes) : null,
    send_window_enabled: !!(sendWindow && typeof sendWindow === "object" && sendWindow.enabled),
    send_days: sendWindow && typeof sendWindow === "object" && sendWindow.enabled && Array.isArray(sendWindow.days) && sendWindow.days.length ? sendWindow.days : null,
    send_time_from: sendWindow && typeof sendWindow === "object" && sendWindow.enabled ? sendWindow.timeFrom || null : null,
    send_time_to: sendWindow && typeof sendWindow === "object" && sendWindow.enabled ? sendWindow.timeTo || null : null,
    send_window_subscriber_tz: !!(sendWindow && typeof sendWindow === "object" && sendWindow.subscriberTz),
  };

  if (type === "welcome") {
    row.delay_minutes = Number.isFinite(delayMinutes) ? Math.max(0, Math.round(delayMinutes)) : 0;
    row.segment_tags = Array.isArray(segmentTags) ? segmentTags : [];
    row.respects_priority = respectsPriority !== false;
    row.config = {};
  } else if (type === "event") {
    if (!String(triggerEvent ?? "").trim()) {
      const responseBody = { error: "triggerEvent required" };
      await logApiCall(admin, projectId, "automations", 400, body, responseBody);
      return NextResponse.json(responseBody, { status: 400 });
    }
    row.delay_minutes = Number.isFinite(delayMinutes) ? Math.max(1, Math.round(delayMinutes)) : 60;
    row.segment_tags = Array.isArray(segmentTags) ? segmentTags : [];
    row.respects_priority = respectsPriority !== false;
    row.config = {
      trigger_event: String(triggerEvent).trim(),
      cancel_events: Array.isArray(cancelEvents) ? cancelEvents.filter((s: unknown) => typeof s === "string" && s.trim()).map((s: string) => s.trim()) : [],
    };
  } else if (type === "custom") {
    // custom (триггерная по вебхуку)
    const trimmedKey = String(key ?? "").trim();
    if (!trimmedKey) {
      const responseBody = { error: "key required" };
      await logApiCall(admin, projectId, "automations", 400, body, responseBody);
      return NextResponse.json(responseBody, { status: 400 });
    }
    if (recipientMode !== "phone" && recipientMode !== "segment" && recipientMode !== "fanout") {
      const responseBody = { error: "recipientMode must be phone, segment or fanout" };
      await logApiCall(admin, projectId, "automations", 400, body, responseBody);
      return NextResponse.json(responseBody, { status: 400 });
    }
    const { data: existing } = await admin.from("automations").select("id").eq("project_id", projectId).eq("type", "custom").eq("config->>key", trimmedKey).maybeSingle();
    if (existing) {
      const responseBody = { error: "an automation with this key already exists", id: existing.id };
      await logApiCall(admin, projectId, "automations", 409, body, responseBody);
      return NextResponse.json(responseBody, { status: 409 });
    }

    const cfg: Record<string, unknown> = { key: trimmedKey, transactional: recipientMode === "phone" };
    const checks = normalizeStatusChecks(statusChecks);
    if (recipientMode === "phone") {
      cfg.phone_path = String(phonePath ?? "").trim() || undefined;
      cfg.email_path = String(emailPath ?? "").trim() || undefined;
      cfg.external_id_path = String(externalIdPath ?? "").trim() || undefined;
      cfg.order_id_path = String(orderIdPath ?? "").trim() || undefined;
      cfg.status_checks = checks;
    } else if (recipientMode === "segment") {
      cfg.segment_path = String(segmentPath ?? "").trim() || undefined;
      cfg.status_checks = checks;
    } else {
      cfg.list_fanout = true;
      cfg.product_id_path = String(productIdPath ?? "").trim() || "product_id";
      cfg.list_type = String(listType ?? "any").trim() || "any";
      cfg.status_checks = checks;
      const trackField = String(trackFieldPath ?? "").trim();
      if (trackField) {
        cfg.track_field_path = trackField;
        cfg.track_mode = trackMode === "increased" || trackMode === "decreased" ? trackMode : "changed";
      }
    }
    row.config = cfg;
    row.segment_tags = [];
    row.delay_minutes = 0;
  } else {
    // recurring — рассылка сегменту по календарному расписанию (см.
    // lib/recurring.ts), а не по активности/вебхуку.
    const scheduleResult = validateSchedule(schedule);
    if (!scheduleResult.ok) {
      const responseBody = { error: scheduleResult.error };
      await logApiCall(admin, projectId, "automations", 400, body, responseBody);
      return NextResponse.json(responseBody, { status: 400 });
    }
    const { data: project } = await admin.from("projects").select("timezone").eq("id", projectId).maybeSingle();
    row.segment_tags = Array.isArray(segmentTags) ? segmentTags : [];
    row.config = { schedule: scheduleResult.schedule };
    row.next_fire_at = computeNextFireAt(scheduleResult.schedule, project?.timezone || "Europe/Moscow", new Date()).toISOString();
  }

  const { data: created, error } = await admin.from("automations").insert(row).select("id").single();
  if (error || !created) {
    const responseBody = { error: error?.message || "create failed" };
    await logApiCall(admin, projectId, "automations", 500, body, responseBody);
    return NextResponse.json(responseBody, { status: 500 });
  }

  const responseBody = { ok: true, id: created.id };
  await logApiCall(admin, projectId, "automations", 201, body, responseBody);
  return NextResponse.json(responseBody, { status: 201 });
}
