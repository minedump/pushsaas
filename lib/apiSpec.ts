// Единый источник правды для описания публичного API (/api/v1/*) — из него
// генерируются и раздел «API» в админке (app/admin/projects/[id]/api/page.tsx,
// показывает разворачиваемую таблицу полей прямо на странице), и скачиваемый
// API.md (app/api/v1/docs/route.ts). Держим контент в одном месте, чтобы
// страница и файл не расходились со временем.

export type ApiField = { name: string; type: string; required?: boolean; description: string; children?: ApiField[] };
export type ApiFieldGroup = { title: string; note?: string; fields: ApiField[] };
export type ApiError = { code: number; description: string };
export type ApiEnumValue = { value: string; description: string };
export type ApiEndpoint = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  summary: string;
  queryParams?: ApiField[];
  // true — эндпоинт читает JSON-тело (нужен заголовок Content-Type), даже
  // если структурированных полей нет (например /trigger — тело произвольное).
  sendsJsonBody?: boolean;
  bodyFields?: ApiField[];
  bodyGroups?: ApiFieldGroup[];
  // Пример тела запроса — сырой JSON, для эндпоинтов со структурированным телом.
  bodyExample?: string;
  bodyExamples?: { label: string; json: string }[];
  bodyNote?: string;
  responseExample?: string;
  responseFields?: ApiField[];
  responseStatus?: ApiEnumValue[];
  responseNote?: string;
  errors?: ApiError[];
};
export type ApiGroup = { title: string; endpoints: ApiEndpoint[] };

const AUTH_METHODS = [
  "Authorization: Bearer wpk_ВАШ_КЛЮЧ",
  "Authorization: Basic base64(wpk_ВАШ_КЛЮЧ:x) — ключ как логин в URL вида https://wpk_КЛЮЧ@host/...",
  "X-Api-Key: wpk_ВАШ_КЛЮЧ",
  "?key=wpk_ВАШ_КЛЮЧ — query-параметр, удобно для вебхуков",
];

export const API_INTRO = {
  authMethods: AUTH_METHODS,
  authNote:
    "Ключ берётся в разделе «API» админки (там же выбирается, через какого провайдера ключ шлёт SMS/Email — фиксируется один раз при создании ключа, в теле запроса не переопределяется). Ниже везде показан вариант Bearer — остальные три равнозначны, см. выше.",
  liquidNote:
    "Везде, где в тексте/HTML можно подставлять значения — Liquid ({{ key }}, {% if %}, {% for %}, фильтры). Одинарные фигурные скобки ({key}) не поддерживаются — использовать только {{ }}.",
  liquidSources: [
    "Атрибуты контакта/подписчика (что накопилось в его профиле)",
    "context.* и плоские ключи — то, что передано в templateData этого конкретного вызова",
    "template.* — контекст, сохранённый в самом шаблоне (раздел «Шаблоны»), если использовался templateId",
  ],
  liquidExample:
    'templateData: {"orderId": "A-1001", "product": {"id": "SKU-42"}} → в тексте {{ orderId }} и {{ product.name }}/{{ product.price }} (объект с полем id автоматически дополняется данными из товарного фида, если он подключён). Тот же принцип для {{ category }}/{{ categories }}/{{ collection }}/{{ collections }}.',
};

const AUTH_ERROR: ApiError = { code: 401, description: "Ключ не передан, неверен или отозван." };
const BLOCKED_ERROR: ApiError = { code: 402, description: "Проект заблокирован (биллинг)." };

const SEND_WINDOW_DESC = "Ограничивает отправку определёнными днями недели и часами — вне окна сообщение откладывается до следующего наступления окна, а не отправляется сразу и не теряется.";
const SEND_WINDOW_CHILDREN: ApiField[] = [
  { name: "enabled", type: "boolean", description: "Включает/выключает механизм окна отправки. Без true остальные поля ниже игнорируются, как будто sendWindow не передавали вовсе." },
  {
    name: "days",
    type: "number[]",
    description: "Разрешённые дни недели, 0=воскресенье…6=суббота — например [1,2,3,4,5] значит будни. В неразрешённый день отправка сдвигается на ближайший разрешённый.",
  },
  { name: "timeFrom", type: 'string "HH:MM"', description: 'Начало разрешённого промежутка часов внутри дня, 24-часовой формат (например "09:00"). Включительно.' },
  { name: "timeTo", type: 'string "HH:MM"', description: "Конец разрешённого промежутка часов внутри дня. Включительно." },
  {
    name: "subscriberTz",
    type: "boolean",
    description:
      "true — считать время по часовому поясу получателя, если он известен (виджет передаёт его при подписке/identify). false — всегда по часовому поясу проекта (раздел «Настройки»), даже если пояс получателя известен.",
  },
];

const SPACING_DESC =
  "Защита от наложения — не даёт слать одному и тому же получателю слишком часто; учитывает любые рассылки и автоматизации на этот канал, а не только повторные вызовы этого же запроса.";
const SPACING_CHILDREN: ApiField[] = [
  { name: "enabled", type: "boolean", description: "Включает/выключает защиту от наложения. Без true minutes игнорируется." },
  {
    name: "minutes",
    type: "number",
    description:
      "Минимальный интервал в минутах с момента последней УСПЕШНОЙ отправки этому получателю на этот канал. Если интервал ещё не истёк — сообщение откладывается до его истечения, а не отменяется.",
  },
];

const SEND_SHARED_FIELDS: ApiField[] = [
  { name: "channel", type: '"push" | "sms" | "email"', required: true, description: "Канал отправки — обязательное поле, значение по умолчанию не подставляется." },
  {
    name: "type",
    type: '"marketing" | "transactional"',
    description:
      'По умолчанию "marketing". Транзакционные игнорируют ручной опт-аут получателя и не требуют ссылки отписки — указывайте для сервисных сообщений (заказ отправлен, статус изменился).',
  },
  { name: "templateId", type: "string", description: "id шаблона (см. GET /api/v1/templates). Явные поля контента переопределяют одноимённые поля шаблона." },
  { name: "templateData", type: "object", description: "Разовые данные этого вызова для Liquid-подстановки — см. раздел «Шаблонизация»." },
  { name: "segmentTags", type: "string[]", description: "Сегмент по тегам контакта. Пусто = не фильтровать по тегам." },
  { name: "contacts", type: "string[]", description: "Адресная отправка — телефоны и email вперемешку в одном списке. Строка не по каналу просто ни на что не матчится." },
  { name: "phones / phone", type: "string[] / string", description: "То же самое отдельным полем (эквивалентно записи в contacts)." },
  { name: "emails / email", type: "string[] / string", description: "То же самое для email." },
  {
    name: "draft",
    type: "boolean",
    description: 'По умолчанию false. true — сохранить черновиком, ничего не отправляя. Взаимоисключимо с scheduledAt — draft побеждает, если передали оба.',
  },
  { name: "scheduledAt", type: "ISO-datetime", description: "Отложенная отправка (должна быть в будущем) — появится со статусом scheduled." },
  { name: "internalTitle", type: "string", required: true, description: "Название для списка «Рассылки» — получателям не видно, обязательно." },
  { name: "sendWindow", type: "object", description: SEND_WINDOW_DESC, children: SEND_WINDOW_CHILDREN },
  { name: "spacing", type: "object", description: SPACING_DESC, children: SPACING_CHILDREN },
];

const PUSH_FIELDS: ApiField[] = [
  { name: "title, body", type: "string", required: true, description: "Заголовок и текст уведомления (или templateId). title ≤ 80, body ≤ 200 символов." },
  { name: "url", type: "string", description: "Куда ведёт клик по уведомлению." },
  { name: "icon, image, badge", type: "string", description: "URL иконки / картинки-баннера / бейджа (rich push)." },
  {
    name: "actions",
    type: "{title, url}[]",
    description: "Кнопки действий под уведомлением (rich push) — массив объектов, максимум 2 элемента, лишние молча обрезаются. Поля каждого объекта ниже.",
    children: [
      { name: "title", type: "string", description: "Подпись на кнопке. Поддерживает Liquid ({{ key }}), как заголовок/текст уведомления." },
      { name: "url", type: "string", description: "Куда ведёт клик именно по этой кнопке — независимо от url самого уведомления. Тоже поддерживает Liquid." },
    ],
  },
  { name: "platforms", type: "string[]", description: "Фильтр по типу устройства (ios/android/desktop). Пусто = все платформы." },
];
const SMS_FIELDS: ApiField[] = [{ name: "text", type: "string", required: true, description: "Текст сообщения (или templateId)." }];
const EMAIL_FIELDS: ApiField[] = [
  { name: "subject", type: "string", description: "Тема письма." },
  { name: "html", type: "string", required: true, description: 'HTML тела письма (или templateId). Для type:"marketing" обязан содержать {{ unsubscribe_url }}.' },
];

