import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { checkPushContacts, filterConsentedContacts } from "@/lib/identity";
import { formatPhone } from "@/lib/phone";

// Кнопка «Проверить» у поля «Контакты» в форме рассылки — чистит СПИСОК,
// который туда вписали: отсеивает контакты, которых нет в базе, у которых
// не включён нужный канал, или (если указан сегмент) которые не входят в
// заданный сегмент. Ничего не проверяет и не резолвит, если поле «Контакты»
// пустое — сегмент сам по себе через эту кнопку не резолвится, при пустых
// контактах он участвует в реальной отправке напрямую (см. dispatchCampaign/
// resolveSmsEmailAudience в lib/sender.ts), без предпросмотра здесь.
//
// Кросс-канальность: контакт можно указать в ЛЮБОМ формате (для SMS
// достаточно email, если у той же identity есть телефон) — filterConsentedContacts
// сам ищет по обоим полям и возвращает значение нужного каналу (см. lib/identity.ts).
//
// type: "transactional" — тот же тумблер «Транзакционная» в форме, снимает
// ограничение (paused/*_marketing_active_at) — транзакционные сообщения
// уходят всем, кто есть в базе проекта.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { projectId, channel, contacts, segmentTags, type } = body as {
    projectId?: string;
    channel?: "push" | "sms" | "email";
    contacts?: string[];
    segmentTags?: string[];
    type?: "transactional" | "marketing";
  };

  if (!projectId || !channel || !Array.isArray(contacts) || !contacts.length) {
    return NextResponse.json({ error: "Нечего проверять — заполните контакты" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const bypass = type === "transactional";
  const tags = (segmentTags || []).filter(Boolean);

  if (channel === "push") {
    const phones = contacts.filter((c) => !c.includes("@"));
    const emails = contacts.filter((c) => c.includes("@"));
    const [validPhones, validEmails] = await Promise.all([
      phones.length ? checkPushContacts(projectId, "phone", phones, { bypassPause: bypass, segmentTags: tags }) : Promise.resolve([]),
      emails.length ? checkPushContacts(projectId, "email", emails, { bypassPause: bypass, segmentTags: tags }) : Promise.resolve([]),
    ]);
    return NextResponse.json({
      valid: [...validPhones.map(formatPhone), ...validEmails],
      removed: contacts.length - validPhones.length - validEmails.length,
    });
  }

  const field = channel === "sms" ? "phone" : "email";
  const validValues = await filterConsentedContacts(projectId, field, contacts, { bypassConsent: bypass, segmentTags: tags });
  return NextResponse.json({
    valid: field === "phone" ? validValues.map(formatPhone) : validValues,
    removed: contacts.length - validValues.length,
  });
}
