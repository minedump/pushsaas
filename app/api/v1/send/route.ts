import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAndDispatch } from "@/lib/sender";
import { phonesToSubscriberIds, emailsToSubscriberIds } from "@/lib/identity";

// POST /api/v1/send   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
// body: { title, body, url?, icon?, image?, segmentTags?, phones? | phone?, emails? | email?, actions? }
// phones/phone или emails/email — адресная отправка (устройства, привязанные
// через вход по телефону, или email, обогащённый из заказов); перекрывает segmentTags.
// actions — до 2 кнопок [{title,url}] (rich push).
export async function POST(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const { title, body, url, icon, image, segmentTags, phones, phone, emails, email, actions } = await req.json().catch(() => ({}));
  if (!title?.trim() || !body?.trim()) {
    return NextResponse.json({ error: "title and body required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: proj } = await admin.from("projects").select("is_active").eq("id", projectId).single();
  if (!proj?.is_active) return NextResponse.json({ error: "project blocked" }, { status: 402 });

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
      return NextResponse.json({ error: "no devices linked to given phones/emails" }, { status: 404 });
    }
  }

  const result = await createAndDispatch(
    projectId,
    { title, body, url, icon, image, segmentTags, actions: Array.isArray(actions) ? actions.slice(0, 2) : undefined },
    subscriberIds
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 402 });
  return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
}
