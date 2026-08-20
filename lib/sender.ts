import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPush, type PushPayload } from "@/lib/webpush";
import { applyTemplate } from "@/lib/template";
import { subscribersToContacts, filterConsentedContacts, phonesToSubscriberIds, emailsToSubscriberIds } from "@/lib/identity";
import { sendSms } from "@/lib/otp/sms";
import { sendEmail } from "@/lib/otp/haskimail";
import { sendSmsSmsc, sendEmailSmsc } from "@/lib/otp/smsc";
import { shortenUrl } from "@/lib/clck";
import { normalizePhone } from "@/lib/phone";
import { unsubscribeUrl, hasUnsubscribeTag } from "@/lib/unsubscribe";

// Непрозрачный per-recipient токен для клика (?pss_r=...) — без PII в
// ссылке (см. миграцию 0024). 6 байт -> 8 символов base64url, достаточно
// для уникальности в пределах одной рассылки, не для криптографии.
function genRecipientToken(): string {
  return crypto.randomBytes(6).toString("base64url");
}

// Кнопки действий (rich push) поддерживают Liquid в тексте и ссылке точно
// так же, как заголовок/текст/ссылка клика — иначе {{ order_id }} в URL
// кнопки ушёл бы получателю буквально, без подстановки.
function renderPushActions(actions: PushAction[] | null | undefined, attrs: Record<string, unknown>): PushAction[] | undefined {
  if (!actions?.length) return undefined;
  return actions.map((a) => ({ title: applyTemplate(a.title, attrs), url: applyTemplate(a.url, attrs) }));
}

export type PushAction = { title: string; url: string };

type CampaignRow = {
  id: string;
  project_id: string;
  title: string;
  body: string;
  icon_url: string | null;
  image_url: string | null;
  click_url: string | null;
  badge_url?: string | null;
  segment_tags: string[] | null;
  actions?: PushAction[] | null;
  template_data?: Record<string, unknown> | null;
  type?: "transactional" | "marketing";
  contacts?: string[] | null;
};

export type DispatchResult = { ok: boolean; delivered: number; failed: number; total: number; error?: string };

// Сырые контакты (телефон и/или email вперемешку, см. migration 0034) ->
// id push-устройств. Тот же сплит по «есть @ или нет», что и везде в этом
// файле/identity.ts — не кросс-канальное сопоставление (у push нет единого
// «целевого поля», в отличие от sms/email): просто ищем устройство и по
// телефону, и по email отдельно, объединяем результат.
export async function resolvePushContactIds(projectId: string, contacts: string[], bypassPause: boolean): Promise<string[]> {
  const phoneLike = contacts.filter((c) => !c.includes("@"));
  const emailLike = contacts.filter((c) => c.includes("@"));
  const [byPhone, byEmail] = await Promise.all([
    phoneLike.length ? phonesToSubscriberIds(projectId, phoneLike, { bypassPause }) : Promise.resolve([]),
    emailLike.length ? emailsToSubscriberIds(projectId, emailLike, { bypassPause }) : Promise.resolve([]),
  ]);
  return [...new Set([...byPhone, ...byEmail])];
}

// Пер-контактный лог отправки (campaign_recipients, миграция 0023) — чтобы
// по кампании можно было скачать статус КАЖДОГО адресата, а не только
// агрегат delivered_count/failed_count. Best-effort: ошибка записи лога не
// должна валить саму отправку, которая уже состоялась.
async function logRecipients(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string,
  projectId: string,
  channel: "push" | "sms" | "email",
  rows: { contact: string; status: "delivered" | "failed"; token?: string }[]
) {
  if (!rows.length) return;
  await admin
    .from("campaign_recipients")
    .insert(rows.map((r) => ({ campaign_id: campaignId, project_id: projectId, channel, contact: r.contact, status: r.status, token: r.token ?? null })))
    .then(
      () => {},
      () => {}
    );
}

// Подмена ссылок в тексте SMS / HTML письма на версию с ?pss_c=<campaignId>
// (и, для sms/email, ?pss_r=<token> — персональный, привязан к строке в
// campaign_recipients, миграция 0024, без единого байта PII на проводе) —
// та же метка pss_c, что push уже проставляет в click_url (см.
// dispatchCampaign ниже и service-worker.js). Embed-скрипт на сайте клиента
// (app/embed/[projectId]/route.ts) её читает: шлёт нам клик в тот же
// campaigns.clicked_count, что уже используется в CTR/аналитике, плюс (при
// наличии pss_r) помечает clicked_at именно этому получателю — и, если
// включена атрибуция, ставит куку для привязки заказа к кампании. Работает
// только для ссылок на сайт с нашим embed-скриптом; сторонние ссылки просто
// получат безобидный лишний query-параметр.
function injectClickTracking(text: string, campaignId: string, token: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/g, (url) => {
    try {
      const u = new URL(url);
      u.searchParams.set("pss_c", campaignId);
      u.searchParams.set("pss_r", token);
      return u.toString();
    } catch {
      return url;
    }
  });
}

