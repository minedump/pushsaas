import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPush, type PushPayload } from "@/lib/webpush";
import { applyTemplate } from "@/lib/template";
import { filterConsentedContacts, phonesToSubscriberIds, emailsToSubscriberIds, resolvePushSegmentIds } from "@/lib/identity";
import { sendSms } from "@/lib/otp/sms";
import { sendEmail } from "@/lib/otp/haskimail";
import { sendSmsSmsc, sendEmailSmsc } from "@/lib/otp/smsc";
import { shortenUrl } from "@/lib/clck";
import { normalizePhone } from "@/lib/phone";
import { unsubscribeUrl, hasUnsubscribeTag } from "@/lib/unsubscribe";
import { isWithinSendWindow, nextWindowStart, type SendWindow } from "@/lib/sendWindow";
import { resolveProductContext, expandProductRefs, resolveCategoryContext, expandCategoryRefs, resolveCollectionContext, expandCollectionRefs } from "@/lib/productFeed";

// Непрозрачный per-recipient токен для клика (?pss_r=...) — без PII в
// ссылке (см. миграцию 0024). 6 байт -> 8 символов base64url, достаточно
// для уникальности в пределах одной рассылки, не для криптографии.
function genRecipientToken(): string {
  return crypto.randomBytes(6).toString("base64url");
}

// products/product, categories/category И collections/collection
// id-ссылки в одном месте — все идут по одному и тому же принципу (см.
// expandProductRefs/expandCategoryRefs/expandCollectionRefs в
// lib/productFeed.ts), вызывающему коду не нужно помнить про все три отдельно.
async function expandRefs(projectId: string, ctx: Record<string, unknown>): Promise<Record<string, unknown>> {
  const withProducts = await expandProductRefs(projectId, ctx);
  const withCategories = await expandCategoryRefs(projectId, withProducts);
  return expandCollectionRefs(projectId, withCategories);
}

// Контекст шаблона (templates.context) замораживается в campaign.template_data
// на момент СОЗДАНИЯ кампании — под резервным ключом __template, ОТДЕЛЬНО от
// разового контекста самой рассылки, а не смешивается с ним. Раньше оба
// сливались в один плоский объект, и одноимённый ключ рассылки тихо перекрывал
// значение шаблона (не видно было, что оно вообще было). Это ломало сценарий
// «в шаблоне дефолт, на рассылке иногда переопределяем» — оба должны быть
// одновременно доступны, не состязаться. См. splitTemplateData — читает
// обратно на стороне отправки, в attrs шаблона context.* остаётся плоским
// (как раньше, обратная совместимость), а template.* — только через это поле.
export function mergeTemplateContext(
  context: Record<string, unknown> | null | undefined,
  data: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  const base = { ...(data || {}) };
  if (context && Object.keys(context).length) (base as Record<string, unknown>).__template = context;
  return Object.keys(base).length ? base : null;
}

// Обратное к mergeTemplateContext — на стороне отправки достаёт контекст
// шаблона отдельным неймспейсом (template.*), а остальное (context.*) —
// это разовый контекст рассылки/автоматизации, как и раньше остаётся ещё и
// плоским в attrs (обратная совместимость + сценарий, где состязание не
// проблема — рассылка сама явно задаёт значение).
export function splitTemplateData(
  templateData: Record<string, unknown> | null | undefined
): { template: Record<string, unknown>; context: Record<string, unknown> } {
  if (!templateData) return { template: {}, context: {} };
  const { __template, ...rest } = templateData as Record<string, unknown> & { __template?: Record<string, unknown> };
  return { template: (__template as Record<string, unknown>) || {}, context: rest };
}

