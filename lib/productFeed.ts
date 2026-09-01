import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPublicUrl } from "@/lib/ssrfGuard";

// Товарный фид в формате YML (Яндекс.Маркет) — тот же формат, что отдаёт
// штатный экспорт InSales по умолчанию. Разбор — ручной, регулярками: формат
// плоский (один уровень полей внутри каждого <offer>), внешняя зависимость
// ради этого не нужна (см. остальной lib/ — тот же принцип, ни одной новой
// npm-библиотеки за всю сессию). Проверено на живом фиде (yuliawave.com,
// 1722 оффера, 354 группы вариантов, ~8 param на оффер) — реальные фиды
// вперемешку используют одинарные И двойные кавычки на атрибутах
// (id='…' group_id='…' available="…" в одном и том же offer), поэтому
// extractAttr обязан понимать оба варианта.
export type ProductFeedItem = {
  external_id: string;
  group_id: string | null; // объединяет варианты одного товара (размер/цвет)
  name: string;
  price: number | null;
  old_price: number | null;
  image_url: string | null;
  url: string | null;
  categories: string[]; // YML допускает несколько <categoryId> на оффер
  collections: string[]; // несколько <collectionId> на оффер — имена, как и categories
  params: Record<string, string>; // <param name="…">…</param> + vendor/manufacturer/country_of_origin/weight
};

function decodeXmlEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Атрибут тега — id='…' И id="…" оба встречаются в одном реальном фиде.
function extractAttr(tagOpen: string, attr: string): string | null {
  const m = tagOpen.match(new RegExp(`\\b${attr}=(?:"([^"]*)"|'([^']*)')`));
  if (!m) return null;
  const v = (m[1] ?? m[2] ?? "").trim();
  return v ? decodeXmlEntities(v) : null;
}

function extractTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeXmlEntities(m[1]).trim() || null : null;
}

// Несколько одноимённых тегов (categoryId) — YML допускает больше одной
// категории на товар, реальные фиды этим пользуются.
function extractTagAll(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const v = decodeXmlEntities(m[1]).trim();
    if (v) out.push(v);
  }
  return out;
}

// <param name="Цвет товара">Рыжий</param> — ключ берём из атрибута name, не
// из тега. Плюс горстка стандартных YML-полей, которые формально не
// "param", но по смыслу такие же кастомные атрибуты товара.
function extractParams(block: string): Record<string, string> {
  const params: Record<string, string> = {};
  const re = /<param\s+([^>]*)>([\s\S]*?)<\/param>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const name = extractAttr(m[1], "name");
    const value = decodeXmlEntities(m[2]).trim();
    if (name && value && !(name in params)) params[name] = value;
  }
  for (const tag of ["vendor", "manufacturer", "country_of_origin", "weight"]) {
    const v = extractTag(block, tag);
    if (v && !(tag in params)) params[tag] = v;
  }
  return params;
}

// Быстрая проверка "это вообще похоже на YML" — до полного разбора тысяч
// офферов. Отдельно от парсинга самих офферов, чтобы пустой/битый фид
// вернул понятную ошибку, а не молчаливое "0 товаров".
export function looksLikeYmlFeed(xml: string): boolean {
  return /<yml_catalog[\s>]/i.test(xml) && /<offers[\s>]/i.test(xml);
}

// date из <yml_catalog date="…"> — YML отдаёт его как "YYYY-MM-DD HH:MM".
// Сверяем строкой, без парсинга в Date: не нужно, только для сравнения
// "изменилось/нет".
export function extractFeedDate(xml: string): string | null {
  const m = xml.match(/<yml_catalog\s+([^>]*)>/i);
  return m ? extractAttr(m[1], "date") : null;
}

export type CategoryFeedItem = { external_id: string; name: string; parent_id: string | null };

