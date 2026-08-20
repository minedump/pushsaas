import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { upsertContact } from "@/lib/identity";

// Ручное добавление контакта из раздела «Подписчики» — по аналогии с «Новый
// шаблон», но НЕ создаёт push-подписчика: subscribers.endpoint/p256dh/auth —
// настоящие ключи из Web Push API конкретного браузера, вручную их
// сфабриковать нельзя (и не нужно — без реального устройства push всё равно
// некуда слать). Создаёт/обогащает identities (см. lib/identity.upsertContact)
// — тот же путь, что и CSV-импорт/обогащение, только на одного контакта, а
// не найдено по уже существующему совпадению: здесь запись создаётся, если
// такого телефона/email в проекте ещё нет.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { projectId, phone, email, name, insalesClientId, smsActive, emailActive, tags } = body as {
    projectId?: string;
    phone?: string;
    email?: string;
    name?: string;
    insalesClientId?: string;
    smsActive?: boolean;
    emailActive?: boolean;
    tags?: string[];
  };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const phoneTrim = phone?.trim() || "";
  const emailTrim = email?.trim() || "";
  if (!phoneTrim && !emailTrim) return NextResponse.json({ error: "Укажите телефон или email" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const result = await upsertContact(projectId, {
    phone: phoneTrim || undefined,
    email: emailTrim || undefined,
    name: name?.trim() || undefined,
    insalesClientId: insalesClientId?.trim() || undefined,
    smsActive: phoneTrim ? !!smsActive : undefined,
    emailActive: emailTrim ? !!emailActive : undefined,
    tags: Array.isArray(tags) ? tags : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: result.id, created: result.created });
}