// splitTemplateData + свежий резолв products/product и categories/category по
// id из кеша фида (см. expandProductRefs/expandCategoryRefs) — отдельно для
// template.* и для context.*, при каждой отправке заново (не замораживается
// вместе с остальным template_data). Основной способ получить template/context
// для attrs.
export async function resolveTemplateData(
  projectId: string,
  templateData: Record<string, unknown> | null | undefined
): Promise<{ template: Record<string, unknown>; context: Record<string, unknown> }> {
  const { template, context } = splitTemplateData(templateData);
  const [expandedTemplate, expandedContext] = await Promise.all([expandRefs(projectId, template), expandRefs(projectId, context)]);
  return { template: expandedTemplate, context: expandedContext };
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
  platforms?: string[] | null;
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
type PushAudienceRow = { id: string; endpoint: string; p256dh: string; auth: string; attributes: Record<string, unknown> | null; timezone: string | null };
// Только поля, реально нужные для резолва аудитории — НЕ полный CampaignRow
// (тот требует icon_url/click_url/title/body, которых нет у sms/email
// кампаний, вызывающих этот резолв через enqueueWindowedCampaign).
type CampaignAudienceQuery = {
  id: string;
  project_id: string;
  contacts?: string[] | null;
  segment_tags?: string[] | null;
  platforms?: string[] | null;
  type?: "transactional" | "marketing";
};

// Резолв аудитории push-кампании (контакты/сегмент/платформа) — вынесено из
// dispatchCampaign, чтобы тот же резолв использовал enqueueWindowedCampaign
// (окно отправки/защита от наложения, см. ниже) без дублирования логики
// пересечения контактов и сегмента.
async function resolvePushCampaignAudience(campaign: CampaignAudienceQuery, subscriberIds?: string[]): Promise<PushAudienceRow[]> {
  const admin = createAdminClient();
  const SEL = "id, endpoint, p256dh, auth, attributes, timezone";

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
  // Платформа (iOS/Android/Desktop) — доп. требование ПОВЕРХ контактов/
  // сегмента, не отдельный источник аудитории: сужает уже резолвленный
  // список устройств, а не резолвит его сама. Пусто = без фильтра.
  const platforms = campaign.platforms?.filter(Boolean) || [];

  let subsRaw: PushAudienceRow[] | null;
  if (!hasContacts && !hasSegment) {
    // ни контактов, ни сегмента — «пусто = всем», широковещательная рассылка.
    let q = admin.from("subscribers").select(SEL).eq("project_id", campaign.project_id).eq("is_active", true).not("endpoint", "is", null);
    if (platforms.length) q = q.in("platform", platforms);
    const { data } = await q;
    subsRaw = data;
  } else if (hasContacts && hasSegment) {
    // пересечение: контакт должен резолвиться в устройство И принадлежать
    // подписчику из сегмента. Сегмент теперь резолвится по identities.tags
    // (см. resolvePushSegmentIds) — теги живут на контакте, не на устройстве.
    if (!ids.length) subsRaw = [];
    else {
      const segmentIds = await resolvePushSegmentIds(campaign.project_id, campaign.segment_tags!);
      const intersected = ids.filter((id) => segmentIds.includes(id));
      if (!intersected.length) subsRaw = [];
      else {
        let q = admin.from("subscribers").select(SEL).eq("project_id", campaign.project_id).eq("is_active", true).not("endpoint", "is", null).in("id", intersected);
        if (platforms.length) q = q.in("platform", platforms);
        const { data } = await q;
        subsRaw = data;
      }
    }
  } else if (hasContacts) {
    let q = admin.from("subscribers").select(SEL).eq("project_id", campaign.project_id).eq("is_active", true).not("endpoint", "is", null).in("id", ids);
    if (platforms.length) q = q.in("platform", platforms);
    const { data } = await q;
    subsRaw = data;
  } else {
    const segmentIds = await resolvePushSegmentIds(campaign.project_id, campaign.segment_tags!);
    if (!segmentIds.length) subsRaw = [];
    else {
      let q = admin.from("subscribers").select(SEL).eq("project_id", campaign.project_id).eq("is_active", true).not("endpoint", "is", null).in("id", segmentIds);
      if (platforms.length) q = q.in("platform", platforms);
      const { data } = await q;
      subsRaw = data;
    }
  }

  // best-effort exclusion of paused subscribers — a SEPARATE query, so a
  // not-yet-migrated `paused` column degrades to "nobody paused" instead of
  // erroring (and silently zeroing) the whole audience query above.
  // Транзакционные рассылки игнорируют paused (см. excludePaused).
  const subs = await excludePaused(admin, campaign.project_id, subsRaw, campaign.type === "transactional");
  return subs || [];
}

export async function dispatchCampaign(campaign: CampaignRow, subscriberIds?: string[]): Promise<DispatchResult> {
  const admin = createAdminClient();
  const subs = await resolvePushCampaignAudience(campaign, subscriberIds);

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
  const { template: templateCtx, context: sendCtx } = await resolveTemplateData(campaign.project_id, campaign.template_data);

  const CONCURRENCY = 20;
  for (let i = 0; i < subs.length; i += CONCURRENCY) {
    const chunk = subs.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (s) => {
        // явные данные вызова (см. createAndDispatch data{}) побеждают атрибуты
        // подписчика при совпадении ключа — это разовые параметры ИМЕННО этой
        // отправки (номер заказа и т.п.), а не свойство подписчика. sendCtx
        // остаётся ещё и плоским (context.* дублирует те же ключи) — только
        // template.* контекст шаблона больше НЕ подмешивается в плоский
        // namespace, иначе одноимённый ключ рассылки тихо перекрывал бы его.
        const attrs = { ...(((s as { attributes?: Record<string, unknown> }).attributes) || {}), ...sendCtx, template: templateCtx, context: sendCtx, automation: {} };
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

// ---------------------------------------------------------------------
// Окно отправки / защита от наложения для обычных кампаний (migration
// 0056) — опционально, по умолчанию выключено (кампании без изменений).
// Вместо немедленной пакетной отправки резолвим аудиторию ОДИН раз и
// заводим пер-получательское задание (campaign_jobs) на каждого — тот же
// принцип, что и welcome-автоматизации (sendWelcomeNow), просто на пачку
// получателей сразу, а не на одного. Реальную отправку каждого задания
// делает cron run-campaign-jobs (sendCampaignJobNow).
// ---------------------------------------------------------------------

// Не наследует CampaignRow целиком (icon_url/image_url/click_url там
// обязательны) — enqueueWindowedCampaign нужны только поля аудитории, их
// незачем требовать и от sms/email-кампаний, у которых их нет.
type WindowedCampaign = {
  id: string;
  project_id: string;
  channel?: "push" | "sms" | "email";
  type?: "transactional" | "marketing";
  provider?: string | null;
  segment_tags?: string[] | null;
  platforms?: string[] | null;
  contacts?: string[] | null;
  send_window_enabled?: boolean | null;
  send_days?: number[] | null;
  send_time_from?: string | null;
  send_time_to?: string | null;
  send_window_subscriber_tz?: boolean | null;
  spacing_enabled?: boolean | null;
  spacing_minutes?: number | null;
};

export async function enqueueWindowedCampaign(campaign: WindowedCampaign, subscriberIds?: string[]): Promise<{ ok: boolean; enqueued: number }> {
  const admin = createAdminClient();
  const channel = campaign.channel || "push";
  const { data: project } = await admin.from("projects").select("timezone").eq("id", campaign.project_id).maybeSingle();
  const projectTimezone = project?.timezone || "Europe/Moscow";
  const win: SendWindow = {
    enabled: !!campaign.send_window_enabled,
    days: campaign.send_days || null,
    timeFrom: campaign.send_time_from || null,
    timeTo: campaign.send_time_to || null,
    useSubscriberTz: !!campaign.send_window_subscriber_tz,
  };
  const spacingMinutes = campaign.spacing_enabled ? campaign.spacing_minutes || null : null;

  type Recipient = { subscriberId?: string; contact?: string; timezone?: string | null };
  let recipients: Recipient[];
  if (channel === "push") {
    const subs = await resolvePushCampaignAudience(campaign, subscriberIds);
    recipients = subs.map((s) => ({ subscriberId: s.id, timezone: s.timezone }));
  } else {
    const contacts = await resolveSmsEmailAudience(admin, campaign.project_id, channel === "sms" ? "phone" : "email", {
      contacts: campaign.contacts || undefined,
      segmentTags: campaign.segment_tags,
      bypassConsent: campaign.type === "transactional",
    });
    recipients = contacts.map((c) => ({ contact: c.value, timezone: c.timezone }));
  }

  if (!recipients.length) {
    await admin.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", campaign.id);
    return { ok: true, enqueued: 0 };
  }

  const now = new Date();
  const jobs: { campaign_id: string; project_id: string; channel: string; subscriber_id: string | null; contact: string | null; fire_at: string }[] = [];
  const CONCURRENCY = 20;
  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    const chunk = recipients.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (r) => {
        const tz = (win.useSubscriberTz && r.timezone) || projectTimezone;
        let fireAt = now;
        if (win.enabled && !isWithinSendWindow(win, tz, now)) {
          fireAt = nextWindowStart(win, tz, now);
        } else if (spacingMinutes) {
          const contactKey = channel === "push" ? r.subscriberId! : r.contact!;
          const lastSentAt = await findRecentSendAt(admin, campaign.project_id, channel, contactKey, spacingMinutes);
          if (lastSentAt) fireAt = new Date(new Date(lastSentAt).getTime() + spacingMinutes * 60_000);
        }
        jobs.push({
          campaign_id: campaign.id,
          project_id: campaign.project_id,
          channel,
          subscriber_id: channel === "push" ? r.subscriberId || null : null,
          contact: channel === "push" ? null : r.contact || null,
          fire_at: fireAt.toISOString(),
        });
      })
    );
  }

  for (let i = 0; i < jobs.length; i += 500) {
    await admin.from("campaign_jobs").insert(jobs.slice(i, i + 500));
  }
  await admin.from("campaigns").update({ status: "sending", sent_at: new Date().toISOString() }).eq("id", campaign.id);
  return { ok: true, enqueued: jobs.length };
}

// Once one campaign_jobs row finishes — bumps the campaign's aggregate
// counters and, if it was the LAST pending job, flips the campaign to
// "sent". Read-then-write, safe as long as run-campaign-jobs processes jobs
// sequentially within one invocation (same assumption as run-automations).
async function bumpCampaignCounts(admin: ReturnType<typeof createAdminClient>, campaignId: string, status: "sent" | "failed"): Promise<void> {
  const { data: c } = await admin.from("campaigns").select("sent_count, delivered_count, failed_count").eq("id", campaignId).maybeSingle();
  if (c) {
    await admin
      .from("campaigns")
      .update({
        sent_count: (c.sent_count || 0) + 1,
        delivered_count: (c.delivered_count || 0) + (status === "sent" ? 1 : 0),
        failed_count: (c.failed_count || 0) + (status === "failed" ? 1 : 0),
      })
      .eq("id", campaignId);
  }
  const { count } = await admin.from("campaign_jobs").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "pending");
  if (!count) await admin.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", campaignId);
}