// Полный разбор секции <categories> — id, имя, родитель (для будущей
// иерархии; сейчас используется только id+имя). parseCategoryNames ниже —
// узкая обёртка для существующего использования (подпись product.categories
// именами), сама секция разбирается один раз.
function parseCategories(xml: string): CategoryFeedItem[] {
  const categories: CategoryFeedItem[] = [];
  const categoriesBlock = xml.match(/<categories>([\s\S]*?)<\/categories>/i)?.[1] || "";
  const categoryRe = /<category\s+([^>]*)>([\s\S]*?)<\/category>/gi;
  let m: RegExpExecArray | null;
  while ((m = categoryRe.exec(categoriesBlock))) {
    const id = extractAttr(m[1], "id");
    const name = decodeXmlEntities(m[2]).trim();
    if (id && name) categories.push({ external_id: id, name, parent_id: extractAttr(m[1], "parentId") });
  }
  return categories;
}

// id категории -> человекочитаемое название, если секция <categories> есть
// в фиде.
function parseCategoryNames(xml: string): Map<string, string> {
  return new Map(parseCategories(xml).map((c) => [c.external_id, c.name]));
}

// Коллекции — отдельный от categories раздел YML (см. документацию Яндекс.Директ,
// https://yandex.ru/support/direct/ru/feeds/requirements-yml#collections):
// не иерархия категорий, а тематические подборки для карточек в письме —
// с картинкой(-ами), ссылкой и описанием, каждый <offer> может входить сразу
// в несколько. Идёт ПОСЛЕ <offers> в структуре фида, но парсим независимо от
// позиции — секция ищется по тегу, а не по месту в документе.
export type CollectionFeedItem = {
  external_id: string;
  name: string;
  description: string | null;
  url: string | null;
  image_url: string | null; // первая <picture> — для карточки достаточно одной
  images: string[]; // все <picture> по порядку, если нужно больше одной
};

function parseCollections(xml: string): CollectionFeedItem[] {
  const collections: CollectionFeedItem[] = [];
  const collectionsBlock = xml.match(/<collections>([\s\S]*?)<\/collections>/i)?.[1] || "";
  const collectionRe = /<collection\s+([^>]*)>([\s\S]*?)<\/collection>/gi;
  let m: RegExpExecArray | null;
  while ((m = collectionRe.exec(collectionsBlock))) {
    const id = extractAttr(m[1], "id");
    const body = m[2];
    const name = extractTag(body, "name");
    if (!id || !name) continue;
    const images = extractTagAll(body, "picture");
    collections.push({
      external_id: id,
      name,
      description: extractTag(body, "description"),
      url: extractTag(body, "url"),
      image_url: images[0] || null,
      images,
    });
  }
  return collections;
}

function parseCollectionNames(xml: string): Map<string, string> {
  return new Map(parseCollections(xml).map((c) => [c.external_id, c.name]));
}

export function parseYmlFeed(xml: string): ProductFeedItem[] {
  const categoryNames = parseCategoryNames(xml);
  const collectionNames = parseCollectionNames(xml);

  const items: ProductFeedItem[] = [];
  const offerRe = /<offer\s+([^>]*)>([\s\S]*?)<\/offer>/gi;
  let m: RegExpExecArray | null;
  while ((m = offerRe.exec(xml))) {
    const id = extractAttr(m[1], "id");
    if (!id) continue;
    const body = m[2];
    // name — либо явный <name>, либо vendor+model (частый вариант для YML с товарными вариациями).
    const name = extractTag(body, "name") || [extractTag(body, "vendor"), extractTag(body, "model")].filter(Boolean).join(" ").trim();
    if (!name) continue;
    const priceRaw = extractTag(body, "price");
    const price = priceRaw ? Number(priceRaw.replace(",", ".")) : null;
    const oldPriceRaw = extractTag(body, "oldprice");
    const oldPrice = oldPriceRaw ? Number(oldPriceRaw.replace(",", ".")) : null;
    const categoryIds = extractTagAll(body, "categoryId");
    const collectionIds = extractTagAll(body, "collectionId");

    items.push({
      external_id: id,
      group_id: extractAttr(m[1], "group_id"),
      name,
      price: price !== null && Number.isFinite(price) ? price : null,
      old_price: oldPrice !== null && Number.isFinite(oldPrice) ? oldPrice : null,
      image_url: extractTag(body, "picture"),
      url: extractTag(body, "url"),
      categories: categoryIds.map((id) => categoryNames.get(id) || id),
      collections: collectionIds.map((id) => collectionNames.get(id) || id),
      params: extractParams(body),
    });
  }
  return items;
}