const SEND_RESULT_FIELDS: ApiField[] = [
  { name: "ok", type: "boolean", description: "true — запрос выполнен успешно." },
  { name: "campaignId", type: "string", description: "id рассылки — подставляется в GET/PUT/DELETE /api/v1/campaigns/{id}." },
  { name: "delivered", type: "number", description: "Успешно доставлено. 0 для черновика/запланированной — станет известно при фактической отправке." },
  { name: "failed", type: "number", description: "Не доставлено." },
  { name: "total", type: "number", description: "Всего получателей в подсчёте." },
];

const CAMPAIGN_LIST_ITEM_FIELDS: ApiField[] = [
  { name: "campaigns[].id", type: "string", description: "id рассылки." },
  { name: "campaigns[].channel", type: "string", description: "push | sms | email." },
  { name: "campaigns[].status", type: "string", description: "draft | scheduled | sending | sent | failed." },
  { name: "campaigns[].type", type: "string", description: "marketing | transactional." },
  { name: "campaigns[].initiator", type: "string", description: "api | manual | automation — кто создал рассылку." },
  { name: "campaigns[].internalTitle", type: "string", description: "Название для списка «Рассылки» — получателям не видно." },
  { name: "campaigns[].title", type: "string", description: "Заголовок (push) или тема/текст, использованные как название." },
  { name: "campaigns[].scheduledAt", type: "string | null", description: "ISO-дата запланированной отправки." },
  { name: "campaigns[].sentAt", type: "string | null", description: "ISO-дата фактической отправки." },
  { name: "campaigns[].sentCount", type: "number", description: "Всего получателей." },
  { name: "campaigns[].deliveredCount", type: "number", description: "Доставлено." },
  { name: "campaigns[].failedCount", type: "number", description: "Не доставлено." },
  { name: "campaigns[].clickedCount", type: "number", description: "Кликов по ссылкам рассылки." },
  { name: "campaigns[].createdAt", type: "string", description: "ISO-дата создания." },
  { name: "total", type: "number", description: "Всего рассылок с учётом фильтра status/channel — для постраничной загрузки через offset." },
];

const CAMPAIGN_FULL_FIELDS: ApiField[] = [
  { name: "id", type: "string", description: "id рассылки." },
  { name: "channel", type: "string", description: "push | sms | email." },
  { name: "status", type: "string", description: "draft | scheduled | sending | sent | failed." },
  { name: "type", type: "string", description: "marketing | transactional." },
  { name: "initiator", type: "string", description: "api | manual | automation." },
  { name: "internalTitle", type: "string", description: "Название для списка «Рассылки» — получателям не видно." },
  { name: "title", type: "string", description: "push: заголовок." },
  { name: "body", type: "string", description: "push: текст уведомления, или sms: текст сообщения." },
  { name: "subject", type: "string | null", description: "email: тема письма." },
  { name: "html", type: "string | null", description: "email: HTML тела письма." },
  { name: "url", type: "string | null", description: "push: click url." },
  { name: "icon, image, badge", type: "string | null", description: "push: rich push." },
  { name: "actions", type: "{title,url}[]", description: "push: кнопки действий." },
  { name: "segmentTags", type: "string[]", description: "Сегмент по тегам, если задан." },
  { name: "platforms", type: "string[]", description: "push: фильтр по платформам, если задан." },
  { name: "contacts", type: "string[]", description: "Адресные контакты, если заданы." },
  { name: "templateId", type: "string | null", description: "id использованного шаблона." },
  { name: "templateData", type: "object | null", description: "Разовый контекст этого вызова." },
  { name: "scheduledAt", type: "string | null", description: "ISO-дата запланированной отправки." },
  { name: "sentAt", type: "string | null", description: "ISO-дата фактической отправки." },
  { name: "error", type: "string | null", description: "Причина сбоя, если status: failed." },
  { name: "sentCount, deliveredCount, failedCount, clickedCount, openedCount", type: "number", description: "Статистика отправки (openedCount — только email)." },
  { name: "sendWindow", type: "object", description: SEND_WINDOW_DESC, children: SEND_WINDOW_CHILDREN },
  { name: "spacing", type: "object", description: SPACING_DESC, children: SPACING_CHILDREN },
  { name: "createdAt", type: "string", description: "ISO-дата создания." },
];

const TEMPLATE_LIST_ITEM_FIELDS: ApiField[] = [
  { name: "templates[].id", type: "string", description: "id шаблона — подставляется как templateId." },
  { name: "templates[].name", type: "string", description: "Название." },
  { name: "templates[].channel", type: "string", description: "push | sms | email." },
];

const TEMPLATE_FULL_FIELDS: ApiField[] = [
  { name: "id", type: "string", description: "id шаблона." },
  { name: "name", type: "string", description: "Название." },
  { name: "channel", type: "string", description: "push | sms | email." },
  { name: "folderId", type: "string | null", description: "id папки, если задана." },
  { name: "context", type: "object | null", description: "Дефолтный Liquid-контекст шаблона." },
  { name: "subject", type: "string | null", description: "email: тема письма." },
  { name: "html", type: "string | null", description: "email: HTML тела письма." },
  { name: "title", type: "string | null", description: "push: заголовок." },
  { name: "body", type: "string | null", description: "push/sms: текст." },
  { name: "url", type: "string | null", description: "push: click url." },
  { name: "icon, image, badge", type: "string | null", description: "push: rich push." },
  { name: "actions", type: "{title,url}[]", description: "push: кнопки действий." },
  { name: "createdAt, updatedAt", type: "string", description: "ISO-даты создания и последнего изменения." },
];

const SUBSCRIBER_FULL_FIELDS: ApiField[] = [
  { name: "id", type: "string", description: "id подписчика." },
  { name: "phone", type: "string | null", description: "Телефон в нормализованном виде." },
  { name: "email", type: "string | null", description: "Email." },
  { name: "name", type: "string | null", description: "Имя." },
  { name: "insalesClientId", type: "string | null", description: "id клиента в InSales, если связан с заказом." },
  { name: "tags", type: "string[]", description: "Теги для сегментации." },
  { name: "attributes", type: "object", description: "Произвольные доп. поля." },
  { name: "smsActive", type: "boolean", description: "Согласие на SMS-рассылки." },
  { name: "emailActive", type: "boolean", description: "Согласие на email-рассылки." },
  { name: "createdAt", type: "string", description: "ISO-дата создания." },
];
const SUBSCRIBER_LIST_ITEM_FIELDS: ApiField[] = [
  ...SUBSCRIBER_FULL_FIELDS.map((f) => ({ ...f, name: `subscribers[].${f.name}` })),
  { name: "total", type: "number", description: "Всего подписчиков — для постраничной загрузки через offset." },
];

const CAMPAIGN_CREATE_ERRORS: ApiError[] = [
  AUTH_ERROR,
  BLOCKED_ERROR,
  { code: 400, description: "channel не передан или не одно из push/sms/email, не хватает обязательных полей (title+body / text / html — все три без templateId), или scheduledAt не в будущем." },
  { code: 402, description: 'Провайдер не настроен, недостаточно баланса, или маркетинговый email без {{ unsubscribe_url }} ("unsubscribe link required").' },
  { code: 404, description: "push: адресная отправка (phones/emails/contacts) — ни один контакт не резолвился в устройство." },
];
const CAMPAIGN_SUCCESS_EXAMPLE = '{\n  "ok": true,\n  "campaignId": "b2f1...",\n  "status": "sending",\n  "delivered": 41,\n  "failed": 1,\n  "total": 42\n}';