// Реальная отправка одного пер-получательского задания (campaign_jobs) —
// вызывается кроном run-campaign-jobs. Контент берётся из уже существующей
// campaigns-строки (campaignId у неё СВОЙ, не создаётся заново — в отличие
// от sendOneOff/sendWelcomeNow, здесь кампания одна на всех получателей).
export async function sendCampaignJobNow(
  admin: ReturnType<typeof createAdminClient>,
  job: { id: string; campaign_id: string; project_id: string; channel: "push" | "sms" | "email"; subscriber_id: string | null; contact: string | null }
): Promise<"sent" | "failed"> {
  let status: "sent" | "failed" = "failed";

  if (job.channel === "push" && job.subscriber_id) {
    const { data: campaign } = await admin
      .from("campaigns")
      .select("id, title, body, icon_url, image_url, click_url, badge_url, actions, template_data")
      .eq("id", job.campaign_id)
      .maybeSingle();
    const { data: sub } = await admin
      .from("subscribers")
      .select("id, endpoint, p256dh, auth, attributes, is_active, paused")
      .eq("id", job.subscriber_id)
      .maybeSingle();
    if (campaign && sub?.is_active && !sub.paused && sub.endpoint) {
      const { data: secret } = await admin.from("project_secrets").select("vapid_private_key").eq("project_id", job.project_id).maybeSingle();
      const { data: project } = await admin.from("projects").select("vapid_public_key").eq("id", job.project_id).maybeSingle();
      if (secret?.vapid_private_key && project?.vapid_public_key) {
        const { data: covered } = await admin.rpc("spend_pushes", { p_project_id: job.project_id, p_count: 1 });
        if (covered) {
          const { template: templateCtx, context: sendCtx } = await resolveTemplateData(job.project_id, campaign.template_data as Record<string, unknown> | null);
          const attrs = { ...((sub.attributes as Record<string, unknown>) || {}), ...sendCtx, template: templateCtx, context: sendCtx, automation: {} };
          try {
            await sendPush(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              {
                title: applyTemplate(campaign.title, attrs),
                body: await shortenBodyLinks(applyTemplate(campaign.body, attrs), new Map()),
                icon: campaign.icon_url ? applyTemplate(campaign.icon_url, attrs) : undefined,
                image: campaign.image_url ? applyTemplate(campaign.image_url, attrs) : undefined,
                badge: campaign.badge_url ? applyTemplate(campaign.badge_url, attrs) : undefined,
                url: applyTemplate(campaign.click_url || "/", attrs) || "/",
                actions: renderPushActions(campaign.actions as PushAction[] | null, attrs),
                campaignId: campaign.id,
                subscriberId: sub.id,
                api: process.env.NEXT_PUBLIC_APP_URL || "",
              },
              { publicKey: project.vapid_public_key, privateKey: secret.vapid_private_key }
            );
            status = "sent";
          } catch {
            await admin.rpc("refund_pushes", { p_project_id: job.project_id, p_count: 1 });
          }
        }
      }
    }
    if (campaign) {
      await logRecipients(admin, job.campaign_id, job.project_id, "push", [{ contact: job.subscriber_id, status: status === "sent" ? "delivered" : "failed" }]);
      await bumpCampaignCounts(admin, job.campaign_id, status);
    }
  } else if ((job.channel === "sms" || job.channel === "email") && job.contact) {
    const { data: campaign } = await admin
      .from("campaigns")
      .select("id, body, subject, html_body, provider, template_data, type")
      .eq("id", job.campaign_id)
      .maybeSingle();
    if (campaign) {
      const field = job.channel === "sms" ? "phone" : "email";
      const { data: identity } = await admin
        .from("identities")
        .select("name, phone, email, tags, attributes")
        .eq("project_id", job.project_id)
        .eq(field, job.contact)
        .maybeSingle();
      const { data: secrets } = await admin
        .from("project_secrets")
        .select("bytehand_service_key, smsc_login, smsc_password, haskimail_server_token, haskimail_marketing_stream, haskimail_transactional_stream")
        .eq("project_id", job.project_id)
        .maybeSingle();
      const { data: oidc } = await admin.from("oidc_clients").select("config").eq("project_id", job.project_id).maybeSingle();
      const contactAttrs = identity
        ? { name: identity.name, phone: identity.phone, email: identity.email, tags: identity.tags, ...((identity.attributes as Record<string, unknown>) || {}) }
        : {};
      const { template: templateCtx, context: sendCtx } = await resolveTemplateData(job.project_id, campaign.template_data as Record<string, unknown> | null);
      const attrs = { ...contactAttrs, ...sendCtx, template: templateCtx, context: sendCtx, automation: {} };
      const token = genRecipientToken();
      if (secrets && campaign.provider) {
        if (job.channel === "sms") {
          const smsSender = (oidc?.config as { sms_sender?: string } | null)?.sms_sender || undefined;
          const text = await injectClickTrackingSms(applyTemplate(campaign.body, attrs), job.campaign_id, token);
          const result =
            campaign.provider === "smsc"
              ? await sendSmsSmsc(secrets.smsc_login!, secrets.smsc_password!, job.contact, text, smsSender)
              : await sendSms(secrets.bytehand_service_key!, job.contact, text, smsSender);
          status = result.ok ? "sent" : "failed";
        } else {
          const emailFrom = (oidc?.config as { email_from?: string } | null)?.email_from || "";
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
          const emailAttrs = { ...attrs, unsubscribe_url: unsubscribeUrl(appUrl, job.project_id, job.contact) };
          const subject = applyTemplate(campaign.subject || "", emailAttrs);
          const html = injectOpenPixel(injectClickTracking(applyTemplate(campaign.html_body || "", emailAttrs), job.campaign_id, token), appUrl, job.campaign_id, token);
          const haskimailStream = campaign.type === "transactional" ? secrets.haskimail_transactional_stream : secrets.haskimail_marketing_stream;
          const ok =
            campaign.provider === "smsc"
              ? (await sendEmailSmsc(secrets.smsc_login!, secrets.smsc_password!, job.contact, subject, html, emailFrom)).ok
              : await sendEmail(secrets.haskimail_server_token!, job.contact, { subject, html }, emailFrom || undefined, haskimailStream!);
          status = ok ? "sent" : "failed";
        }
      }
      await logRecipients(admin, job.campaign_id, job.project_id, job.channel, [{ contact: job.contact, status: status === "sent" ? "delivered" : "failed", token }]);
      await bumpCampaignCounts(admin, job.campaign_id, status);
    }
  }

  return status;
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
    platforms?: string[];
    actions: PushAction[];
    status: string;
    scheduled_at?: string | null;
    created_by?: string;
    type?: "transactional" | "marketing";
    initiator?: "manual" | "api" | "automation";
    template_id?: string | null;
    template_data?: Record<string, unknown> | null;
    internal_title?: string | null;
    contacts?: string[];
    send_window_enabled?: boolean;
    send_days?: number[] | null;
    send_time_from?: string | null;
    send_time_to?: string | null;
    send_window_subscriber_tz?: boolean;
    spacing_enabled?: boolean;
    spacing_minutes?: number | null;
  }
): Promise<CampaignRow | null> {
  const full = "id, project_id, title, body, icon_url, image_url, click_url, badge_url, segment_tags, platforms, actions, template_data, type, contacts";
  const { data, error } = await admin.from("campaigns").insert(row).select(full).single();
  if (!error) return data;

  const { badge_url, platforms, ...withoutBadge } = row;
  void badge_url;
  void platforms;
  const withActions = "id, project_id, title, body, icon_url, image_url, click_url, segment_tags, actions, template_data, type, contacts";
  const { data: noBadge, error: err2 } = await admin.from("campaigns").insert(withoutBadge).select(withActions).single();
  if (!err2) return { ...noBadge, badge_url: null, platforms: [] };

  const { actions, contacts: contactsField, ...withoutActionsBadgeContacts } = withoutBadge;
  void actions;
  void contactsField;
  const { data: fallback } = await admin
    .from("campaigns")
    .insert(withoutActionsBadgeContacts)
    .select("id, project_id, title, body, icon_url, image_url, click_url, segment_tags, type")
    .single();
  return fallback ? { ...fallback, actions: [], badge_url: null, platforms: [], contacts: [] } : null;
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
): Promise<{
  title: string;
  body: string;
  icon?: string;
  image?: string;
  url?: string;
  badge?: string;
  actions?: PushAction[];
  name?: string;
  context?: Record<string, unknown> | null;
}> {
  const { data: tpl } = await admin
    .from("templates")
    .select("name, title, body, url, icon_url, image_url, badge_url, actions, context")
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
    name: tpl?.name,
    context: tpl?.context as Record<string, unknown> | null | undefined,
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
    platforms?: string[];
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
  let templateContext: Record<string, unknown> | null | undefined;
  if (content.templateId) {
    const resolved = await resolvePushTemplate(admin, projectId, content.templateId, content);
    title = resolved.title;
    body = resolved.body;
    icon = resolved.icon;
    image = resolved.image;
    url = resolved.url;
    templateContext = resolved.context;
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
    platforms: content.platforms || [],
    actions: content.actions || [],
    status: "sending",
    type: content.type,
    initiator: "api",
    template_id: content.templateId || null,
    template_data: mergeTemplateContext(templateContext, content.data),
  });
  if (!campaign) return { ok: false, delivered: 0, failed: 0, total: 0, error: "campaign create failed" };
  return dispatchCampaign(campaign, subscriberIds);
}

