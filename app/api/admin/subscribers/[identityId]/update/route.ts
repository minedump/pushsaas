import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { updateContact, composeName, setIdentityTimezone, setYmClientIds } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSystemFields } from "@/lib/shopFields";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ identityId: string }> }) {
  const { identityId } = await params;
  const body = await req.json().catch(() => ({}));
  const { projectId, phone, email, name, lastName, firstName, middleName, insalesClientId, smsActive, emailActive, tags, attributes } = body as {
    projectId?: string;
    phone?: string;
    email?: string;
    name?: string;
    lastName?: string;
    firstName?: string;
    middleName?: string;
    insalesClientId?: string;
    smsActive?: boolean;
    emailActive?: boolean;
    tags?: string[];
    attributes?: Record<string, string | null>;
  };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  // часовой пояс (IANA) и ClientID Метрики (список заменяется целиком): не переданы — не трогаем
  const sys = parseSystemFields(body as { timezone?: unknown; ymClientIds?: unknown });
  if ("error" in sys) {
    const msg = sys.error.startsWith("invalid timezone")
      ? "Часовой пояс: укажите название IANA, например Europe/Moscow"
      : "UUID метрики: 5–64 символа, буквы, цифры, «_» и «-», несколько через запятую";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const result = await updateContact(projectId, identityId, {
    phone: phone?.trim() || null,
    email: email?.trim() || null,
    name: name !== undefined ? name : undefined,
    lastName: lastName !== undefined ? lastName : undefined,
    firstName: firstName !== undefined ? firstName : undefined,
    middleName: middleName !== undefined ? middleName : undefined,
    insalesClientId: insalesClientId !== undefined ? insalesClientId : undefined,
    smsActive: phone?.trim() ? !!smsActive : undefined,
    emailActive: email?.trim() ? !!emailActive : undefined,
    tags: Array.isArray(tags) ? tags : undefined,
    attributes: attributes && typeof attributes === "object" ? attributes : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const admin = createAdminClient();
  if (sys.timezone !== undefined) await setIdentityTimezone(admin, projectId, identityId, sys.timezone);
  if (sys.ymClientIds !== undefined) await setYmClientIds(admin, projectId, identityId, sys.ymClientIds);
  await writeAudit({
    projectId,
    entity: "subscriber",
    entityId: identityId,
    name: name?.trim() || composeName(firstName, lastName) || phone?.trim() || email?.trim() || null,
    action: "update",
  });
  return NextResponse.json({ ok: true });
}
