import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";

// Best-effort: subset of ids whose subscriber row has paused=true. Returns an
// empty set (excludes nobody) if the column doesn't exist yet — degrades to
// pre-migration behaviour instead of erroring the caller's whole query.
async function pausedIdsAmong(admin: ReturnType<typeof createAdminClient>, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await admin.from("subscribers").select("id").eq("paused", true).in("id", ids);
  if (error || !data?.length) return new Set();
  return new Set(data.map((r) => r.id));
}

type DeviceRow = { subscriber_id: string; subscribers: unknown };
async function activeUnpausedIds(admin: ReturnType<typeof createAdminClient>, links: DeviceRow[] | null): Promise<string[]> {
  const active = [...new Set((links || [])
    .filter((l) => (l.subscribers as { is_active: boolean } | null)?.is_active)
    .map((l) => l.subscriber_id))];
  const paused = await pausedIdsAmong(admin, active);
  return active.filter((id) => !paused.has(id));
}

// Телефоны -> id активных (не приостановленных) push-устройств, привязанных
// к ним (identity_devices). Используется API v1 для адресной отправки.
export async function phonesToSubscriberIds(projectId: string, phones: string[]): Promise<string[]> {
  const normalized = [...new Set(phones.map((p) => normalizePhone(p)).filter((p): p is string => !!p))];
  if (!normalized.length) return [];

  const admin = createAdminClient();
  const { data: identities } = await admin
    .from("identities")
    .select("id")
    .eq("project_id", projectId)
    .in("phone", normalized);
  if (!identities?.length) return [];

  const { data: links } = await admin
    .from("identity_devices")
    .select("subscriber_id, subscribers!inner(id, is_active)")
    .in("identity_id", identities.map((i) => i.id));

  return activeUnpausedIds(admin, links);
}

// Email -> id устройств. Email становится известным только когда его удаётся
// сопоставить с уже подтверждённым телефоном (см. captureEmailForPhone) —
// самостоятельного входа по email нет, это только адресная отправка.
export async function emailsToSubscriberIds(projectId: string, emails: string[]): Promise<string[]> {
  const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!normalized.length) return [];

  const admin = createAdminClient();
  const { data: identities } = await admin
    .from("identities")
    .select("id")
    .eq("project_id", projectId)
    .in("email", normalized);
  if (!identities?.length) return [];

  const { data: links } = await admin
    .from("identity_devices")
    .select("subscriber_id, subscribers!inner(id, is_active)")
    .in("identity_id", identities.map((i) => i.id));

  return activeUnpausedIds(admin, links);
}

// Обогащение профиля: если у ПОДТВЕРЖДЁННОГО телефона в проекте ещё нет email,
// а он пришёл в теле вебхука заказа рядом с телефоном — сохраняем. Так email
// "попадает в базу" без отдельного флоу: он приезжает вместе с транзакционными
// вебхуками (обычно client.email рядом с client.phone в заказе).
export async function captureEmailForPhone(projectId: string, phoneDigits: string, email: string | null | undefined) {
  const clean = (email || "").trim().toLowerCase();
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return;

  const admin = createAdminClient();
  const { data: identity } = await admin
    .from("identities")
    .select("id, email")
    .eq("project_id", projectId)
    .eq("phone", phoneDigits)
    .maybeSingle();
  if (identity && !identity.email) {
    await admin.from("identities").update({ email: clean }).eq("id", identity.id);
  }
}
