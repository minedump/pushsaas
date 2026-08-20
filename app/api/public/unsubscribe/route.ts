import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

// Публичный, без авторизации — вызывается со страницы /unsubscribe после
// явного подтверждения (не голым GET по ссылке из письма: почтовые
// сканеры/антивирусы на корпоративных шлюзах автоматически переходят по
// ссылкам внутри писем, голый GET-эндпоинт отписал бы получателя без его
// участия). token — HMAC(projectId+email), см. lib/unsubscribe.ts.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { p: projectId, e: email, t: token } = body as { p?: string; e?: string; t?: string };
  if (!projectId || !email || !token) return NextResponse.json({ error: "Некорректная ссылка" }, { status: 400 });
  if (!verifyUnsubscribeToken(projectId, email, token)) return NextResponse.json({ error: "Некорректная или устаревшая ссылка" }, { status: 403 });

  const admin = createAdminClient();
  const normalized = email.trim().toLowerCase();
  const { data: identity } = await admin.from("identities").select("id").eq("project_id", projectId).eq("email", normalized).maybeSingle();
  // Не нашли identity — всё равно 200: не подтверждаем/опровергаем наличие
  // email в базе проекта незнакомцу, у которого просто есть подписанная
  // ссылка (например, переслал письмо кому-то ещё).
  if (identity) {
    await admin.from("identities").update({ email_marketing_active_at: null }).eq("id", identity.id);
    await admin
      .from("identity_channel_events")
      .insert({ project_id: projectId, identity_id: identity.id, channel: "email", active: false, contact: normalized })
      .then(
        () => {},
        () => {}
      );
  }
  return NextResponse.json({ ok: true });
}
