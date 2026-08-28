import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import { fireWelcomeAutomations } from "@/lib/sender";

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

// Кому из контактов интересен конкретный товар (избранное/корзина/свой
// именованный список) — для вебхук-триггеров «цена снижена»/«товар в
// наличии» (см. app/api/v1/trigger). Список копится сам из client-side
// событий cart_updated/favorite_updated (полный снимок) или {имя}_added/
// {имя}_removed (свой список, любое имя — см. ingest_event, migration 0070),
// это НЕ то же самое, что подписка на push — контакт может быть sms/email-
// only. listType — "any" (в любом списке) или конкретное имя, не только
// favorite/cart. Пусто — значит товар ни у кого не в списке, вызывающий код
// просто ничего не отправляет.
export async function resolveIdentitiesForProduct(
  projectId: string,
  productId: string,
  listType: string
): Promise<string[]> {
  const admin = createAdminClient();
  let query = admin.from("identity_product_lists").select("identity_id").eq("project_id", projectId).eq("product_id", productId);
  if (listType !== "any") query = query.eq("list_type", listType);
  const { data } = await query;
  return [...new Set((data || []).map((r) => r.identity_id))];
}

// Забирает накопленный список «просмотров» (list_type='viewed', копится на
// product_viewed/category_viewed — см. ingest_event, migration 0068) И СРАЗУ
// ЖЕ очищает его одним запросом (DELETE...RETURNING, атомарно — не отдельные
// select+delete) — используется настройкой «Очищать список после отправки»
// у событийной автоматизации (см. run-automations): забрали то, что
// накопилось с прошлой отправки, разослали, следующий цикл просмотров
// начинается с нуля. Пусто — просмотров с прошлой отправки не было,
// вызывающий код просто продолжит с одиночным id из самого события.
// Очищаем ДО подтверждения успешной отправки (тот же принцип, что и у
// claim'а automation_jobs выше по стеку — без повторной отправки при сбое).
export async function consumeViewedProductIds(identityId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("identity_product_lists").delete().eq("identity_id", identityId).eq("list_type", "viewed").select("product_id");
  return (data || []).map((r) => r.product_id);
}

export async function consumeViewedCategoryIds(identityId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("identity_category_lists").delete().eq("identity_id", identityId).eq("list_type", "viewed").select("category_id");
  return (data || []).map((r) => r.category_id);
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
  attributes?: Record<string, string | null>;
};
export type UpsertContactResult = { ok: true; id: string; created: boolean } | { ok: false; error: string };

// Полноценное создание/редактирование контакта — единственный публичный
// способ (см. /api/v1/subscribers) пометить телефон/email АКТИВНЫМ для
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
    .select("id, name, phone, email, insales_client_id, tags, sms_marketing_active_at, email_marketing_active_at")
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
    logChannelEvents(admin, projectId, existing.id, input, phone || existing.phone, email || existing.email, {
      sms: !!existing.sms_marketing_active_at,
      email: !!existing.email_marketing_active_at,
    });
    // Общая история изменений — только поля, реально пришедшие в patch.
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ["name", "phone", "email", "insales_client_id", "tags"] as const) {
      if (key in patch) {
        before[key] = existing[key as keyof typeof existing];
        after[key] = patch[key];
      }
    }
    logFieldChanges(admin, projectId, existing.id, before, after);
    return { ok: true, id: existing.id, created: false };
  }
  const { data: created, error } = await admin
    .from("identities")
    .insert({ project_id: projectId, ...patch })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message || "insert failed" };
  logChannelEvents(admin, projectId, created.id, input, phone, email, { sms: false, email: false });
  return { ok: true, id: created.id, created: true };
}