const CHANNEL_TEMPLATES_CHILDREN: ApiField[] = [
  { name: "push", type: "string", description: "id push-шаблона (см. GET /api/v1/templates?channel=push)." },
  { name: "sms", type: "string", description: "id sms-шаблона." },
  { name: "email", type: "string", description: "id email-шаблона — обязан содержать {{ unsubscribe_url }}." },
];

const AUTOMATION_COMMON_CREATE_FIELDS: ApiField[] = [
  {
    name: "type",
    type: '"welcome" | "event" | "custom" | "recurring"',
    required: true,
    description:
      "Тип автоматизации — определяет, какие поля из групп ниже применимы, и когда она сработает. welcome — на новую подписку/identify контакта. event — на событие sendera.event() со стороны сайта (например брошенная корзина). custom — на вызов вебхука POST /api/v1/trigger. recurring — по календарному расписанию (поле schedule), сегменту, а не по активности контакта. После создания неизменен.",
  },
  { name: "name", type: "string", required: true, description: "Внутреннее название — получателям не видно, отображается в списке автоматизаций." },
  { name: "isEnabled", type: "boolean", description: "По умолчанию true. false — создать выключенной, не сработает, пока её не включат." },
  { name: "channel", type: '"push" | "sms" | "email"', description: "Канал отправки — обязателен, если cascade не true." },
  {
    name: "cascade",
    type: "boolean",
    description:
      "true — каскадная отправка: реальный канал резолвится в момент срабатывания по «Приоритету каналов» проекта (раздел «Подключения»), а не фиксирован заранее. При true используйте channelTemplates вместо channel+templateId, и провайдер (поле provider) не применяется.",
  },
  { name: "channelTemplates", type: "object", description: "Шаблон под каждый канал сразу — обязательно (хотя бы один канал) при cascade:true. Поля ниже.", children: CHANNEL_TEMPLATES_CHILDREN },
  { name: "templateId", type: "string", description: "id шаблона (см. GET /api/v1/templates) — обязателен, если cascade не true." },
  {
    name: "isTransactional",
    type: "boolean",
    description:
      'По умолчанию false. true — содержимое сервисное (например трек-номер заказа), а не маркетинговое: email-шаблон не обязан содержать {{ unsubscribe_url }}, и получателя не фильтрует его согласие на маркетинг по каналу (opt-out/пауза push) — та же семантика, что и type:"transactional" у POST /api/v1/campaigns.',
  },
  { name: "provider", type: "string", description: "Провайдер конкретно для этой автоматизации, если у канала их несколько подключено (раздел «Подключения»). Не применяется при cascade:true." },
  { name: "platforms", type: "string[]", description: "push: фильтр по типу устройства (ios/android/desktop). Пусто или перечислены все три = без фильтра." },
  {
    name: "segmentTags",
    type: "string[]",
    description:
      "welcome/event: сегмент по тегам контакта — кому вообще применима автоматизация. recurring: сегмент, которому целиком уходит рассылка при каждом срабатывании расписания — здесь это не фильтр, а сама аудитория. Пусто = вся аудитория. Для custom не используется — получатель определяется вебхуком, см. группу полей custom ниже.",
  },
  {
    name: "respectsPriority",
    type: "boolean",
    description:
      "welcome/event: по умолчанию true — уважает общее включено/выключено и провайдер конкретного канала из настроек приветственных сообщений (раздел «Автоматизации»). false — эта автоматизация всегда шлёт через свой channel/provider напрямую, игнорируя общий переключатель проекта.",
  },
  { name: "spacing", type: "object", description: SPACING_DESC, children: SPACING_CHILDREN },
  { name: "sendWindow", type: "object", description: SEND_WINDOW_DESC, children: SEND_WINDOW_CHILDREN },
];

const AUTOMATION_WELCOME_FIELDS: ApiField[] = [
  { name: "delayMinutes", type: "number", description: "Через сколько минут после подписки/identify отправлять. По умолчанию 0 — сразу, без задержки." },
];

const AUTOMATION_EVENT_FIELDS: ApiField[] = [
  {
    name: "triggerEvent",
    type: "string",
    required: true,
    description:
      "Имя события — то же значение, что передаётся в sendera.event(name, payload) со стороны сайта (например cart_updated, favorite_updated, product_viewed, checkout_started, или своё произвольное имя). При срабатывании этого события у контакта ставится (или переставляется заново, если уже стояла) отложенная отправка.",
  },
  { name: "delayMinutes", type: "number", description: "Сколько минут ждать после события, прежде чем отправить — например 60 для «напомнить о корзине через час». По умолчанию 60, минимум 1." },
  {
    name: "cancelEvents",
    type: "string[]",
    description: 'Если ДО истечения задержки произойдёт одно из этих событий — отправка отменяется целиком, например ["order_placed"] — не слать напоминание о брошенной корзине, если заказ уже оформлен.',
  },
];

const AUTOMATION_SCHEDULE_CHILDREN: ApiField[] = [
  {
    name: "kind",
    type: '"weekly" | "monthly_from_date" | "monthly_nth_weekday"',
    required: true,
    description:
      'Вид периодичности. "weekly" — каждую неделю в заданный день. "monthly_from_date" — ежемесячно (или раз в N месяцев) от даты начала, число месяца берётся из неё (конец месяца короче — переносится на последний день). "monthly_nth_weekday" — в N-ю неделю каждого месяца в заданный день недели (например «первая суббота»).',
  },
  { name: "time", type: "string", required: true, description: 'Время срабатывания в часовом поясе проекта (раздел «Настройки»), формат "HH:mm", например "09:00".' },
  { name: "weekday", type: "number", description: '0-6 (0=воскресенье, как Date.getDay()). Обязательно для kind:"weekly" и kind:"monthly_nth_weekday".' },
  { name: "weekOfMonth", type: "number", description: 'Обязательно для kind:"monthly_nth_weekday" — 1-4 (какая по счёту неделя) или -1 (последняя).' },
  { name: "startDate", type: "string", description: 'Обязательно для kind:"monthly_from_date" — дата первого срабатывания, "YYYY-MM-DD".' },
  { name: "intervalMonths", type: "number", description: 'kind:"monthly_from_date"/"monthly_nth_weekday" — раз в сколько месяцев повторять. По умолчанию 1 (каждый месяц).' },
];

const AUTOMATION_RECURRING_FIELDS: ApiField[] = [
  {
    name: "schedule",
    type: "object",
    required: true,
    description:
      "Календарное расписание срабатывания — не привязано к активности контакта. Содержимое (шаблон/каскад) собирается заново из его АКТУАЛЬНОГО состояния при каждом срабатывании, поэтому обновляйте шаблон перед циклом (например раз в неделю), а не пересоздавайте автоматизацию. Аудитория — segmentTags (см. общие поля), не одиночный контакт.",
    children: AUTOMATION_SCHEDULE_CHILDREN,
  },
];

const AUTOMATION_STATUS_CHECK_CHILDREN: ApiField[] = [
  { name: "field", type: "string", description: "Путь к полю в теле вебхука, точечная нотация для вложенных объектов — например fulfillment_status или client.phone." },
  {
    name: "op",
    type: '"contains" | "eq" | "gt" | "lt"',
    description: 'Способ сравнения. "contains" — value через запятую, срабатывает при совпадении с любым из перечисленных (по ИЛИ). "eq" — точное совпадение строкой. "gt"/"lt" — числовое сравнение больше/меньше. По умолчанию "contains".',
  },
  { name: "value", type: "string", description: 'Значение для сравнения. Для "contains" можно перечислить несколько через запятую.' },
];

