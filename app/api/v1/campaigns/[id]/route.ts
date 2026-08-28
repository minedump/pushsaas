import { NextResponse } from "next/server";
import { authenticateApiKeyFull } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePushTemplate, resolveChannelTemplate, mergeTemplateContext, splitTemplateData, type PushAction } from "@/lib/sender";
import { hasUnsubscribeTag } from "@/lib/unsubscribe";
import { withShortenedLinks } from "@/lib/linkPreview";
import { logApiCall } from "@/lib/apiLog";

const FULL_SELECT =
  "id, channel, status, type, initiator, title, body, subject, html_body, icon_url, image_url, click_url, badge_url, segment_tags, platforms, contacts, actions, template_id, template_data, internal_title, scheduled_at, sent_at, sent_count, delivered_count, failed_count, clicked_count, opened_count, error, send_window_enabled, send_days, send_time_from, send_time_to, send_window_subscriber_tz, spacing_enabled, spacing_minutes, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCampaign(c: any) {
  return {
    id: c.id,
    channel: c.channel,
    status: c.status,
    type: c.type,
    initiator: c.initiator,
    internalTitle: c.internal_title,
    title: c.title,
    body: c.body,
    subject: c.subject,
    html: c.html_body,
    url: c.click_url,
    icon: c.icon_url,
    image: c.image_url,
    badge: c.badge_url,
    actions: c.actions || [],
    segmentTags: c.segment_tags || [],
    platforms: c.platforms || [],
    contacts: c.contacts || [],
    templateId: c.template_id,
    templateData: c.template_data,
    scheduledAt: c.scheduled_at,
    sentAt: c.sent_at,
    error: c.error,
    sentCount: c.sent_count,
    deliveredCount: c.delivered_count,
    failedCount: c.failed_count,
    clickedCount: c.clicked_count,
    openedCount: c.opened_count,
    sendWindow: {
      enabled: !!c.send_window_enabled,
      days: c.send_days,
      timeFrom: c.send_time_from,
      timeTo: c.send_time_to,
      subscriberTz: !!c.send_window_subscriber_tz,
    },
    spacing: { enabled: !!c.spacing_enabled, minutes: c.spacing_minutes },
    createdAt: c.created_at,
  };
}

// GET /api/v1/campaigns/{id} — полная информация об одной рассылке, включая
// статистику отправки (для черновика/запланированной счётчики нулевые — она
// ещё не уходила).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateApiKeyFull(req);
  if (!key) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { id: campaignId } = await params;

  const admin = createAdminClient();
  const { data } = await admin.from("campaigns").select(FULL_SELECT).eq("id", campaignId).eq("project_id", key.projectId).maybeSingle();
  if (!data) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  return NextResponse.json(toCampaign(data));
}