// Журнал включений/отключений SMS/Email-рассылки по identity (см. вкладку
// «События подписчиков» в Журнале) — единственная точка записи, потому что
// upsertContact/updateContact — единственные места, где smsActive/emailActive
// реально применяются. Best-effort: ошибка записи события не должна ронять
// сам upsert. `before` — было ли согласие уже включено ДО этой правки: канал
// «Активен» впервые (было выключено/не было вовсе → включили) — единственный
// момент, когда стреляют приветственные автоматизации этого канала (см.
// fireWelcomeAutomations в lib/sender.ts); повторное сохранение с уже
// включённым согласием их не дублирует.
function logChannelEvents(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  identityId: string,
  input: UpsertContactInput,
  contactPhone: string | null,
  contactEmail: string | null,
  before: { sms: boolean; email: boolean }
) {
  // Логируем строку и в истории карточки, и в identity_channel_events
  // только при РЕАЛЬНОЙ смене состояния (before.sms/before.email) — форма
  // редактирования подписчика присылает smsActive/emailActive отражением
  // текущих чекбоксов при КАЖДОМ сохранении, даже если их не трогали, иначе
  // "включён"/"выключен" задваивалось бы при каждой правке любого другого поля.
  const rows: { project_id: string; identity_id: string; channel: "sms" | "email"; active: boolean; contact: string }[] = [];
  if (input.smsActive !== undefined && input.smsActive !== before.sms && contactPhone) {
    rows.push({ project_id: projectId, identity_id: identityId, channel: "sms", active: input.smsActive, contact: contactPhone });
    if (input.smsActive) fireWelcomeAutomations(projectId, "sms", { identityId }).catch(() => {});
  }
  if (input.emailActive !== undefined && input.emailActive !== before.email && contactEmail) {
    rows.push({ project_id: projectId, identity_id: identityId, channel: "email", active: input.emailActive, contact: contactEmail });
    if (input.emailActive) fireWelcomeAutomations(projectId, "email", { identityId }).catch(() => {});
  }
  if (rows.length) admin.from("identity_channel_events").insert(rows).then(() => {}, () => {});
}

// "" считается тем же "нет значения", что и null/undefined — иначе доп.
// поле, которого у контакта никогда не было (форма присылает его пустой
// строкой для КАЖДОГО известного проекту ключа, см. EditSubscriberForm),
// логировалось бы как изменение "— → —" при каждом сохранении формы, хотя
// ничего реально не поменялось.
function normalizeForDiff(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) return v.length ? [...v].map(String).sort().join(", ") : null;
  return String(v);
}

// Общий журнал изменений данных контакта (см. identity_field_changes,
// миграция 0041) — единая история для карточки подписчика, помимо
// identity_channel_events (тот остаётся для SMS/Email-согласия). `before`/
// `after` — плоские объекты с ОДИНАКОВЫМ набором ключей: только те поля,
// которые реально затронуты этой правкой (не весь контакт целиком) — иначе
// нетронутые поля считались бы "изменившимися" при первом же сравнении
// undefined-с-undefined. Массивы (теги) сравниваются как множества —
// перестановка порядка не считается изменением. Best-effort, не блокирует
// сам апдейт.
export function logFieldChanges(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  identityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  const rows: { project_id: string; identity_id: string; field: string; old_value: string | null; new_value: string | null }[] = [];
  for (const key of Object.keys(after)) {
    const av = normalizeForDiff(before[key]);
    const bv = normalizeForDiff(after[key]);
    if (av === bv) continue;
    rows.push({ project_id: projectId, identity_id: identityId, field: key, old_value: av, new_value: bv });
  }
  if (rows.length) admin.from("identity_field_changes").insert(rows).then(() => {}, () => {});
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
  const { data: existing } = await admin
    .from("identities")
    .select("id, name, phone, email, insales_client_id, tags, attributes, sms_marketing_active_at, email_marketing_active_at")
    .eq("id", identityId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "not found" };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now, phone, email };
  if (input.name !== undefined) patch.name = input.name?.trim() || null;
  if (input.insalesClientId !== undefined) patch.insales_client_id = input.insalesClientId?.trim() || null;
  if (input.smsActive !== undefined) patch.sms_marketing_active_at = input.smsActive ? now : null;
  if (input.emailActive !== undefined) patch.email_marketing_active_at = input.emailActive ? now : null;
  if (input.tags !== undefined) patch.tags = input.tags;
  // Мёрж, не замена — форма редактирования показывает только ключи,
  // встречавшиеся хотя бы у одного контакта проекта на момент открытия
  // страницы (см. edit/page.tsx); ключ, добавленный кому-то ПОСЛЕ этого
  // (например, свежим CSV-импортом), не должен потеряться здесь молча.
  // Значение null — сигнал удалить ключ целиком (форма даёт убрать доп.
  // поле), а не просто очистить его текстом.
  let mergedAttrs: Record<string, unknown> | null = null;
  if (input.attributes !== undefined) {
    mergedAttrs = { ...((existing.attributes as object) || {}) };
    for (const [key, value] of Object.entries(input.attributes)) {
      if (value === null) delete mergedAttrs[key];
      else mergedAttrs[key] = value;
    }
  }
  if (mergedAttrs) patch.attributes = mergedAttrs;

  const { error } = await admin.from("identities").update(patch).eq("id", identityId);
  if (error) return { ok: false, error: error.message };
  logChannelEvents(admin, projectId, identityId, input, phone, email, {
    sms: !!existing.sms_marketing_active_at,
    email: !!existing.email_marketing_active_at,
  });
  // Общая история изменений (карточка подписчика) — только поля, которые
  // реально пришли в этой правке, плюс изменившиеся доп. поля (attr:<ключ>,
  // чтобы не путаться с одноимённым обычным полем контакта).
  const before: Record<string, unknown> = { phone: existing.phone, email: existing.email };
  const after: Record<string, unknown> = { phone, email };
  if (input.name !== undefined) {
    before.name = existing.name;
    after.name = patch.name;
  }
  if (input.insalesClientId !== undefined) {
    before.insales_client_id = existing.insales_client_id;
    after.insales_client_id = patch.insales_client_id;
  }
  if (input.tags !== undefined) {
    before.tags = existing.tags;
    after.tags = input.tags;
  }
  if (input.attributes) {
    const existingAttrs = (existing.attributes as Record<string, unknown>) || {};
    for (const key of Object.keys(input.attributes)) {
      before[`attr:${key}`] = existingAttrs[key];
      after[`attr:${key}`] = input.attributes[key];
    }
  }
  logFieldChanges(admin, projectId, identityId, before, after);
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

