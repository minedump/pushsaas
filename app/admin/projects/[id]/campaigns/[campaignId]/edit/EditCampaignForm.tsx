"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconX, IconPlus, IconEye } from "@tabler/icons-react";
import { Badge, Button, Input, Textarea, Label, Toggle, useDialogs } from "@/app/ui";
import { CustomSelect, type ComboOption } from "@/app/ui/CustomSelect";
import { SearchSelect } from "@/app/ui/SearchSelect";
import { createClient } from "@/lib/supabase/client";
import { MessagePreviewModal, type PreviewContent } from "../../../MessagePreviewModal";
import { SegmentTagsInput } from "../../../SegmentTagsInput";
import { PlatformFilter, PLATFORM_VALUES } from "../../../PlatformFilter";
import { SendWindowFields, sendWindowError, type SendWindowState } from "../../../SendWindowFields";
import { ContextField } from "../../../ContextField";
import { ContextDocs } from "../../../templates/ContextDocs";
import { ProductPicker } from "../../../ProductPicker";
import type { ProductsRule, ProductFeedItem } from "@/lib/productFeed";
import { smsSegments } from "@/lib/smsSegments";
import { withShortenedLinks } from "@/lib/linkPreview";
import { hasUnsubscribeTag } from "@/lib/unsubscribeTag";

type Channel = "push" | "sms" | "email";
const CHANNEL_LABEL: Record<Channel, string> = { push: "Push", sms: "SMS", email: "Email" };
const CUSTOM_HTML = "__custom__";

type Campaign = {
  id: string;
  channel: Channel;
  status: "draft" | "scheduled";
  title: string;
  body: string;
  subject: string | null;
  html_body: string | null;
  icon_url: string | null;
  image_url: string | null;
  click_url: string | null;
  badge_url: string | null;
  segment_tags: string[] | null;
  platforms: string[] | null;
  actions: { title: string; url: string }[] | null;
  type: "transactional" | "marketing";
  template_id: string | null;
  scheduled_at: string | null;
  internal_title: string | null;
  template_data: Record<string, unknown> | null;
  contacts: string[] | null;
  provider: string | null;
  send_window_enabled?: boolean | null;
  send_days?: number[] | null;
  send_time_from?: string | null;
  send_time_to?: string | null;
  send_window_subscriber_tz?: boolean | null;
  spacing_enabled?: boolean | null;
  spacing_minutes?: number | null;
};

function toLocalDateValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toLocalTimeValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Template = {
  id: string;
  name: string;
  channel: Channel;
  subject: string | null;
  html: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  icon_url: string | null;
  image_url: string | null;
  badge_url: string | null;
  actions: { title: string; url: string }[] | null;
  context: Record<string, unknown> | null;
};

// Обратное к mergeTemplateContext (см. lib/sender.ts, не импортируем сюда —
// это серверный модуль) — на кампании template_data хранит контекст ВЫБРАННОГО
// на момент создания/сохранения шаблона под ключом __template, отдельно от
// собственного ручного контекста рассылки. Админу в поле «Добавить контекст»
// нужно видеть и редактировать только свою часть — не служебный __template.
function stripTemplateContext(data: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!data) return null;
  const { __template, ...rest } = data as Record<string, unknown> & { __template?: unknown };
  return rest;
}