// Sends a single one-off push to one subscriber (welcome/событийная
// автоматизация) — заводит campaigns-строку на одного получателя (тот же
// приём, что и у транзакционных вебхук-триггеров, см. createAndDispatch),
// иначе клик некому трекать и заказ/выручку (order_attributions) физически
// не к чему привязать — атрибуция матчит СТРОГО по campaign_id из клик-куки.
// Spends 1 unit; refunds on failure.
export async function sendOneOff(
  projectId: string,
  subscriber: { id: string; endpoint: string; p256dh: string; auth: string },
  content: { title: string; body: string; url?: string; icon?: string; image?: string; badge?: string; actions?: PushAction[] },
  attrs: Record<string, unknown> = {},
  meta: { type?: "transactional" | "marketing" } = {}
): Promise<{ ok: boolean; campaignId: string | null }> {
  const admin = createAdminClient();

  const title = applyTemplate(content.title, attrs);
  const body = applyTemplate(content.body, attrs);
  const icon = content.icon ? applyTemplate(content.icon, attrs) : null;
  const image = content.image ? applyTemplate(content.image, attrs) : null;
  const badge = content.badge ? applyTemplate(content.badge, attrs) : null;
  const url = applyTemplate(content.url || "/", attrs) || "/";
  const actions = renderPushActions(content.actions, attrs);

  const campaign = await insertCampaign(admin, {
    project_id: projectId,
    title,
    body,
    icon_url: icon,
    image_url: image,
    click_url: url,
    badge_url: badge,
    segment_tags: [],
    actions: actions || [],
    status: "sending",
    type: meta.type || "marketing",
    initiator: "automation",
  });
  const campaignId = campaign?.id || null;

  const { data: secret } = await admin.from("project_secrets").select("vapid_private_key").eq("project_id", projectId).single();
  const { data: project } = await admin.from("projects").select("vapid_public_key").eq("id", projectId).single();
  if (!secret?.vapid_private_key || !project?.vapid_public_key) {
    if (campaignId) await admin.from("campaigns").update({ status: "failed", error: "no vapid keys" }).eq("id", campaignId);
    return { ok: false, campaignId };
  }

  const { data: covered } = await admin.rpc("spend_pushes", { p_project_id: projectId, p_count: 1 });
  if (!covered) {
    if (campaignId) await admin.from("campaigns").update({ status: "failed", error: "insufficient balance" }).eq("id", campaignId);
    return { ok: false, campaignId };
  }

  try {
    await sendPush(
      { endpoint: subscriber.endpoint, keys: { p256dh: subscriber.p256dh, auth: subscriber.auth } },
      {
        title,
        body,
        icon: icon || undefined,
        image: image || undefined,
        badge: badge || undefined,
        url,
        actions,
        campaignId: campaignId || undefined,
        subscriberId: subscriber.id,
        api: process.env.NEXT_PUBLIC_APP_URL || "",
      },
      { publicKey: project.vapid_public_key, privateKey: secret.vapid_private_key }
    );
    if (campaignId) {
      await admin
        .from("campaigns")
        .update({ status: "sent", sent_at: new Date().toISOString(), sent_count: 1, delivered_count: 1 })
        .eq("id", campaignId);
      await logRecipients(admin, campaignId, projectId, "push", [{ contact: subscriber.id, status: "delivered" }]);
    }
    return { ok: true, campaignId };
  } catch {
    await admin.rpc("refund_pushes", { p_project_id: projectId, p_count: 1 });
    if (campaignId) {
      await admin
        .from("campaigns")
        .update({ status: "sent", sent_at: new Date().toISOString(), sent_count: 1, failed_count: 1 })
        .eq("id", campaignId);
      await logRecipients(admin, campaignId, projectId, "push", [{ contact: subscriber.id, status: "failed" }]);
    }
    return { ok: false, campaignId };
  }
}

// Какие из трёх каналов у этого контакта СЕЙЧАС активны — только среди
// каналов, для которых вообще настроена хоть одна welcome-цепочка
// (`configured`): нет смысла отдавать приоритет каналу, который всё равно
// никогда не отправит приветствие. push — есть хотя бы одно активное
// устройство, привязанное к identity; sms/email — соответствующий
// *_marketing_active_at установлен.
export async function activeConfiguredChannels(
  admin: ReturnType<typeof createAdminClient>,
  identityId: string,
  configured: Set<"push" | "sms" | "email">
): Promise<Set<"push" | "sms" | "email">> {
  const active = new Set<"push" | "sms" | "email">();
  if (configured.has("sms") || configured.has("email")) {
    const { data: identity } = await admin
      .from("identities")
      .select("sms_marketing_active_at, email_marketing_active_at")
      .eq("id", identityId)
      .maybeSingle();
    if (identity?.sms_marketing_active_at && configured.has("sms")) active.add("sms");
    if (identity?.email_marketing_active_at && configured.has("email")) active.add("email");
  }
  if (configured.has("push")) {
    const { data: links } = await admin
      .from("identity_devices")
      .select("subscriber_id, subscribers!inner(is_active)")
      .eq("identity_id", identityId);
    if ((links || []).some((l) => (l.subscribers as unknown as { is_active: boolean } | null)?.is_active)) active.add("push");
  }
  return active;
}

// Резолвит, каким именно каналом уйдёт каскадная (мультиканальная) welcome/
// событийная автоматизация — среди каналов, для которых в карточке задан
// шаблон (channel_templates), берём активный (см. activeConfiguredChannels)
// и включённый в проекте, побеждает первый по общему «Приоритету каналов».
// Без identityId (анонимный push, ссылку на identity ещё не нашли) активность
// сравнивать не с чем — если среди настроенных каналов есть push, он и
// побеждает (тот же best-effort принцип, что и respects_priority без
// identity у обычных, не каскадных автоматизаций).
export async function resolveCascadeChannel(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  identityId: string | undefined,
  channelTemplates: Partial<Record<"push" | "sms" | "email", string>>
): Promise<{ channel: "push" | "sms" | "email"; templateId: string } | null> {
  const configured = new Set(Object.keys(channelTemplates).filter((c) => channelTemplates[c as "push" | "sms" | "email"]) as ("push" | "sms" | "email")[]);
  if (!configured.size) return null;

  const { data: project } = await admin
    .from("projects")
    .select("welcome_channel_priority, welcome_channel_enabled")
    .eq("id", projectId)
    .maybeSingle();
  const enabled = (project?.welcome_channel_enabled as Record<string, boolean> | null) || {};
  const order = (project?.welcome_channel_priority as ("push" | "sms" | "email")[] | null) || ["push", "sms", "email"];

  let active: Set<"push" | "sms" | "email">;
  if (identityId) {
    active = await activeConfiguredChannels(admin, identityId, configured);
  } else if (configured.has("push")) {
    active = new Set(["push"]);
  } else {
    active = new Set();
  }

  const winner = order.find((c) => configured.has(c) && active.has(c) && enabled[c] !== false);
  if (!winner) return null;
  return { channel: winner, templateId: channelTemplates[winner]! };
}

