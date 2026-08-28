import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateContact } from "@/lib/identity";
import { logApiCall } from "@/lib/apiLog";

function toSubscriber(row: {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  insales_client_id: string | null;
  tags: string[] | null;
  attributes: Record<string, unknown> | null;
  sms_marketing_active_at: string | null;
  email_marketing_active_at: string | null;
  created_at?: string;
}) {
  return {
    id: row.id,
    phone: row.phone,
    email: row.email,
    name: row.name,
    insalesClientId: row.insales_client_id,
    tags: row.tags || [],
    attributes: row.attributes || {},
    smsActive: !!row.sms_marketing_active_at,
    emailActive: !!row.email_marketing_active_at,
    createdAt: row.created_at,
  };
}

// GET /api/v1/subscribers/{id}   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { id } = await params;

  const admin = createAdminClient();
  const { data } = await admin
    .from("identities")
    .select("id, phone, email, name, insales_client_id, tags, attributes, sms_marketing_active_at, email_marketing_active_at, created_at")
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
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { id } = await params;

  const admin = createAdminClient();
  const { data: existing } = await admin.from("identities").select("phone, email").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "subscriber not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { phone, email, name, insalesClientId, tags, attributes, smsActive, emailActive } = body as {
    phone?: string | null;
    email?: string | null;
    name?: string | null;
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
    insalesClientId,
    tags,
    attributes,
    smsActive: typeof smsActive === "boolean" ? smsActive : undefined,
    emailActive: typeof emailActive === "boolean" ? emailActive : undefined,
  });
  const httpStatus = result.ok ? 200 : result.error === "not found" ? 404 : 400;
  const responseBody = result.ok ? { ok: true, id: result.id } : { error: result.error };
  await logApiCall(admin, projectId, "subscribers", httpStatus, body, responseBody);
  if (!result.ok) return NextResponse.json(responseBody, { status: httpStatus });
  return NextResponse.json(responseBody);
}
