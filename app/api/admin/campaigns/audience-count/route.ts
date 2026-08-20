import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { countAudience } from "@/lib/sender";

// Точное число получателей — вызывается прямо перед диалогом подтверждения
// отправки/планирования («Уйдёт N получателям»), не для превью контактов
// (для этого есть check-contacts). Контакты передаём сырыми (телефон и/или
// email вперемешку), как и при реальной отправке — countAudience сам
// резолвит нужное каналу поле.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { projectId, channel, contacts, segmentTags, type } = body as {
    projectId?: string;
    channel?: "push" | "sms" | "email";
    contacts?: string[];
    segmentTags?: string[];
    type?: "transactional" | "marketing";
  };
  if (!projectId || !channel) return NextResponse.json({ error: "Не хватает данных" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const count = await countAudience(projectId, channel, {
    contacts: contacts || [],
    segmentTags: segmentTags || [],
    bypassConsent: type === "transactional",
  });
  return NextResponse.json({ count });
}