// ---------------------------------------------------------------------
// Приветственные автоматизации (welcome) — многоканальные, на основе
// шаблонов (раздел «Шаблоны»); несколько штук на канал допустимо (цепочка
// из N сообщений с разной задержкой), несколько каналов одновременно тоже
// допустимо (см. AutomationsManager). Триггер: push — новое устройство
// подписалось (app/api/public/subscribe/route.ts); sms/email — контакт
// только что стал «Активным» по каналу, т.е. *_marketing_active_at
// сменился с null на значение (см. logChannelEvents в lib/identity.ts).
// delay_minutes=0 — шлём сразу; иначе ставим в ту же очередь
// automation_jobs, что и событийные автоматизации (см.
// app/api/cron/run-automations), но с identity_id вместо subscriber_id для
// sms/email — у контакта может не быть push-устройства.
export async function fireWelcomeAutomations(
  projectId: string,
  channel: "push" | "sms" | "email",
  recipient: { subscriberId?: string; identityId?: string }
): Promise<void> {
  const admin = createAdminClient();

  const { data: allWelcomes } = await admin
    .from("automations")
    .select(
      "id, name, channel, delay_minutes, template_id, segment_tags, spacing_enabled, spacing_minutes, send_window_enabled, send_days, send_time_from, send_time_to, send_window_subscriber_tz, config, cascade, channel_templates, provider, platforms"
    )
    .eq("project_id", projectId)
    .eq("type", "welcome")
    .eq("is_enabled", true);
  // Каскадные карточки (см. resolveCascadeChannel) рассматриваем, если ИМЕННО
  // этот активировавшийся канал вообще числится среди её настроенных —
  // реальный победитель по приоритету резолвится позже, отдельно для каждой
  // карточки, не здесь.
  let candidates = (allWelcomes || []).filter((a) =>
    a.cascade ? !!(a.channel_templates as Record<string, string> | null)?.[channel] : a.channel === channel && a.template_id
  );
  if (!candidates.length) return;

  // push обычно триггерится ДО того, как устройство привязано к identity —
  // но если привязка уже есть (вернувшийся/залогиненный посетитель),
  // используем её: без этого приоритет и сегмент для push никогда бы не
  // сработали, только для sms/email (там identityId уже известен всегда).
  let identityId = recipient.identityId;
  if (!identityId && channel === "push" && recipient.subscriberId) {
    const { data: link } = await admin
      .from("identity_devices")
      .select("identity_id")
      .eq("subscriber_id", recipient.subscriberId)
      .limit(1)
      .maybeSingle();
    identityId = link?.identity_id || undefined;
  }

  const { data: project } = await admin
    .from("projects")
    .select("welcome_channel_priority, welcome_channel_enabled, welcome_channel_provider, timezone")
    .eq("id", projectId)
    .maybeSingle();
  const projectTimezone = project?.timezone || "Europe/Moscow";

  // Канал целиком отключён для welcome (быстрый выключатель, отдельный от
  // is_enabled каждого сообщения) — см. «Приоритет каналов» в Автоматизациях.
  const channelEnabled = (project?.welcome_channel_enabled as Record<string, boolean> | null)?.[channel];
  if (channelEnabled === false) return;

  // Сегмент по тегам — сообщение с непустым segment_tags уходит только
  // контактам, чьи identities.tags пересекаются со списком; без identity
  // (анонимный push) сегментированные сообщения пропускаются — тегов взять
  // неоткуда, несегментированные (пусто = всем) продолжают работать как раньше.
  let identityTags: string[] = [];
  if (identityId) {
    const { data: identity } = await admin.from("identities").select("tags").eq("id", identityId).maybeSingle();
    identityTags = (identity?.tags as string[] | null) || [];
  }
  candidates = candidates.filter((a) => {
    const tags = (a.segment_tags as string[] | null) || [];
    return !tags.length || tags.some((t) => identityTags.includes(t));
  });
  if (!candidates.length) return;

  // Приоритет каналов больше не сравнивается для одноканальных карточек —
  // они всегда уходят на своём канале независимо от активности контакта на
  // других (это и есть способ намеренно продублировать волну по нескольким
  // каналам). Взаимоисключение по приоритету — только у каскадных карточек,
  // резолвится отдельно для каждой (resolveCascadeChannel), не здесь.
  const toFire = candidates;

  // Цепочка (все welcome-автоматизации канала, что реально сработали в этом
  // событии) запускается максимум ОДИН раз на контакт+канал — не при каждом
  // повторном вкл/выкл согласия. Push это гарантирует сам вызывающий код
  // (fires only for a genuinely new device row, см. /api/public/subscribe);
  // sms/email — явный маркер на identities, иначе повторное включение
  // согласия слало бы welcome заново. Атомарный claim (update ... where col
  // is null): проходит только для первого вызова, конкурентный повтор не
  // запустит цепочку дважды.
  if ((channel === "sms" || channel === "email") && identityId) {
    const col = channel === "sms" ? "sms_welcomed_at" : "email_welcomed_at";
    const { data: claimed } = await admin
      .from("identities")
      .update({ [col]: new Date().toISOString() })
      .eq("id", identityId)
      .is(col, null)
      .select("id");
    if (!claimed?.length) return;
  }

  const globalProviderHint = (project?.welcome_channel_provider as Record<string, string> | null)?.[channel] || null;

  for (const a of toFire) {
    if (!a.cascade && !a.template_id) continue;
    if (a.cascade) {
      // Каскадная карточка может сработать от РАЗНЫХ активаций канала
      // (push/sms/email) — реальный канал резолвится позже, в момент разбора
      // очереди (run-automations), поэтому всегда ставим задание в
      // automation_jobs (даже при delay=0 — уйдёт со следующим тиком крона,
      // до минуты), а не шлём напрямую. Ключ дедупа — identity_id, когда он
      // известен, ВНЕ ЗАВИСИМОСТИ от того, какой канал сейчас триггерит: так
      // существующий уникальный индекс uq_pending_job_identity сам не даст
      // создать вторую pending-задачу для той же карточки+контакта, если
      // активируется другой канал раньше, чем эта уже отправилась. Без
      // identity (анонимный push) дедуп по subscriber_id — тот же best-effort
      // предел, что и везде при отсутствии identity.
      await admin
        .from("automation_jobs")
        .insert({
          project_id: projectId,
          automation_id: a.id,
          subscriber_id: identityId ? null : recipient.subscriberId || null,
          identity_id: identityId || null,
          fire_at: new Date(Date.now() + (a.delay_minutes || 0) * 60_000).toISOString(),
        })
        .then(
          () => {},
          () => {}
        );
      continue;
    }
    if ((a.delay_minutes || 0) > 0) {
      await admin
        .from("automation_jobs")
        .insert({
          project_id: projectId,
          automation_id: a.id,
          subscriber_id: channel === "push" ? recipient.subscriberId : null,
          identity_id: channel !== "push" ? identityId : null,
          fire_at: new Date(Date.now() + a.delay_minutes * 60_000).toISOString(),
        })
        .then(
          () => {},
          () => {}
        );
    } else {
      await sendWelcomeNow(
        admin,
        projectId,
        a.id,
        channel,
        a.template_id,
        recipient,
        a.provider || globalProviderHint,
        a.name,
        a.spacing_enabled ? a.spacing_minutes || null : null,
        {
          enabled: !!a.send_window_enabled,
          days: (a.send_days as number[] | null) || null,
          timeFrom: a.send_time_from,
          timeTo: a.send_time_to,
          useSubscriberTz: !!a.send_window_subscriber_tz,
        },
        projectTimezone,
        "welcome",
        null,
        (a.platforms as string[] | null) || null
      );
    }
  }
}

// Ищет последнюю отправку этому контакту на этот канал за окно
// windowMinutes — по ЛЮБОМУ источнику (кампания или другая автоматизация),
// не только по welcome. contact — subscriber_id для push, телефон/email для
// sms/email (тот же формат, что campaign_recipients.contact).
async function findRecentSendAt(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  channel: "push" | "sms" | "email",
  contact: string,
  windowMinutes: number
): Promise<string | null> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const [{ data: campRows }, { data: logRows }] = await Promise.all([
    admin
      .from("campaign_recipients")
      .select("created_at")
      .eq("project_id", projectId)
      .eq("channel", channel)
      .eq("contact", contact)
      .eq("status", "delivered")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1),
    admin
      .from("automation_log")
      .select("created_at")
      .eq("project_id", projectId)
      .eq("channel", channel)
      .eq("contact", contact)
      .eq("status", "sent")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const times = [campRows?.[0]?.created_at, logRows?.[0]?.created_at].filter(Boolean) as string[];
  return times.length ? times.sort().pop()! : null;
}