// Перечитывает фид проекта и обновляет кеш product_feed_items — вызывается и
// вручную (кнопка «Обновить сейчас» в Настройках), и по расписанию (крон
// refresh-product-feeds, раз в 15 минут). Если <yml_catalog date="…"> не
// изменился с прошлого раза — фид не разбирается заново (на живом фиде
// 1722 оффера/354 группы это реальная экономия, не микрооптимизация).
export async function refreshProductFeed(projectId: string): Promise<{ ok: boolean; count: number; skipped?: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("product_feed_url, product_feed_source_date, product_feed_item_count").eq("id", projectId).maybeSingle();
  const feedUrl = project?.product_feed_url;
  if (!feedUrl) return { ok: false, count: 0, error: "не указан URL фида" };

  let xml: string;
  try {
    // fetchPublicUrl — не голый fetch: блокирует адреса внутренней сети/
    // localhost/cloud-metadata на каждом хопе редиректа (SSRF-защита, см.
    // lib/ssrfGuard.ts) — product_feed_url задаёт сам админ проекта.
    const res = await fetchPublicUrl(feedUrl, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (e) {
    const message = e instanceof Error ? e.message : "не удалось загрузить фид";
    await admin.from("projects").update({ product_feed_error: message }).eq("id", projectId);
    return { ok: false, count: 0, error: message };
  }

  if (!looksLikeYmlFeed(xml)) {
    const message = "фид не похож на YML — не найдены <yml_catalog>/<offers>";
    await admin.from("projects").update({ product_feed_error: message }).eq("id", projectId);
    return { ok: false, count: 0, error: message };
  }

  // Кеш категорий обновляем ВСЕГДА, даже если товары ниже сейчас пропустят
  // перепарсинг (см. skip по source date) — секция <categories> в разы
  // меньше <offers>, перечитывать её каждый раз дёшево, а привязывать к тому
  // же skip'у значило бы, что уже синхронизированные проекты не увидят
  // категории вообще, пока апстрим-фид не поменяет дату (см. resolveCategoryContext).
  const categoriesRefreshedAt = new Date().toISOString();
  const categories = parseCategories(xml);
  if (categories.length) {
    for (let i = 0; i < categories.length; i += 500) {
      const chunk = categories.slice(i, i + 500).map((c) => ({ project_id: projectId, ...c, updated_at: categoriesRefreshedAt }));
      await admin.from("product_feed_categories").upsert(chunk, { onConflict: "project_id,external_id" });
    }
    await admin.from("product_feed_categories").delete().eq("project_id", projectId).lt("updated_at", categoriesRefreshedAt);
  }

  // Кеш коллекций — та же логика, независимо от skip по товарам ниже (см.
  // комментарий у категорий выше). У фида может не быть <collections> вовсе
  // (необязательный раздел) — тогда просто нечего кешировать.
  const collectionsRefreshedAt = new Date().toISOString();
  const collections = parseCollections(xml);
  if (collections.length) {
    for (let i = 0; i < collections.length; i += 500) {
      const chunk = collections.slice(i, i + 500).map((c) => ({ project_id: projectId, ...c, updated_at: collectionsRefreshedAt }));
      await admin.from("product_feed_collections").upsert(chunk, { onConflict: "project_id,external_id" });
    }
    await admin.from("product_feed_collections").delete().eq("project_id", projectId).lt("updated_at", collectionsRefreshedAt);
  }

  const sourceDate = extractFeedDate(xml);
  if (sourceDate && sourceDate === project?.product_feed_source_date) {
    // фид не обновлялся с прошлого раза — только отмечаем момент проверки.
    await admin.from("projects").update({ product_feed_updated_at: new Date().toISOString(), product_feed_error: null }).eq("id", projectId);
    return { ok: true, count: project?.product_feed_item_count || 0, skipped: true };
  }

  const items = parseYmlFeed(xml);
  if (!items.length) {
    const message = "фид пустой или не распознан (ни одного оффера с id и названием)";
    await admin.from("projects").update({ product_feed_error: message }).eq("id", projectId);
    return { ok: false, count: 0, error: message };
  }

  const refreshStartedAt = new Date().toISOString();
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500).map((it) => ({ project_id: projectId, ...it, updated_at: refreshStartedAt }));
    const { error } = await admin.from("product_feed_items").upsert(chunk, { onConflict: "project_id,external_id" });
    if (error) {
      await admin.from("projects").update({ product_feed_error: error.message }).eq("id", projectId);
      return { ok: false, count: 0, error: error.message };
    }
  }
  // то, что не тронуло это обновление, — пропало из фида (категории уже
  // обновлены выше, до skip-проверки — не привязаны к refreshStartedAt).
  await admin.from("product_feed_items").delete().eq("project_id", projectId).lt("updated_at", refreshStartedAt);

  await admin
    .from("projects")
    .update({
      product_feed_updated_at: refreshStartedAt,
      product_feed_item_count: items.length,
      product_feed_source_date: sourceDate,
      product_feed_error: null,
    })
    .eq("id", projectId);
  return { ok: true, count: items.length };
}