// Очистка «Событий на сайте» карточки контакта (таблица events, см. миграцию
// 0007/0070) — сырой трекинг-стрим, только диагностика/наглядность, ни на
// что не влияет (списки избранного/корзины строятся отдельно, в
// identity_product_lists, и этой очисткой не затрагиваются).
export async function clearSiteEvents(projectId: string, identityId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: links } = await admin.from("identity_devices").select("subscriber_id").eq("identity_id", identityId);
  const subscriberIds = (links || []).map((l) => l.subscriber_id);
  if (!subscriberIds.length) return { ok: true };
  const { error } = await admin.from("events").delete().eq("project_id", projectId).in("subscriber_id", subscriberIds);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Очистка «Истории изменений» — переключения каналов (identity_channel_events)
// и правки полей (identity_field_changes). Устройства в эту очистку
// НЕ входят — это не история, а текущий список реальных push-подписок,
// удалять их тут значило бы отвязать реальные устройства от контакта.
export async function clearIdentityHistory(projectId: string, identityId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { error: e1 } = await admin.from("identity_channel_events").delete().eq("project_id", projectId).eq("identity_id", identityId);
  if (e1) return { ok: false, error: e1.message };
  const { error: e2 } = await admin.from("identity_field_changes").delete().eq("project_id", projectId).eq("identity_id", identityId);
  if (e2) return { ok: false, error: e2.message };
  return { ok: true };
}

// Обогащение профиля: identity уже резолвлена (по телефону, email ИЛИ
// внешнему id — см. app/api/v1/trigger/route.ts), а тело вебхука может
// нести и остальные поля рядом (обычно client.phone/client.email/client.id
// вместе в одном заказе) — досохраняем то, чего у контакта ещё нет,
// НИКОГДА не перезаписывая уже заданное значение (это не повторная
// верификация, просто попутное заполнение профиля).
export async function enrichIdentityFields(
  identityId: string,
  fields: { phone?: string | null; email?: string | null; insales_client_id?: string | null }
): Promise<void> {
  const admin = createAdminClient();
  const { data: identity } = await admin.from("identities").select("phone, email, insales_client_id").eq("id", identityId).maybeSingle();
  if (!identity) return;

  const patch: Record<string, string> = {};
  if (fields.phone && !identity.phone) {
    const normalized = normalizePhone(fields.phone);
    if (normalized) patch.phone = normalized;
  }
  if (fields.email && !identity.email) {
    const clean = fields.email.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) patch.email = clean;
  }
  if (fields.insales_client_id && !identity.insales_client_id) patch.insales_client_id = fields.insales_client_id;

  if (Object.keys(patch).length) {
    await admin.from("identities").update(patch).eq("id", identityId);
  }
}
