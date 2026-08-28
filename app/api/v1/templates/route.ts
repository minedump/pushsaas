import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiCall } from "@/lib/apiLog";

// GET /api/v1/templates   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
// Список шаблонов проекта (id, name, channel) — id подставляется в
// /api/v1/campaigns как templateId. ?channel=push|sms|email фильтрует по каналу.
// Полное содержимое одного шаблона — GET /api/v1/templates/{id}.
export async function GET(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const channel = new URL(req.url).searchParams.get("channel");

  const admin = createAdminClient();
  let q = admin.from("templates").select("id, name, channel").eq("project_id", projectId).order("updated_at", { ascending: false });
  if (channel === "push" || channel === "sms" || channel === "email") q = q.eq("channel", channel);
  const { data: templates, error } = await q;
  if (error) return NextResponse.json({ templates: [] });

  return NextResponse.json({ templates: templates ?? [] });
}

// POST /api/v1/templates   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
//
// { name, channel: "push"|"sms"|"email", folderId?, context?,
//   subject?, html?,                         — email
//   title?, body?, url?, icon?, image?, badge?, actions?,   — push
//   body? }                                                 — sms (тем же полем body, что и push-текст)
//
// name и channel обязательны; по каналу нужно: email — html, push — title и
// body (title ≤ 80, body ≤ 200 символов — тот же лимит, что и у самой
// рассылки), sms — body. actions — до 2 кнопок [{title,url}]. context —
// объект, замораживается как дефолтный Liquid-контекст шаблона (см.
// GET /api/v1/docs, раздел «Шаблонизация») — переопределяется разовым
// templateData при отправке, если он передан.
export async function POST(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { name, channel, folderId, context, subject, html, title, body: pushBody, url, icon, image, badge, actions } = body as {
    name?: string;
    channel?: string;
    folderId?: string;
    context?: Record<string, unknown>;
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

  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (channel !== "push" && channel !== "sms" && channel !== "email") return NextResponse.json({ error: "channel must be push, sms or email" }, { status: 400 });
  if (channel === "email" && !html?.trim()) return NextResponse.json({ error: "html required" }, { status: 400 });
  if (channel === "push" && (!title?.trim() || !pushBody?.trim())) return NextResponse.json({ error: "title and body required" }, { status: 400 });
  if (channel === "push" && title!.length > 80) return NextResponse.json({ error: "title longer than 80 characters" }, { status: 400 });
  if (channel === "push" && pushBody!.length > 200) return NextResponse.json({ error: "body longer than 200 characters" }, { status: 400 });
  if (channel === "sms" && !pushBody?.trim()) return NextResponse.json({ error: "body required" }, { status: 400 });

  const admin = createAdminClient();
  let validFolderId: string | null = null;
  if (folderId) {
    const { data: folder } = await admin.from("template_folders").select("id").eq("id", folderId).eq("project_id", projectId).maybeSingle();
    validFolderId = folder?.id || null;
  }

  const { data: created, error } = await admin
    .from("templates")
    .insert({
      project_id: projectId,
      name: name.trim(),
      channel,
      folder_id: validFolderId,
      context: context || null,
      subject: channel === "email" ? subject?.trim() || null : null,
      html: channel === "email" ? html : null,
      title: channel === "push" ? title!.trim() : null,
      body: channel === "push" || channel === "sms" ? pushBody : null,
      url: channel === "push" ? url?.trim() || null : null,
      icon_url: channel === "push" ? icon?.trim() || null : null,
      image_url: channel === "push" ? image?.trim() || null : null,
      badge_url: channel === "push" ? badge?.trim() || null : null,
      actions: channel === "push" && Array.isArray(actions) ? actions.filter((a) => a?.title?.trim() && a?.url?.trim()).slice(0, 2) : [],
    })
    .select("id")
    .single();
  if (error || !created) {
    const responseBody = { error: "create failed" };
    await logApiCall(admin, projectId, "templates", 500, body, responseBody);
    return NextResponse.json(responseBody, { status: 500 });
  }

  const responseBody = { ok: true, id: created.id };
  await logApiCall(admin, projectId, "templates", 201, body, responseBody);
  return NextResponse.json(responseBody, { status: 201 });
}