// Удаляет фид проекта целиком — ссылку И кеш товаров (product_feed_items).
// Кнопка «Удалить фид» в Настройках: чтобы подключить другой фид с нуля, не
// смешивая старые и новые позиции (совпадающие external_id из разных фидов
// у разных магазинов — не гарантированно один и тот же товар).
export async function clearProductFeed(projectId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("product_feed_items").delete().eq("project_id", projectId);
  await admin
    .from("projects")
    .update({
      product_feed_url: null,
      product_feed_updated_at: null,
      product_feed_item_count: 0,
      product_feed_source_date: null,
      product_feed_error: null,
    })
    .eq("id", projectId);
}

// Контекст для Liquid в событийных рассылках про товары — резолвит id(-ы)
// товара из payload события против кеша фида. Принимает оба варианта:
// одиночный product_id (просмотр товара/категории) и массив product_ids
// (брошенная корзина — несколько позиций). Best-effort: нет фида/не нашли —
// пустой объект, шаблон просто не подставит {{ product }}. Кастомные
// атрибуты доступны через {{ product.params["Название"] }} (Liquid не умеет
// {{ product.params.Название }} с пробелом в ключе — только через скобки).
const PRODUCT_COLUMNS = "external_id, group_id, name, price, old_price, image_url, url, categories, collections, params";

