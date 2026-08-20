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

// bypassPause — транзакционные сообщения (код входа, статус заказа и т.п.)
// не требуют согласия на push-рассылки: is_active всё равно гейтит (нет
// активной подписки — физически некуда слать), а paused — это ручной
// маркетинговый опт-аут (см. SubscribersTable «Приостановить подписку»),
// который транзакционные сообщения обязаны игнорировать.
type DeviceRow = { subscriber_id: string; subscribers: unknown };
async function activeUnpausedIds(admin: ReturnType<typeof createAdminClient>, links: DeviceRow[] | null, bypassPause = false): Promise<string[]> {
  const active = [...new Set((links || [])
    .filter((l) => (l.subscribers as { is_active: boolean } | null)?.is_active)
    .map((l) => l.subscriber_id))];
  if (bypassPause) return active;
  const paused = await pausedIdsAmong(admin, active);
  return active.filter((id) => !paused.has(id));
}

// Телефоны -> id активных push-устройств, привязанных к ним (identity_devices).
// Используется API v1 и адресной отправкой из формы рассылки. bypassPause —
// см. activeUnpausedIds.
export async function phonesToSubscriberIds(projectId: string, phones: string[], opts: { bypassPause?: boolean } = {}): Promise<string[]> {
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

  return activeUnpausedIds(admin, links, opts.bypassPause);
}

// Email -> id устройств. Email становится известным только когда его удаётся
// сопоставить с уже подтверждённым телефоном (см. captureEmailForPhone) —
// самостоятельного входа по email нет, это только адресная отправка.
export async function emailsToSubscriberIds(projectId: string, emails: string[], opts: { bypassPause?: boolean } = {}): Promise<string[]> {
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

  return activeUnpausedIds(admin, links, opts.bypassPause);
}

// Для кнопки «Проверить» у поля адресной push-отправки — какие ИМЕННО из
// введённых телефонов/email резолвятся в активное устройство, а не просто
// сколько устройств нашлось (в отличие от phonesToSubscriberIds/
// emailsToSubscriberIds, которые возвращают id устройств и теряют связь с
// исходным контактом). Возвращает нормализованные значения (цифры для
// телефона, lowercase для email) — не исходное написание.
// segmentTags — если задан сегмент, это ДОПОЛНИТЕЛЬНОЕ требование к
// введённым контактам (пересечение, не отдельная проверка): контакт должен
// не только резолвиться в активное устройство, но и принадлежать подписчику
// из этого сегмента. Кнопка «Проверить» отвечает только за то, что уже
// вписано в поле «Контакты» — сам по себе сегмент (без контактов) через эту
// кнопку не резолвится, это отдельный путь при реальной отправке.
export async function checkPushContacts(
  projectId: string,
  field: "phone" | "email",
  values: string[],
  opts: { bypassPause?: boolean; segmentTags?: string[] } = {}
): Promise<string[]> {
  const normalized = [...new Set(
    field === "phone" ? values.map((v) => normalizePhone(v)).filter((v): v is string => !!v) : values.map((v) => v.trim().toLowerCase()).filter(Boolean)
  )];
  if (!normalized.length) return [];

  const admin = createAdminClient();
  const { data: identities } = await admin
    .from("identities")
    .select(`id, ${field}, tags`)
    .eq("project_id", projectId)
    .in(field, normalized);
  if (!identities?.length) return [];

  const tags = opts.segmentTags?.filter(Boolean) || [];
  const matching = tags.length
    ? (identities as Record<string, unknown>[]).filter((i) => {
        const idTags = (i.tags as string[] | null) || [];
        return tags.some((t) => idTags.includes(t));
      })
    : (identities as Record<string, unknown>[]);
  if (!matching.length) return [];

  const { data: links } = await admin
    .from("identity_devices")
    .select("identity_id, subscriber_id, subscribers!inner(id, is_active)")
    .in("identity_id", matching.map((i) => i.id as string));
  const activeSubscriberIds = new Set(await activeUnpausedIds(admin, links, opts.bypassPause));

  const identityIdsWithActiveDevice = new Set(
    (links || []).filter((l) => activeSubscriberIds.has(l.subscriber_id)).map((l) => l.identity_id)
  );

  return matching
    .filter((i) => identityIdsWithActiveDevice.has(i.id as string))
    .map((i) => i[field] as string);
}

