import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertContact } from "@/lib/identity";
import { normalizePhone } from "@/lib/phone";
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

// GET /api/v1/subscribers?limit=&offset=   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
//
// Список подписчиков проекта (раздел «Подписчики» — телефон/email/имя/теги/
// согласия на рассылку), сортировка — по дате создания, новые первыми.
// limit — по умолчанию 50, максимум 200. Счётчик активных push-подписок
// (устройств), отдельно от этого списка — GET /api/v1/subscribers/push-stats.
export async function GET(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(q.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(q.get("offset")) || 0, 0);

  const admin = createAdminClient();
  const { data, count, error } = await admin
    .from("identities")
    .select("id, phone, email, name, insales_client_id, tags, attributes, sms_marketing_active_at, email_marketing_active_at, created_at", { count: "exact" })
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return NextResponse.json({ subscribers: [], total: 0 });
  return NextResponse.json({ subscribers: (data || []).map(toSubscriber), total: count || 0 });
}

// POST /api/v1/subscribers   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
//
// { phone?, email?, name?, insalesClientId?, tags?, attributes?, smsActive?, emailActive? }
//
// Создаёт НОВОГО подписчика — хотя бы одно из phone/email обязательно.
// Подписчик с таким же phone (или, если phone не передан, email) уже
// существует — 409 с id найденного, редактируйте его через
// PUT /api/v1/subscribers/{id}, а не создавайте повторно.
//
// smsActive/emailActive — ЕДИНСТВЕННЫЙ способ пометить канал доступным для
// маркетинговых рассылок (сегментные SMS/Email-кампании и /api/v1/campaigns с
// segmentTags берут подписчика только отсюда, см. lib/sender.resolveSmsEmailAudience).
// Это НЕ то же самое, что подтверждение телефона/почты при входе по коду —
// вход доказывает владение номером, но не согласие на рассылки. true
// включает канал, false — выключает (отписка).
export async function POST(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { phone, email, name, insalesClientId, tags, attributes, smsActive, emailActive } = body as {
    phone?: string;
    email?: string;
    name?: string;
    insalesClientId?: string;
    tags?: string[];
    attributes?: Record<string, string | null>;
    smsActive?: boolean;
    emailActive?: boolean;
  };

  const normPhone = phone ? normalizePhone(phone) : null;
  const normEmail = email ? email.trim().toLowerCase() : null;
  if (phone && !normPhone) return NextResponse.json({ error: "invalid phone" }, { status: 400 });
  if (email && !normEmail) return NextResponse.json({ error: "invalid email" }, { status: 400 });
  if (!normPhone && !normEmail) return NextResponse.json({ error: "phone or email required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("identities")
    .select("id")
    .eq("project_id", projectId)
    .eq(normPhone ? "phone" : "email", normPhone || normEmail)
    .maybeSingle();
  if (existing) {
    const responseBody = { error: "subscriber already exists", id: existing.id };
    await logApiCall(admin, projectId, "subscribers", 409, body, responseBody);
    return NextResponse.json(responseBody, { status: 409 });
  }

  const result = await upsertContact(projectId, {
    phone,
    email,
    name,
    insalesClientId,
    tags,
    attributes,
    smsActive: typeof smsActive === "boolean" ? smsActive : undefined,
    emailActive: typeof emailActive === "boolean" ? emailActive : undefined,
  });
  const httpStatus = result.ok ? 201 : 400;
  const responseBody = result.ok ? { ok: true, id: result.id } : { error: result.error };
  await logApiCall(admin, projectId, "subscribers", httpStatus, body, responseBody);
  return NextResponse.json(responseBody, { status: httpStatus });
}
