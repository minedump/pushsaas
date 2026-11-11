import { NextResponse } from "next/server";
import { authenticateApiKey, hasScope } from "@/lib/apikey";
import { auditAs } from "@/lib/auditContext";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateContact, setIdentityTimezone, setYmClientIds } from "@/lib/identity";
import { logApiCall } from "@/lib/apiLog";
import { parseSystemFields } from "@/lib/shopFields";

function toSubscriber(row: {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  last_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  insales_client_id: string | null;
  tags: string[] | null;
  attributes: Record<string, unknown> | null;
  sms_marketing_active_at: string | null;
  email_marketing_active_at: string | null;
  timezone?: string | null;
  ym_client_ids?: string[] | null;
  created_at?: string;
}) {
  return {
    id: row.id,
    phone: row.phone,
    email: row.email,
    name: row.name,
    lastName: row.last_name ?? null,
    firstName: row.first_name ?? null,
    middleName: row.middle_name ?? null,
    insalesClientId: row.insales_client_id,
    tags: row.tags || [],
    attributes: row.attributes || {},
    smsActive: !!row.sms_marketing_active_at,
    emailActive: !!row.email_marketing_active_at,
    timezone: row.timezone ?? null,
    ymClientIds: row.ym_client_ids ?? [],
    createdAt: row.created_at,
  };
}

// GET /api/v1/subscribers/{id}   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateApiKey(req);
  if (key) auditAs(null, "api");
  if (!key) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  if (!hasScope(key, "subscribers")) return NextResponse.json({ error: "api key missing scope: subscribers" }, { status: 403 });
  const { projectId } = key;
  const { id } = await params;

  const admin = createAdminClient();
  const { data } = await admin
    .from("identities")
    .select("id, phone, email, name, last_name, first_name, middle_name, insales_client_id, tags, attributes, sms_marketing_active_at, email_marketing_active_at, timezone, ym_client_ids, created_at")
    .eq("id", id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "subscriber not found" }, { status: 404 });
  return NextResponse.json(toSubscriber(data));
}

// PUT /api/v1/subscribers/{id}   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
//
// Редактирует уже существующего подписчика (см. POST /api/v1/subscribers для
// создания нового). Частичное обновление — поле не передано, значит не
// трогаем; phone/email — исключение, если ни один не передан, остаются
// прежними, но передать оба пустыми одновременно нельзя (подписчик должен
// быть идентифицируем хотя бы одним из двух).
//
// ФИО: lastName, firstName, middleName (null или "" очищает поле). name собирается из имени и фамилии;
// если переданы только name, он записывается как есть, а пустая разбивка заполняется из него.
//
// timezone — часовой пояс (IANA, например Europe/Moscow; null или "" очищает), ymClientIds — список
// ClientID Метрики: переданный список ЗАМЕНЯЕТ прежний (чтобы лишний id можно было убрать).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateApiKey(req);
  if (key) auditAs(null, "api");
  if (!key) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  if (!hasScope(key, "subscribers")) return NextResponse.json({ error: "api key missing scope: subscribers" }, { status: 403 });
  const { projectId } = key;
  const { id } = await params;

  const admin = createAdminClient();
  const { data: existing } = await admin.from("identities").select("phone, email").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "subscriber not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const sys = parseSystemFields(body as { timezone?: unknown; ymClientIds?: unknown });
  if ("error" in sys) return NextResponse.json({ error: sys.error }, { status: 400 });
  const { phone, email, name, lastName, firstName, middleName, insalesClientId, tags, attributes, smsActive, emailActive } = body as {
    phone?: string | null;
    email?: string | null;
    name?: string | null;
    lastName?: string | null;
    firstName?: string | null;
    middleName?: string | null;
    insalesClientId?: string | null;
    tags?: string[];
    attributes?: Record<string, string | null>;
    smsActive?: boolean;
    emailActive?: boolean;
  };

  const result = await updateContact(projectId, id, {
    phone: phone !== undefined ? phone : existing.phone,
    email: email !== undefined ? email : existing.email,
    name,
    lastName,
    firstName,
    middleName,
    insalesClientId,
    tags,
    attributes,
    smsActive: typeof smsActive === "boolean" ? smsActive : undefined,
    emailActive: typeof emailActive === "boolean" ? emailActive : undefined,
  });
  if (result.ok) {
    if (sys.timezone !== undefined) await setIdentityTimezone(admin, projectId, id, sys.timezone);
    if (sys.ymClientIds !== undefined) await setYmClientIds(admin, projectId, id, sys.ymClientIds);
  }
  const httpStatus = result.ok ? 200 : result.error === "not found" ? 404 : 400;
  const responseBody = result.ok ? { ok: true, id: result.id } : { error: result.error };
  await logApiCall(admin, projectId, "subscribers", httpStatus, body, responseBody);
  if (!result.ok) return NextResponse.json(responseBody, { status: httpStatus });
  return NextResponse.json(responseBody);
}