export default function EditCampaignForm({
  projectId,
  campaign,
  templates,
  segmentOptions = [],
  providerOptions = { sms: [], email: [] },
  projectTimezone,
  hasFeed,
}: {
  projectId: string;
  campaign: Campaign;
  templates: Template[];
  segmentOptions?: string[];
  providerOptions?: { sms: ComboOption[]; email: ComboOption[] };
  projectTimezone: string;
  hasFeed: boolean;
}) {
  const { toast, confirm, prompt } = useDialogs();
  const router = useRouter();
  const supabase = createClient();
  const channel = campaign.channel;

  const [transactional, setTransactional] = useState(campaign.type === "transactional");

  // push
  const [title, setTitle] = useState(campaign.title);
  const [message, setMessage] = useState(campaign.body);
  const [url, setUrl] = useState(campaign.click_url || "");
  const [icon, setIcon] = useState(campaign.icon_url || "");
  const [image, setImage] = useState(campaign.image_url || "");
  const [badge, setBadge] = useState(campaign.badge_url || "");
  const [actions, setActions] = useState<{ title: string; url: string }[]>(campaign.actions || []);
  const [schedule, setSchedule] = useState(campaign.status === "scheduled");
  const [scheduleDate, setScheduleDate] = useState(toLocalDateValue(campaign.scheduled_at));
  const [scheduleTime, setScheduleTime] = useState(toLocalTimeValue(campaign.scheduled_at));

  // sms
  const [smsText, setSmsText] = useState(campaign.body);
  const [smsProvider, setSmsProvider] = useState(campaign.provider || providerOptions.sms[0]?.value || "");

  // email
  const [subject, setSubject] = useState(campaign.subject || "");
  const [html, setHtml] = useState(campaign.html_body || "");
  const [emailProvider, setEmailProvider] = useState(campaign.provider || providerOptions.email[0]?.value || "");

  // Шаблон общий для всех каналов — на кампании их и так только один
  // (channel фиксирован при редактировании), выбор просто подставляет
  // содержимое в обычные поля ниже, дальше это такой же редактируемый текст.
  const [templateId, setTemplateId] = useState(campaign.template_id || CUSTOM_HTML);
  const channelTemplates = templates.filter((t) => t.channel === channel);
  const templateOptions: ComboOption[] = [
    { value: CUSTOM_HTML, label: channel === "email" ? "Свой HTML" : "Свой текст" },
    ...channelTemplates.map((t) => ({ value: t.id, label: t.name })),
  ];
  function selectTemplate(id: string) {
    setTemplateId(id);
    if (id === CUSTOM_HTML) return;
    const t = channelTemplates.find((x) => x.id === id);
    if (!t) return;
    if (channel === "push") {
      setTitle(t.title || "");
      setMessage(t.body || "");
      setUrl(t.url || "");
      setIcon(t.icon_url || "");
      setImage(t.image_url || "");
      setBadge(t.badge_url || "");
      setActions(t.actions || []);
    } else if (channel === "sms") {
      setSmsText(t.body || "");
    } else {
      setSubject(t.subject || "");
      setHtml(t.html || "");
    }
  }

  const [internalTitle, setInternalTitle] = useState(campaign.internal_title || "");
  const editableTemplateData = stripTemplateContext(campaign.template_data);
  const [contextEnabled, setContextEnabled] = useState(!!editableTemplateData);
  const [contextJson, setContextJson] = useState(editableTemplateData ? JSON.stringify(editableTemplateData, null, 2) : "");
  // Уже подобранные товары (если были) показываем как список для ручного
  // выбора — какой РЕЖИМ их дал (конкретный список или «N новых») к моменту
  // редактирования уже не восстановить, template_data хранит только
  // результат резолва, не исходное правило; для черновика это не проблема —
  // список можно поправить вручную, как и остальной уже введённый текст.
  const initialProducts = (campaign.template_data?.products as ProductFeedItem[] | undefined) || [];
  const [productsRule, setProductsRule] = useState<ProductsRule | null>(
    initialProducts.length ? { mode: "manual", external_ids: initialProducts.map((p) => p.external_id) } : null
  );
  const [segment, setSegment] = useState<string[]>(campaign.segment_tags || []);
  // Предвыбраны все платформы, когда фильтра ещё нет (см. NewCampaignForm.tsx)
  // — явно видно, куда уйдёт рассылка, а не молчаливое "пусто = всем".
  const [platforms, setPlatforms] = useState<string[]>(campaign.platforms?.length ? campaign.platforms : PLATFORM_VALUES);
  const effectivePlatforms = platforms.length === PLATFORM_VALUES.length ? [] : platforms;
  const [sendWindow, setSendWindow] = useState<SendWindowState>(() => {
    const spacingTotal = campaign.spacing_minutes || 60;
    const spacingUnit = spacingTotal % 1440 === 0 ? 1440 : spacingTotal % 60 === 0 ? 60 : 1;
    return {
      sendWindowEnabled: !!campaign.send_window_enabled,
      sendDays: campaign.send_days?.length ? campaign.send_days : [1, 2, 3, 4, 5, 6, 0],
      sendTimeFrom: (campaign.send_time_from || "09:00").slice(0, 5),
      sendTimeTo: (campaign.send_time_to || "21:00").slice(0, 5),
      sendWindowSubscriberTz: !!campaign.send_window_subscriber_tz,
      spacingEnabled: !!campaign.spacing_enabled,
      spacingAmount: spacingTotal / spacingUnit,
      spacingUnit,
    };
  });
  const [contacts, setContacts] = useState((campaign.contacts || []).join(", "));
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ручной JSON-контекст — доступен в шаблоне через Liquid, та же логика,
  // что и в форме создания (см. NewCampaignForm.tsx).
  let contextData: Record<string, unknown> | undefined;
  let contextError: string | null = null;
  if (contextEnabled && contextJson.trim()) {
    try {
      const parsed = JSON.parse(contextJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) contextData = parsed;
      else contextError = "Контекст должен быть JSON-объектом";
    } catch {
      contextError = "Невалидный JSON";
    }
  }

  const previewContent: PreviewContent =
    channel === "push"
      ? { channel, title, body: message, url, icon_url: icon, image_url: image, actions }
      : channel === "sms"
      ? { channel, body: smsText }
      : { channel, subject, html };

  // resolvedProducts — уже резолвленные товары (см. resolveProducts перед
  // save()/sendNow()), мержатся в template_data поверх ручного JSON-контекста
  // тем же способом, что и в /api/admin/campaigns/send для создания.
  function buildRow(resolvedProducts?: ProductFeedItem[]): Record<string, unknown> {
    const segmentTags = segment.map((s) => s.trim().toLowerCase()).filter(Boolean);
    const contactList = contacts
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Контекст ВЫБРАННОГО сейчас шаблона (templates.context) замораживается
    // отдельным ключом __template — та же схема, что и на сервере при
    // создании рассылки (см. mergeTemplateContext в lib/sender.ts), не
    // смешивается с ручным контекстом рассылки, чтобы не перекрывать его при
    // совпадении ключа (см. ContextDocs.tsx, п.1).
    const selectedTemplate = templateId !== CUSTOM_HTML ? channelTemplates.find((t) => t.id === templateId) : undefined;
    const templateData: Record<string, unknown> = {
      ...(contextData || {}),
      ...(resolvedProducts?.length ? { products: resolvedProducts, product: resolvedProducts[0] } : {}),
    };
    if (selectedTemplate?.context && Object.keys(selectedTemplate.context).length) {
      templateData.__template = selectedTemplate.context;
    }
    const row: Record<string, unknown> = {
      segment_tags: segmentTags,
      platforms: channel === "push" ? effectivePlatforms : [],
      type: transactional ? "transactional" : "marketing",
      template_id: templateId !== CUSTOM_HTML ? templateId : null,
      internal_title: internalTitle.trim() || null,
      template_data: Object.keys(templateData).length ? templateData : null,
      contacts: contactList,
      status: schedule ? "scheduled" : "draft",
      scheduled_at: schedule && scheduleDate && scheduleTime ? new Date(`${scheduleDate}T${scheduleTime}`).toISOString() : null,
      send_window_enabled: sendWindow.sendWindowEnabled,
      send_days: sendWindow.sendWindowEnabled && sendWindow.sendDays.length ? sendWindow.sendDays : null,
      send_time_from: sendWindow.sendWindowEnabled ? sendWindow.sendTimeFrom : null,
      send_time_to: sendWindow.sendWindowEnabled ? sendWindow.sendTimeTo : null,
      send_window_subscriber_tz: sendWindow.sendWindowSubscriberTz,
      spacing_enabled: sendWindow.spacingEnabled,
      spacing_minutes: sendWindow.spacingEnabled ? Math.max(1, sendWindow.spacingAmount * sendWindow.spacingUnit) : null,
    };
    if (channel === "push") {
      row.title = title.trim();
      row.body = message.trim();
      row.click_url = url.trim() || null;
      row.icon_url = icon.trim() || null;
      row.image_url = image.trim() || null;
      row.badge_url = badge.trim() || null;
      row.actions = actions.filter((a) => a.title.trim() && a.url.trim()).slice(0, 2);
    } else if (channel === "sms") {
      row.title = smsText.trim();
      row.body = smsText.trim();
      row.provider = smsProvider || null;
    } else {
      row.title = subject || "";
      row.subject = subject || null;
      row.html_body = html;
      row.provider = emailProvider || null;
    }
    return row;
  }

  function validate(): string | null {
    if (!internalTitle.trim()) return "Укажите внутреннее название";
    if (contextError) return contextError;
    if (schedule && (!scheduleDate || !scheduleTime)) return "Укажите дату и время отправки";
    if (channel === "push" && platforms.length === 0) return "Выберите хотя бы одну платформу";
    if (sendWindowError(sendWindow)) return sendWindowError(sendWindow);
    if (channel === "push" && (!title.trim() || !message.trim())) return "Заполните заголовок и текст";
    if (channel === "push" && title.length > 80) return "Заголовок длиннее 80 символов";
    // Ссылки в тексте сократятся при отправке (см. lib/sender.ts), поэтому
    // лимит проверяем по оценке ПОСЛЕ сокращения, а не по сырой длине ввода.
    if (channel === "push" && withShortenedLinks(message).length > 200) return "Текст длиннее 200 символов";
    if (channel === "sms" && !smsText.trim()) return "Заполните текст SMS";
    if (channel === "email" && !html.trim()) return "Выберите шаблон или заполните HTML";
    if (channel === "email" && !transactional && !hasUnsubscribeTag(html)) return "Добавьте {{ unsubscribe_url }} в письмо — обязательно для маркетинговой рассылки";
    return null;
  }

  // Та же проверка, что и в форме создания (см. NewCampaignForm.tsx) —
  // контакт можно указать в любом формате, кросс-канальное сопоставление
  // резолвит сервер; сегмент, если указан, — дополнительное требование к
  // введённым контактам (пересечение), не отдельный источник аудитории.
  async function checkContacts() {
    const list = contacts
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return;

    setCheckBusy(true);
    const res = await fetch("/api/admin/campaigns/check-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, channel, contacts: list, segmentTags: segment, type: transactional ? "transactional" : "marketing" }),
    });
    const json = await res.json();
    setCheckBusy(false);
    if (!res.ok) return toast(json.error || "Ошибка проверки", "bad");

    setContacts((json.valid as string[]).join(", "));
    if (json.removed > 0) {
      toast(`Убрано ${json.removed} — нет в базе, канал не включён, не входит в сегмент или контакт не найден.`, "warn");
    } else {
      toast("Все контакты прошли проверку.", "good");
    }
  }

  // Резолвит текущее правило товаров (ProductPicker) в конкретные товары —
  // нужен отдельный запрос, потому что save()/sendNow() пишут в campaigns
  // напрямую через Supabase-клиент, минуя /api/admin/campaigns/send, где для
  // создания это же делается на сервере (см. комментарий там).
  async function resolveProducts(): Promise<ProductFeedItem[] | undefined> {
    if (!productsRule) return undefined;
    const res = await fetch(`/api/admin/projects/${projectId}/product-feed/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule: productsRule }),
    }).catch(() => null);
    const json = res && res.ok ? await res.json() : null;
    return json?.items;
  }

  async function save() {
    const err = validate();
    if (err) return setError(err);
    setError(null);
    setBusy(true);
    const resolvedProducts = await resolveProducts();
    const { error: dbErr } = await supabase.from("campaigns").update(buildRow(resolvedProducts)).eq("id", campaign.id);
    setBusy(false);
    if (dbErr) return setError(dbErr.message);
    toast("Сохранено", "good");
    router.push(`/admin/projects/${projectId}/campaigns`);
    router.refresh();
  }

  async function sendNow() {
    const err = validate();
    if (err) return setError(err);

    // См. NewCampaignForm.tsx — тот же принцип: точное число получателей
    // прямо перед подтверждением, best-effort.
    const contactList = contacts
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const countRes = await fetch("/api/admin/campaigns/audience-count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        channel,
        contacts: contactList,
        segmentTags: segment,
        platforms: channel === "push" && effectivePlatforms.length ? effectivePlatforms : undefined,
        type: transactional ? "transactional" : "marketing",
      }),
    }).catch(() => null);
    const countJson = countRes && countRes.ok ? await countRes.json() : null;
    const audienceNote = typeof countJson?.count === "number" ? ` Уйдёт ${countJson.count} получателям.` : "";

    const ok = await confirm({
      title: "Отправить сейчас?",
      message: `Сообщения уйдут получателям немедленно — действие нельзя отменить.${audienceNote}`,
      confirmText: "Отправить",
    });
    if (!ok) return;

    setError(null);
    setBusy(true);
    const resolvedProducts = await resolveProducts();
    const { error: dbErr } = await supabase.from("campaigns").update(buildRow(resolvedProducts)).eq("id", campaign.id);
    if (dbErr) {
      setBusy(false);
      return setError(dbErr.message);
    }
    const res = await fetch(`/api/admin/campaigns/${campaign.id}/send-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error || "Ошибка отправки");
    toast(`Отправлено ${json.delivered} из ${json.total}, ошибок ${json.failed}`, "good");
    router.push(`/admin/projects/${projectId}/campaigns`);
    router.refresh();
  }

  // Тестовая отправка на один контакт — не трогает саму рассылку/черновик,
  // только проверяет как выглядит уже сохранённый в форме контент.
  async function sendTest() {
    if (contextError) return toast(contextError, "bad");
    const testContact = await prompt({
      title: "Тестовая отправка",
      message: channel === "push" ? "Телефон или email уже подписанного получателя." : undefined,
      placeholder: channel === "sms" ? "+79991234567" : channel === "email" ? "you@example.ru" : "+79991234567 или you@example.ru",
      confirmText: "Отправить тест",
    });
    if (!testContact?.trim()) return;

    setTestBusy(true);
    const body: Record<string, unknown> = { projectId, channel, contact: testContact.trim(), data: contextData, productsRule: productsRule || undefined };
    if (channel === "push") {
      body.title = title;
      body.message = message;
      body.url = url;
      body.icon = icon;
      body.image = image;
      body.badge = badge;
      body.actions = actions.filter((a) => a.title.trim() && a.url.trim());
      body.templateId = templateId !== CUSTOM_HTML ? templateId : undefined;
    } else if (channel === "sms") {
      body.text = smsText;
      body.provider = smsProvider || undefined;
      body.templateId = templateId !== CUSTOM_HTML ? templateId : undefined;
    } else {
      body.subject = subject || undefined;
      body.provider = emailProvider || undefined;
      body.html = html;
      body.templateId = templateId !== CUSTOM_HTML ? templateId : undefined;
    }

    const res = await fetch("/api/admin/campaigns/test-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setTestBusy(false);
    if (!res.ok) return toast(json.error || "Ошибка тестовой отправки", "bad");
    toast("Тест отправлен", "good");
  }

  async function remove() {
    const ok = await confirm({
      title: campaign.status === "draft" ? "Удалить черновик?" : "Отменить запланированную рассылку?",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    await supabase.from("campaigns").delete().eq("id", campaign.id);
    setBusy(false);
    toast("Удалено", "good");
    router.push(`/admin/projects/${projectId}/campaigns`);
    router.refresh();
  }

  const smsTextShortened = withShortenedLinks(smsText);
  const segments = smsSegments(smsTextShortened);
  const noProvider = (channel === "sms" && providerOptions.sms.length === 0) || (channel === "email" && providerOptions.email.length === 0);

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">{campaign.status === "draft" ? "Черновик рассылки" : "Запланированная рассылка"}</h1>

      <div className="mt-4 flex flex-col gap-3">
        <div>
          <Label>Внутреннее название</Label>
          <Input value={internalTitle} onChange={(e) => setInternalTitle(e.target.value)} placeholder="Для себя — получателям не видно" required />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge tone="accent">{CHANNEL_LABEL[channel]}</Badge>
            <Badge tone={campaign.status === "draft" ? "neutral" : "warn"} dot>
              {campaign.status === "draft" ? "черновик" : "запланирована"}
            </Badge>
          </div>
          <Toggle checked={transactional} onChange={setTransactional} label="Транзакционная" />
        </div>

        {noProvider && (
          <p className="text-bad text-[13px] mt-0 mb-0">
            {channel === "sms" ? "SMS" : "Email"} не настроен — сначала добавьте провайдера в разделе «Подключения». Черновик можно сохранить, но
            отправить не получится.
          </p>
        )}

        {channel === "sms" && providerOptions.sms.length > 1 && (
          <div>
            <Label>Через</Label>
            <CustomSelect value={smsProvider} onChange={setSmsProvider} options={providerOptions.sms} className="w-full" />
          </div>
        )}
        {channel === "email" && providerOptions.email.length > 1 && (
          <div>
            <Label>Через</Label>
            <CustomSelect value={emailProvider} onChange={setEmailProvider} options={providerOptions.email} className="w-full" />
          </div>
        )}

        {channel === "push" && (
          <>
            <div>
              <Label>Шаблон</Label>
              <SearchSelect value={templateId} onChange={selectTemplate} options={templateOptions} className="w-full" />
            </div>
            <ContextField enabled={contextEnabled} onToggle={setContextEnabled} value={contextJson} onChange={setContextJson} error={contextError} />
            <ContextDocs variant="campaign" />
            <div>
              <Label>
                Заголовок <span className="text-bad">*</span>
              </Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} placeholder="Скидка 20% сегодня" />
              <p className="text-[11px] text-ink-faint text-right mt-1 mb-0">{80 - title.length} символов осталось</p>
            </div>
            <div>
              <Label>
                Текст <span className="text-bad">*</span>
              </Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} required rows={3} placeholder="Только до конца дня…" />
              <p className="text-[11px] text-ink-faint text-right mt-1 mb-0">{200 - withShortenedLinks(message).length} символов осталось</p>
            </div>
            <div>
              <Label>Ссылка при клике</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ваш-сайт/акция" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label>URL иконки</Label>
                <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="https://ваш-сайт/icon-192.png" />
              </div>
              <div className="flex-1">
                <Label>URL картинки</Label>
                <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://ваш-сайт/image.jpg" />
              </div>
              <div className="flex-1">
                <Label>URL значка</Label>
                <Input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="https://ваш-сайт/badge-72.png" />
              </div>
            </div>

            <div>
              <Label>Кнопки действий</Label>
              {actions.map((a, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <Input
                    value={a.title}
                    onChange={(e) => setActions((as) => as.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    placeholder="Текст кнопки"
                    maxLength={30}
                  />
                  <Input
                    value={a.url}
                    onChange={(e) => setActions((as) => as.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                    placeholder="https://..."
                  />
                  <Button type="button" variant="secondary" size="sm" onClick={() => setActions((as) => as.filter((_, j) => j !== i))}>
                    <IconX size={15} stroke={2} />
                  </Button>
                </div>
              ))}
              {actions.length < 2 && (
                <Button type="button" variant="secondary" size="sm" onClick={() => setActions((as) => [...as, { title: "", url: "" }])}>
                  <IconPlus size={15} stroke={2} />
                  Кнопка
                </Button>
              )}
            </div>

          </>
        )}

        {channel === "sms" && (
          <>
            <div>
              <Label>Шаблон</Label>
              <SearchSelect value={templateId} onChange={selectTemplate} options={templateOptions} className="w-full" />
            </div>
            <ContextField enabled={contextEnabled} onToggle={setContextEnabled} value={contextJson} onChange={setContextJson} error={contextError} />
            <ContextDocs variant="campaign" />
            <div>
              <Label>
                Текст сообщения <span className="text-bad">*</span>
              </Label>
              <Textarea value={smsText} onChange={(e) => setSmsText(e.target.value)} required rows={4} maxLength={400} placeholder="Скидка 20% только сегодня!" />
              <p className="text-[11px] text-ink-faint text-right mt-1 mb-0">
                {smsTextShortened.length} символов · {segments.encoding} · {segments.count || 1} SMS
              </p>
            </div>
          </>
        )}

        {channel === "email" && (
          <>
            <div>
              <Label>Шаблон</Label>
              <SearchSelect value={templateId} onChange={selectTemplate} options={templateOptions} className="w-full" />
            </div>
            <ContextField enabled={contextEnabled} onToggle={setContextEnabled} value={contextJson} onChange={setContextJson} error={contextError} />
            <ContextDocs variant="campaign" />
            <div>
              <Label>
                Тема письма <span className="text-bad">*</span>
              </Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} required placeholder="Скидка недели" />
            </div>
            <div>
              <Label>
                HTML письма <span className="text-bad">*</span>
              </Label>
              <Textarea value={html} onChange={(e) => setHtml(e.target.value)} required rows={10} className="font-mono text-xs" placeholder="<p>Привет!</p>" />
              {!transactional && (
                <p className={`text-[11px] text-right mt-1 mb-0 ${hasUnsubscribeTag(html) ? "text-ink-faint" : "text-bad"}`}>
                  {hasUnsubscribeTag(html) ? "Ссылка отписки найдена" : "Добавьте ссылку вида "}
                  {!hasUnsubscribeTag(html) && <code>{'<a href="{{ unsubscribe_url }}">Отписаться</a>'}</code>}
                  {!hasUnsubscribeTag(html) && " — обязательно для маркетинговой рассылки"}
                </p>
              )}
            </div>
          </>
        )}

        <div>
          <Toggle checked={schedule} onChange={setSchedule} label="Запланировать на потом" />
          {schedule && (
            <div className="flex gap-2 mt-2.5">
              <Input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} required />
              <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} required />
            </div>
          )}
          {schedule && contacts.trim() && (
            <p className="text-[12px] text-ink-faint mt-1 mb-0">
              Контакты резолвятся заново в момент отправки — актуальные на тот момент устройства/согласие, а не на момент планирования.
            </p>
          )}
        </div>

        <div>
          <Label>Сегмент по тегам</Label>
          <SegmentTagsInput value={segment} onChange={setSegment} options={segmentOptions} />
        </div>

        <ProductPicker projectId={projectId} hasFeed={hasFeed} value={productsRule} onChange={setProductsRule} />

        {channel === "push" && (
          <div>
            <Label>
              Платформы <span className="text-bad">*</span>
            </Label>
            <PlatformFilter value={platforms} onChange={setPlatforms} />
          </div>
        )}

        <div>
          <Label>Контакты (телефон/email, через запятую)</Label>
          <div className="flex gap-2">
            <Input
              value={contacts}
              onChange={(e) => setContacts(e.target.value)}
              placeholder={channel === "sms" ? "+79991234567, +79997654321" : channel === "email" ? "client@example.ru, second@example.ru" : "+79991234567, client@example.ru"}
              className="flex-1"
            />
            <Button type="button" variant="secondary" disabled={checkBusy || !contacts.trim()} onClick={checkContacts}>
              {checkBusy ? "Проверяем…" : "Проверить"}
            </Button>
          </div>
        </div>

        <SendWindowFields value={sendWindow} onChange={setSendWindow} projectTimezone={projectTimezone} />

        {error && <p className="text-bad text-[13px] mt-0 mb-0">{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || noProvider} onClick={sendNow} type="button">
            {busy ? "Отправляем…" : "Отправить сейчас"}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={save} type="button">
            {busy ? "Сохраняем…" : schedule ? "Запланировать" : "Сохранить как черновик"}
          </Button>
          <Button variant="secondary" onClick={() => setPreviewOpen(true)} type="button">
            <IconEye size={15} stroke={1.8} />
            Превью
          </Button>
          <Button variant="secondary" disabled={testBusy || noProvider} onClick={sendTest} type="button">
            {testBusy ? "Отправляем тест…" : "Отправить тест"}
          </Button>
          <Button variant="secondary" onClick={() => router.push(`/admin/projects/${projectId}/campaigns`)} type="button">
            Отмена
          </Button>
          <Button variant="danger" disabled={busy} onClick={remove} type="button" className="ml-auto">
            Удалить
          </Button>
        </div>
      </div>

      {previewOpen && <MessagePreviewModal label="Превью" content={previewContent} sampleData={contextData} onClose={() => setPreviewOpen(false)} />}
    </main>
  );
}