const AUTOMATION_CUSTOM_FIELDS: ApiField[] = [
  {
    name: "key",
    type: "string",
    required: true,
    description: "Слаг для URL вебхука — POST /api/v1/trigger?key=ВАШ_КЛЮЧ&automation=<key>. Уникален в пределах проекта — вторая автоматизация с тем же key вернёт 409.",
  },
  {
    name: "recipientMode",
    type: '"phone" | "segment" | "fanout"',
    required: true,
    description:
      "Как определяется получатель из тела вебхука. phone — один конкретный контакт по телефону/email/внешнему id из тела. segment — рассылка по сегменту тегов, тело только задаёт условие срабатывания. fanout — по списку товара: КАЖДОМУ контакту, у кого этот товар в избранном/корзине.",
  },
  { name: "statusChecks", type: "{field,op,value}[]", description: "Условие срабатывания — все элементы массива должны совпасть (И). Применимо к любому recipientMode. Поля объекта ниже.", children: AUTOMATION_STATUS_CHECK_CHILDREN },
  { name: "phonePath", type: "string", description: 'recipientMode:"phone" — путь к телефону получателя в теле вебхука, например client.phone. Пусто = не резолвить по телефону (тогда нужен emailPath или externalIdPath).' },
  { name: "emailPath", type: "string", description: 'recipientMode:"phone" — путь к email получателя, используется если phonePath пуст или не нашёл совпадения среди контактов.' },
  { name: "externalIdPath", type: "string", description: 'recipientMode:"phone" — путь к внешнему id контакта (например insalesClientId) — используется как последний способ определить получателя.' },
  { name: "orderIdPath", type: "string", description: 'recipientMode:"phone"/"segment" — путь к id заказа (или другому уникальному идентификатору события) в теле — используется для защиты от повторной отправки на один и тот же вебхук.' },
  { name: "segmentPath", type: "string", description: 'recipientMode:"segment" — путь к тегу сегмента в теле вебхука, если сегмент нужно определять динамически из самого вебхука, а не фиксировать заранее в segmentTags.' },
  { name: "productIdPath", type: "string", description: 'recipientMode:"fanout" — путь к id товара в теле вебхука. По умолчанию "product_id".' },
  { name: "listType", type: "string", description: 'recipientMode:"fanout" — какой накопленный список подписчиков проверять: favorite, cart, или своё произвольное имя списка. По умолчанию "any" — любой список, где встречается товар.' },
  {
    name: "trackFieldPath",
    type: "string",
    description: 'recipientMode:"fanout" — путь к отслеживаемому числовому полю (например цене или остатку). Если задан, отправка происходит только когда его значение меняется в нужную сторону (см. trackMode), а не на каждый вызов вебхука.',
  },
  { name: "trackMode", type: '"changed" | "increased" | "decreased"', description: 'recipientMode:"fanout" — в какую сторону должно измениться trackFieldPath, чтобы сработала отправка (например "decreased" — только при снижении цены). Работает только вместе с trackFieldPath. По умолчанию "changed".' },
];

const AUTOMATION_FULL_FIELDS: ApiField[] = [
  { name: "id", type: "string", description: "id автоматизации." },
  { name: "type", type: '"welcome" | "event" | "custom" | "recurring"', description: "Тип — определяет, какие из полей ниже заполнены." },
  { name: "name", type: "string", description: "Внутреннее название." },
  { name: "isEnabled", type: "boolean", description: "Включена ли автоматизация." },
  { name: "channel", type: "string", description: "push | sms | email — не учитывается, если cascade:true." },
  { name: "cascade", type: "boolean", description: "true — канал резолвится по «Приоритету каналов» в момент срабатывания." },
  { name: "channelTemplates", type: "object", description: "Шаблон на каждый канал — заполнено, только если cascade:true.", children: CHANNEL_TEMPLATES_CHILDREN },
  { name: "templateId", type: "string | null", description: "id шаблона — null, если cascade:true." },
  { name: "isTransactional", type: "boolean", description: 'true — содержимое сервисное: без требования {{ unsubscribe_url }} и без фильтра по согласию на маркетинг у получателя, та же семантика, что и type:"transactional" у рассылок.' },
  { name: "provider", type: "string | null", description: "Провайдер этой автоматизации, если задан явно." },
  { name: "platforms", type: "string[]", description: "push: фильтр по платформам, если задан." },
  { name: "segmentTags", type: "string[]", description: "welcome/event/recurring: сегмент по тегам (у recurring — сама аудитория рассылки). Всегда пусто для custom." },
  { name: "respectsPriority", type: "boolean", description: "welcome/event: уважает общий переключатель канала проекта." },
  { name: "delayMinutes", type: "number", description: "welcome/event: задержка в минутах. Всегда 0 для custom (срабатывает синхронно на вебхук)." },
  { name: "triggerEvent", type: "string | null", description: "Только type: event — имя события-триггера." },
  { name: "cancelEvents", type: "string[]", description: "Только type: event — события, отменяющие уже поставленную отправку." },
  { name: "key", type: "string | null", description: "Только type: custom — слаг вебхука (?automation=)." },
  { name: "recipientMode", type: '"phone" | "segment" | "fanout" | null', description: "Только type: custom — режим определения получателя." },
  { name: "phonePath, emailPath, externalIdPath, orderIdPath", type: "string | null", description: 'Только type: custom, recipientMode:"phone" (orderIdPath — также "segment").' },
  { name: "segmentPath", type: "string | null", description: 'Только type: custom, recipientMode:"segment".' },
  { name: "productIdPath, listType, trackFieldPath, trackMode", type: "string | null", description: 'Только type: custom, recipientMode:"fanout".' },
  { name: "statusChecks", type: "{field,op,value}[]", description: "Только type: custom — условие срабатывания.", children: AUTOMATION_STATUS_CHECK_CHILDREN },
  { name: "schedule", type: "object | null", description: "Только type: recurring — календарное расписание.", children: AUTOMATION_SCHEDULE_CHILDREN },
  { name: "nextFireAt", type: "string | null", description: "Только type: recurring — ISO-момент следующего срабатывания, пересчитывается после каждого." },
  { name: "lastFiredAt", type: "string | null", description: "Только type: recurring — ISO-момент последнего срабатывания, null — ещё ни разу не срабатывала." },
  { name: "spacing", type: "object", description: SPACING_DESC, children: SPACING_CHILDREN },
  { name: "sendWindow", type: "object", description: SEND_WINDOW_DESC, children: SEND_WINDOW_CHILDREN },
  { name: "createdAt", type: "string", description: "ISO-дата создания." },
];
const AUTOMATION_LIST_ITEM_FIELDS: ApiField[] = AUTOMATION_FULL_FIELDS.map((f) => ({ ...f, name: `automations[].${f.name}` }));

const AUTOMATION_CREATE_ERRORS: ApiError[] = [
  AUTH_ERROR,
  {
    code: 400,
    description:
      "type не welcome/event/custom/recurring, name пуст, не хватает channel+templateId (или channelTemplates при cascade), шаблон не найден/не того канала/email без {{ unsubscribe_url }}, для event — пуст triggerEvent, для custom — пуст key или recipientMode не phone/segment/fanout, для recurring — schedule не задан или некорректен (неверный kind/time/weekday/weekOfMonth/startDate).",
  },
  { code: 409, description: "type: custom — автоматизация с таким key уже существует в проекте (тело содержит id найденной)." },
];

