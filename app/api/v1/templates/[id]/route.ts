import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiCall } from "@/lib/apiLog";

const FULL_SELECT = "id, name, channel, folder_id, context, subject, html, title, body, url, icon_url, image_url, badge_url, actions, created_at, updated_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTemplate(t: any) {
  return {
    id: t.id,
    name: t.name,
    channel: t.channel,
    folderId: t.folder_id,
    context: t.context,
    subject: t.subject,
    html: t.html,
    title: t.title,
    body: t.body,
    url: t.url,
    icon: t.icon_url,
    image: t.image_url,
    badge: t.badge_url,
    actions: t.actions || [],
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

// GET /api/v1/templates/{id} — полное содержимое одного шаблона.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { id } = await params;

  const admin = createAdminClient();
  const { data } = await admin.from("templates").select(FULL_SELECT).eq("id", id).eq("project_id", projectId).maybeSingle();
  if (!data) return NextResponse.json({ error: "template not found" }, { status: 404 });
  return NextResponse.json(toTemplate(data));
}

// PUT /api/v1/templates/{id}   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
//
// Редактирует существующий шаблон (см. POST /api/v1/templates для создания
// нового) — та же форма тела, минус channel (канал шаблона неизменен после
// создания). Частичное обновление — поле не передано, значит не трогаем.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  const { id } = await params;

  const admin = createAdminClient();
  const { data: existing } = await admin.from("templates").select("channel, title, body, html").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "template not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { name, folderId, context, subject, html, title, body: pushBody, url, icon, image, badge, actions } = body as {
    name?: string;
    folderId?: string | null;
    context?: Record<string, unknown> | null;
    subject?: string;
    html?: string;
    title?: string;
    body?: string;
    url?: string;
    icon?: string;
    image?: string;
    badge?: string;
    actions?: { title: string; url: string }[];
  };

  const channel = existing.channel as "push" | "sms" | "email";
  const row: Record<string, unknown> = {};
  if (name !== undefined) {
    if (!name.trim()) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    row.name = name.trim();
  }
  if (context !== undefined) row.context = context;
  if (folderId !== undefined) {
    if (folderId) {
      const { data: folder } = await admin.from("template_folders").select("id").eq("id", folderId).eq("project_id", projectId).maybeSingle();
      row.folder_id = folder?.id || null;
    } else row.folder_id = null;
  }

  if (channel === "email") {
    if (subject !== undefined) row.subject = subject?.trim() || null;
    if (html !== undefined) row.html = html;
    const finalHtml = (row.html as string | undefined) ?? existing.html;
    if (!finalHtml?.trim()) return NextResponse.json({ error: "html cannot be empty" }, { status: 400 });
  } else if (channel === "push") {
    if (title !== undefined) row.title = title.trim();
    if (pushBody !== undefined) row.body = pushBody;
    if (url !== undefined) row.url = url?.trim() || null;
    if (icon !== undefined) row.icon_url = icon?.trim() || null;
    if (image !== undefined) row.image_url = image?.trim() || null;
    if (badge !== undefined) row.badge_url = badge?.trim() || null;
    if (actions !== undefined) row.actions = Array.isArray(actions) ? actions.filter((a) => a?.title?.trim() && a?.url?.trim()).slice(0, 2) : [];
    const finalTitle = (row.title as string | undefined) ?? existing.title;
    const finalBody = (row.body as string | undefined) ?? existing.body;
    if (!finalTitle?.trim() || !finalBody?.trim()) return NextResponse.json({ error: "title and body cannot be empty" }, { status: 400 });
    if (finalTitle.length > 80) return NextResponse.json({ error: "title longer than 80 characters" }, { status: 400 });
    if (finalBody.length > 200) return NextResponse.json({ error: "body longer than 200 characters" }, { status: 400 });
  } else {
    // sms
    if (pushBody !== undefined) row.body = pushBody;
    const finalBody = (row.body as string | undefined) ?? existing.body;
    if (!finalBody?.trim()) return NextResponse.json({ error: "body cannot be empty" }, { status: 400 });
  }

  const { error } = await admin.from("templates").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id).eq("project_id", projectId);
  if (error) {
    const responseBody = { error: "update failed" };
    await logApiCall(admin, projectId, "templates", 500, body, responseBody);
    return NextResponse.json(responseBody, { status: 500 });
  }
  const responseBody = { ok: true, id };
  await logApiCall(admin, projectId, "templates", 200, body, responseBody);
  return NextResponse.json(responseBody);
}
