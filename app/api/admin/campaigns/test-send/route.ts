import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTestMessage, resolvePushTemplate, resolveChannelTemplate } from "@/lib/sender";
import { withShortenedLinks } from "@/lib/linkPreview";

// Тестовая отправка одному контакту из формы создания/редактирования
// рассылки — не создаёт кампанию и не расходует аудиторию, только проверяет,
// как выглядит контент. См. sendTestMessage в lib/sender.ts.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { projectId, channel, contact, title, message, url, icon, image, badge, actions, text, subject, html, templateId, provider, data } = body as {
    projectId?: string;
    channel?: "push" | "sms" | "email";
    contact?: string;
    title?: string;
    message?: string;
    url?: string;
    icon?: string;
    image?: string;
    badge?: string;
    actions?: { title: string; url: string }[];
    text?: string;
    subject?: string;
    html?: string;
    templateId?: string;
    provider?: string;
    data?: Record<string, unknown>;
  };

  if (!projectId || !channel || !contact?.trim()) {
    return NextResponse.json({ error: "Не хватает данных" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  if (channel === "push") {
    let pushTitle = title?.trim() || "";
    let pushBody = message?.trim() || "";
    let pushUrl = url;
    let pushIcon = icon;
    let pushImage = image;
    let pushBadge = badge;
    let pushActions = actions;
    if (templateId) {
      const resolved = await resolvePushTemplate(admin, projectId, templateId, { title: pushTitle, body: pushBody, url, icon, image, badge, actions });
      pushTitle = resolved.title;
      pushBody = resolved.body;
      pushUrl = resolved.url;
      pushIcon = resolved.icon;
      pushImage = resolved.image;
      pushBadge = resolved.badge;
      pushActions = resolved.actions;
    }
    if (!pushTitle.trim() || !pushBody.trim()) {
      return NextResponse.json({ error: "Заполните заголовок и текст" }, { status: 400 });
    }
    if (pushTitle.length > 80) return NextResponse.json({ error: "Заголовок длиннее 80 символов" }, { status: 400 });
    if (withShortenedLinks(pushBody).length > 200) return NextResponse.json({ error: "Текст длиннее 200 символов" }, { status: 400 });
    const result = await sendTestMessage(projectId, "push", contact.trim(), {
      title: pushTitle,
      body: pushBody,
      url: pushUrl,
      icon: pushIcon,
      image: pushImage,
      badge: pushBadge,
      actions: pushActions,
      data,
    });
    if (!result.ok) return NextResponse.json({ error: result.error || "Ошибка отправки" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (channel === "sms") {
    const resolved = await resolveChannelTemplate(admin, projectId, "sms", templateId, { body: text });
    if (!resolved.body?.trim()) return NextResponse.json({ error: "Заполните текст SMS или выберите шаблон" }, { status: 400 });
    const result = await sendTestMessage(projectId, "sms", contact.trim(), { text: resolved.body, provider, data });
    if (!result.ok) return NextResponse.json({ error: result.error || "Ошибка отправки" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // email
  const resolved = await resolveChannelTemplate(admin, projectId, "email", templateId, { subject, html });
  if (!resolved.html?.trim()) return NextResponse.json({ error: "Выберите шаблон или заполните HTML" }, { status: 400 });
  const result = await sendTestMessage(projectId, "email", contact.trim(), { subject: resolved.subject || subject, html: resolved.html, provider, data });
  if (!result.ok) return NextResponse.json({ error: result.error || "Ошибка отправки" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
