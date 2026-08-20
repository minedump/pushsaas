import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertContact } from "@/lib/identity";
import { logApiCall } from "@/lib/apiLog";

// POST /api/v1/contacts   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
//
// { phone?, email?, name?, insalesClientId?, smsActive?, emailActive? }
//
// Создаёт контакт (identity) или редактирует уже существующий — ищется по
// phone, если он передан, иначе по email; хотя бы одно из двух обязательно.
// Прочие поля дозаписываются поверх найденной/новой записи, не трогая то,
// что не передано в этом вызове.
//
// smsActive/emailActive — ЕДИНСТВЕННЫЙ способ пометить канал доступным для
// маркетинговых рассылок (сегментные SMS/Email-кампании и /api/v1/send с
// segmentTags берут контакт только отсюда, см. lib/sender.resolveSmsEmailAudience).
// Это НЕ то же самое, что подтверждение телефона/почты при входе по коду —
// вход доказывает владение номером, но не согласие на рассылки. true
// включает канал, false — выключает (отписка).
export async function POST(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { phone, email, name, insalesClientId, smsActive, emailActive } = body as {
    phone?: string;
    email?: string;
    name?: string;
    insalesClientId?: string;
    smsActive?: boolean;
    emailActive?: boolean;
  };

  const result = await upsertContact(projectId, {
    phone,
    email,
    name,
    insalesClientId,
    smsActive: typeof smsActive === "boolean" ? smsActive : undefined,
    emailActive: typeof emailActive === "boolean" ? emailActive : undefined,
  });

  const admin = createAdminClient();
  await logApiCall(admin, projectId, "contacts", result.ok, result.ok ? null : result.error, {
    created: result.ok ? result.created : undefined,
    smsActive,
    emailActive,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: result.id, created: result.created });
}