// DELETE /api/v1/campaigns/{id} — удаляет черновик или запланированную
// рассылку безвозвратно. Отправленную/отправляющуюся удалить нельзя (400) —
// история рассылок и статистика не должны исчезать задним числом.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateApiKeyFull(req);
  if (!key) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { projectId } = key;
  const { id: campaignId } = await params;

  const admin = createAdminClient();
  const { data: campaign } = await admin.from("campaigns").select("id, status").eq("id", campaignId).eq("project_id", projectId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    return NextResponse.json({ error: "only a draft or scheduled campaign can be deleted" }, { status: 400 });
  }

  const { error } = await admin.from("campaigns").delete().eq("id", campaignId).eq("project_id", projectId);
  if (error) return NextResponse.json({ error: "delete failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// PUT /api/v1/campaigns/{id} — редактирует ранее созданный черновик или
// запланированную рассылку (любым способом — через API или вручную),
// отправленную/отправляющуюся редактировать нельзя. Частичное обновление —
// поле не передано в теле = не трогаем то, что уже сохранено. Та же форма
// тела, что и у POST /api/v1/campaigns (минус channel — канал рассылки при
// редактировании не меняется), см. GET /api/v1/docs.
//
// draft/scheduledAt меняют статус (черновик ⇄ запланированная) — если ни то,
// ни другое не передано, статус остаётся как есть.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateApiKeyFull(req);
  if (!key) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { projectId } = key;
  const { id: campaignId } = await params;

  const admin = createAdminClient();
  const { data: proj } = await admin.from("projects").select("is_active").eq("id", projectId).single();
  if (!proj?.is_active) return NextResponse.json({ error: "project blocked" }, { status: 402 });

  const { data: campaign } = await admin
    .from("campaigns")
    .select(
      "id, channel, status, title, body, subject, html_body, icon_url, image_url, click_url, badge_url, segment_tags, platforms, actions, template_id, template_data, type, internal_title, contacts, scheduled_at, send_window_enabled, send_days, send_time_from, send_time_to, send_window_subscriber_tz, spacing_enabled, spacing_minutes"
    )
    .eq("id", campaignId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    return NextResponse.json({ error: "only a draft or scheduled campaign can be edited" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    title,
    body: pushBody,
    url,
    icon,
    image,
    badge,
    text,
    subject,
    html,
    templateId,
    templateData,
    segmentTags,
    platforms,
    phones,
    phone,
    emails,
    email,
    contacts,
    actions,
    type,
    draft,
    scheduledAt,
    internalTitle,
    sendWindow,
    spacing,
  } = body;

  const channel: "push" | "sms" | "email" = campaign.channel || "push";
  const row: Record<string, unknown> = {};

  // Аудитория — набор целиком заменяется, если передан хоть один из этих
  // параметров, а не сливается со старым (та же семантика, что и «Контакты»
  // в форме редактирования — новый список, а не дополнение к старому).
  const contactFieldsGiven = contacts !== undefined || phones !== undefined || phone !== undefined || emails !== undefined || email !== undefined;
  if (contactFieldsGiven) {
    const merged = [
      ...(Array.isArray(contacts) ? contacts : []),
      ...(Array.isArray(phones) ? phones : []),
      ...(phone ? [phone] : []),
      ...(Array.isArray(emails) ? emails : []),
      ...(email ? [email] : []),
    ].filter(Boolean);
    row.contacts = [...new Set(merged)];
  }
  if (segmentTags !== undefined) row.segment_tags = Array.isArray(segmentTags) ? segmentTags : [];
  if (type !== undefined) row.type = type === "transactional" ? "transactional" : "marketing";
  if (internalTitle !== undefined) {
    if (!String(internalTitle ?? "").trim()) return NextResponse.json({ error: "internalTitle cannot be empty" }, { status: 400 });
    row.internal_title = internalTitle;
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

  // Контент — если пришёл templateId, содержимое пересобирается заново из
  // шаблона (прочие поля контента в ЭТОМ ЖЕ вызове побеждают, как и при
  // создании); без templateId отдельные переданные поля просто перезаписывают
  // сохранённые, остальное не трогается.
  if (channel === "push") {
    if (templateId !== undefined || title !== undefined || pushBody !== undefined || url !== undefined || icon !== undefined || image !== undefined || badge !== undefined || actions !== undefined) {
      if (templateId) {
        const resolved = await resolvePushTemplate(admin, projectId, templateId, {
          title,
          body: pushBody,
          icon,
          image,
          url,
          badge,
          actions: Array.isArray(actions) ? (actions.slice(0, 2) as PushAction[]) : undefined,
        });
        row.title = resolved.title;
        row.body = resolved.body;
        row.icon_url = resolved.icon || null;
        row.image_url = resolved.image || null;
        row.click_url = resolved.url || null;
        row.badge_url = resolved.badge || null;
        row.actions = resolved.actions || [];
        row.template_id = templateId;
        const keepContext = splitTemplateData(campaign.template_data as Record<string, unknown> | null).context;
        row.template_data = mergeTemplateContext(resolved.context, templateData !== undefined ? templateData : keepContext);
      } else {
        if (title !== undefined) row.title = title;
        if (pushBody !== undefined) row.body = pushBody;
        if (url !== undefined) row.click_url = url || null;
        if (icon !== undefined) row.icon_url = icon || null;
        if (image !== undefined) row.image_url = image || null;
        if (badge !== undefined) row.badge_url = badge || null;
        if (actions !== undefined) row.actions = Array.isArray(actions) ? actions.slice(0, 2) : [];
      }
    }
    if (templateData !== undefined && row.template_data === undefined) {
      const { template } = splitTemplateData(campaign.template_data as Record<string, unknown> | null);
      row.template_data = mergeTemplateContext(template, templateData);
    }
    if (platforms !== undefined) row.platforms = Array.isArray(platforms) ? platforms : [];

    const finalTitle = (row.title as string | undefined) ?? campaign.title;
    const finalBody = (row.body as string | undefined) ?? campaign.body;
    if (!finalTitle?.trim() || !finalBody?.trim()) {
      return NextResponse.json({ error: "title and body required" }, { status: 400 });
    }
    if (finalTitle.length > 80) return NextResponse.json({ error: "title longer than 80 characters" }, { status: 400 });
    if (withShortenedLinks(finalBody).length > 200) return NextResponse.json({ error: "body longer than 200 characters (after link shortening)" }, { status: 400 });
  } else {
    // sms / email
    if (templateId !== undefined || text !== undefined || subject !== undefined || html !== undefined) {
      const resolved = await resolveChannelTemplate(admin, projectId, channel, templateId || undefined, { subject, html, body: text });
      if (templateId) row.template_id = templateId;
      if (channel === "sms") row.body = resolved.body || "";
      else {
        row.html_body = resolved.html;
        row.subject = resolved.subject;
      }
      const { context: existingContext } = splitTemplateData(campaign.template_data as Record<string, unknown> | null);
      row.template_data = mergeTemplateContext(resolved.context, templateData !== undefined ? templateData : existingContext);
    } else if (templateData !== undefined) {
      const { template } = splitTemplateData(campaign.template_data as Record<string, unknown> | null);
      row.template_data = mergeTemplateContext(template, templateData);
    }

    const finalType = (row.type as string | undefined) ?? campaign.type;
    const finalHtml = (row.html_body as string | null | undefined) ?? campaign.html_body;
    const finalBody = (row.body as string | undefined) ?? campaign.body;
    if (channel === "email") {
      if (!finalHtml?.trim()) return NextResponse.json({ error: "html or templateId required" }, { status: 400 });
      if (finalType === "marketing" && !hasUnsubscribeTag(finalHtml)) {
        return NextResponse.json({ error: "unsubscribe link required" }, { status: 400 });
      }
    } else if (!finalBody?.trim()) {
      return NextResponse.json({ error: "text or templateId required" }, { status: 400 });
    }
  }

  // draft/scheduledAt — если ни то, ни другое не передано, статус не трогаем.
  if (draft === true) {
    row.status = "draft";
    row.scheduled_at = null;
  } else if (scheduledAt !== undefined) {
    const d = new Date(scheduledAt);
    if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      return NextResponse.json({ error: "scheduledAt must be a valid future date" }, { status: 400 });
    }
    row.status = "scheduled";
    row.scheduled_at = d.toISOString();
  }

  const { error } = await admin.from("campaigns").update(row).eq("id", campaignId).eq("project_id", projectId);
  if (error) {
    const responseBody = { error: "update failed" };
    await logApiCall(admin, projectId, "campaigns", 500, body, responseBody);
    return NextResponse.json(responseBody, { status: 500 });
  }

  const responseBody = { ok: true, campaignId, status: (row.status as string) || campaign.status };
  await logApiCall(admin, projectId, "campaigns", 200, body, responseBody);
  return NextResponse.json(responseBody);
}