// Пиксель открытия письма — тот же token, что и у клик-трекинга (один
// получатель = одна строка campaign_recipients, не заводим отдельный token
// под открытия). /api/public/open отдаёт 1x1 GIF независимо от результата
// записи — почтовый клиент не должен видеть сломанную картинку из-за сбоя на
// нашей стороне. Перед </body>, если он есть — так пиксель не влияет на
// видимую вёрстку письма даже в клиентах, где отображается "сырой" HTML.
function injectOpenPixel(html: string, appUrl: string, campaignId: string, token: string): string {
  const pixel = `<img src="${appUrl}/api/public/open?c=${campaignId}&t=${token}" width="1" height="1" alt="" style="display:none" />`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${pixel}</body>`) : `${html}${pixel}`;
}

// SMS-версия: та же подмена, но вдобавок через clck.ru (lib/clck.ts)
// сокращает получившуюся ссылку — SMS тарифицируется по сегментам (обычно
// 160 символов), и добавленные ?pss_c=...&pss_r=... не должны случайно
// перевести сообщение в следующий сегмент. Вызывается НА КАЖДОГО получателя
// (ссылка теперь персональная — свой token), не один раз на кампанию, как
// раньше: проверено вживую — 1000 сокращений через clck.ru идут ~74мс каждое
// без единой ошибки/лимита, узким местом это не станет.
async function injectClickTrackingSms(text: string, campaignId: string, token: string): Promise<string> {
  const urls = text.match(/https?:\/\/[^\s"'<>]+/g);
  if (!urls?.length) return text;
  let result = text;
  for (const url of new Set(urls)) {
    let tracked: string;
    try {
      const u = new URL(url);
      u.searchParams.set("pss_c", campaignId);
      u.searchParams.set("pss_r", token);
      tracked = u.toString();
    } catch {
      continue;
    }
    const short = await shortenUrl(tracked);
    result = result.split(url).join(short);
  }
  return result;
}

// Ссылки в теле push-уведомления — экономим отображаемые символы (200-
// символьный лимит), сокращая через clck.ru так же, как для SMS (см.
// injectClickTrackingSms). Без клик-трекинга (?pss_c/?pss_r) — в отличие от
// SMS/email, текст уведомления сам по себе не кликабелен (кликабельны
// только click_url и кнопки действий, см. payload.url/actions ниже),
// добавлять трекинг-параметры в нечитаемую и некликабельную строку
// бессмысленно. cache — на время ОДНОЙ рассылки: обычная ссылка (не
// завязанная на Liquid-переменную) после рендера одинакова у всех
// получателей, сокращаем её один раз, а не на каждого адресата.
async function shortenBodyLinks(text: string, cache: Map<string, string>): Promise<string> {
  const urls = text.match(/https?:\/\/[^\s"'<>]+/g);
  if (!urls?.length) return text;
  let result = text;
  for (const url of new Set(urls)) {
    let short = cache.get(url);
    if (!short) {
      short = await shortenUrl(url);
      cache.set(url, short);
    }
    result = result.split(url).join(short);
  }
  return result;
}

// Best-effort: drops subscribers with paused=true from an already-fetched list.
// If the `paused` column doesn't exist yet (migration 0009 not applied), the
// probe query errors and we simply exclude nobody — old behaviour, no crash.
// bypassPause — транзакционные рассылки игнорируют ручной опт-аут (paused),
// см. lib/identity.ts activeUnpausedIds для того же принципа на push-контактах.
async function excludePaused<T extends { id: string }>(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  list: T[] | null,
  bypassPause = false
): Promise<T[] | null> {
  if (!list?.length || bypassPause) return list;
  const { data: pausedRows, error } = await admin
    .from("subscribers")
    .select("id")
    .eq("project_id", projectId)
    .eq("paused", true)
    .in("id", list.map((s) => s.id));
  if (error || !pausedRows?.length) return list;
  const paused = new Set(pausedRows.map((r) => r.id));
  return list.filter((s) => !paused.has(s.id));
}

// Sends an existing campaign row to its audience. Shared by the immediate send
// route, the scheduled-send cron, and the client API. Handles atomic balance
// spend (tariff→package), 410 pruning, failure refunds, and count updates.
// subscriberIds — адресная аудитория, уже резолвленная вызывающим кодом
// (немедленная отправка из формы, API v1 — там контакт резолвится тут же
// синхронно, ради мгновенной проверки «не найдено устройств»). Если не
// передали явно, но на самой кампании сохранены сырые контакты (черновик/
// запланированный push, см. migration 0034) — резолвим их здесь, в момент
// реальной отправки: раньше на планировании контакты приходилось резолвить
// заранее (или вовсе запрещать), теперь актуальное состояние устройств
// смотрим прямо перед отправкой, а не на момент создания черновика.
export async function dispatchCampaign(campaign: CampaignRow, subscriberIds?: string[]): Promise<DispatchResult> {
  const admin = createAdminClient();
  const SEL = "id, endpoint, p256dh, auth, attributes";

  // Контакты и сегмент — если заданы оба, это пересечение (AND): уходит
  // только тем из указанных контактов, кто ТАКЖЕ входит в сегмент, а не
  // объединение обоих списков. Если задан только один из двух — обычное
  // разрешение по нему. hasContacts отдельно от "ids", чтобы явно указанные,
  // но НИ ОДИН не резолвившийся контакт (все отписались и т.п.) не давал
  // молчаливый откат к «просто сегмент» — пересечение с пустым списком
  // контактов даёт пустую аудиторию, а не всех из сегмента.
  const hasContacts = !!subscriberIds?.length || !!campaign.contacts?.length;
  const ids = subscriberIds?.length ? subscriberIds : campaign.contacts?.length ? await resolvePushContactIds(campaign.project_id, campaign.contacts, campaign.type === "transactional") : [];
  const hasSegment = !!(campaign.segment_tags && campaign.segment_tags.length);

  let subsRaw: { id: string; endpoint: string; p256dh: string; auth: string; attributes: Record<string, unknown> | null }[] | null;
  if (!hasContacts && !hasSegment) {
    // ни контактов, ни сегмента — «пусто = всем», широковещательная рассылка.
    const { data } = await admin.from("subscribers").select(SEL).eq("project_id", campaign.project_id).eq("is_active", true);
    subsRaw = data;
  } else if (hasContacts && hasSegment) {
    // пересечение: контакт должен резолвиться в устройство И принадлежать
    // подписчику из сегмента.
    if (!ids.length) subsRaw = [];
    else {
      const { data } = await admin
        .from("subscribers")
        .select(SEL)
        .eq("project_id", campaign.project_id)
        .eq("is_active", true)
        .in("id", ids)
        .overlaps("tags", campaign.segment_tags!);
      subsRaw = data;
    }
  } else if (hasContacts) {
    const { data } = await admin.from("subscribers").select(SEL).eq("project_id", campaign.project_id).eq("is_active", true).in("id", ids);
    subsRaw = data;
  } else {
    const { data } = await admin.from("subscribers").select(SEL).eq("project_id", campaign.project_id).eq("is_active", true).overlaps("tags", campaign.segment_tags!);
    subsRaw = data;
  }

  // best-effort exclusion of paused subscribers — a SEPARATE query, so a
  // not-yet-migrated `paused` column degrades to "nobody paused" instead of
  // erroring (and silently zeroing) the whole audience query above.
  // Транзакционные рассылки игнорируют paused (см. excludePaused).
  const subs = await excludePaused(admin, campaign.project_id, subsRaw, campaign.type === "transactional");

  if (!subs?.length) {
    await admin.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", campaign.id);
    return { ok: true, delivered: 0, failed: 0, total: 0 };
  }

  const { data: secret } = await admin
    .from("project_secrets")
    .select("vapid_private_key")
    .eq("project_id", campaign.project_id)
    .single();
  const { data: project } = await admin
    .from("projects")
    .select("vapid_public_key")
    .eq("id", campaign.project_id)
    .single();

  if (!secret?.vapid_private_key || !project?.vapid_public_key) {
    await admin.from("campaigns").update({ status: "failed", error: "no vapid keys" }).eq("id", campaign.id);
    return { ok: false, delivered: 0, failed: 0, total: subs.length, error: "no vapid keys" };
  }

  const { data: covered } = await admin.rpc("spend_pushes", { p_project_id: campaign.project_id, p_count: subs.length });
  if (!covered) {
    await admin.from("campaigns").update({ status: "failed", error: "insufficient balance" }).eq("id", campaign.id);
    return { ok: false, delivered: 0, failed: 0, total: subs.length, error: "insufficient balance" };
  }

  const vapid = { publicKey: project.vapid_public_key, privateKey: secret.vapid_private_key };
  const api = process.env.NEXT_PUBLIC_APP_URL || "";
  let delivered = 0;
  let failed = 0;
  const dead: string[] = [];
  const deadSubscriberIds: string[] = [];
  const recipients: { contact: string; status: "delivered" | "failed" }[] = [];
  const linkCache = new Map<string, string>();

  const CONCURRENCY = 20;
  for (let i = 0; i < subs.length; i += CONCURRENCY) {
    const chunk = subs.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (s) => {
        // явные данные вызова (см. createAndDispatch data{}) побеждают атрибуты
        // подписчика при совпадении ключа — это разовые параметры ИМЕННО этой
        // отправки (номер заказа и т.п.), а не свойство подписчика.
        const attrs = { ...(((s as { attributes?: Record<string, unknown> }).attributes) || {}), ...(campaign.template_data || {}) };
        const payload: PushPayload = {
          title: applyTemplate(campaign.title, attrs),
          body: await shortenBodyLinks(applyTemplate(campaign.body, attrs), linkCache),
          icon: campaign.icon_url ? applyTemplate(campaign.icon_url, attrs) : undefined,
          image: campaign.image_url ? applyTemplate(campaign.image_url, attrs) : undefined,
          badge: campaign.badge_url ? applyTemplate(campaign.badge_url, attrs) : undefined,
          url: applyTemplate(campaign.click_url || "/", attrs) || "/",
          actions: renderPushActions(campaign.actions, attrs),
          campaignId: campaign.id,
          subscriberId: s.id,
          api,
        };
        try {
          await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, vapid);
          delivered++;
          recipients.push({ contact: s.id, status: "delivered" });
        } catch (err: unknown) {
          failed++;
          recipients.push({ contact: s.id, status: "failed" });
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            dead.push(s.endpoint);
            deadSubscriberIds.push(s.id);
          }
        }
      })
    );
  }

  if (dead.length) await admin.from("subscribers").update({ is_active: false }).in("endpoint", dead);
  if (deadSubscriberIds.length) {
    await admin
      .from("push_events")
      .insert(deadSubscriberIds.map((subscriberId) => ({ project_id: campaign.project_id, campaign_id: campaign.id, subscriber_id: subscriberId, type: "dead" })))
      .then(
        () => {},
        () => {}
      );
  }
  if (failed > 0) await admin.rpc("refund_pushes", { p_project_id: campaign.project_id, p_count: failed });
  await logRecipients(admin, campaign.id, campaign.project_id, "push", recipients);

  await admin
    .from("campaigns")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_count: subs.length,
      delivered_count: delivered,
      failed_count: failed,
    })
    .eq("id", campaign.id);

  return { ok: true, delivered, failed, total: subs.length };
}

// Inserts a campaign row. `actions` (rich-push buttons, migration 0009) and
// `badge_url` (rich-push badge, migration 0019) are attempted first; if a
// column isn't migrated yet, retries without it so campaign creation — the
// core send path, hit by every push — never breaks on a not-yet-applied
// migration. Shared by every campaign-creating caller.
export async function insertCampaign(
  admin: ReturnType<typeof createAdminClient>,
  row: {
    project_id: string;
    title: string;
    body: string;
    icon_url: string | null;
    image_url: string | null;
    click_url: string | null;
    badge_url?: string | null;
    segment_tags: string[];
    actions: PushAction[];
    status: string;
    scheduled_at?: string | null;
    created_by?: string;
    type?: "transactional" | "marketing";
    initiator?: "manual" | "api";
    template_id?: string | null;
    template_data?: Record<string, unknown> | null;
    internal_title?: string | null;
    contacts?: string[];
  }
): Promise<CampaignRow | null> {
  const full = "id, project_id, title, body, icon_url, image_url, click_url, badge_url, segment_tags, actions, template_data, type, contacts";
  const { data, error } = await admin.from("campaigns").insert(row).select(full).single();
  if (!error) return data;

  const { badge_url, ...withoutBadge } = row;
  void badge_url;
  const withActions = "id, project_id, title, body, icon_url, image_url, click_url, segment_tags, actions, template_data, type, contacts";
  const { data: noBadge, error: err2 } = await admin.from("campaigns").insert(withoutBadge).select(withActions).single();
  if (!err2) return { ...noBadge, badge_url: null };

  const { actions, contacts: contactsField, ...withoutActionsBadgeContacts } = withoutBadge;
  void actions;
  void contactsField;
  const { data: fallback } = await admin
    .from("campaigns")
    .insert(withoutActionsBadgeContacts)
    .select("id, project_id, title, body, icon_url, image_url, click_url, segment_tags, type")
    .single();
  return fallback ? { ...fallback, actions: [], badge_url: null, contacts: [] } : null;
}

// Разрешает шаблон канала push в набор полей кампании — общий код для
// createAndDispatch (/api/v1/send) и /api/admin/campaigns/send (ручная
// рассылка из «Кампаний», в т.ч. по быстрой ссылке «Отправить рассылку» из
// «Шаблонов»). Явные значения (title/body/etc, переданные вызывающим кодом)
// побеждают поля шаблона при совпадении.
export async function resolvePushTemplate(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  templateId: string,
  explicit: { title?: string; body?: string; icon?: string; image?: string; url?: string; badge?: string; actions?: PushAction[] } = {}
): Promise<{ title: string; body: string; icon?: string; image?: string; url?: string; badge?: string; actions?: PushAction[] }> {
  const { data: tpl } = await admin
    .from("templates")
    .select("title, body, url, icon_url, image_url, badge_url, actions")
    .eq("id", templateId)
    .eq("project_id", projectId)
    .eq("channel", "push")
    .maybeSingle();
  return {
    title: explicit.title || tpl?.title || "",
    body: explicit.body || tpl?.body || "",
    icon: explicit.icon ?? tpl?.icon_url ?? undefined,
    image: explicit.image ?? tpl?.image_url ?? undefined,
    url: explicit.url ?? tpl?.url ?? undefined,
    badge: explicit.badge ?? tpl?.badge_url ?? undefined,
    actions: explicit.actions?.length ? explicit.actions : ((tpl?.actions as PushAction[] | null) ?? undefined),
  };
}

// Creates a campaign row from raw content and dispatches it immediately.
// Shared by the client API (/api/v1/send, /api/v1/trigger) — ТОЛЬКО ими,
// админка для push идёт через insertCampaign+dispatchCampaign напрямую
// (см. /api/admin/campaigns/send), поэтому initiator тут всегда 'api'.
// templateId — шаблон канала push (раздел «Шаблоны»); явные title/body/etc.
// в content переопределяют соответствующие поля шаблона. data — разовые
// значения именно этого вызова для Liquid-подстановки в шаблон (см. dispatchCampaign).
export async function createAndDispatch(
  projectId: string,
  content: {
    title?: string;
    body?: string;
    icon?: string;
    image?: string;
    badge?: string;
    url?: string;
    segmentTags?: string[];
    actions?: PushAction[];
    type?: "transactional" | "marketing";
    templateId?: string;
    data?: Record<string, unknown>;
  },
  subscriberIds?: string[]
): Promise<DispatchResult> {
  const admin = createAdminClient();

  let title = content.title || "";
  let body = content.body || "";
  let icon = content.icon;
  let image = content.image;
  let url = content.url;
  if (content.templateId) {
    const resolved = await resolvePushTemplate(admin, projectId, content.templateId, content);
    title = resolved.title;
    body = resolved.body;
    icon = resolved.icon;
    image = resolved.image;
    url = resolved.url;
  }
  if (!title.trim() || !body.trim()) {
    return { ok: false, delivered: 0, failed: 0, total: 0, error: "title and body required (or a valid templateId)" };
  }

  const campaign = await insertCampaign(admin, {
    project_id: projectId,
    title,
    body,
    icon_url: icon || null,
    image_url: image || null,
    click_url: url || null,
    badge_url: content.badge || null,
    segment_tags: content.segmentTags || [],
    actions: content.actions || [],
    status: "sending",
    type: content.type,
    initiator: "api",
    template_id: content.templateId || null,
    template_data: content.data || null,
  });
  if (!campaign) return { ok: false, delivered: 0, failed: 0, total: 0, error: "campaign create failed" };
  return dispatchCampaign(campaign, subscriberIds);
}

// Sends a single one-off push to one subscriber (welcome automation).
// Spends 1 unit; refunds on failure. No campaign row.
export async function sendOneOff(
  projectId: string,
  subscriber: { id: string; endpoint: string; p256dh: string; auth: string },
  content: { title: string; body: string; url?: string; actions?: PushAction[] },
  attrs: Record<string, unknown> = {}
): Promise<boolean> {
  const admin = createAdminClient();

  const { data: secret } = await admin.from("project_secrets").select("vapid_private_key").eq("project_id", projectId).single();
  const { data: project } = await admin.from("projects").select("vapid_public_key").eq("id", projectId).single();
  if (!secret?.vapid_private_key || !project?.vapid_public_key) return false;

  const { data: covered } = await admin.rpc("spend_pushes", { p_project_id: projectId, p_count: 1 });
  if (!covered) return false;

  try {
    await sendPush(
      { endpoint: subscriber.endpoint, keys: { p256dh: subscriber.p256dh, auth: subscriber.auth } },
      {
        title: applyTemplate(content.title, attrs),
        body: applyTemplate(content.body, attrs),
        url: applyTemplate(content.url || "/", attrs) || "/",
        actions: content.actions?.length ? content.actions : undefined,
        subscriberId: subscriber.id,
        api: process.env.NEXT_PUBLIC_APP_URL || "",
      },
      { publicKey: project.vapid_public_key, privateKey: secret.vapid_private_key }
    );
    return true;
  } catch {
    await admin.rpc("refund_pushes", { p_project_id: projectId, p_count: 1 });
    return false;
  }
}

// ---------------------------------------------------------------------
// SMS / Email — кампании и API-отправка через тот же провайдерский слой,
// что и OTP (lib/otp/sms.ts, lib/otp/smsc.ts, lib/otp/haskimail.ts), но с
// произвольным контентом вместо кода. Telegram Gateway сюда не входит — это
// OTP-only API по своей природе, не для рассылок (SMSC — единственный
// провайдер, который может нести Telegram-контент, но Telegram как канал
// рассылок в этой версии не запрашивался). Баланс (spend_pushes) не
// участвует — тарификация SMS/Email не входит в этот этап.
// ---------------------------------------------------------------------

type SmsEmailCampaignRow = {
  id: string;
  project_id: string;
  title: string;
  body: string;
  subject: string | null;
  html_body: string | null;
  segment_tags: string[] | null;
  channel: "sms" | "email";
  provider: string | null;
  type: "transactional" | "marketing";
  template_data?: Record<string, unknown> | null;
  contacts?: string[] | null;
};

type ChannelContact = { value: string; attrs: Record<string, unknown> };

// Прямые контакты (адресная отправка) и сегмент — если заданы оба, это
// ПЕРЕСЕЧЕНИЕ (AND): уходит только тем из указанных контактов, кто ТАКЖЕ
// входит в сегмент, а не объединение обоих списков. Если задан только один
// из двух — обычное разрешение по нему (contacts проверяются на согласие,
// segment резолвится в подписчиков сегмента → их контакт). Ни того, ни
// другого — «пусто = всем» (см. ниже). Прямые контакты ТОЖЕ проходят
// проверку согласия (filterConsentedContacts, тот же *_marketing_active_at,
// что и у сегментной отправки) — явно вписанный номер не обходит отсутствие
// согласия, это не адрес доставки "как есть", а то же самое согласие на
// канал, просто указанное вручную, а не через подписчика.
//
// Один контакт (телефон/email) дедуплицируется даже если на него ссылается
// НЕСКОЛЬКО подписчиков сегмента — у SMS/Email нет понятия "устройство", в
// отличие от push, поэтому один человек не должен получить одно и то же
// письмо/SMS дважды.
export async function resolveSmsEmailAudience(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  field: "phone" | "email",
  opts: { contacts?: string[]; segmentTags?: string[] | null; bypassConsent?: boolean }
): Promise<ChannelContact[]> {
  const hasContacts = !!opts.contacts?.length;
  const hasSegment = !!opts.segmentTags?.length;

  if (hasContacts && hasSegment) {
    // Пересечение — та же логика, что и у кнопки «Проверить»
    // (check-contacts/route.ts): filterConsentedContacts уже умеет сузить
    // контакты до тех, кто входит в сегмент.
    const consented = await filterConsentedContacts(projectId, field, opts.contacts!, {
      bypassConsent: opts.bypassConsent,
      segmentTags: opts.segmentTags!,
    });
    return consented.map((value) => ({ value, attrs: {} }));
  }

  const byContact = new Map<string, ChannelContact>();

  if (hasContacts) {
    const consented = await filterConsentedContacts(projectId, field, opts.contacts!, { bypassConsent: opts.bypassConsent });
    for (const value of consented) byContact.set(value, { value, attrs: {} });
  } else if (hasSegment) {
    const { data: subs } = await admin
      .from("subscribers")
      .select("id, attributes")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .overlaps("tags", opts.segmentTags!);
    if (subs?.length) {
      const contactMap = await subscribersToContacts(
        projectId,
        subs.map((s) => s.id),
        field,
        { bypassConsent: opts.bypassConsent }
      );
      for (const s of subs) {
        const value = contactMap.get(s.id);
        if (!value || byContact.has(value)) continue; // первое устройство этого контакта выигрывает
        byContact.set(value, { value, attrs: (s as { attributes?: Record<string, unknown> }).attributes || {} });
      }
    }
  } else {
    // Ни контактов, ни сегмента — «пусто = всем», тот же принцип, что и у
    // push (dispatchCampaign). Маркетинговая рассылка уходит всем известным
    // проекту identity с согласием на канал (activeCol); транзакционная —
    // всем известным контактам вообще, независимо от согласия (bypassConsent).
    const activeCol = field === "phone" ? "sms_marketing_active_at" : "email_marketing_active_at";
    let q = admin.from("identities").select(`${field}, ${activeCol}`).eq("project_id", projectId);
    if (!opts.bypassConsent) q = q.not(activeCol, "is", null);
    const { data } = await q;
    for (const row of data || []) {
      const value = (row as Record<string, string>)[field];
      if (value) byContact.set(value, { value, attrs: {} });
    }
  }

  return [...byContact.values()];
}

// Точное число получателей ДО отправки — для диалога подтверждения
// («Уйдёт N получателям»), а не только для превью содержимого (см.
// check-contacts/route.ts, тот отдельно — чистит поле «Контакты», этот
// просто считает). Та же логика пересечения/broadcast-all, что и у
// dispatchCampaign (push) и resolveSmsEmailAudience (sms/email) — дублируется
// намеренно узко (только резолв id, без реальной отправки), не вызывает
// dispatch* напрямую.
export async function countAudience(
  projectId: string,
  channel: "push" | "sms" | "email",
  opts: { contacts?: string[]; segmentTags?: string[]; bypassConsent: boolean }
): Promise<number> {
  const admin = createAdminClient();
  const contacts = (opts.contacts || []).filter(Boolean);
  const segmentTags = (opts.segmentTags || []).filter(Boolean);
  const hasContacts = !!contacts.length;
  const hasSegment = !!segmentTags.length;

  if (channel !== "push") {
    const field = channel === "sms" ? "phone" : "email";
    const audience = await resolveSmsEmailAudience(admin, projectId, field, { contacts, segmentTags, bypassConsent: opts.bypassConsent });
    return audience.length;
  }

  if (!hasContacts && !hasSegment) {
    const { count } = await admin.from("subscribers").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true);
    return count || 0;
  }
  const ids = hasContacts ? await resolvePushContactIds(projectId, contacts, opts.bypassConsent) : [];
  if (hasContacts && hasSegment) {
    if (!ids.length) return 0;
    const { count } = await admin
      .from("subscribers")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("is_active", true)
      .in("id", ids)
      .overlaps("tags", segmentTags);
    return count || 0;
  }
  if (hasContacts) return ids.length;
  const { count } = await admin.from("subscribers").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true).overlaps("tags", segmentTags);
  return count || 0;
}

// Какой провайдер реально настроен (есть креды) для sms/email на проекте.
// hint (например api_keys.sms_provider, закреплённый за ключом при
// создании) побеждает, если сам настроен; иначе — первый настроенный из
// дефолтного порядка. Haskimail использует ОДИН server token на аккаунт —
// нужны и токен (haskimail_server_token, уже есть для входа по коду), И ID
// НУЖНОГО канала — transactional_stream для транзакционных сообщений,
// marketing_stream для маркетинговых (см. lib/otp/haskimail.ts) — иначе
// провайдер не считается настроенным ДЛЯ ЭТОГО типа отправки, даже если
// другой поток у него сконфигурирован.
export async function resolveChannelProvider(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  channel: "sms" | "email",
  hint?: string | null,
  type: "transactional" | "marketing" = "marketing"
): Promise<string | null> {
  const { data: secrets } = await admin
    .from("project_secrets")
    .select("bytehand_service_key, smsc_login, smsc_password, haskimail_server_token, haskimail_marketing_stream, haskimail_transactional_stream")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!secrets) return null;

  const smscReady = !!secrets.smsc_login && !!secrets.smsc_password;
  const haskimailStream = type === "transactional" ? secrets.haskimail_transactional_stream : secrets.haskimail_marketing_stream;
  const configured: Record<string, boolean> =
    channel === "sms"
      ? { bytehand: !!secrets.bytehand_service_key, smsc: smscReady }
      : { haskimail: !!secrets.haskimail_server_token && !!haskimailStream, smsc: smscReady };

  if (hint && configured[hint]) return hint;
  const order = channel === "sms" ? ["bytehand", "smsc"] : ["haskimail", "smsc"];
  return order.find((p) => configured[p]) || null;
}

export async function dispatchSmsCampaign(campaign: SmsEmailCampaignRow, contacts?: string[]): Promise<DispatchResult> {
  const admin = createAdminClient();
  const audience = await resolveSmsEmailAudience(admin, campaign.project_id, "phone", {
    contacts: contacts ?? campaign.contacts ?? undefined,
    segmentTags: campaign.segment_tags,
    bypassConsent: campaign.type === "transactional",
  });
  if (!audience.length) {
    await admin.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", campaign.id);
    return { ok: true, delivered: 0, failed: 0, total: 0 };
  }

  const { data: secrets } = await admin
    .from("project_secrets")
    .select("bytehand_service_key, smsc_login, smsc_password")
    .eq("project_id", campaign.project_id)
    .maybeSingle();
  if (!secrets || (campaign.provider === "smsc" ? !secrets.smsc_login : !secrets.bytehand_service_key)) {
    await admin.from("campaigns").update({ status: "failed", error: "provider not configured" }).eq("id", campaign.id);
    return { ok: false, delivered: 0, failed: 0, total: audience.length, error: "provider not configured" };
  }

  // Тот же зарегистрированный отправитель, что уже используется для
  // OTP-кода (lib/otp/index.ts) — без него sendSms/sendSmsSmsc падают на
  // дефолтный "SMS", который у большинства провайдеров не одобрен и
  // отклоняется на приёме (см. живой пример: Bytehand вернул "rejected"
  // именно из-за этого, 2026-08-18).
  const { data: oidc } = await admin.from("oidc_clients").select("config").eq("project_id", campaign.project_id).maybeSingle();
  const smsSender = (oidc?.config as { sms_sender?: string } | null)?.sms_sender || undefined;

  let delivered = 0;
  let failed = 0;
  const recipients: { contact: string; status: "delivered" | "failed"; token: string }[] = [];
  const CONCURRENCY = 10;
  for (let i = 0; i < audience.length; i += CONCURRENCY) {
    const chunk = audience.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (c) => {
        const attrs = { ...c.attrs, ...(campaign.template_data || {}) };
        const token = genRecipientToken();
        const text = await injectClickTrackingSms(applyTemplate(campaign.body, attrs), campaign.id, token);
        const result =
          campaign.provider === "smsc"
            ? await sendSmsSmsc(secrets.smsc_login!, secrets.smsc_password!, c.value, text, smsSender)
            : await sendSms(secrets.bytehand_service_key!, c.value, text, smsSender);
        if (result.ok) delivered++;
        else failed++;
        recipients.push({ contact: c.value, status: result.ok ? "delivered" : "failed", token });
      })
    );
  }

  await admin
    .from("campaigns")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_count: audience.length, delivered_count: delivered, failed_count: failed })
    .eq("id", campaign.id);
  await logRecipients(admin, campaign.id, campaign.project_id, "sms", recipients);

  return { ok: true, delivered, failed, total: audience.length };
}

export async function dispatchEmailCampaign(campaign: SmsEmailCampaignRow, contacts?: string[]): Promise<DispatchResult> {
  const admin = createAdminClient();
  const audience = await resolveSmsEmailAudience(admin, campaign.project_id, "email", {
    contacts: contacts ?? campaign.contacts ?? undefined,
    segmentTags: campaign.segment_tags,
    bypassConsent: campaign.type === "transactional",
  });
  if (!audience.length) {
    await admin.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", campaign.id);
    return { ok: true, delivered: 0, failed: 0, total: 0 };
  }

  const { data: secrets } = await admin
    .from("project_secrets")
    .select("haskimail_server_token, haskimail_marketing_stream, haskimail_transactional_stream, smsc_login, smsc_password")
    .eq("project_id", campaign.project_id)
    .maybeSingle();
  const haskimailStream = campaign.type === "transactional" ? secrets?.haskimail_transactional_stream : secrets?.haskimail_marketing_stream;
  if (!secrets || (campaign.provider === "smsc" ? !secrets.smsc_login : !secrets.haskimail_server_token || !haskimailStream)) {
    await admin.from("campaigns").update({ status: "failed", error: "provider not configured" }).eq("id", campaign.id);
    return { ok: false, delivered: 0, failed: 0, total: audience.length, error: "provider not configured" };
  }

  const { data: oidc } = await admin.from("oidc_clients").select("config").eq("project_id", campaign.project_id).maybeSingle();
  const emailFrom = (oidc?.config as { email_from?: string } | null)?.email_from || "";

  const subjectRaw = campaign.subject || campaign.title;
  const htmlRaw = campaign.html_body || "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  let delivered = 0;
  let failed = 0;
  const recipients: { contact: string; status: "delivered" | "failed"; token: string }[] = [];
  const CONCURRENCY = 10;
  for (let i = 0; i < audience.length; i += CONCURRENCY) {
    const chunk = audience.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (c) => {
        // unsubscribe_url — ПОСЛЕ template_data, чтобы разовые данные вызова
        // не могли подменить ссылку отписки на чужую/поддельную.
        const attrs = { ...c.attrs, ...(campaign.template_data || {}), unsubscribe_url: unsubscribeUrl(appUrl, campaign.project_id, c.value) };
        const token = genRecipientToken();
        const subject = applyTemplate(subjectRaw, attrs);
        const html = injectOpenPixel(injectClickTracking(applyTemplate(htmlRaw, attrs), campaign.id, token), appUrl, campaign.id, token);
        const ok =
          campaign.provider === "smsc"
            ? (await sendEmailSmsc(secrets.smsc_login!, secrets.smsc_password!, c.value, subject, html, emailFrom)).ok
            : await sendEmail(secrets.haskimail_server_token!, c.value, { subject, html }, emailFrom || undefined, haskimailStream!);
        if (ok) delivered++;
        else failed++;
        recipients.push({ contact: c.value, status: ok ? "delivered" : "failed", token });
      })
    );
  }

  await admin
    .from("campaigns")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_count: audience.length, delivered_count: delivered, failed_count: failed })
    .eq("id", campaign.id);
  await logRecipients(admin, campaign.id, campaign.project_id, "email", recipients);

  return { ok: true, delivered, failed, total: audience.length };
}

// Единая точка создания+отправки для sms/email — аналог createAndDispatch,
// но с явным channel и разрешением шаблона (теперь и sms, не только email —
// раздел «Шаблоны» хранит шаблоны всех трёх каналов в одной таблице
// templates, см. миграцию 0030). Провайдер закрепляется за отправкой один
// раз здесь (не выбирается заново в dispatch*Campaign) — используется и
// кампаниями из UI, и /api/v1/send. data — разовые значения именно этого
// вызова для Liquid-подстановки в шаблон (см. dispatch*Campaign).
export async function resolveChannelTemplate(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  channel: "sms" | "email",
  templateId: string | undefined,
  explicit: { subject?: string | null; html?: string | null; body?: string | null }
): Promise<{ subject: string | null; html: string | null; body: string | null }> {
  let html = explicit.html || null;
  let subject = explicit.subject || null;
  let body = explicit.body || null;
  if (templateId) {
    const { data: tpl } = await admin
      .from("templates")
      .select("subject, html, body")
      .eq("id", templateId)
      .eq("project_id", projectId)
      .eq("channel", channel)
      .maybeSingle();
    if (tpl) {
      if (channel === "email") {
        html = html || tpl.html;
        subject = subject || tpl.subject || null;
      } else {
        body = body || tpl.body;
      }
    }
  }
  return { subject, html, body };
}

export async function createAndDispatchChannel(
  projectId: string,
  channel: "sms" | "email",
  content: {
    title: string;
    body?: string;
    subject?: string;
    html?: string;
    templateId?: string;
    data?: Record<string, unknown>;
    segmentTags?: string[];
    providerHint?: string | null;
    type?: "transactional" | "marketing";
    initiator?: "manual" | "api";
    internalTitle?: string;
  },
  contacts?: string[]
): Promise<DispatchResult> {
  const admin = createAdminClient();

  const resolved = await resolveChannelTemplate(admin, projectId, channel, content.templateId, {
    subject: content.subject,
    html: content.html,
    body: content.body,
  });
  const html = resolved.html;
  const subject = resolved.subject;
  const smsBody = resolved.body;
  if (channel === "email" && !html) {
    return { ok: false, delivered: 0, failed: 0, total: 0, error: "html or templateId required" };
  }
  if (channel === "sms" && !smsBody?.trim()) {
    return { ok: false, delivered: 0, failed: 0, total: 0, error: "text or templateId required" };
  }

  const type = content.type === "transactional" ? "transactional" : "marketing";
  // Ссылка отписки обязательна для маркетингового письма (не для
  // транзакционного) — единая точка проверки для админки (/campaigns/send)
  // и публичного API (/api/v1/send), оба вызывают эту функцию.
  if (channel === "email" && type === "marketing" && !hasUnsubscribeTag(html || "")) {
    return { ok: false, delivered: 0, failed: 0, total: 0, error: "unsubscribe link required" };
  }
  const provider = await resolveChannelProvider(admin, projectId, channel, content.providerHint, type);
  if (!provider) {
    return { ok: false, delivered: 0, failed: 0, total: 0, error: "no provider configured" };
  }

  const { data: campaign, error } = await admin
    .from("campaigns")
    .insert({
      project_id: projectId,
      channel,
      title: content.title || subject || "",
      body: smsBody || "",
      subject,
      html_body: html,
      template_data: content.data || null,
      template_id: content.templateId || null,
      provider,
      segment_tags: content.segmentTags || [],
      status: "sending",
      type,
      initiator: content.initiator || "api",
      internal_title: content.internalTitle || null,
      contacts: contacts || [],
    })
    .select("id, project_id, title, body, subject, html_body, segment_tags, channel, provider, type, template_data, contacts")
    .single();
  if (error || !campaign) return { ok: false, delivered: 0, failed: 0, total: 0, error: "campaign create failed" };

  return channel === "sms" ? dispatchSmsCampaign(campaign, contacts) : dispatchEmailCampaign(campaign, contacts);
}

// Разовая тестовая отправка из формы создания/редактирования рассылки —
// "проверить как выглядит" на конкретном контакте, а не рассылка аудитории.
// Никакой campaign-строки не создаётся, сегмент/согласие получателя не
// проверяются (это явное действие админа, а не автоматическая рассылка
// подписчикам) — контакт указывает сам админ, и он отвечает за то, что шлёт
// себе/коллеге тестовое сообщение. Push — исключение: Web Push физически
// невозможен без уже существующей подписки браузера, поэтому контакт (телефон
// или email) резолвится в устройство через phonesToSubscriberIds/
// emailsToSubscriberIds — тот же путь, что и адресная push-отправка.
export async function sendTestMessage(
  projectId: string,
  channel: "push" | "sms" | "email",
  contact: string,
  content: {
    title?: string;
    body?: string;
    url?: string;
    icon?: string;
    image?: string;
    badge?: string;
    actions?: PushAction[];
    text?: string;
    subject?: string;
    html?: string;
    provider?: string | null;
    data?: Record<string, unknown>;
  }
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();

  if (channel === "push") {
    const isEmail = contact.includes("@");
    const subscriberIds = isEmail ? await emailsToSubscriberIds(projectId, [contact]) : await phonesToSubscriberIds(projectId, [contact]);
    if (!subscriberIds.length) return { ok: false, error: "У этого контакта нет активной push-подписки" };

    const { data: sub } = await admin
      .from("subscribers")
      .select("id, endpoint, p256dh, auth, attributes")
      .eq("project_id", projectId)
      .in("id", subscriberIds)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!sub) return { ok: false, error: "У этого контакта нет активной push-подписки" };

    const { data: secret } = await admin.from("project_secrets").select("vapid_private_key").eq("project_id", projectId).single();
    const { data: project } = await admin.from("projects").select("vapid_public_key").eq("id", projectId).single();
    if (!secret?.vapid_private_key || !project?.vapid_public_key) return { ok: false, error: "VAPID-ключи не настроены" };

    // Прогоняем через тот же Liquid-рендер, что и реальная отправка (см.
    // dispatchCampaign) — иначе тестовое сообщение показало бы {{ }}/{% %}
    // буквально, а не то, что реально уйдёт получателю. content.data — ручной
    // JSON-контекст из формы рассылки, побеждает атрибуты подписчика при
    // совпадении ключа (та же логика, что и у campaign.template_data).
    const attrs = { ...((sub as { attributes?: Record<string, unknown> }).attributes || {}), ...(content.data || {}) };
    try {
      await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        {
          title: applyTemplate(content.title, attrs),
          body: await shortenBodyLinks(applyTemplate(content.body, attrs), new Map()),
          icon: content.icon ? applyTemplate(content.icon, attrs) : undefined,
          image: content.image ? applyTemplate(content.image, attrs) : undefined,
          badge: content.badge ? applyTemplate(content.badge, attrs) : undefined,
          url: applyTemplate(content.url, attrs) || "/",
          actions: renderPushActions(content.actions, attrs),
          subscriberId: sub.id,
          api: process.env.NEXT_PUBLIC_APP_URL || "",
        },
        { publicKey: project.vapid_public_key, privateKey: secret.vapid_private_key }
      );
      return { ok: true };
    } catch {
      return { ok: false, error: "Не удалось доставить — устройство недоступно" };
    }
  }

  if (channel === "sms") {
    const phone = normalizePhone(contact);
    if (!phone) return { ok: false, error: "Некорректный номер" };

    const provider = await resolveChannelProvider(admin, projectId, "sms", content.provider, "marketing");
    if (!provider) return { ok: false, error: "SMS не настроен" };

    const { data: secrets } = await admin
      .from("project_secrets")
      .select("bytehand_service_key, smsc_login, smsc_password")
      .eq("project_id", projectId)
      .maybeSingle();
    if (!secrets) return { ok: false, error: "SMS не настроен" };

    const { data: oidc } = await admin.from("oidc_clients").select("config").eq("project_id", projectId).maybeSingle();
    const smsSender = (oidc?.config as { sms_sender?: string } | null)?.sms_sender || undefined;

    const text = applyTemplate(content.text, content.data || {});
    const result =
      provider === "smsc"
        ? await sendSmsSmsc(secrets.smsc_login!, secrets.smsc_password!, phone, text, smsSender)
        : await sendSms(secrets.bytehand_service_key!, phone, text, smsSender);
    return result.ok ? { ok: true } : { ok: false, error: "Провайдер отклонил отправку" };
  }

  // email
  const email = contact.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Некорректный email" };

  const provider = await resolveChannelProvider(admin, projectId, "email", content.provider, "marketing");
  if (!provider) return { ok: false, error: "Email не настроен" };

  const { data: secrets } = await admin
    .from("project_secrets")
    .select("haskimail_server_token, haskimail_marketing_stream, haskimail_transactional_stream, smsc_login, smsc_password")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!secrets) return { ok: false, error: "Email не настроен" };

  const { data: oidc } = await admin.from("oidc_clients").select("config").eq("project_id", projectId).maybeSingle();
  const emailFrom = (oidc?.config as { email_from?: string } | null)?.email_from || "";
  const testAttrs = { ...(content.data || {}), unsubscribe_url: unsubscribeUrl(process.env.NEXT_PUBLIC_APP_URL || "", projectId, email) };
  const subject = applyTemplate(content.subject || content.title || "", testAttrs);
  const html = applyTemplate(content.html, testAttrs);

  const ok =
    provider === "smsc"
      ? (await sendEmailSmsc(secrets.smsc_login!, secrets.smsc_password!, email, subject, html, emailFrom)).ok
      : await sendEmail(secrets.haskimail_server_token!, email, { subject, html }, emailFrom || undefined, secrets.haskimail_marketing_stream!);
  return ok ? { ok: true } : { ok: false, error: "Провайдер отклонил отправку" };
}