// Сегмент по тегам identity -> id активных push-устройств. Теги живут на
// контакте (identities.tags), а не на устройстве — один контакт с двумя
// устройствами (телефон+десктоп) должен попасть в сегмент обоими сразу.
// Анонимные устройства (без привязанной identity) в сегмент попасть не
// могут — им негде хранить теги, это осознанное следствие переноса тегов
// на identities. Пауза НЕ учитывается здесь — вызывающий код (dispatchCampaign)
// применяет её отдельно, с учётом типа рассылки (excludePaused), так что
// фильтрация тут привела бы к двойному и не всегда верному исключению.
export async function resolvePushSegmentIds(projectId: string, segmentTags: string[]): Promise<string[]> {
  const tags = segmentTags.filter(Boolean);
  if (!tags.length) return [];

  const admin = createAdminClient();
  const { data: identities } = await admin
    .from("identities")
    .select("id")
    .eq("project_id", projectId)
    .overlaps("tags", tags);
  if (!identities?.length) return [];

  const { data: links } = await admin
    .from("identity_devices")
    .select("subscriber_id, subscribers!inner(id, is_active)")
    .in("identity_id", identities.map((i) => i.id));

  return [...new Set(
    (links || [])
      .filter((l) => (l.subscribers as unknown as { is_active: boolean } | null)?.is_active)
      .map((l) => l.subscriber_id)
  )];
}

// Адресная отправка (явно вписанные телефоны/email) — не повод пропустить
// проверку согласия: гейтим по тому же *_marketing_active_at, что и
// сегментная отправка (см. resolveSmsEmailAudience в lib/sender.ts), а не
// *_verified_at. Нет identity с этим контактом или согласие не включено —
// контакт просто не попадает в результат, это не ошибка ввода, а отсутствие согласия.
// bypassConsent — транзакционные сообщения игнорируют это согласие: важен
// только факт, что контакт вообще есть в базе проекта (см. вызов ниже).
//
// field — какой канал шлём (его целевое поле: phone для SMS, email для
// Email), а НЕ то, в каком виде обязательно ввёл админ. values — сырой
// список контактов из поля «Контакты» может содержать оба формата сразу
// (например, при отправке письма кто-то указал телефон) — ищем совпадение
// и по phone, и по email в одной identity, но возвращаем всегда значение
// нужного каналу поля: если для SMS передали email, résolve её телефон.
// segmentTags — как и у checkPushContacts выше: ДОПОЛНИТЕЛЬНОЕ требование к
// уже введённым контактам (пересечение), не отдельная проверка сегмента.
// Используется только кнопкой «Проверить» (см. check-contacts/route.ts) —
// реальная отправка (resolveSmsEmailAudience в lib/sender.ts) сегмент сюда
// не передаёт, там сегмент — самостоятельный источник аудитории, не фильтр.
export async function filterConsentedContacts(
  projectId: string,
  field: "phone" | "email",
  values: string[],
  opts: { bypassConsent?: boolean; segmentTags?: string[] } = {}
): Promise<string[]> {
  const phoneLike = [...new Set(values.filter((v) => !v.includes("@")).map((v) => normalizePhone(v)).filter((v): v is string => !!v))];
  const emailLike = [...new Set(values.filter((v) => v.includes("@")).map((v) => v.trim().toLowerCase()).filter(Boolean))];
  if (!phoneLike.length && !emailLike.length) return [];

  const admin = createAdminClient();
  const activeCol = field === "phone" ? "sms_marketing_active_at" : "email_marketing_active_at";
  const tags = opts.segmentTags?.filter(Boolean) || [];
  const result = new Set<string>();

  async function collect(lookupField: "phone" | "email", vals: string[]) {
    if (!vals.length) return;
    let q = admin.from("identities").select(`id, ${field}, ${activeCol}, tags`).eq("project_id", projectId).in(lookupField, vals);
    if (!opts.bypassConsent) q = q.not(activeCol, "is", null);
    const { data } = await q;
    if (!data?.length) return;

    for (const row of data as Record<string, unknown>[]) {
      if (tags.length) {
        const rowTags = (row.tags as string[] | null) || [];
        if (!tags.some((t) => rowTags.includes(t))) continue;
      }
      const value = row[field] as string;
      if (value) result.add(value);
    }
  }
  await Promise.all([collect("phone", phoneLike), collect("email", emailLike)]);
  return [...result];
}

export type UpsertContactInput = {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  insalesClientId?: string | null;
  smsActive?: boolean;
  emailActive?: boolean;
  tags?: string[];
};
export type UpsertContactResult = { ok: true; id: string; created: boolean } | { ok: false; error: string };