// Ссылка на товар ИЛИ категорию внутри ручного JSON-контекста
// (template.*/context.*) — {"id": "123"} рядом с любыми другими полями.
// Элемент считается ссылкой, только если id — строка/число; объект без id
// всегда остаётся чистым ручным вводом (см. expandProductRefs/expandCategoryRefs).
function refId(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const id = (v as Record<string, unknown>).id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

// Расширяет products/product ВНУТРИ уже готового объекта контекста (после
// mergeTemplateContext/splitTemplateData — вызывается отдельно для template.*
// и отдельно для context.*, см. resolveTemplateData в lib/sender.ts) свежими
// данными из кеша фида: элемент с полем id заменяется ЦЕЛИКОМ на актуальный
// ProductFeedItem — переданные рядом с id атрибуты игнорируются, побеждает
// фид (максимально свежие данные, а не то, что могло устареть в JSON).
// Элементы без id — чистый ручной ввод, не трогаем (см. ContextDocs.tsx,
// п.4). Резолвится заново при каждой отправке (как resolveProductContext),
// не замораживается.
export async function expandProductRefs(projectId: string, ctx: Record<string, unknown>): Promise<Record<string, unknown>> {
  const productsArr = Array.isArray(ctx.products) ? (ctx.products as unknown[]) : null;
  const productObj = ctx.product;
  const productObjId = refId(productObj);
  const ids = new Set<string>();
  if (productsArr) for (const p of productsArr) { const id = refId(p); if (id) ids.add(id); }
  if (productObjId) ids.add(productObjId);
  if (!ids.size) return ctx;

  const admin = createAdminClient();
  const { data } = await admin.from("product_feed_items").select(PRODUCT_COLUMNS).eq("project_id", projectId).in("external_id", [...ids]);
  const byId = new Map((data || []).map((p) => [p.external_id, p]));

  const out = { ...ctx };
  if (productsArr) out.products = productsArr.map((p) => { const id = refId(p); return id && byId.has(id) ? byId.get(id) : p; });
  if (productObjId && byId.has(productObjId)) out.product = byId.get(productObjId);
  return out;
}

export async function resolveProductContext(projectId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const singleId = typeof payload.product_id === "string" || typeof payload.product_id === "number" ? String(payload.product_id) : null;
  const manyIds = Array.isArray(payload.product_ids) ? payload.product_ids.map(String).slice(0, 20) : [];
  const ids = [...new Set([...(singleId ? [singleId] : []), ...manyIds])];
  if (!ids.length) return {};

  const { data } = await admin
    .from("product_feed_items")
    .select("external_id, group_id, name, price, old_price, image_url, url, categories, collections, params")
    .eq("project_id", projectId)
    .in("external_id", ids);
  if (!data?.length) return {};

  const byId = new Map(data.map((p) => [p.external_id, p]));
  const context: Record<string, unknown> = {};
  if (singleId && byId.has(singleId)) context.product = byId.get(singleId);
  if (manyIds.length) {
    const products = manyIds.map((id) => byId.get(id)).filter(Boolean);
    if (products.length) {
      context.products = products;
      if (!context.product) context.product = products[0];
    }
  }
  return context;
}

const CATEGORY_COLUMNS = "external_id, name, parent_id";

// Расширяет category/categories ВНУТРИ уже готового объекта контекста —
// зеркало expandProductRefs, тот же принцип (id побеждает ручные поля,
// элементы без id остаются как есть).
export async function expandCategoryRefs(projectId: string, ctx: Record<string, unknown>): Promise<Record<string, unknown>> {
  const categoriesArr = Array.isArray(ctx.categories) ? (ctx.categories as unknown[]) : null;
  const categoryObj = ctx.category;
  const categoryObjId = refId(categoryObj);
  const ids = new Set<string>();
  if (categoriesArr) for (const c of categoriesArr) { const id = refId(c); if (id) ids.add(id); }
  if (categoryObjId) ids.add(categoryObjId);
  if (!ids.size) return ctx;

  const admin = createAdminClient();
  const { data } = await admin.from("product_feed_categories").select(CATEGORY_COLUMNS).eq("project_id", projectId).in("external_id", [...ids]);
  const byId = new Map((data || []).map((c) => [c.external_id, c]));

  const out = { ...ctx };
  if (categoriesArr) out.categories = categoriesArr.map((c) => { const id = refId(c); return id && byId.has(id) ? byId.get(id) : c; });
  if (categoryObjId && byId.has(categoryObjId)) out.category = byId.get(categoryObjId);
  return out;
}

// Зеркало resolveProductContext — category_id/category_ids из payload
// события/вебхука (трекинг) резолвятся против кеша фида в {{ category }}/
// {{ categories }}, тем же способом, что и товары. category_ids позволяет
// трекингу передать сразу список — например, все категории, которые
// подписчик просматривал (см. также «Очищать список после отправки» у
// событийной автоматизации, run-automations, — там накопленный список
// подставляется сюда же через тот же payload.category_ids).
export async function resolveCategoryContext(projectId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const singleId = typeof payload.category_id === "string" || typeof payload.category_id === "number" ? String(payload.category_id) : null;
  const manyIds = Array.isArray(payload.category_ids) ? payload.category_ids.map(String).slice(0, 20) : [];
  const ids = [...new Set([...(singleId ? [singleId] : []), ...manyIds])];
  if (!ids.length) return {};

  const { data } = await admin.from("product_feed_categories").select(CATEGORY_COLUMNS).eq("project_id", projectId).in("external_id", ids);
  if (!data?.length) return {};

  const byId = new Map(data.map((c) => [c.external_id, c]));
  const context: Record<string, unknown> = {};
  if (singleId && byId.has(singleId)) context.category = byId.get(singleId);
  if (manyIds.length) {
    const categories = manyIds.map((id) => byId.get(id)).filter(Boolean);
    if (categories.length) {
      context.categories = categories;
      if (!context.category) context.category = categories[0];
    }
  }
  return context;
}

const COLLECTION_COLUMNS = "external_id, name, description, url, image_url, images";

// Расширяет collection/collections ВНУТРИ уже готового объекта контекста —
// зеркало expandCategoryRefs, тот же принцип.
export async function expandCollectionRefs(projectId: string, ctx: Record<string, unknown>): Promise<Record<string, unknown>> {
  const collectionsArr = Array.isArray(ctx.collections) ? (ctx.collections as unknown[]) : null;
  const collectionObj = ctx.collection;
  const collectionObjId = refId(collectionObj);
  const ids = new Set<string>();
  if (collectionsArr) for (const c of collectionsArr) { const id = refId(c); if (id) ids.add(id); }
  if (collectionObjId) ids.add(collectionObjId);
  if (!ids.size) return ctx;

  const admin = createAdminClient();
  const { data } = await admin.from("product_feed_collections").select(COLLECTION_COLUMNS).eq("project_id", projectId).in("external_id", [...ids]);
  const byId = new Map((data || []).map((c) => [c.external_id, c]));

  const out = { ...ctx };
  if (collectionsArr) out.collections = collectionsArr.map((c) => { const id = refId(c); return id && byId.has(id) ? byId.get(id) : c; });
  if (collectionObjId && byId.has(collectionObjId)) out.collection = byId.get(collectionObjId);
  return out;
}

// Зеркало resolveCategoryContext, НО читает те же поля payload —
// category_id/category_ids, не отдельные collection_id/collection_ids:
// сайт передаёт один и тот же идентификатор группировки, не разделяя для
// себя категорию и коллекцию (это внутреннее разделение фида/платформы, не
// трекинга) — резолвится в {{ collection }}/{{ collections }} (картинка(-и)/
// ссылка/описание, готово для карточки в письме), ПАРАЛЛЕЛЬНО и независимо
// от resolveCategoryContext по тому же id (см. FeedStructureDocs.tsx/ContextDocs.tsx).
export async function resolveCollectionContext(projectId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const singleId = typeof payload.category_id === "string" || typeof payload.category_id === "number" ? String(payload.category_id) : null;
  const manyIds = Array.isArray(payload.category_ids) ? payload.category_ids.map(String).slice(0, 20) : [];
  const ids = [...new Set([...(singleId ? [singleId] : []), ...manyIds])];
  if (!ids.length) return {};

  const { data } = await admin.from("product_feed_collections").select(COLLECTION_COLUMNS).eq("project_id", projectId).in("external_id", ids);
  if (!data?.length) return {};

  const byId = new Map(data.map((c) => [c.external_id, c]));
  const context: Record<string, unknown> = {};
  if (singleId && byId.has(singleId)) context.collection = byId.get(singleId);
  if (manyIds.length) {
    const collections = manyIds.map((id) => byId.get(id)).filter(Boolean);
    if (collections.length) {
      context.collections = collections;
      if (!context.collection) context.collection = collections[0];
    }
  }
  return context;
}
