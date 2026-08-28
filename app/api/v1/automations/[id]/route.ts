import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAutomationTemplates, normalizeStatusChecks, toAutomation, AUTOMATION_SELECT } from "@/lib/automations";
import { validateSchedule, computeNextFireAt } from "@/lib/recurring";
import { logApiCall } from "@/lib/apiLog";

// GET /api/v1/automations/{id} — полная карточка одной автоматизации, та же
// форма, что и элемент списка GET /api/v1/automations.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { id } = await params;

  const admin = createAdminClient();
  const { data } = await admin.from("automations").select(AUTOMATION_SELECT).eq("id", id).eq("project_id", projectId).maybeSingle();
  if (!data) return NextResponse.json({ error: "automation not found" }, { status: 404 });
  return NextResponse.json(toAutomation(data));
}

// DELETE /api/v1/automations/{id} — удаляет автоматизацию безвозвратно
// (welcome/event — снимаются с очереди automation_jobs автоматически, там
// нет отдельного шага отмены; custom — вебхук перестаёт находить её и вернёт
// 404 при следующем вызове).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { id } = await params;

  const admin = createAdminClient();
  const { data: existing } = await admin.from("automations").select("id").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "automation not found" }, { status: 404 });

  const { error } = await admin.from("automations").delete().eq("id", id).eq("project_id", projectId);
  if (error) return NextResponse.json({ error: "delete failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// PUT /api/v1/automations/{id} — редактирует существующую автоматизацию,
// частичное обновление (поле не передано в теле — не трогаем сохранённое).
// type менять нельзя — правьте соответствующие типу поля, см. GET /api/v1/docs.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { id } = await params;

  const admin = createAdminClient();
  const { data: existing } = await admin.from("automations").select(AUTOMATION_SELECT).eq("id", id).eq("project_id", projectId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "automation not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const {
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

  const row: Record<string, unknown> = {};

  if (name !== undefined) {
    if (!String(name ?? "").trim()) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    row.name = String(name).trim();
  }
  if (isEnabled !== undefined) row.is_enabled = !!isEnabled;
  if (isTransactional !== undefined) row.is_transactional = !!isTransactional;

  // Содержимое — если пришёл хоть один из этих четырёх параметров (или
  // сменился isTransactional — влияет на то, обязательна ли {{ unsubscribe_url }}),
  // пересобирается заново целиком (та же семантика, что при создании), с
  // недостающими значениями, взятыми из уже сохранённых.
  const effectiveTransactional = isTransactional !== undefined ? !!isTransactional : !!existing.is_transactional;
  const contentFieldsGiven = cascade !== undefined || channel !== undefined || templateId !== undefined || channelTemplates !== undefined || isTransactional !== undefined;
  const effectiveCascade = cascade !== undefined ? !!cascade : !!existing.cascade;
  if (contentFieldsGiven) {
    const resolved = await resolveAutomationTemplates(admin, projectId, {
      cascade: effectiveCascade,
      channel: channel !== undefined ? channel : existing.channel,
      templateId: templateId !== undefined ? templateId : existing.template_id,
      channelTemplates: channelTemplates !== undefined ? channelTemplates : existing.channel_templates,
      transactional: effectiveTransactional,
    });
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
    Object.assign(row, resolved.row);
  }
  if (provider !== undefined || contentFieldsGiven) {
    const effProvider = provider !== undefined ? provider : existing.provider;
    row.provider = !effectiveCascade && effProvider ? String(effProvider) : null;
  }

  if (platforms !== undefined) {
    const effChannelTemplates = (contentFieldsGiven ? (row.channel_templates as Record<string, unknown>) : existing.channel_templates) || {};
    const effChannel = contentFieldsGiven ? (row.channel as string) : existing.channel;
    const pushApplicable = effectiveCascade ? !!effChannelTemplates.push : effChannel === "push";
    const platformsArr = Array.isArray(platforms) ? platforms : [];
    row.platforms = pushApplicable && platformsArr.length && platformsArr.length < 3 ? platformsArr : [];
  }

  if (sendWindow !== undefined && sendWindow && typeof sendWindow === "object") {
    row.send_window_enabled = !!sendWindow.enabled;
    row.send_days = sendWindow.enabled && Array.isArray(sendWindow.days) && sendWindow.days.length ? sendWindow.days : null;
    row.send_time_from = sendWindow.enabled ? sendWindow.timeFrom || null : null;
    row.send_time_to = sendWindow.enabled ? sendWindow.timeTo || null : null;
    row.send_window_subscriber_tz = !!sendWindow.subscriberTz;
  }
  if (spacing !== undefined && spacing && typeof spacing === "object") {
    row.spacing_enabled = !!spacing.enabled;
    row.spacing_minutes = spacing.enabled && spacing.minutes ? Number(spacing.minutes) : null;
  }

  if (existing.type === "welcome" || existing.type === "event") {
    if (segmentTags !== undefined) row.segment_tags = Array.isArray(segmentTags) ? segmentTags : [];
    if (respectsPriority !== undefined) row.respects_priority = !!respectsPriority;
    if (delayMinutes !== undefined) {
      const min = existing.type === "event" ? 1 : 0;
      row.delay_minutes = Number.isFinite(delayMinutes) ? Math.max(min, Math.round(delayMinutes)) : existing.delay_minutes;
    }
  }

  if (existing.type === "event" && (triggerEvent !== undefined || cancelEvents !== undefined)) {
    const cfg = { ...((existing.config as Record<string, unknown>) || {}) };
    if (triggerEvent !== undefined) {
      if (!String(triggerEvent ?? "").trim()) return NextResponse.json({ error: "triggerEvent cannot be empty" }, { status: 400 });
      cfg.trigger_event = String(triggerEvent).trim();
    }
    if (cancelEvents !== undefined) {
      cfg.cancel_events = Array.isArray(cancelEvents) ? cancelEvents.filter((s: unknown) => typeof s === "string" && s.trim()).map((s: string) => s.trim()) : [];
    }
    row.config = cfg;
  }

  if (existing.type === "recurring") {
    if (segmentTags !== undefined) row.segment_tags = Array.isArray(segmentTags) ? segmentTags : [];
    if (schedule !== undefined) {
      const scheduleResult = validateSchedule(schedule);
      if (!scheduleResult.ok) return NextResponse.json({ error: scheduleResult.error }, { status: 400 });
      const { data: project } = await admin.from("projects").select("timezone").eq("id", projectId).maybeSingle();
      row.config = { schedule: scheduleResult.schedule };
      row.next_fire_at = computeNextFireAt(scheduleResult.schedule, project?.timezone || "Europe/Moscow", new Date()).toISOString();
    }
  }

  if (existing.type === "custom") {
    const customFieldsGiven =
      recipientMode !== undefined ||
      key !== undefined ||
      phonePath !== undefined ||
      emailPath !== undefined ||
      externalIdPath !== undefined ||
      orderIdPath !== undefined ||
      segmentPath !== undefined ||
      productIdPath !== undefined ||
      listType !== undefined ||
      trackFieldPath !== undefined ||
      trackMode !== undefined ||
      statusChecks !== undefined;

    if (customFieldsGiven) {
      const cfg = (existing.config as Record<string, unknown>) || {};
      const mode = recipientMode !== undefined ? recipientMode : cfg.list_fanout ? "fanout" : cfg.transactional ? "phone" : "segment";
      if (mode !== "phone" && mode !== "segment" && mode !== "fanout") {
        return NextResponse.json({ error: "recipientMode must be phone, segment or fanout" }, { status: 400 });
      }
      const trimmedKey = key !== undefined ? String(key ?? "").trim() : String(cfg.key || "");
      if (!trimmedKey) return NextResponse.json({ error: "key cannot be empty" }, { status: 400 });
      if (trimmedKey !== cfg.key) {
        const { data: keyTaken } = await admin
          .from("automations")
          .select("id")
          .eq("project_id", projectId)
          .eq("type", "custom")
          .eq("config->>key", trimmedKey)
          .neq("id", id)
          .maybeSingle();
        if (keyTaken) return NextResponse.json({ error: "an automation with this key already exists", id: keyTaken.id }, { status: 409 });
      }

      const checks = statusChecks !== undefined ? normalizeStatusChecks(statusChecks) : (cfg.status_checks as unknown[]) || [];
      const newCfg: Record<string, unknown> = { key: trimmedKey, transactional: mode === "phone" };
      if (mode === "phone") {
        newCfg.phone_path = String(phonePath !== undefined ? phonePath : cfg.phone_path || "").trim() || undefined;
        newCfg.email_path = String(emailPath !== undefined ? emailPath : cfg.email_path || "").trim() || undefined;
        newCfg.external_id_path = String(externalIdPath !== undefined ? externalIdPath : cfg.external_id_path || "").trim() || undefined;
        newCfg.order_id_path = String(orderIdPath !== undefined ? orderIdPath : cfg.order_id_path || "").trim() || undefined;
        newCfg.status_checks = checks;
      } else if (mode === "segment") {
        newCfg.segment_path = String(segmentPath !== undefined ? segmentPath : cfg.segment_path || "").trim() || undefined;
        newCfg.status_checks = checks;
      } else {
        newCfg.list_fanout = true;
        newCfg.product_id_path = String(productIdPath !== undefined ? productIdPath : cfg.product_id_path || "product_id").trim() || "product_id";
        newCfg.list_type = String(listType !== undefined ? listType : cfg.list_type || "any").trim() || "any";
        newCfg.status_checks = checks;
        const trackField = String(trackFieldPath !== undefined ? trackFieldPath : cfg.track_field_path || "").trim();
        if (trackField) {
          newCfg.track_field_path = trackField;
          const tm = trackMode !== undefined ? trackMode : cfg.track_mode;
          newCfg.track_mode = tm === "increased" || tm === "decreased" ? tm : "changed";
        }
      }
      row.config = newCfg;
    }
  }

  const { error } = await admin.from("automations").update(row).eq("id", id).eq("project_id", projectId);
  if (error) {
    const responseBody = { error: "update failed" };
    await logApiCall(admin, projectId, "automations", 500, body, responseBody);
    return NextResponse.json(responseBody, { status: 500 });
  }

  const responseBody = { ok: true, id };
  await logApiCall(admin, projectId, "automations", 200, body, responseBody);
  return NextResponse.json(responseBody);
}