// Полноценное создание/редактирование контакта — единственный публичный
// способ (см. /api/v1/contacts) пометить телефон/email АКТИВНЫМ для
// маркетинговых рассылок: sms_marketing_active_at/email_marketing_active_at
// не выставляются нигде больше — ни входом по коду (*_verified_at — это
// доказательство владения номером, не согласие на рассылку), ни
// обогащением из вебхука заказа. true -> ставим текущее время, false ->
// явно снимаем активность (это же единственная сейчас отписка от SMS/Email;
// у push для этого есть свой subscribers.paused). Ищет identity по
// переданному телефону, иначе по email; остальные поля дозаписывает поверх
// найденной или новой записи, не трогая то, что не передано.
export async function upsertContact(projectId: string, input: UpsertContactInput): Promise<UpsertContactResult> {
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const email = input.email ? input.email.trim().toLowerCase() : null;
  if (input.phone && !phone) return { ok: false, error: "invalid phone" };
  if (input.email && !email) return { ok: false, error: "invalid email" };
  if (!phone && !email) return { ok: false, error: "phone or email required" };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("identities")
    .select("id, phone, email")
    .eq("project_id", projectId)
    .eq(phone ? "phone" : "email", phone || email)
    .maybeSingle();

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (phone) patch.phone = phone;
  if (email) patch.email = email;
  if (input.name?.trim()) patch.name = input.name.trim();
  if (input.insalesClientId?.trim()) patch.insales_client_id = input.insalesClientId.trim();
  if (input.smsActive !== undefined) patch.sms_marketing_active_at = input.smsActive ? now : null;
  if (input.emailActive !== undefined) patch.email_marketing_active_at = input.emailActive ? now : null;
  if (input.tags !== undefined) patch.tags = input.tags;

  if (existing) {
    await admin.from("identities").update(patch).eq("id", existing.id);
    logChannelEvents(admin, projectId, existing.id, input, phone || existing.phone, email || existing.email);
    return { ok: true, id: existing.id, created: false };
  }
  const { data: created, error } = await admin
    .from("identities")
    .insert({ project_id: projectId, ...patch })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message || "insert failed" };
  logChannelEvents(admin, projectId, created.id, input, phone, email);
  return { ok: true, id: created.id, created: true };
}

// Журнал включений/отключений SMS/Email-рассылки по identity (см. вкладку
// «События подписчиков» в Журнале) — единственная точка записи, потому что
// upsertContact — единственное место, где smsActive/emailActive реально
// применяются. Best-effort: ошибка записи события не должна ронять сам upsert.
function logChannelEvents(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  identityId: string,
  input: UpsertContactInput,
  contactPhone: string | null,
  contactEmail: string | null
) {
  const rows: { project_id: string; identity_id: string; channel: "sms" | "email"; active: boolean; contact: string }[] = [];
  if (input.smsActive !== undefined && contactPhone) {
    rows.push({ project_id: projectId, identity_id: identityId, channel: "sms", active: input.smsActive, contact: contactPhone });
  }
  if (input.emailActive !== undefined && contactEmail) {
    rows.push({ project_id: projectId, identity_id: identityId, channel: "email", active: input.emailActive, contact: contactEmail });
  }
  if (rows.length) admin.from("identity_channel_events").insert(rows).then(() => {}, () => {});
}

// Редактирование УЖЕ ИЗВЕСТНОГО контакта по его id (страница «Изменить
// подписчика») — в отличие от upsertContact, не ищет совпадение по
// телефону/email (тот id УЖЕ есть), поэтому явно перезаписывает phone/email
// даже в null, если поле очистили в форме. Требует хотя бы одного контакта
// после правки — иначе запись становится ничем не идентифицируемой.
export async function updateContact(projectId: string, identityId: string, input: UpsertContactInput): Promise<UpsertContactResult> {
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const email = input.email ? input.email.trim().toLowerCase() : null;
  if (input.phone && !phone) return { ok: false, error: "invalid phone" };
  if (input.email && !email) return { ok: false, error: "invalid email" };
  if (!phone && !email) return { ok: false, error: "phone or email required" };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("identities").select("id").eq("id", identityId).eq("project_id", projectId).maybeSingle();
  if (!existing) return { ok: false, error: "not found" };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now, phone, email };
  if (input.name !== undefined) patch.name = input.name?.trim() || null;
  if (input.insalesClientId !== undefined) patch.insales_client_id = input.insalesClientId?.trim() || null;
  if (input.smsActive !== undefined) patch.sms_marketing_active_at = input.smsActive ? now : null;
  if (input.emailActive !== undefined) patch.email_marketing_active_at = input.emailActive ? now : null;
  if (input.tags !== undefined) patch.tags = input.tags;

  const { error } = await admin.from("identities").update(patch).eq("id", identityId);
  if (error) return { ok: false, error: error.message };
  logChannelEvents(admin, projectId, identityId, input, phone, email);
  return { ok: true, id: identityId, created: false };
}

// Удаление контакта — только сама identity (телефон/email/имя/согласия);
// связанное push-устройство (subscribers), если было, никуда не девается —
// оно просто теряет привязку к контакту (identity_devices каскадно удаляется
// вместе с identity, см. 0003_identity_oidc.sql) и продолжает получать push
// как анонимное. Это осознанно: удаление контакта — не то же самое, что
// отписка устройства от push.
export async function deleteContact(projectId: string, identityId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from("identities").delete().eq("id", identityId).eq("project_id", projectId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
