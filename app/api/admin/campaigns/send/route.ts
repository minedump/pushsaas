import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchCampaign, insertCampaign, createAndDispatchChannel, resolvePushTemplate, resolveChannelTemplate, mergeTemplateContext, enqueueWindowedCampaign } from "@/lib/sender";
import { phonesToSubscriberIds, emailsToSubscriberIds } from "@/lib/identity";
import { resolveProductsByRule, type ProductsRule } from "@/lib/productFeed";
import { withShortenedLinks } from "@/lib/linkPreview";
import { hasUnsubscribeTag } from "@/lib/unsubscribe";

// Compose + send now, or now/schedule for later — планирование доступно для
// всех трёх каналов; отложенные sms/email кампании (status='scheduled')
// подхватывает тот же крон send-scheduled, что и push.
//
// phones/emails — адресная отправка, из формы «Новая рассылка» (поле
// «Контакты», парсится через запятую на клиенте). Если сегмент ТОЖЕ задан —
// это пересечение (AND), не объединение: уходит только тем контактам,
// которые входят и в переданный список, и в сегмент (см.
// resolveSmsEmailAudience/dispatchCampaign в lib/sender.ts). Указан только
// один из двух источников — обычное разрешение по нему. Явно вписанный
// контакт всё равно проходит проверку согласия (filterConsentedContacts) —
// адресный ввод не обходит отсутствие согласия на канал.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const {
    projectId,
    channel,
    title,
    message,
    icon,
    image,
    badge,
    url,
    segmentTags,
    platforms,
    scheduledAt,
    actions,
    text,
    subject,
    html,
    templateId,
    provider,
    phones,
    emails,
    type,
    draft,
    internalTitle,
    data: dataInput,
    productsRule,
    sendWindowEnabled,
    sendDays,
    sendTimeFrom,
    sendTimeTo,
    sendWindowSubscriberTz,
    spacingEnabled,
    spacingMinutes,
  } = body as {
    projectId?: string;
    channel?: "push" | "sms" | "email";
    title?: string;
    message?: string;
    icon?: string;
    image?: string;
    badge?: string;
    url?: string;
    segmentTags?: string[];
    platforms?: string[];
    scheduledAt?: string;
    actions?: { title: string; url: string }[];
    text?: string;
    subject?: string;
    html?: string;
    templateId?: string;
    provider?: string;
    phones?: string[];
    emails?: string[];
    type?: "transactional" | "marketing";
    draft?: boolean;
    internalTitle?: string;
    data?: Record<string, unknown>;
    productsRule?: ProductsRule;
    sendWindowEnabled?: boolean;
    sendDays?: number[];
    sendTimeFrom?: string;
    sendTimeTo?: string;
    sendWindowSubscriberTz?: boolean;
    spacingEnabled?: boolean;
    spacingMinutes?: number;
  };
  const sendWindowRow = {
    send_window_enabled: !!sendWindowEnabled,
    send_days: sendWindowEnabled && sendDays?.length ? sendDays : null,
    send_time_from: sendWindowEnabled ? sendTimeFrom || null : null,
    send_time_to: sendWindowEnabled ? sendTimeTo || null : null,
    send_window_subscriber_tz: !!sendWindowSubscriberTz,
    spacing_enabled: !!spacingEnabled,
    spacing_minutes: spacingEnabled ? spacingMinutes || null : null,
  };
  const msgType: "transactional" | "marketing" = type === "transactional" ? "transactional" : "marketing";

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  // Товары по правилу (ProductPicker в форме рассылки) — резолвится один раз
  // здесь и замораживается в template_data вместе с ручным контекстом, тем
  // же путём, что и весь остальной data (см. комментарий у insertCampaign
  // ниже) — кампания разовая/на конкретное время, а не повторяющаяся
  // автоматизация, поэтому «заморозка на момент отправки/планирования» здесь
  // корректна (в отличие от sendWelcomeNow, который резолвит правило заново
  // при каждой отправке).
  let data = dataInput;
  if (productsRule) {
    const products = await resolveProductsByRule(projectId, productsRule);
    if (products.length) data = { ...(data || {}), products, product: products[0] };
  }

  // blocked (unpaid) projects can't send — superadmin bypasses
  const { data: proj } = await admin.from("projects").select("is_active").eq("id", projectId).single();
  if (!proj?.is_active) {
    const { data: profile } = await admin.from("profiles").select("role").eq("id", access.user!.id).maybeSingle();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Проект заблокирован — пополните баланс" }, { status: 402 });
    }
  }

  // Черновик — только сохранение строки (status='draft'), без реальной
  // отправки; довершается через /api/admin/campaigns/[id]/send-draft.
  // Провайдер («Через») сохраняется как выбрал админ — если к моменту
  // реальной отправки он пуст (старые черновики) или уже не настроен,
  // send-draft резолвит его заново (см. resolveChannelProvider). Контакты
  // (адресная отправка) сохраняются сырыми (migration 0034) — реального
  // резолва (устройство/согласие на канал) им предстоит дождаться отправки,
  // см. dispatchCampaign/dispatchSmsCampaign/dispatchEmailCampaign в lib/sender.ts.
  //
  // Контент шаблона резолвится ЗДЕСЬ и сохраняется в title/body/html_body —
  // а не только template_id-ссылкой — потому что ни send-draft, ни cron
  // send-scheduled повторно шаблон не резолвят, читают эти колонки как есть
  // (см. dispatchSmsCampaign/dispatchEmailCampaign/dispatchCampaign в
  // lib/sender.ts). Раньше html_body тут писался в null при выбранном
  // шаблоне — черновик потом уходил с пустым письмом.
  if (draft) {
    const rawContacts = [...new Set([...(Array.isArray(phones) ? phones : []), ...(Array.isArray(emails) ? emails : [])])];
    const row: Record<string, unknown> = {
      project_id: projectId,
      channel: channel || "push",
      segment_tags: segmentTags || [],
      platforms: platforms || [],
      status: "draft",
      type: msgType,
      initiator: "manual",
      created_by: access.user!.id,
      ...sendWindowRow,
      template_id: templateId || null,
      internal_title: internalTitle || null,
      template_data: data || null,
      contacts: rawContacts,
    };
    if (channel === "sms") {
      const resolved = await resolveChannelTemplate(admin, projectId, "sms", templateId, { body: text });
      row.title = resolved.body?.trim() || "";
      row.body = resolved.body?.trim() || "";
      row.provider = provider || null;
      row.template_data = mergeTemplateContext(resolved.context, data);
    } else if (channel === "email") {
      const resolved = await resolveChannelTemplate(admin, projectId, "email", templateId, { subject, html });
      // Ссылка отписки обязательна для маркетингового письма — см.
      // hasUnsubscribeTag/unsubscribeUrl в lib/unsubscribe.ts. Транзакционные
      // письма (код входа, статус заказа) этим требованием не связаны.
      if (msgType === "marketing" && !hasUnsubscribeTag(resolved.html || "")) {
        return NextResponse.json({ error: "Добавьте {{ unsubscribe_url }} в письмо — обязательно для маркетинговой рассылки" }, { status: 400 });
      }
      row.title = resolved.subject || "";
      row.body = "";
      row.subject = resolved.subject || null;
      row.html_body = resolved.html || null;
      row.provider = provider || null;
      row.template_data = mergeTemplateContext(resolved.context, data);
    } else {
      let pushTitle = title?.trim() || "";
      let pushBody = message?.trim() || "";
      let pushUrl = url;
      let pushIcon = icon;
      let pushImage = image;
      let pushBadge = badge;
      let pushActions = Array.isArray(actions) ? actions.filter((a) => a.title?.trim() && a.url?.trim()).slice(0, 2) : [];
      if (templateId) {
        const resolved = await resolvePushTemplate(admin, projectId, templateId, { title: pushTitle, body: pushBody, url, icon, image, badge, actions: pushActions });
        pushTitle = resolved.title;
        pushBody = resolved.body;
        pushUrl = resolved.url;
        pushIcon = resolved.icon;
        pushImage = resolved.image;
        pushBadge = resolved.badge;
        pushActions = resolved.actions || [];
        row.template_data = mergeTemplateContext(resolved.context, data);
      }
      // Лимит проверяем и здесь (не только на клиенте) — иначе прямой вызов
      // API мог бы сохранить черновик с заголовком/текстом длиннее того, что
      // реально поместится в уведомление. Текст — по оценке ПОСЛЕ сокращения
      // ссылок (см. lib/linkPreview.ts), не по сырой длине.
      if (pushTitle.length > 80) return NextResponse.json({ error: "Заголовок длиннее 80 символов" }, { status: 400 });
      if (withShortenedLinks(pushBody).length > 200) return NextResponse.json({ error: "Текст длиннее 200 символов" }, { status: 400 });
      row.title = pushTitle;
      row.body = pushBody;
      row.click_url = pushUrl || null;
      row.icon_url = pushIcon || null;
      row.image_url = pushImage || null;
      row.badge_url = pushBadge || null;
      row.actions = pushActions;
    }
    const { data: created, error } = await admin.from("campaigns").insert(row).select("id").single();
    if (error || !created) return NextResponse.json({ error: "Ошибка сохранения черновика" }, { status: 500 });
    return NextResponse.json({ ok: true, draft: true, id: created.id });
  }

  if (channel === "sms") {
    if (!text?.trim() && !templateId) return NextResponse.json({ error: "Заполните текст SMS или выберите шаблон" }, { status: 400 });
    // Сырые контакты (не только phones) — кто-то мог указать email в поле
    // «Контакты» при отправке SMS; filterConsentedContacts сам определит тип
    // и найдёт привязанный телефон той же identity (см. lib/identity.ts).
    const rawContacts = [...new Set([...(Array.isArray(phones) ? phones : []), ...(Array.isArray(emails) ? emails : [])])];
    const scheduled = scheduledAt && new Date(scheduledAt).getTime() > Date.now();

    if (scheduled) {
      // Как и у push — контент шаблона резолвится и сохраняется сейчас
      // (title/body), а контакты/провайдер резолвятся заново перед реальной
      // отправкой (крон send-scheduled), см. комментарий у ветки draft выше.
      const resolved = await resolveChannelTemplate(admin, projectId, "sms", templateId, { body: text });
      const { data: created, error } = await admin
        .from("campaigns")
        .insert({
          project_id: projectId,
          channel: "sms",
          title: resolved.body?.trim() || "",
          body: resolved.body?.trim() || "",
          provider: provider || null,
          segment_tags: segmentTags || [],
          status: "scheduled",
          scheduled_at: scheduledAt,
          type: msgType,
          initiator: "manual",
          created_by: access.user!.id,
          ...sendWindowRow,
          template_id: templateId || null,
          internal_title: internalTitle || null,
          template_data: mergeTemplateContext(resolved.context, data),
          contacts: rawContacts,
        })
        .select("id")
        .single();
      if (error || !created) return NextResponse.json({ error: "Ошибка планирования" }, { status: 500 });
      return NextResponse.json({ scheduled: true, at: scheduledAt });
    }

    const result = await createAndDispatchChannel(
      projectId,
      "sms",
      {
        title: text?.trim() || "",
        body: text?.trim(),
        templateId,
        segmentTags,
        providerHint: provider,
        type: msgType,
        initiator: "manual",
        internalTitle,
        data,
        sendWindow: sendWindowEnabled ? { enabled: true, days: sendDays || null, timeFrom: sendTimeFrom || null, timeTo: sendTimeTo || null, subscriberTz: !!sendWindowSubscriberTz } : undefined,
        spacing: spacingEnabled ? { enabled: true, minutes: spacingMinutes || null } : undefined,
      },
      rawContacts.length ? rawContacts : undefined
    );
    if (!result.ok) return NextResponse.json({ error: result.error === "no provider configured" ? "SMS не настроен" : "Ошибка отправки" }, { status: 402 });
    return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
  }

  if (channel === "email") {
    if (!templateId && !html?.trim()) return NextResponse.json({ error: "Выберите шаблон или заполните HTML" }, { status: 400 });
    // Сырые контакты (не только emails) — см. комментарий в ветке sms выше.
    const rawContacts = [...new Set([...(Array.isArray(phones) ? phones : []), ...(Array.isArray(emails) ? emails : [])])];
    const scheduled = scheduledAt && new Date(scheduledAt).getTime() > Date.now();

    if (scheduled) {
      const resolved = await resolveChannelTemplate(admin, projectId, "email", templateId, { subject, html });
      if (msgType === "marketing" && !hasUnsubscribeTag(resolved.html || "")) {
        return NextResponse.json({ error: "Добавьте {{ unsubscribe_url }} в письмо — обязательно для маркетинговой рассылки" }, { status: 400 });
      }
      const { data: created, error } = await admin
        .from("campaigns")
        .insert({
          project_id: projectId,
          channel: "email",
          title: resolved.subject || "",
          body: "",
          subject: resolved.subject || null,
          html_body: resolved.html || null,
          provider: provider || null,
          segment_tags: segmentTags || [],
          status: "scheduled",
          scheduled_at: scheduledAt,
          type: msgType,
          initiator: "manual",
          created_by: access.user!.id,
          ...sendWindowRow,
          template_id: templateId || null,
          internal_title: internalTitle || null,
          template_data: mergeTemplateContext(resolved.context, data),
          contacts: rawContacts,
        })
        .select("id")
        .single();
      if (error || !created) return NextResponse.json({ error: "Ошибка планирования" }, { status: 500 });
      return NextResponse.json({ scheduled: true, at: scheduledAt });
    }

    const result = await createAndDispatchChannel(
      projectId,
      "email",
      {
        title: subject || "",
        subject,
        html,
        templateId,
        segmentTags,
        providerHint: provider,
        type: msgType,
        initiator: "manual",
        internalTitle,
        data,
        sendWindow: sendWindowEnabled ? { enabled: true, days: sendDays || null, timeFrom: sendTimeFrom || null, timeTo: sendTimeTo || null, subscriberTz: !!sendWindowSubscriberTz } : undefined,
        spacing: spacingEnabled ? { enabled: true, minutes: spacingMinutes || null } : undefined,
      },
      rawContacts.length ? rawContacts : undefined
    );
    if (!result.ok) {
      const msg =
        result.error === "no provider configured"
          ? "Email не настроен"
          : result.error === "html or templateId required"
          ? "Выберите шаблон или заполните HTML"
          : result.error === "unsubscribe link required"
          ? "Добавьте {{ unsubscribe_url }} в письмо — обязательно для маркетинговой рассылки"
          : "Ошибка отправки";
      return NextResponse.json({ error: msg }, { status: 402 });
    }
    return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
  }

  // push (default — сохраняет обратную совместимость со старыми вызовами без channel)
  let pushTitle = title?.trim() || "";
  let pushBody = message?.trim() || "";
  let pushUrl = url;
  let pushIcon = icon;
  let pushImage = image;
  let pushBadge = badge;
  let pushActions = Array.isArray(actions) ? actions.filter((a) => a.title?.trim() && a.url?.trim()).slice(0, 2) : [];
  let pushTemplateContext: Record<string, unknown> | null | undefined;
  if (templateId) {
    const resolved = await resolvePushTemplate(admin, projectId, templateId, { title: pushTitle, body: pushBody, url, icon, image, badge, actions: pushActions });
    pushTitle = resolved.title;
    pushBody = resolved.body;
    pushUrl = resolved.url;
    pushIcon = resolved.icon;
    pushImage = resolved.image;
    pushBadge = resolved.badge;
    pushActions = resolved.actions || [];
    pushTemplateContext = resolved.context;
  }
  if (!pushTitle.trim() || !pushBody.trim()) {
    return NextResponse.json({ error: "Заполните заголовок и текст" }, { status: 400 });
  }
  if (pushTitle.length > 80) return NextResponse.json({ error: "Заголовок длиннее 80 символов" }, { status: 400 });
  if (withShortenedLinks(pushBody).length > 200) return NextResponse.json({ error: "Текст длиннее 200 символов" }, { status: 400 });

  const phoneList = Array.isArray(phones) ? phones : [];
  const emailList = Array.isArray(emails) ? emails : [];
  const rawContacts = [...new Set([...phoneList, ...emailList])];
  const scheduled = scheduledAt && new Date(scheduledAt).getTime() > Date.now();

  // При планировании контакты не резолвим сейчас — устройство может
  // подписаться/отписаться до наступления времени отправки, поэтому сырые
  // контакты сохраняются на кампании (migration 0034) и резолвятся заново
  // прямо перед реальной отправкой (см. dispatchCampaign в lib/sender.ts,
  // вызывается кроном send-scheduled). Немедленную отправку резолвим
  // синхронно здесь же — так можно сразу сказать «не найдено устройств»,
  // а не ждать следующего запуска крона, чтобы узнать о нуле получателей.
  let subscriberIds: string[] | undefined;
  if (!scheduled && rawContacts.length) {
    const bypassPause = msgType === "transactional";
    const [byPhone, byEmail] = await Promise.all([
      phoneList.length ? phonesToSubscriberIds(projectId, phoneList, { bypassPause }) : Promise.resolve([]),
      emailList.length ? emailsToSubscriberIds(projectId, emailList, { bypassPause }) : Promise.resolve([]),
    ]);
    subscriberIds = [...new Set([...byPhone, ...byEmail])];
    if (!subscriberIds.length) {
      return NextResponse.json({ error: "Не найдено устройств по указанным телефонам/email" }, { status: 404 });
    }
  }

  const campaign = await insertCampaign(admin, {
    project_id: projectId,
    title: pushTitle,
    body: pushBody,
    icon_url: pushIcon || null,
    image_url: pushImage || null,
    click_url: pushUrl || null,
    badge_url: pushBadge || null,
    segment_tags: segmentTags || [],
    platforms: platforms || [],
    actions: pushActions,
    status: scheduled ? "scheduled" : "sending",
    scheduled_at: scheduled ? scheduledAt : null,
    template_id: templateId || null,
    created_by: access.user!.id,
    type: msgType,
    initiator: "manual",
    internal_title: internalTitle || null,
    template_data: mergeTemplateContext(pushTemplateContext, data),
    contacts: rawContacts,
    ...sendWindowRow,
  });

  if (!campaign) {
    return NextResponse.json({ error: "Ошибка создания рассылки" }, { status: 500 });
  }

  if (scheduled) {
    return NextResponse.json({ scheduled: true, at: scheduledAt });
  }

  // Окно отправки/защита от наложения — вместо немедленной пакетной
  // отправки заводим пер-получательские задания (см. lib/sender.ts
  // enqueueWindowedCampaign), реальную отправку каждого делает отдельный
  // крон run-campaign-jobs.
  if (sendWindowEnabled || spacingEnabled) {
    const r = await enqueueWindowedCampaign({ ...campaign, channel: "push" }, subscriberIds);
    return NextResponse.json({ ok: r.ok, delivered: 0, failed: 0, total: r.enqueued });
  }

  const result = await dispatchCampaign(campaign, subscriberIds);
  if (!result.ok) {
    const msg = result.error === "insufficient balance" ? "Недостаточно баланса" : "Ошибка отправки";
    return NextResponse.json({ error: msg }, { status: 402 });
  }
  return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
}