export const API_GROUPS: ApiGroup[] = [
  {
    title: "Рассылки",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/campaigns",
        summary: "Создаёт и отправляет (или сохраняет черновиком/планирует) рассылку — один эндпоинт на все три канала.",
        bodyGroups: [
          { title: "Общие поля (все каналы)", fields: SEND_SHARED_FIELDS },
          { title: "push (channel: \"push\")", fields: PUSH_FIELDS },
          { title: "sms (channel: \"sms\")", fields: SMS_FIELDS },
          { title: "email (channel: \"email\")", fields: EMAIL_FIELDS },
        ],
        bodyExample: '{ "channel": "push", "title": "Привет", "body": "Тест", "segmentTags": ["vip"] }',
        bodyExamples: [
          {
            label: "push — максимум полей",
            json: `{
  "channel": "push",
  "type": "marketing",
  "title": "Скидка 20% сегодня",
  "body": "Успейте до полуночи, {{ name }}!",
  "url": "https://site.ru/sale",
  "icon": "https://site.ru/icon.png",
  "image": "https://site.ru/banner.jpg",
  "badge": "https://site.ru/badge.png",
  "actions": [
    { "title": "К товарам", "url": "https://site.ru/sale" },
    { "title": "Позже", "url": "https://site.ru" }
  ],
  "platforms": ["android", "ios"],
  "segmentTags": ["vip"],
  "contacts": ["+79991234567", "client@example.com"],
  "templateData": { "orderId": "A-1001", "product": { "id": "SKU-42" } },
  "internalTitle": "Распродажа выходного дня",
  "scheduledAt": "2026-09-01T07:00:00Z",
  "sendWindow": { "enabled": true, "days": [1, 2, 3, 4, 5], "timeFrom": "09:00", "timeTo": "20:00", "subscriberTz": true },
  "spacing": { "enabled": true, "minutes": 1440 }
}`,
          },
          {
            label: "sms — максимум полей",
            json: `{
  "channel": "sms",
  "type": "marketing",
  "text": "{{ name }}, скидка 20% сегодня! Подробности: https://site.ru/sale",
  "templateData": { "name": "Иван" },
  "segmentTags": ["vip"],
  "contacts": ["+79991234567"],
  "internalTitle": "SMS выходного дня",
  "scheduledAt": "2026-09-01T09:00:00Z",
  "sendWindow": { "enabled": true, "days": [1, 2, 3, 4, 5], "timeFrom": "09:00", "timeTo": "20:00", "subscriberTz": false },
  "spacing": { "enabled": true, "minutes": 1440 }
}`,
          },
          {
            label: "email — максимум полей",
            json: `{
  "channel": "email",
  "type": "marketing",
  "subject": "Скидка недели — только для вас",
  "html": "<p>Привет, {{ name }}!</p><p><a href=\\"https://site.ru/sale\\">Смотреть скидки</a></p><p><a href=\\"{{ unsubscribe_url }}\\">Отписаться</a></p>",
  "templateData": { "name": "Иван" },
  "segmentTags": ["vip"],
  "contacts": ["client@example.com"],
  "internalTitle": "Email выходного дня",
  "scheduledAt": "2026-09-01T09:00:00Z",
  "sendWindow": { "enabled": true, "days": [1, 2, 3, 4, 5], "timeFrom": "09:00", "timeTo": "20:00", "subscriberTz": false },
  "spacing": { "enabled": true, "minutes": 1440 }
}`,
          },
        ],
        responseExample: CAMPAIGN_SUCCESS_EXAMPLE,
        responseFields: [
          { name: "ok", type: "boolean", description: "true — запрос выполнен успешно." },
          { name: "campaignId", type: "string", description: "id рассылки — для GET/PUT/DELETE /api/v1/campaigns/{id}." },
          { name: "status", type: "string", description: "sending | draft | scheduled — расшифровка ниже." },
          ...SEND_RESULT_FIELDS.slice(2),
        ],
        responseStatus: [
          { value: "sending", description: "Ушла сейчас — delivered/failed/total уже отражают реальный результат." },
          { value: "draft", description: "Сохранена черновиком, ничего не отправлено — delivered/failed/total нулевые." },
          { value: "scheduled", description: "Отложена на scheduledAt — delivered/failed/total нулевые, охват станет известен при фактической отправке." },
        ],
        errors: CAMPAIGN_CREATE_ERRORS,
      },
      {
        method: "GET",
        path: "/api/v1/campaigns",
        summary: "Список рассылок проекта, новые первыми — кратко, без содержимого сообщения.",
        queryParams: [
          {
            name: "status",
            type: "string",
            description: "Показывает только рассылки в этом статусе — draft | scheduled | sending | sent | failed. Не передан — показываются все статусы.",
          },
          { name: "channel", type: "string", description: "Показывает только рассылки этого канала — push | sms | email. Не передан — показываются все каналы." },
          { name: "limit", type: "number", description: "Сколько рассылок вернуть за один вызов, не больше. По умолчанию 50, максимум 200." },
          {
            name: "offset",
            type: "number",
            description: "Сколько рассылок с начала списка пропустить — для постраничной загрузки (следующая страница: offset + limit предыдущего вызова). По умолчанию 0.",
          },
        ],
        responseExample:
          '{\n  "campaigns": [\n    {\n      "id": "b2f1...", "channel": "push", "status": "sent", "type": "marketing",\n      "initiator": "api", "internalTitle": "Распродажа выходного дня", "title": "Привет",\n      "scheduledAt": null, "sentAt": "2026-08-25T09:00:00Z",\n      "sentCount": 42, "deliveredCount": 41, "failedCount": 1, "clickedCount": 3,\n      "createdAt": "2026-08-25T08:59:50Z"\n    }\n  ],\n  "total": 1\n}',
        responseFields: CAMPAIGN_LIST_ITEM_FIELDS,
        errors: [AUTH_ERROR],
      },
      {
        method: "GET",
        path: "/api/v1/campaigns/{id}",
        summary:
          "Полная карточка одной рассылки по её id — содержимое сообщения (текст/HTML/rich push), кому и как она адресована (сегмент/контакты), и статистика отправки (доставлено/не доставлено/клики). Используйте после создания через POST /api/v1/campaigns, чтобы проверить итоговый статус или отследить прогресс.",
        responseExample:
          '{\n  "id": "b2f1...", "channel": "push", "status": "sent", "type": "marketing", "initiator": "api",\n  "internalTitle": "Распродажа выходного дня", "title": "Привет", "body": "Тест", "subject": null, "html": null,\n  "url": null, "icon": null, "image": null, "badge": null, "actions": [],\n  "segmentTags": ["vip"], "platforms": [], "contacts": [],\n  "templateId": null, "templateData": null,\n  "scheduledAt": null, "sentAt": "2026-08-25T09:00:00Z", "error": null,\n  "sentCount": 42, "deliveredCount": 41, "failedCount": 1, "clickedCount": 3, "openedCount": 0,\n  "sendWindow": { "enabled": false, "days": null, "timeFrom": null, "timeTo": null, "subscriberTz": false },\n  "spacing": { "enabled": false, "minutes": null },\n  "createdAt": "2026-08-25T08:59:50Z"\n}',
        responseFields: CAMPAIGN_FULL_FIELDS,
        errors: [AUTH_ERROR, { code: 404, description: "Рассылка не найдена (не существует, или принадлежит другому проекту)." }],
      },
      {
        method: "PUT",
        path: "/api/v1/campaigns/{id}",
        summary:
          "Редактирует ранее сохранённый черновик или запланированную рассылку. Частичное обновление: поле не передано — не трогаем.",
        bodyFields: [
          ...SEND_SHARED_FIELDS.filter((f) => f.name !== "channel"),
          ...PUSH_FIELDS,
          { name: "text", type: "string", description: "sms-текст." },
          { name: "subject, html", type: "string", description: "email-содержимое." },
        ],
        bodyExample: '{ "body": "Обновлённый текст", "scheduledAt": "2026-09-01T07:00:00Z" }',
        responseExample: '{ "ok": true, "campaignId": "b2f1...", "status": "scheduled" }',
        responseFields: [
          { name: "ok", type: "boolean", description: "true — запрос выполнен успешно." },
          { name: "campaignId", type: "string", description: "id отредактированной рассылки (тот же, что в пути запроса)." },
          { name: "status", type: "string", description: "draft | scheduled — итоговый статус после этой правки." },
        ],
        responseNote:
          "Списки (contacts/phones/emails/segmentTags/platforms) при передаче заменяются целиком, а не дополняются. draft:true или новый scheduledAt переключают статус — если ни то, ни другое не передано, статус остаётся как был.",
        errors: [
          AUTH_ERROR,
          BLOCKED_ERROR,
          { code: 404, description: "Рассылка не найдена." },
          { code: 400, description: "Рассылка уже не draft/scheduled, не хватает обязательных полей, длина за лимитом, нет {{ unsubscribe_url }}, или scheduledAt не в будущем." },
        ],
      },
      {
        method: "DELETE",
        path: "/api/v1/campaigns/{id}",
        summary:
          "Безвозвратно удаляет черновик или запланированную рассылку вместе с её содержимым — используйте, если она больше не нужна и отправлять её не планируется. Уже отправленную или отправляющуюся рассылку удалить нельзя: её история и статистика остаются в разделе «Рассылки».",
        responseExample: '{ "ok": true }',
        responseFields: [{ name: "ok", type: "boolean", description: "true — рассылка удалена." }],
        errors: [
          AUTH_ERROR,
          { code: 404, description: "Рассылка не найдена." },
          { code: 400, description: "Рассылка уже не draft/scheduled — отправленную удалить нельзя." },
          { code: 500, description: "Сбой удаления на стороне сервера." },
        ],
      },
      {
        method: "POST",
        path: "/api/v1/campaigns/{id}/send",
        summary: "Отправляет черновик/запланированную рассылку прямо сейчас, не дожидаясь scheduledAt. Тело не нужно.",
        responseExample: '{ "ok": true, "campaignId": "b2f1...", "delivered": 41, "failed": 1, "total": 42 }',
        responseFields: SEND_RESULT_FIELDS,
        errors: [
          AUTH_ERROR,
          BLOCKED_ERROR,
          { code: 404, description: "Рассылка не найдена." },
          { code: 400, description: "Рассылка уже отправлена, или маркетинговый email без {{ unsubscribe_url }}." },
          { code: 402, description: "Провайдер не настроен, недостаточно баланса, или иная ошибка отправки." },
        ],
      },
      {
        method: "POST",
        path: "/api/v1/campaigns/{id}/duplicate",
        summary: "Копирует рассылку любого статуса (включая отправленную) в новый черновик. Тело не нужно.",
        responseExample: '{ "ok": true, "campaignId": "c9a4...", "status": "draft" }',
        responseFields: [
          { name: "ok", type: "boolean", description: "true — копия создана." },
          { name: "campaignId", type: "string", description: "id НОВОЙ рассылки-копии (не исходной)." },
          { name: "status", type: "string", description: 'Всегда "draft" — копия стартует черновиком независимо от статуса исходной рассылки.' },
        ],
        responseNote: "Время планирования и статистика исходной рассылки не переносятся.",
        errors: [AUTH_ERROR, BLOCKED_ERROR, { code: 404, description: "Рассылка не найдена." }, { code: 500, description: "Сбой копирования на стороне сервера." }],
      },
    ],
  },
  {
    title: "Шаблоны",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/templates",
        summary: "Список шаблонов проекта — краткая форма, id пригодится для templateId в /campaigns.",
        queryParams: [
          { name: "channel", type: "string", description: "Показывает только шаблоны этого канала — push | sms | email. Не передан — показываются шаблоны всех каналов." },
        ],
        responseExample: '{ "templates": [{ "id": "a1c3...", "name": "Заказ отправлен", "channel": "push" }] }',
        responseFields: TEMPLATE_LIST_ITEM_FIELDS,
        responseNote: "Полное содержимое одного шаблона — GET /api/v1/templates/{id}.",
        errors: [AUTH_ERROR],
      },
      {
        method: "POST",
        path: "/api/v1/templates",
        summary:
          "Создаёт новый переиспользуемый шаблон сообщения — по каналу нужен свой набор полей (email — html, push — title/body, sms — body). Готовый шаблон подставляется по id через templateId в POST /api/v1/campaigns вместо содержимого, переданного прямо в запросе.",
        bodyFields: [
          { name: "name", type: "string", required: true, description: "Внутреннее название — получателям не видно." },
          { name: "channel", type: '"push"|"sms"|"email"', required: true, description: "Канал шаблона — после создания неизменен." },
          { name: "folderId", type: "string", description: "id папки — неизвестный/чужой id молча игнорируется." },
          { name: "context", type: "object", description: "Дефолтный Liquid-контекст шаблона — переопределяется разовым templateData при отправке." },
          { name: "subject", type: "string", description: "email: тема письма." },
          { name: "html", type: "string", description: "email: HTML тела письма (обязательно для channel:email)." },
          { name: "title", type: "string", description: "push: заголовок, ≤ 80 символов (обязательно для channel:push)." },
          { name: "body", type: "string", description: "push (≤ 200 символов) или sms (без лимита) — текст (обязательно для обоих)." },
          { name: "url", type: "string", description: "push: click url." },
          { name: "icon, image, badge", type: "string", description: "push: rich push." },
          { name: "actions", type: "{title,url}[]", description: "push: до 2 кнопок." },
        ],
        bodyExample: '{ "name": "Заказ отправлен", "channel": "push", "title": "В пути!", "body": "Трек: {{ trackingNumber }}" }',
        responseExample: '{ "ok": true, "id": "a1c3..." }',
        responseFields: [
          { name: "ok", type: "boolean", description: "true — шаблон создан." },
          { name: "id", type: "string", description: "id нового шаблона — подставляется как templateId в /api/v1/campaigns." },
        ],
        errors: [
          AUTH_ERROR,
          { code: 400, description: "name/channel не переданы, или не хватает обязательного поля канала (html / title+body / body), или push title/body за лимитом." },
        ],
      },
      {
        method: "GET",
        path: "/api/v1/templates/{id}",
        summary:
          "Полное содержимое одного шаблона по его id — все поля канала (текст/HTML/rich push), с чем он создавался, и служебные даты. Используйте, чтобы посмотреть или скопировать содержимое существующего шаблона программно, например перед PUT-редактированием.",
        responseExample:
          '{\n  "id": "a1c3...", "name": "Заказ отправлен", "channel": "push", "folderId": null,\n  "context": null, "subject": null, "html": null,\n  "title": "В пути!", "body": "Трек: {{ trackingNumber }}",\n  "url": null, "icon": null, "image": null, "badge": null, "actions": [],\n  "createdAt": "2026-08-25T09:00:00Z", "updatedAt": "2026-08-25T09:00:00Z"\n}',
        responseFields: TEMPLATE_FULL_FIELDS,
        errors: [AUTH_ERROR, { code: 404, description: "Шаблон не найден." }],
      },
      {
        method: "PUT",
        path: "/api/v1/templates/{id}",
        summary: "Редактирует существующий шаблон — та же таблица полей, что у создания (минус channel), частичное обновление.",
        bodyFields: [
          { name: "name", type: "string", description: "Внутреннее название." },
          { name: "folderId", type: "string", description: "id папки — неизвестный/чужой id молча игнорируется." },
          { name: "context", type: "object", description: "Дефолтный Liquid-контекст шаблона." },
          { name: "subject", type: "string", description: "email: тема письма." },
          { name: "html", type: "string", description: "email: HTML тела письма." },
          { name: "title", type: "string", description: "push: заголовок, ≤ 80 символов." },
          { name: "body", type: "string", description: "push (≤ 200 символов) или sms — текст." },
          { name: "url", type: "string", description: "push: click url." },
          { name: "icon, image, badge", type: "string", description: "push: rich push." },
          { name: "actions", type: "{title,url}[]", description: "push: до 2 кнопок." },
        ],
        bodyExample: '{ "body": "Обновлённый текст" }',
        responseExample: '{ "ok": true, "id": "a1c3..." }',
        responseFields: [
          { name: "ok", type: "boolean", description: "true — шаблон обновлён." },
          { name: "id", type: "string", description: "id отредактированного шаблона (тот же, что в пути запроса)." },
        ],
        errors: [
          AUTH_ERROR,
          { code: 404, description: "Шаблон не найден." },
          { code: 400, description: "Поле очищено до пустого при том, что оно обязательно, или push title/body за лимитом." },
          { code: 500, description: "Сбой обновления на стороне сервера." },
        ],
      },
    ],
  },
  {
    title: "Подписчики",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/subscribers",
        summary:
          "Список всех подписчиков проекта (раздел «Подписчики») — телефон, email, имя, теги и согласие на SMS/Email-рассылки по каждому, новые первыми. Используйте для выгрузки или сверки базы контактов со своей системой.",
        queryParams: [
          { name: "limit", type: "number", description: "Сколько подписчиков вернуть за один вызов, не больше. По умолчанию 50, максимум 200." },
          {
            name: "offset",
            type: "number",
            description: "Сколько подписчиков с начала списка пропустить — для постраничной загрузки (следующая страница: offset + limit предыдущего вызова). По умолчанию 0.",
          },
        ],
        responseExample:
          '{\n  "subscribers": [\n    {\n      "id": "d4e2...", "phone": "79991234567", "email": null, "name": "Иван",\n      "insalesClientId": null, "tags": ["vip"], "attributes": {},\n      "smsActive": true, "emailActive": false, "createdAt": "2026-08-25T09:00:00Z"\n    }\n  ],\n  "total": 1\n}',
        responseFields: SUBSCRIBER_LIST_ITEM_FIELDS,
        errors: [AUTH_ERROR],
      },
      {
        method: "POST",
        path: "/api/v1/subscribers",
        summary:
          "Создаёт нового подписчика — контакт с телефоном и/или email, тегами и согласием на SMS/Email-рассылки. Используйте при регистрации или оформлении заказа в вашей системе, чтобы сразу завести человека в Sendera. Для уже существующего подписчика вернёт 409 — редактируйте через PUT /api/v1/subscribers/{id}.",
        bodyFields: [
          { name: "phone", type: "string", description: "Любой формат — нормализуется. Хотя бы одно из phone/email обязательно." },
          { name: "email", type: "string", description: "Email." },
          { name: "name", type: "string", description: "Имя подписчика." },
          { name: "insalesClientId", type: "string", description: "id клиента в InSales, если подписчик связан с заказом." },
          { name: "tags", type: "string[]", description: "Теги для сегментации." },
          { name: "attributes", type: "object", description: "Произвольные доп. поля {ключ: значение} — доступны в Liquid как атрибуты подписчика." },
          { name: "smsActive", type: "boolean", description: "Включить (true) / явно выключить (false) SMS-рассылку." },
          { name: "emailActive", type: "boolean", description: "То же для email." },
        ],
        bodyExample: '{ "phone": "+79991234567", "name": "Иван", "smsActive": true, "emailActive": true }',
        responseExample: '{ "ok": true, "id": "d4e2..." }',
        responseFields: [
          { name: "ok", type: "boolean", description: "true — подписчик создан." },
          { name: "id", type: "string", description: "id нового подписчика." },
        ],
        responseNote:
          "smsActive/emailActive — единственный способ дать согласие на канал для сегментных маркетинговых рассылок; отдельно от подтверждения телефона/почты входом по коду.",
        errors: [
          AUTH_ERROR,
          { code: 400, description: "Ни phone, ни email не переданы, или один из них некорректного формата." },
          { code: 409, description: "Подписчик с таким phone (или email) уже существует — тело содержит id найденного, редактируйте его через PUT." },
        ],
      },
      {
        method: "GET",
        path: "/api/v1/subscribers/{id}",
        summary:
          "Полная карточка одного подписчика по его id — телефон, email, имя, теги, произвольные атрибуты и согласие на SMS/Email-рассылки. Используйте, чтобы проверить текущее состояние согласия или атрибутов конкретного человека перед адресной отправкой.",
        responseExample:
          '{\n  "id": "d4e2...", "phone": "79991234567", "email": null, "name": "Иван",\n  "insalesClientId": null, "tags": ["vip"], "attributes": {},\n  "smsActive": true, "emailActive": false, "createdAt": "2026-08-25T09:00:00Z"\n}',
        responseFields: SUBSCRIBER_FULL_FIELDS,
        errors: [AUTH_ERROR, { code: 404, description: "Подписчик не найден." }],
      },
      {
        method: "PUT",
        path: "/api/v1/subscribers/{id}",
        summary: "Редактирует существующего подписчика (см. POST для создания нового) — та же таблица полей, частичное обновление.",
        bodyFields: [
          { name: "phone", type: "string", description: "Любой формат — нормализуется." },
          { name: "email", type: "string", description: "Email." },
          { name: "name", type: "string", description: "Имя подписчика." },
          { name: "insalesClientId", type: "string", description: "id клиента в InSales." },
          { name: "tags", type: "string[]", description: "Теги для сегментации — заменяются целиком." },
          { name: "attributes", type: "object", description: "Доп. поля {ключ: значение} — мёрж по ключу, значение null удаляет ключ." },
          { name: "smsActive", type: "boolean", description: "Включить (true) / явно выключить (false) SMS-рассылку." },
          { name: "emailActive", type: "boolean", description: "То же для email." },
        ],
        bodyExample: '{ "emailActive": false }',
        responseExample: '{ "ok": true, "id": "d4e2..." }',
        responseFields: [
          { name: "ok", type: "boolean", description: "true — подписчик обновлён." },
          { name: "id", type: "string", description: "id отредактированного подписчика (тот же, что в пути запроса)." },
        ],
        responseNote: "phone/email — оба сразу пустыми передать нельзя (нужен хотя бы один), ни один не передан — оба остаются прежними.",
        errors: [AUTH_ERROR, { code: 404, description: "Подписчик не найден." }, { code: 400, description: "И phone, и email переданы пустыми одновременно." }],
      },
    ],
  },
  {
    title: "Автоматизации",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/automations",
        summary:
          "Создаёт автоматизацию любого из четырёх типов (раздел «Автоматизации») — приветственную (welcome), событийную (event, например брошенная корзина), триггерную по вебхуку (custom) или повторяющуюся по расписанию (recurring). type — обязательное поле, определяет остальные применимые поля тела запроса.",
        bodyGroups: [
          { title: "Общие поля (все типы)", fields: AUTOMATION_COMMON_CREATE_FIELDS },
          { title: 'welcome (type: "welcome")', fields: AUTOMATION_WELCOME_FIELDS },
          { title: 'event (type: "event")', fields: AUTOMATION_EVENT_FIELDS },
          { title: 'custom (type: "custom") — триггерная по вебхуку', fields: AUTOMATION_CUSTOM_FIELDS },
          { title: 'recurring (type: "recurring") — по календарному расписанию', fields: AUTOMATION_RECURRING_FIELDS },
        ],
        bodyExamples: [
          { label: "welcome — push сразу после подписки", json: '{\n  "type": "welcome",\n  "name": "Приветствие",\n  "channel": "push",\n  "templateId": "a1c3...",\n  "delayMinutes": 0,\n  "segmentTags": []\n}' },
          {
            label: "event — напоминание о брошенной корзине",
            json:
              '{\n  "type": "event",\n  "name": "Брошенная корзина",\n  "channel": "email",\n  "templateId": "b7e2...",\n  "triggerEvent": "cart_updated",\n  "cancelEvents": ["order_placed"],\n  "delayMinutes": 60,\n  "sendWindow": { "enabled": true, "days": [1,2,3,4,5,6,0], "timeFrom": "09:00", "timeTo": "21:00", "subscriberTz": true }\n}',
          },
          {
            label: "custom — триггерная по вебхуку (заказ отправлен, транзакционная)",
            json:
              '{\n  "type": "custom",\n  "name": "Заказ отправлен",\n  "key": "order_shipped",\n  "channel": "sms",\n  "templateId": "c4f8...",\n  "isTransactional": true,\n  "recipientMode": "phone",\n  "phonePath": "client.phone",\n  "orderIdPath": "number",\n  "statusChecks": [{ "field": "fulfillment_status", "op": "contains", "value": "shipped" }]\n}',
          },
          {
            label: "recurring — дайджест новинок раз в месяц",
            json:
              '{\n  "type": "recurring",\n  "name": "Дайджест новинок",\n  "channel": "email",\n  "templateId": "d9a4...",\n  "segmentTags": ["subscribed_digest"],\n  "schedule": { "kind": "monthly_from_date", "startDate": "2026-09-01", "intervalMonths": 1, "time": "10:00" }\n}',
          },
          {
            label: "recurring — акции сегменту каждую пятницу",
            json:
              '{\n  "type": "recurring",\n  "name": "Акции недели",\n  "channel": "push",\n  "templateId": "e2b7...",\n  "schedule": { "kind": "weekly", "weekday": 5, "time": "09:00" }\n}',
          },
        ],
        responseExample: '{ "ok": true, "id": "f7a1..." }',
        responseFields: [
          { name: "ok", type: "boolean", description: "true — автоматизация создана." },
          { name: "id", type: "string", description: "id новой автоматизации." },
        ],
        responseNote: "Автоматизация создаётся сразу с переданным isEnabled (по умолчанию включена) — отдельного шага активации нет.",
        errors: AUTOMATION_CREATE_ERRORS,
      },
      {
        method: "GET",
        path: "/api/v1/automations",
        summary: "Список автоматизаций проекта (раздел «Автоматизации»), новые первыми — та же карточка целиком, что и у GET /api/v1/automations/{id}, без урезания полей.",
        queryParams: [
          { name: "type", type: "string", description: "Показывает только автоматизации этого типа — welcome | event | custom | recurring. Не передан — показываются все типы." },
          { name: "channel", type: "string", description: "Показывает только автоматизации этого канала — push | sms | email. Не передан — показываются все каналы (включая каскадные, у них всегда channel: push)." },
          { name: "enabled", type: "string", description: 'Показывает только включённые ("true") или только выключенные ("false"). Не передан — показываются все.' },
        ],
        responseExample:
          '{\n  "automations": [\n    {\n      "id": "f7a1...", "type": "event", "name": "Брошенная корзина", "isEnabled": true,\n      "channel": "email", "cascade": false, "channelTemplates": {}, "templateId": "b7e2...", "isTransactional": false,\n      "provider": null, "platforms": [], "segmentTags": [], "respectsPriority": true,\n      "delayMinutes": 60, "triggerEvent": "cart_updated", "cancelEvents": ["order_placed"],\n      "spacing": { "enabled": false, "minutes": null },\n      "sendWindow": { "enabled": false, "days": null, "timeFrom": null, "timeTo": null, "subscriberTz": false },\n      "createdAt": "2026-08-25T09:00:00Z"\n    }\n  ]\n}',
        responseFields: AUTOMATION_LIST_ITEM_FIELDS,
        errors: [AUTH_ERROR],
      },
      {
        method: "GET",
        path: "/api/v1/automations/{id}",
        summary:
          "Полная карточка одной автоматизации по её id — тип, содержимое (шаблон/канал или каскад), условия срабатывания (задержка/событие/вебхук-ключ/расписание, в зависимости от типа) и защита от наложения/окно отправки. Используйте после создания через POST, чтобы проверить сохранённые значения, или перед PUT-редактированием.",
        responseExample:
          '{\n  "id": "f7a1...", "type": "event", "name": "Брошенная корзина", "isEnabled": true,\n  "channel": "email", "cascade": false, "channelTemplates": {}, "templateId": "b7e2...", "isTransactional": false,\n  "provider": null, "platforms": [], "segmentTags": [], "respectsPriority": true,\n  "delayMinutes": 60, "triggerEvent": "cart_updated", "cancelEvents": ["order_placed"],\n  "spacing": { "enabled": false, "minutes": null },\n  "sendWindow": { "enabled": true, "days": [1,2,3,4,5,6,0], "timeFrom": "09:00", "timeTo": "21:00", "subscriberTz": true },\n  "createdAt": "2026-08-25T09:00:00Z"\n}',
        responseFields: AUTOMATION_FULL_FIELDS,
        responseNote: "Поля, неприменимые к типу автоматизации, приходят null/пусто — см. таблицу выше, какое поле к какому типу относится.",
        errors: [AUTH_ERROR, { code: 404, description: "Автоматизация не найдена." }],
      },
      {
        method: "PUT",
        path: "/api/v1/automations/{id}",
        summary:
          "Редактирует существующую автоматизацию — та же таблица полей, что у создания (минус type, он неизменен после создания), частичное обновление: поле не передано в теле — не трогаем сохранённое. Если передан хоть один из channel/cascade/templateId/channelTemplates — содержимое пересобирается заново целиком, с недостающими значениями из уже сохранённых.",
        bodyGroups: [
          { title: "Общие поля (все типы)", fields: AUTOMATION_COMMON_CREATE_FIELDS.filter((f) => f.name !== "type") },
          { title: 'welcome/event — доп. поля (если у автоматизации type: "welcome" или "event")', fields: AUTOMATION_EVENT_FIELDS },
          { title: 'custom — доп. поля (если у автоматизации type: "custom")', fields: AUTOMATION_CUSTOM_FIELDS },
          { title: 'recurring — доп. поля (если у автоматизации type: "recurring")', fields: AUTOMATION_RECURRING_FIELDS },
        ],
        bodyExample: '{ "isEnabled": false }',
        responseExample: '{ "ok": true, "id": "f7a1..." }',
        responseFields: [
          { name: "ok", type: "boolean", description: "true — автоматизация обновлена." },
          { name: "id", type: "string", description: "id отредактированной автоматизации (тот же, что в пути запроса)." },
        ],
        responseNote:
          'Поля из группы welcome/event применяются, только если у автоматизации type: welcome (кроме triggerEvent/cancelEvents — они только для event) или type: event — переданные для несовпадающего типа значения молча игнорируются. Аналогично для custom и recurring. recurring: передача schedule целиком пересчитывает nextFireAt от текущего момента.',
        errors: [
          AUTH_ERROR,
          { code: 404, description: "Автоматизация не найдена." },
          {
            code: 400,
            description: "name очищено до пустого, не хватает channel+templateId (или channelTemplates при cascade) при смене содержимого, шаблон не найден/не того канала/email без {{ unsubscribe_url }}, triggerEvent/key очищены до пустого, recipientMode не phone/segment/fanout, или (recurring) schedule некорректен.",
          },
          { code: 409, description: "type: custom — смена key на уже занятый в проекте (тело содержит id владельца)." },
          { code: 500, description: "Сбой обновления на стороне сервера." },
        ],
      },
      {
        method: "DELETE",
        path: "/api/v1/automations/{id}",
        summary:
          "Безвозвратно удаляет автоматизацию. Для welcome/event/recurring уже поставленные в очередь отложенные отправки (automation_jobs) снимаются вместе с ней; для custom вебхук на этот key сразу начнёт отвечать 404.",
        responseExample: '{ "ok": true }',
        responseFields: [{ name: "ok", type: "boolean", description: "true — автоматизация удалена." }],
        errors: [AUTH_ERROR, { code: 404, description: "Автоматизация не найдена." }, { code: 500, description: "Сбой удаления на стороне сервера." }],
      },
      {
        method: "POST",
        path: "/api/v1/trigger",
        summary: "Запускает триггерную автоматизацию (раздел «Автоматизации» → «Триггерные») — не для произвольной отправки, для неё используйте /api/v1/campaigns.",
        queryParams: [
          {
            name: "automation",
            type: "string",
            required: true,
            description: "Определяет, какая триггерная автоматизация сработает на этот вызов — значение поля «Ключ» в форме её создания.",
          },
        ],
        sendsJsonBody: true,
        bodyExample: `{
  "number": "12345",
  "financial_status": "paid",
  "fulfillment_status": "shipped",
  "total_price": "2990.00",
  "delivery": { "tracking_number": "RA123456789RU" },
  "client": { "name": "Иван Иванов", "phone": "+79991234567", "email": "ivan@example.com" }
}`,
        bodyNote:
          "Тело — произвольный JSON от вашей системы (пример выше — типичный вебхук заказа), схема заранее не фиксирована. Путь к телефону/статусу и защита от повторной отправки настраиваются в самой автоматизации, не в теле запроса — любое поле тела доступно в шаблоне как {{ поле }}, включая вложенные ({{ client.name }}). Подробности — кнопка «Какой вебхук установить и откуда взять ключ» в форме создания триггерной рассылки.",
        responseExample: '{ "ok": true, "delivered": 1, "failed": 0, "total": 1 }',
        responseFields: [
          { name: "ok", type: "boolean", description: "true, если сработала (или намеренно пропущена — см. skipped) — false только при реальной ошибке отправки." },
          { name: "delivered", type: "number", description: "Успешно доставлено (0 или 1 — автоматизация всегда на одного получателя за вызов)." },
          { name: "failed", type: "number", description: "Не доставлено." },
          { name: "total", type: "number", description: "Общее число (0 или 1)." },
          { name: "skipped", type: "string", description: "Присутствует, только если сработал пропуск — причина текстом (условие не совпало, уже отправляли и т.п.), не ошибка." },
        ],
        responseNote: 'Условие автоматизации не совпало, или этому получателю уже отправляли — {ok:true, skipped:"причина"}, это не ошибка.',
        errors: [
          AUTH_ERROR,
          { code: 400, description: "Параметр automation не передан." },
          BLOCKED_ERROR,
          { code: 404, description: "Автоматизация с таким ключом не найдена, выключена, или не настроен канал/шаблон." },
        ],
      },
    ],
  },
];
