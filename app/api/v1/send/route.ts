import { NextResponse } from "next/server";
import { authenticateApiKeyFull } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAndDispatch, createAndDispatchChannel } from "@/lib/sender";
import { phonesToSubscriberIds, emailsToSubscriberIds } from "@/lib/identity";
import { logApiCall } from "@/lib/apiLog";

// POST /api/v1/send   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
//
// channel: "push" (default) | "sms" | "email"
// type: "marketing" (default) | "transactional" — влияет на выбор потока у
//   Haskimail (haskimail_transactional_stream vs haskimail_marketing_stream,
//   см. раздел «Подключения») и на отображение в «Кампаниях»
//   (фильтр Транзакционные/Маркетинговые). Указывайте "transactional" для
//   сервисных сообщений (заказ отправлен, статус изменился и т.п.) — вход по
//   коду и вебхук-автоматизации с включённым тумблером «Транзакционная»
//   классифицируются так уже автоматически, без этого поля.
//
// push:  { title?, body?, url?, icon?, image?, badge?, templateId?, templateData?, segmentTags?, phones?|phone?, emails?|email?, actions? }
//   нужен title+body ИЛИ templateId (шаблон канала push из раздела «Шаблоны»).
//   phones/phone или emails/email — адресная отправка (устройства, привязанные
//   через вход по телефону, или email, обогащённый из заказов); перекрывает segmentTags.
//   actions — до 2 кнопок [{title,url}] (rich push).
//
// sms:   { channel:"sms", text?, templateId?, templateData?, phone?|phones?, segmentTags? }
//   нужен text ИЛИ templateId (шаблон канала sms). phone(s) — отправка
//   напрямую на номер, без привязки к подписчику. segmentTags — только тем в
//   сегменте, у кого канал SMS активирован для рассылок (не то же самое, что
//   подтверждение телефона входом по коду — см. POST /api/v1/contacts).
//
// email: { channel:"email", subject?, html?, templateId?, templateData?, email?|emails?, segmentTags? }
//   нужен html ИЛИ templateId (шаблон из раздела «Шаблоны», см. GET /api/v1/templates).
//   email(s) — отправка напрямую на адрес; segmentTags — только тем, у кого
//   канал Email активирован для рассылок (см. POST /api/v1/contacts).
//
// templateData — { key: value } для подстановки {{ key }} в текст/HTML
// шаблона (номер заказа, сумма и т.п., полный Liquid — фильтры/{% if %}/
// {% for %}) — разовые данные ЭТОГО вызова, не путать с segmentTags-
// адресацией по атрибутам подписчика (те тоже подставляются, templateData
// просто побеждает при совпадении ключа).
//
// Провайдер (какой сервис реально шлёт sms/email) закреплён за самим ключом
// при его создании (см. раздел «API» в админке) — в теле запроса не выбирается.
export async function POST(req: Request) {
  const key = await authenticateApiKeyFull(req);
  if (!key) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { projectId } = key;

  const body = await req.json().catch(() => ({}));
  const { channel, type, title, body: pushBody, url, icon, image, badge, segmentTags, phones, phone, emails, email, actions, text, subject, html, templateId, templateData } = body;
  const msgType: "transactional" | "marketing" = type === "transactional" ? "transactional" : "marketing";

  const admin = createAdminClient();
  const { data: proj } = await admin.from("projects").select("is_active").eq("id", projectId).single();
  if (!proj?.is_active) return NextResponse.json({ error: "project blocked" }, { status: 402 });

  if (channel === "sms") {
    if (!text?.trim() && !templateId) {
      await logApiCall(admin, projectId, "send", false, "text or templateId required", { channel });
      return NextResponse.json({ error: "text or templateId required" }, { status: 400 });
    }
    const phoneList: string[] = Array.isArray(phones) ? phones : phone ? [phone] : [];
    const result = await createAndDispatchChannel(
      projectId,
      "sms",
      { title: text?.trim() || "", body: text?.trim(), templateId, data: templateData, segmentTags, providerHint: key.smsProvider, type: msgType, initiator: "api" },
      phoneList.length ? phoneList : undefined
    );
    await logApiCall(admin, projectId, "send", result.ok, result.error, { channel, type: msgType, total: result.total, delivered: result.delivered });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 402 });
    return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
  }

  if (channel === "email") {
    if (!html?.trim() && !templateId) {
      await logApiCall(admin, projectId, "send", false, "html or templateId required", { channel });
      return NextResponse.json({ error: "html or templateId required" }, { status: 400 });
    }
    const emailList: string[] = Array.isArray(emails) ? emails : email ? [email] : [];
    const result = await createAndDispatchChannel(
      projectId,
      "email",
      { title: subject || "", subject, html, templateId, data: templateData, segmentTags, providerHint: key.emailProvider, type: msgType, initiator: "api" },
      emailList.length ? emailList : undefined
    );
    await logApiCall(admin, projectId, "send", result.ok, result.error, { channel, type: msgType, total: result.total, delivered: result.delivered });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 402 });
    return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
  }

  // push (default)
  if ((!title?.trim() || !pushBody?.trim()) && !templateId) {
    await logApiCall(admin, projectId, "send", false, "title and body required (or templateId)", { channel: "push" });
    return NextResponse.json({ error: "title and body required (or templateId)" }, { status: 400 });
  }

  let subscriberIds: string[] | undefined;
  const phoneList: string[] = Array.isArray(phones) ? phones : phone ? [phone] : [];
  const emailList: string[] = Array.isArray(emails) ? emails : email ? [email] : [];

  if (phoneList.length || emailList.length) {
    const [byPhone, byEmail] = await Promise.all([
      phoneList.length ? phonesToSubscriberIds(projectId, phoneList) : Promise.resolve([]),
      emailList.length ? emailsToSubscriberIds(projectId, emailList) : Promise.resolve([]),
    ]);
    subscriberIds = [...new Set([...byPhone, ...byEmail])];
    if (!subscriberIds.length) {
      await logApiCall(admin, projectId, "send", false, "no devices linked to given phones/emails", { channel: "push" });
      return NextResponse.json({ error: "no devices linked to given phones/emails" }, { status: 404 });
    }
  }

  const result = await createAndDispatch(
    projectId,
    { title, body: pushBody, url, icon, image, badge, templateId, data: templateData, segmentTags, actions: Array.isArray(actions) ? actions.slice(0, 2) : undefined, type: msgType },
    subscriberIds
  );
  await logApiCall(admin, projectId, "send", result.ok, result.error, { channel: "push", type: msgType, total: result.total, delivered: result.delivered });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 402 });
  return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
}