// Отправка отложена (наложение или вне окна отправки) — не шлём сейчас,
// переставляем попытку на fireAt через ту же очередь automation_jobs, что и
// обычная задержка. Не жёсткий пропуск: если условие к тому моменту снова не
// выполнится (контакт опять «свежий», окно опять закрыто), сработает ещё
// один перенос.
async function rescheduleWelcome(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  automationId: string,
  recipient: { subscriberId?: string; identityId?: string },
  channel: "push" | "sms" | "email",
  fireAt: Date
): Promise<void> {
  await admin
    .from("automation_jobs")
    .insert({
      project_id: projectId,
      automation_id: automationId,
      subscriber_id: channel === "push" ? recipient.subscriberId : null,
      identity_id: channel !== "push" ? recipient.identityId : null,
      fire_at: fireAt.toISOString(),
    })
    .then(
      () => {},
      () => {}
    );
}

// Общая для немедленной отправки (delay=0) и для крон-обработчика очереди
// (delay>0, см. app/api/cron/run-automations) — единая точка резолва
// шаблона+провайдера+отправки+лога, чтобы оба пути welcome вели себя
// идентично.
export async function sendWelcomeNow(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  automationId: string,
  channel: "push" | "sms" | "email",
  templateId: string,
  recipient: { subscriberId?: string; identityId?: string },
  providerHint: string | null = null,
  automationName: string | null = null,
  spacingMinutes: number | null = null,
  sendWindow: SendWindow | null = null,
  projectTimezone = "Europe/Moscow",
  source: "welcome" | "event" | "webhook" = "welcome",
  eventPayload: Record<string, unknown> | null = null,
  platforms: string[] | null = null
): Promise<"sent" | "failed" | "skipped"> {
  let status: "sent" | "failed" | "skipped" = "skipped";
  let deferred = false;
  // Данные события (сырой payload + резолвленные товар/категория/коллекция
  // из кеша фида, см. lib/productFeed.ts) — слой персонализации МЕЖДУ
  // контактом и устройством/каналом: специфичнее профиля контакта (это
  // конкретное срабатывание), но контакт всё равно может переопределить
  // одноимённые поля своими самыми свежими атрибутами (см. merge ниже).
  // Только для событийных — у welcome eventPayload всегда null, лишний
  // запрос не идёт.
  const eventContext = eventPayload
    ? {
        ...eventPayload,
        ...(await resolveProductContext(projectId, eventPayload)),
        ...(await resolveCategoryContext(projectId, eventPayload)),
        ...(await resolveCollectionContext(projectId, eventPayload)),
      }
    : {};
  // Тот же payload, но БЕЗ резолвленного товара и НЕ подмешанный в плоский
  // namespace — доступен явно через {{ automation.* }}, см. ContextDocs.tsx.
  const automationCtx = eventPayload || {};
  // Название автоматизации (задаётся мерчантом, обязательно при создании) —
  // приоритетнее названия шаблона в Журнале/Рассылках: один шаблон может
  // переиспользоваться в нескольких сообщениях цепочки.
  let title: string | null = automationName;
  // Контакт в формате campaign_recipients.contact — пишем в лог, чтобы
  // последующие проверки защиты от наложения видели эту отправку тоже.
  let contactKey: string | null = channel === "push" ? recipient.subscriberId || null : null;
  // Кампания на одного получателя (см. sendOneOff/insertCampaign ниже) —
  // без неё клик-трекинг и атрибуция заказов (order_attributions матчит
  // строго по campaign_id) для welcome-отправок физически невозможны.
  let campaignId: string | null = null;

  if (channel === "push" && recipient.subscriberId) {
    const { data: sub } = await admin
      .from("subscribers")
      .select("id, endpoint, p256dh, auth, is_active, paused, attributes, timezone, platform")
      .eq("id", recipient.subscriberId)
      .maybeSingle();
    // Фильтр по платформе (та же семантика, что у campaigns.platforms —
    // пусто = без фильтра, все платформы): устройство не того типа просто
    // пропускается, это не ошибка отправки.
    const platformAllowed = !platforms?.length || (!!sub?.platform && platforms.includes(sub.platform));
    if (sub?.is_active && !sub.paused && sub.endpoint && platformAllowed) {
      if (sendWindow?.enabled) {
        const tz = (sendWindow.useSubscriberTz && sub.timezone) || projectTimezone;
        if (!isWithinSendWindow(sendWindow, tz, new Date())) {
          const fireAt = nextWindowStart(sendWindow, tz, new Date());
          await rescheduleWelcome(admin, projectId, automationId, recipient, channel, fireAt);
          deferred = true;
        }
      }
      if (!deferred && spacingMinutes) {
        const lastSentAt = await findRecentSendAt(admin, projectId, channel, sub.id, spacingMinutes);
        if (lastSentAt) {
          const fireAt = new Date(new Date(lastSentAt).getTime() + spacingMinutes * 60_000);
          await rescheduleWelcome(admin, projectId, automationId, recipient, channel, fireAt);
          deferred = true;
        }
      }
      if (!deferred) {
        const tpl = await resolvePushTemplate(admin, projectId, templateId);
        title = title || tpl.name || null;
        if (tpl.title && tpl.body) {
          // Персонализация: контекст шаблона (дефолты) < контакт (если
          // устройство уже привязано к identity) < атрибуты САМОГО устройства
          // (самые специфичные — переопределяют одноимённые поля контакта).
          const { data: link } = await admin
            .from("identity_devices")
            .select("identity_id")
            .eq("subscriber_id", sub.id)
            .limit(1)
            .maybeSingle();
          let identityAttrs: Record<string, unknown> = {};
          if (link?.identity_id) {
            const { data: identity } = await admin
              .from("identities")
              .select("name, phone, email, tags, attributes")
              .eq("id", link.identity_id)
              .maybeSingle();
            if (identity) {
              identityAttrs = { name: identity.name, phone: identity.phone, email: identity.email, tags: identity.tags, ...((identity.attributes as object) || {}) };
            }
          }
          const templateCtx = await expandRefs(projectId, tpl.context || {});
          const attrs = { ...identityAttrs, ...eventContext, ...((sub as { attributes?: Record<string, unknown> }).attributes || {}), template: templateCtx, context: {}, automation: automationCtx };
          const result = await sendOneOff(projectId, sub, tpl, attrs);
          status = result.ok ? "sent" : "failed";
          campaignId = result.campaignId;
        }
      }
    }
  } else if ((channel === "sms" || channel === "email") && recipient.identityId) {
    const { data: identity } = await admin
      .from("identities")
      .select("id, name, phone, email, tags, attributes, sms_marketing_active_at, email_marketing_active_at, timezone")
      .eq("id", recipient.identityId)
      .maybeSingle();
    const contact = channel === "sms" ? identity?.phone : identity?.email;
    const stillActive = channel === "sms" ? !!identity?.sms_marketing_active_at : !!identity?.email_marketing_active_at;
    if (contact && stillActive) {
      contactKey = contact;
      if (sendWindow?.enabled) {
        const tz = (sendWindow.useSubscriberTz && identity?.timezone) || projectTimezone;
        if (!isWithinSendWindow(sendWindow, tz, new Date())) {
          const fireAt = nextWindowStart(sendWindow, tz, new Date());
          await rescheduleWelcome(admin, projectId, automationId, recipient, channel, fireAt);
          deferred = true;
        }
      }
      if (!deferred && spacingMinutes) {
        const lastSentAt = await findRecentSendAt(admin, projectId, channel, contact, spacingMinutes);
        if (lastSentAt) {
          const fireAt = new Date(new Date(lastSentAt).getTime() + spacingMinutes * 60_000);
          await rescheduleWelcome(admin, projectId, automationId, recipient, channel, fireAt);
          deferred = true;
        }
      }
      if (!deferred) {
        const tpl = await resolveChannelTemplate(admin, projectId, channel, templateId, {});
        title = title || tpl.name || null;
        // Email без {{ unsubscribe_url }} в шаблоне не отправляем — та же
        // проверка, что и у обычных маркетинговых рассылок (createAndDispatchChannel).
        const unsubscribeOk = channel !== "email" || hasUnsubscribeTag(tpl.html || "");
        const provider = unsubscribeOk ? await resolveChannelProvider(admin, projectId, channel, providerHint, "marketing") : null;
        const hasContent = (channel === "sms" && !!tpl.body?.trim()) || (channel === "email" && !!tpl.html);

        if (hasContent) {
          // Кампания на одного получателя — тот же приём, что и push (см.
          // sendOneOff) и createAndDispatchChannel: без неё
          // injectClickTracking/injectOpenPixel нечего помечать, а
          // order_attributions нечего атрибуировать. Форма строки — та же,
          // что у createAndDispatchChannel (html_body/subject/provider), не
          // push-ориентированный insertCampaign.
          const { data: campaign } = await admin
            .from("campaigns")
            .insert({
              project_id: projectId,
              channel,
              title: title || tpl.name || "",
              body: channel === "sms" ? tpl.body || "" : "",
              subject: channel === "email" ? tpl.subject : null,
              html_body: channel === "email" ? tpl.html : null,
              provider,
              segment_tags: [],
              status: "sending",
              type: "marketing",
              initiator: "automation",
            })
            .select("id")
            .single();
          campaignId = campaign?.id || null;

          if (!provider) {
            if (campaignId) {
              const error = !unsubscribeOk ? "unsubscribe link required" : "provider not configured";
              await admin.from("campaigns").update({ status: "failed", error }).eq("id", campaignId);
            }
          } else {
            const { data: secrets } = await admin
              .from("project_secrets")
              .select("bytehand_service_key, smsc_login, smsc_password, haskimail_server_token, haskimail_marketing_stream")
              .eq("project_id", projectId)
              .maybeSingle();
            const { data: oidc } = await admin.from("oidc_clients").select("config").eq("project_id", projectId).maybeSingle();
            if (secrets) {
              const contactAttrs = { name: identity?.name, phone: identity?.phone, email: identity?.email, tags: identity?.tags, ...((identity?.attributes as object) || {}) };
              const token = genRecipientToken();
              const templateCtx = await expandRefs(projectId, tpl.context || {});
              if (channel === "sms") {
                const smsSender = (oidc?.config as { sms_sender?: string } | null)?.sms_sender || undefined;
                const attrs = { ...contactAttrs, ...eventContext, template: templateCtx, context: {}, automation: automationCtx };
                const rendered = applyTemplate(tpl.body!, attrs);
                const text = campaignId ? await injectClickTrackingSms(rendered, campaignId, token) : rendered;
                const result =
                  provider === "smsc"
                    ? await sendSmsSmsc(secrets.smsc_login!, secrets.smsc_password!, contact, text, smsSender)
                    : await sendSms(secrets.bytehand_service_key!, contact, text, smsSender);
                status = result.ok ? "sent" : "failed";
              } else {
                const emailFrom = (oidc?.config as { email_from?: string } | null)?.email_from || "";
                const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
                const attrs = { ...contactAttrs, ...eventContext, template: templateCtx, context: {}, automation: automationCtx, unsubscribe_url: unsubscribeUrl(appUrl, projectId, contact) };
                const subject = applyTemplate(tpl.subject || "", attrs);
                const renderedHtml = applyTemplate(tpl.html || "", attrs);
                const html = campaignId ? injectOpenPixel(injectClickTracking(renderedHtml, campaignId, token), appUrl, campaignId, token) : renderedHtml;
                const ok =
                  provider === "smsc"
                    ? (await sendEmailSmsc(secrets.smsc_login!, secrets.smsc_password!, contact, subject, html, emailFrom)).ok
                    : await sendEmail(secrets.haskimail_server_token!, contact, { subject, html }, emailFrom || undefined, secrets.haskimail_marketing_stream!);
                status = ok ? "sent" : "failed";
              }
              if (campaignId) {
                await admin
                  .from("campaigns")
                  .update({
                    status: "sent",
                    sent_at: new Date().toISOString(),
                    sent_count: 1,
                    delivered_count: status === "sent" ? 1 : 0,
                    failed_count: status === "sent" ? 0 : 1,
                  })
                  .eq("id", campaignId);
                await logRecipients(admin, campaignId, projectId, channel, [{ contact, status: status === "sent" ? "delivered" : "failed", token }]);
              }
            }
          }
        }
      }
    }
  }

  await admin
    .from("automation_log")
    .insert({
      project_id: projectId,
      source,
      automation_id: automationId,
      subscriber_id: recipient.subscriberId || null,
      contact: contactKey,
      campaign_id: campaignId,
      title,
      status,
      recipients: status === "sent" ? 1 : 0,
      channel,
      // Резолвленный контекст (payload события + товар из фида на МОМЕНТ
      // отправки) сохраняем в лог — фид обновляется/чистится, а история
      // отправок должна остаться проверяемой: что реально подставилось в
      // это конкретное сообщение, а не что сейчас лежит в кеше.
      detail: { channel, ...(deferred ? { deferred: true } : {}), ...(Object.keys(eventContext).length ? { context: eventContext } : {}) },
    })
    .then(
      () => {},
      () => {}
    );
  return status;
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

type ChannelContact = { value: string; attrs: Record<string, unknown>; timezone?: string | null };

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
  let contacts: ChannelContact[];

  if (hasContacts && hasSegment) {
    // Пересечение — та же логика, что и у кнопки «Проверить»
    // (check-contacts/route.ts): filterConsentedContacts уже умеет сузить
    // контакты до тех, кто входит в сегмент.
    const consented = await filterConsentedContacts(projectId, field, opts.contacts!, {
      bypassConsent: opts.bypassConsent,
      segmentTags: opts.segmentTags!,
    });
    contacts = consented.map((value) => ({ value, attrs: {} }));
  } else {
    const byContact = new Map<string, ChannelContact>();

    if (hasContacts) {
      const consented = await filterConsentedContacts(projectId, field, opts.contacts!, { bypassConsent: opts.bypassConsent });
      for (const value of consented) byContact.set(value, { value, attrs: {} });
    } else if (hasSegment) {
      // Теги теперь живут на identities — сегментная SMS/Email-рассылка больше
      // не завязана на наличие активного push-устройства у контакта (это было
      // побочным следствием старой модели, где теги хранились на subscribers).
      const activeCol = field === "phone" ? "sms_marketing_active_at" : "email_marketing_active_at";
      let q = admin.from("identities").select(`${field}, ${activeCol}`).eq("project_id", projectId).overlaps("tags", opts.segmentTags!);
      if (!opts.bypassConsent) q = q.not(activeCol, "is", null);
      const { data } = await q;
      for (const row of data || []) {
        const value = (row as Record<string, string>)[field];
        if (value && !byContact.has(value)) byContact.set(value, { value, attrs: {} });
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
    contacts = [...byContact.values()];
  }

  // Часовые пояса — отдельным запросом по уже резолвленным значениям (проще,
  // чем дублировать select в каждой из веток выше) — нужны только для окна
  // отправки «по часовому поясу подписчика» (см. enqueueWindowedCampaign).
  if (contacts.length) {
    const { data: tzRows } = await admin
      .from("identities")
      .select(`${field}, timezone`)
      .eq("project_id", projectId)
      .in(field, contacts.map((c) => c.value));
    const tzMap = new Map((tzRows || []).map((r) => [(r as Record<string, string>)[field], (r as Record<string, string | null>).timezone]));
    for (const c of contacts) c.timezone = tzMap.get(c.value) || null;
  }

  return contacts;
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
  opts: { contacts?: string[]; segmentTags?: string[]; platforms?: string[]; bypassConsent: boolean }
): Promise<number> {
  const admin = createAdminClient();
  const contacts = (opts.contacts || []).filter(Boolean);
  const segmentTags = (opts.segmentTags || []).filter(Boolean);
  const platforms = (opts.platforms || []).filter(Boolean);
  const hasContacts = !!contacts.length;
  const hasSegment = !!segmentTags.length;

  if (channel !== "push") {
    const field = channel === "sms" ? "phone" : "email";
    const audience = await resolveSmsEmailAudience(admin, projectId, field, { contacts, segmentTags, bypassConsent: opts.bypassConsent });
    return audience.length;
  }

  if (!hasContacts && !hasSegment) {
    let q = admin.from("subscribers").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true).not("endpoint", "is", null);
    if (platforms.length) q = q.in("platform", platforms);
    const { count } = await q;
    return count || 0;
  }
  // ids/segmentIds могут включать identity_devices, привязанные к устройству
  // БЕЗ push (см. migration 0071) — поэтому для push-канала всегда
  // довопрашиваем subscribers с фильтром по endpoint, не возвращаем длину
  // списка id напрямую (иначе точный подсчёт получился бы завышенным).
  const ids = hasContacts ? await resolvePushContactIds(projectId, contacts, opts.bypassConsent) : [];
  if (hasContacts && hasSegment) {
    if (!ids.length) return 0;
    const segmentIds = await resolvePushSegmentIds(projectId, segmentTags);
    const intersected = ids.filter((id) => segmentIds.includes(id));
    if (!intersected.length) return 0;
    let q = admin.from("subscribers").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true).not("endpoint", "is", null).in("id", intersected);
    if (platforms.length) q = q.in("platform", platforms);
    const { count } = await q;
    return count || 0;
  }
  if (hasContacts) {
    if (!ids.length) return 0;
    let q = admin.from("subscribers").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true).not("endpoint", "is", null).in("id", ids);
    if (platforms.length) q = q.in("platform", platforms);
    const { count } = await q;
    return count || 0;
  }
  const segmentIds = await resolvePushSegmentIds(projectId, segmentTags);
  if (!segmentIds.length) return 0;
  let q = admin.from("subscribers").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("is_active", true).not("endpoint", "is", null).in("id", segmentIds);
  if (platforms.length) q = q.in("platform", platforms);
  const { count } = await q;
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
  const { template: templateCtx, context: sendCtx } = await resolveTemplateData(campaign.project_id, campaign.template_data);
  const CONCURRENCY = 10;
  for (let i = 0; i < audience.length; i += CONCURRENCY) {
    const chunk = audience.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (c) => {
        const attrs = { ...c.attrs, ...sendCtx, template: templateCtx, context: sendCtx, automation: {} };
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
  const { template: templateCtx, context: sendCtx } = await resolveTemplateData(campaign.project_id, campaign.template_data);
  const CONCURRENCY = 10;
  for (let i = 0; i < audience.length; i += CONCURRENCY) {
    const chunk = audience.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (c) => {
        // unsubscribe_url — ПОСЛЕ sendCtx, чтобы разовые данные вызова не
        // могли подменить ссылку отписки на чужую/поддельную.
        const attrs = { ...c.attrs, ...sendCtx, template: templateCtx, context: sendCtx, automation: {}, unsubscribe_url: unsubscribeUrl(appUrl, campaign.project_id, c.value) };
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
): Promise<{ subject: string | null; html: string | null; body: string | null; name?: string; context?: Record<string, unknown> | null }> {
  let html = explicit.html || null;
  let subject = explicit.subject || null;
  let body = explicit.body || null;
  let name: string | undefined;
  let context: Record<string, unknown> | null | undefined;
  if (templateId) {
    const { data: tpl } = await admin
      .from("templates")
      .select("name, subject, html, body, context")
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
      name = tpl.name;
      context = tpl.context as Record<string, unknown> | null;
    }
  }
  return { subject, html, body, name, context };
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
    sendWindow?: { enabled: boolean; days: number[] | null; timeFrom: string | null; timeTo: string | null; subscriberTz: boolean };
    spacing?: { enabled: boolean; minutes: number | null };
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
      template_data: mergeTemplateContext(resolved.context, content.data),
      template_id: content.templateId || null,
      provider,
      segment_tags: content.segmentTags || [],
      status: "sending",
      type,
      initiator: content.initiator || "api",
      internal_title: content.internalTitle || null,
      contacts: contacts || [],
      send_window_enabled: content.sendWindow?.enabled || false,
      send_days: content.sendWindow?.enabled && content.sendWindow.days?.length ? content.sendWindow.days : null,
      send_time_from: content.sendWindow?.enabled ? content.sendWindow.timeFrom : null,
      send_time_to: content.sendWindow?.enabled ? content.sendWindow.timeTo : null,
      send_window_subscriber_tz: content.sendWindow?.subscriberTz || false,
      spacing_enabled: content.spacing?.enabled || false,
      spacing_minutes: content.spacing?.enabled ? content.spacing.minutes : null,
    })
    .select("id, project_id, title, body, subject, html_body, segment_tags, channel, provider, type, template_data, contacts")
    .single();
  if (error || !campaign) return { ok: false, delivered: 0, failed: 0, total: 0, error: "campaign create failed" };

  if (content.sendWindow?.enabled || content.spacing?.enabled) {
    const r = await enqueueWindowedCampaign(
      {
        ...campaign,
        channel,
        contacts,
        send_window_enabled: content.sendWindow?.enabled,
        send_days: content.sendWindow?.days,
        send_time_from: content.sendWindow?.timeFrom,
        send_time_to: content.sendWindow?.timeTo,
        send_window_subscriber_tz: content.sendWindow?.subscriberTz,
        spacing_enabled: content.spacing?.enabled,
        spacing_minutes: content.spacing?.minutes,
      },
      undefined
    );
    return { ok: r.ok, delivered: 0, failed: 0, total: r.enqueued };
  }

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
    data?: Record<string, unknown> | null;
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
      .not("endpoint", "is", null)
      .limit(1)
      .maybeSingle();
    if (!sub) return { ok: false, error: "У этого контакта нет активной push-подписки" };

    const { data: secret } = await admin.from("project_secrets").select("vapid_private_key").eq("project_id", projectId).single();
    const { data: project } = await admin.from("projects").select("vapid_public_key").eq("id", projectId).single();
    if (!secret?.vapid_private_key || !project?.vapid_public_key) return { ok: false, error: "VAPID-ключи не настроены" };

    // Прогоняем через тот же Liquid-рендер, что и реальная отправка (см.
    // dispatchCampaign) — иначе тестовое сообщение показало бы {{ }}/{% %}
    // буквально, а не то, что реально уйдёт получателю. content.data — та же
    // структура, что и campaign.template_data (см. splitTemplateData).
    const { template: testTemplateCtx, context: testSendCtx } = await resolveTemplateData(projectId, content.data);
    const attrs = { ...((sub as { attributes?: Record<string, unknown> }).attributes || {}), ...testSendCtx, template: testTemplateCtx, context: testSendCtx, automation: {} };
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

    const { template: smsTemplateCtx, context: smsSendCtx } = await resolveTemplateData(projectId, content.data);
    const text = applyTemplate(content.text, { ...smsSendCtx, template: smsTemplateCtx, context: smsSendCtx, automation: {} });
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
  const { template: emailTemplateCtx, context: emailSendCtx } = await resolveTemplateData(projectId, content.data);
  const testAttrs = { ...emailSendCtx, template: emailTemplateCtx, context: emailSendCtx, automation: {}, unsubscribe_url: unsubscribeUrl(process.env.NEXT_PUBLIC_APP_URL || "", projectId, email) };
  const subject = applyTemplate(content.subject || content.title || "", testAttrs);
  const html = applyTemplate(content.html, testAttrs);

  const ok =
    provider === "smsc"
      ? (await sendEmailSmsc(secrets.smsc_login!, secrets.smsc_password!, email, subject, html, emailFrom)).ok
      : await sendEmail(secrets.haskimail_server_token!, email, { subject, html }, emailFrom || undefined, secrets.haskimail_marketing_stream!);
  return ok ? { ok: true } : { ok: false, error: "Провайдер отклонил отправку" };
}
