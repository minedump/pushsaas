import { NextResponse } from "next/server";
import { authenticateApiKeyFull } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAndDispatch, createAndDispatchChannel } from "@/lib/sender";
import { phonesToSubscriberIds, emailsToSubscriberIds } from "@/lib/identity";
import { logApiCall } from "@/lib/apiLog";

// GET /api/v1/campaigns?status=&channel=&limit=&offset=
//   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
//
// Список рассылок проекта (раздел «Рассылки»), новые первыми. Краткая форма
// — без содержимого сообщения, полную карточку одной рассылки смотрите в
// GET /api/v1/campaigns/{id}. ?status=draft|scheduled|sending|sent|failed и
// ?channel=push|sms|email — необязательные фильтры, limit по умолчанию 50,
// максимум 200.
export async function GET(req: Request) {
  const key = await authenticateApiKeyFull(req);
  if (!key) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const channel = q.get("channel");
  const limit = Math.min(Math.max(Number(q.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(q.get("offset")) || 0, 0);

  const admin = createAdminClient();
  let query = admin
    .from("campaigns")
    .select(
      "id, channel, status, type, initiator, internal_title, title, scheduled_at, sent_at, sent_count, delivered_count, failed_count, clicked_count, created_at",
      { count: "exact" }
    )
    .eq("project_id", key.projectId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (status) query = query.eq("status", status);
  if (channel === "push" || channel === "sms" || channel === "email") query = query.eq("channel", channel);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ campaigns: [], total: 0 });

  const campaigns = (data || []).map((c) => ({
    id: c.id,
    channel: c.channel,
    status: c.status,
    type: c.type,
    initiator: c.initiator,
    internalTitle: c.internal_title,
    title: c.title,
    scheduledAt: c.scheduled_at,
    sentAt: c.sent_at,
    sentCount: c.sent_count,
    deliveredCount: c.delivered_count,
    failedCount: c.failed_count,
    clickedCount: c.clicked_count,
    createdAt: c.created_at,
  }));
  return NextResponse.json({ campaigns, total: count || 0 });
}

// POST /api/v1/campaigns   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
//
// Создаёт и отправляет (или сохраняет черновиком/планирует) рассылку — один
// эндпоинт на все три канала, выбирается полем channel, а не отдельным URL.
// Полное описание тела запроса — GET /api/v1/docs (markdown, есть ссылка
// «Скачать API.md» в разделе «API» админки).
//
// channel: "push" | "sms" | "email" — обязательное поле, значение по
//   умолчанию не подставляется.
// type: "marketing" (default) | "transactional" — маркетинговый email без
//   {{ unsubscribe_url }} в итоговом HTML (из шаблона или переданном явно)
//   отклоняется с ok:false, error:"unsubscribe link required".
// contacts / phones|phone / emails|email — адресная отправка, одному и тому
//   же списку получателей независимо от channel (нерелевантные строке канала
//   значения просто не находят совпадения, ничего не ломают).
// draft — сохранить черновиком, ничего не отправляя (появится в «Рассылки»,
//   отправляется оттуда через POST /api/v1/campaigns/{id}/send). scheduledAt
//   — ISO-дата в будущем, отложить (подхватит тот же крон, что и
//   «Запланировать» в форме рассылки). Оба поля взаимоисключающие — draft
//   побеждает, если передали оба.
// platforms — только push, фильтр по типу устройства (ios/android/desktop),
//   пусто/не указано = все.
// sendWindow / spacing — защита от наложения и окно отправки, та же форма,
//   что и в ручной рассылке.
export async function POST(req: Request) {
  const key = await authenticateApiKeyFull(req);
  if (!key) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { projectId } = key;

  const body = await req.json().catch(() => ({}));
  const {
    channel,
    type,
    title,
    body: pushBody,
    url,
    icon,
    image,
    badge,
    segmentTags,
    platforms,
    phones,
    phone,
    emails,
    email,
    contacts,
    actions,
    text,
    subject,
    html,
    templateId,
    templateData,
    draft,
    scheduledAt,
    internalTitle,
    sendWindow,
    spacing,
  } = body;
  const msgType: "transactional" | "marketing" = type === "transactional" ? "transactional" : "marketing";
  const isDraft = !!draft;

  const admin = createAdminClient();

  // channel обязателен — без явного значения не подставляем push по
  // умолчанию: пустое поле должно быть ошибкой, а не молчаливой отправкой
  // push, которую вызывающий мог не иметь в виду.
  if (channel !== "push" && channel !== "sms" && channel !== "email") {
    const responseBody = { error: "channel is required (push, sms or email)" };
    await logApiCall(admin, projectId, "campaigns", 400, body, responseBody);
    return NextResponse.json(responseBody, { status: 400 });
  }

  // internalTitle обязателен — та же семантика, что и «Название» в ручном
  // создании (список «Рассылки» иначе не даёт содержательно отличить строки).
  if (!String(internalTitle ?? "").trim()) {
    const responseBody = { error: "internalTitle is required" };
    await logApiCall(admin, projectId, "campaigns", 400, body, responseBody);
    return NextResponse.json(responseBody, { status: 400 });
  }

  const { data: proj } = await admin.from("projects").select("is_active").eq("id", projectId).single();
  if (!proj?.is_active) return NextResponse.json({ error: "project blocked" }, { status: 402 });

  let resolvedScheduledAt: string | null = null;
  if (!isDraft && scheduledAt) {
    const d = new Date(scheduledAt);
    if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      const responseBody = { error: "scheduledAt must be a valid future date" };
      await logApiCall(admin, projectId, "campaigns", 400, body, responseBody);
      return NextResponse.json(responseBody, { status: 400 });
    }
    resolvedScheduledAt = d.toISOString();
  }
  const status = isDraft ? "draft" : resolvedScheduledAt ? "scheduled" : "sending";

  const win = sendWindow && typeof sendWindow === "object" ? sendWindow : undefined;
  const normalizedWindow = win
    ? {
        enabled: !!win.enabled,
        days: Array.isArray(win.days) ? win.days : null,
        timeFrom: win.timeFrom || null,
        timeTo: win.timeTo || null,
        subscriberTz: !!win.subscriberTz,
      }
    : undefined;
  const sp = spacing && typeof spacing === "object" ? spacing : undefined;
  const normalizedSpacing = sp ? { enabled: !!sp.enabled, minutes: sp.minutes ? Number(sp.minutes) : null } : undefined;

  // Один и тот же список адресатов независимо от канала — телефон/email
  // вперемешку, как в поле «Контакты» ручной рассылки: строка, не подходящая
  // выбранному каналу (email в sms-рассылке и т.п.), просто ни на что не
  // матчится, а не ошибка.
  const mergedContacts = [
    ...(Array.isArray(contacts) ? contacts : []),
    ...(Array.isArray(phones) ? phones : []),
    ...(phone ? [phone] : []),
    ...(Array.isArray(emails) ? emails : []),
    ...(email ? [email] : []),
  ].filter(Boolean);
  const rawContacts = [...new Set(mergedContacts)];

  if (channel === "sms") {
    if (!text?.trim() && !templateId) {
      const responseBody = { error: "text or templateId required" };
      await logApiCall(admin, projectId, "campaigns", 400, body, responseBody);
      return NextResponse.json(responseBody, { status: 400 });
    }
    const result = await createAndDispatchChannel(
      projectId,
      "sms",
      {
        title: text?.trim() || "",
        body: text?.trim(),
        templateId,
        data: templateData,
        segmentTags,
        providerHint: key.smsProvider,
        type: msgType,
        initiator: "api",
        internalTitle,
        draft: isDraft,
        scheduledAt: resolvedScheduledAt,
        sendWindow: normalizedWindow,
        spacing: normalizedSpacing,
      },
      rawContacts.length ? rawContacts : undefined
    );
    const httpStatus = result.ok ? 201 : 402;
    const responseBody = result.ok
      ? { ok: true, campaignId: result.campaignId, status, delivered: result.delivered, failed: result.failed, total: result.total }
      : { error: result.error };
    await logApiCall(admin, projectId, "campaigns", httpStatus, body, responseBody);
    return NextResponse.json(responseBody, { status: httpStatus });
  }

  if (channel === "email") {
    if (!html?.trim() && !templateId) {
      const responseBody = { error: "html or templateId required" };
      await logApiCall(admin, projectId, "campaigns", 400, body, responseBody);
      return NextResponse.json(responseBody, { status: 400 });
    }
    const result = await createAndDispatchChannel(
      projectId,
      "email",
      {
        title: subject || "",
        subject,
        html,
        templateId,
        data: templateData,
        segmentTags,
        providerHint: key.emailProvider,
        type: msgType,
        initiator: "api",
        internalTitle,
        draft: isDraft,
        scheduledAt: resolvedScheduledAt,
        sendWindow: normalizedWindow,
        spacing: normalizedSpacing,
      },
      rawContacts.length ? rawContacts : undefined
    );
    const httpStatus = result.ok ? 201 : 402;
    const responseBody = result.ok
      ? { ok: true, campaignId: result.campaignId, status, delivered: result.delivered, failed: result.failed, total: result.total }
      : { error: result.error };
    await logApiCall(admin, projectId, "campaigns", httpStatus, body, responseBody);
    return NextResponse.json(responseBody, { status: httpStatus });
  }

  // push (channel уже проверен выше)
  if ((!title?.trim() || !pushBody?.trim()) && !templateId) {
    const responseBody = { error: "title and body required (or templateId)" };
    await logApiCall(admin, projectId, "campaigns", 400, body, responseBody);
    return NextResponse.json(responseBody, { status: 400 });
  }

  // Немедленная отправка адресно (не черновик/не отложенная) — резолвим
  // устройства прямо сейчас, как и раньше: «нет ни одного устройства» это
  // мгновенная 404, а не молчаливый нулевой охват. Для черновика/отложенной
  // резолва пока нет — сырые контакты просто сохраняются на кампании и
  // резолвятся заново непосредственно перед реальной отправкой (send-draft/
  // крон), устройство могло появиться позже.
  let subscriberIds: string[] | undefined;
  if (rawContacts.length && status === "sending") {
    const phoneLike = rawContacts.filter((c) => !c.includes("@"));
    const emailLike = rawContacts.filter((c) => c.includes("@"));
    const [byPhone, byEmail] = await Promise.all([
      phoneLike.length ? phonesToSubscriberIds(projectId, phoneLike) : Promise.resolve([]),
      emailLike.length ? emailsToSubscriberIds(projectId, emailLike) : Promise.resolve([]),
    ]);
    subscriberIds = [...new Set([...byPhone, ...byEmail])];
    if (!subscriberIds.length) {
      const responseBody = { error: "no devices linked to given phones/emails" };
      await logApiCall(admin, projectId, "campaigns", 404, body, responseBody);
      return NextResponse.json(responseBody, { status: 404 });
    }
  }

  const result = await createAndDispatch(
    projectId,
    {
      title,
      body: pushBody,
      url,
      icon,
      image,
      badge,
      templateId,
      data: templateData,
      segmentTags,
      platforms: Array.isArray(platforms) ? platforms : undefined,
      contacts: rawContacts.length ? rawContacts : undefined,
      actions: Array.isArray(actions) ? actions.slice(0, 2) : undefined,
      type: msgType,
      internalTitle,
      draft: isDraft,
      scheduledAt: resolvedScheduledAt,
      sendWindow: normalizedWindow,
      spacing: normalizedSpacing,
    },
    subscriberIds
  );
  const httpStatus = result.ok ? 201 : 402;
  const responseBody = result.ok
    ? { ok: true, campaignId: result.campaignId, status, delivered: result.delivered, failed: result.failed, total: result.total }
    : { error: result.error };
  await logApiCall(admin, projectId, "campaigns", httpStatus, body, responseBody);
  return NextResponse.json(responseBody, { status: httpStatus });
}
