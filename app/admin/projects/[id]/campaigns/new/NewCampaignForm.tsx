"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconX, IconPlus, IconEye } from "@tabler/icons-react";
import { Button, Input, Textarea, Label, Toggle, useDialogs } from "@/app/ui";
import { CustomSelect, type ComboOption } from "@/app/ui/CustomSelect";
import { SearchSelect } from "@/app/ui/SearchSelect";
import { MessagePreviewModal, type PreviewContent } from "../../MessagePreviewModal";
import { SegmentTagsInput } from "../../SegmentTagsInput";
import { PlatformFilter, PLATFORM_VALUES } from "../../PlatformFilter";
import { SendWindowFields, SEND_WINDOW_DEFAULTS, sendWindowError, type SendWindowState } from "../../SendWindowFields";
import { ContextField } from "../../ContextField";
import { ContextDocs } from "../../templates/ContextDocs";
import { smsSegments } from "@/lib/smsSegments";
import { withShortenedLinks } from "@/lib/linkPreview";
import { hasUnsubscribeTag } from "@/lib/unsubscribeTag";

type Channel = "push" | "sms" | "email";
const CUSTOM_HTML = "__custom__";

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
};

export default function NewCampaignForm({
  projectId,
  providerOptions,
  templates,
  segmentOptions = [],
  initialChannel,
  initialTemplateId,
  projectTimezone,
}: {
  projectId: string;
  providerOptions: { sms: ComboOption[]; email: ComboOption[] };
  templates: Template[];
  segmentOptions?: string[];
  initialChannel?: Channel;
  initialTemplateId?: string;
  projectTimezone: string;
}) {
  const { toast, confirm, prompt } = useDialogs();
  const router = useRouter();
  const initialTemplate = initialTemplateId ? templates.find((t) => t.id === initialTemplateId) : undefined;
  const [channel, setChannel] = useState<Channel>(initialChannel || initialTemplate?.channel || "push");
  const [transactional, setTransactional] = useState(false);

  // push
  const [pushTemplateId, setPushTemplateId] = useState(initialTemplate?.channel === "push" ? initialTemplate.id : CUSTOM_HTML);
  const [title, setTitle] = useState(initialTemplate?.channel === "push" ? initialTemplate.title || "" : "");
  const [message, setMessage] = useState(initialTemplate?.channel === "push" ? initialTemplate.body || "" : "");
  const [url, setUrl] = useState(initialTemplate?.channel === "push" ? initialTemplate.url || "" : "");
  const [icon, setIcon] = useState(initialTemplate?.channel === "push" ? initialTemplate.icon_url || "" : "");
  const [image, setImage] = useState(initialTemplate?.channel === "push" ? initialTemplate.image_url || "" : "");
  const [badge, setBadge] = useState(initialTemplate?.channel === "push" ? initialTemplate.badge_url || "" : "");
  const [actions, setActions] = useState<{ title: string; url: string }[]>(initialTemplate?.channel === "push" ? initialTemplate.actions || [] : []);
  const [schedule, setSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

  // sms
  const [smsTemplateId, setSmsTemplateId] = useState(initialTemplate?.channel === "sms" ? initialTemplate.id : CUSTOM_HTML);
  const [smsText, setSmsText] = useState(initialTemplate?.channel === "sms" ? initialTemplate.body || "" : "");
  const [smsProvider, setSmsProvider] = useState(providerOptions.sms[0]?.value || "");

  // email
  const [templateId, setTemplateId] = useState(initialTemplate?.channel === "email" ? initialTemplate.id : CUSTOM_HTML);
  const [subject, setSubject] = useState(initialTemplate?.channel === "email" ? initialTemplate.subject || "" : "");
  const [html, setHtml] = useState(initialTemplate?.channel === "email" ? initialTemplate.html || "" : "");
  const [emailProvider, setEmailProvider] = useState(providerOptions.email[0]?.value || "");

  const [internalTitle, setInternalTitle] = useState("");
  const [contextEnabled, setContextEnabled] = useState(false);
  const [contextJson, setContextJson] = useState("");
  const [segment, setSegment] = useState<string[]>([]);
  // Предвыбраны все платформы — явно видно, куда уйдёт рассылка; снятие
  // галочки сужает аудиторию. Все 3 выбраны эквивалентно отсутствию фильтра
  // (см. effectivePlatforms) — иначе push на устройства с platform="unknown"
  // (не удалось определить при подписке) молча перестали бы получать
  // рассылки по умолчанию.
  const [platforms, setPlatforms] = useState<string[]>(PLATFORM_VALUES);
  const effectivePlatforms = platforms.length === PLATFORM_VALUES.length ? undefined : platforms;
  const [sendWindow, setSendWindow] = useState<SendWindowState>(SEND_WINDOW_DEFAULTS);
  const [contacts, setContacts] = useState("");
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Ручной JSON-контекст — доступен в шаблоне через Liquid ({{ ключ }},
  // фильтры, {% if %}/{% for %}) точно так же, как templateData у /api/v1/campaigns.
  // Невалидный JSON не роняет форму молча — считается ошибкой и блокирует
  // отправку/сохранение, чтобы не улетело с буквальными {{ }} в тексте.
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

  const pushTemplates = templates.filter((t) => t.channel === "push");
  const pushTemplateOptions: ComboOption[] = [{ value: CUSTOM_HTML, label: "Свой текст" }, ...pushTemplates.map((t) => ({ value: t.id, label: t.name }))];
  const smsTemplates = templates.filter((t) => t.channel === "sms");
  const smsTemplateOptions: ComboOption[] = [{ value: CUSTOM_HTML, label: "Свой текст" }, ...smsTemplates.map((t) => ({ value: t.id, label: t.name }))];
  const emailTemplates = templates.filter((t) => t.channel === "email");
  const templateOptions: ComboOption[] = [{ value: CUSTOM_HTML, label: "Свой HTML" }, ...emailTemplates.map((t) => ({ value: t.id, label: t.name }))];

  const channelOptions: ComboOption[] = [
    { value: "push", label: "Push" },
    { value: "sms", label: providerOptions.sms.length === 0 ? "SMS (не настроен)" : "SMS", disabled: providerOptions.sms.length === 0 },
    { value: "email", label: providerOptions.email.length === 0 ? "Email (не настроен)" : "Email", disabled: providerOptions.email.length === 0 },
  ];

  // Выбор шаблона просто подставляет его содержимое в обычные поля ниже —
  // дальше это такой же редактируемый текст, как если бы его напечатали
  // вручную (не «ссылка на шаблон», резолвящаяся заново при отправке).
  function selectPushTemplate(id: string) {
    setPushTemplateId(id);
    if (id === CUSTOM_HTML) return;
    const t = pushTemplates.find((x) => x.id === id);
    if (!t) return;
    setTitle(t.title || "");
    setMessage(t.body || "");
    setUrl(t.url || "");
    setIcon(t.icon_url || "");
    setImage(t.image_url || "");
    setBadge(t.badge_url || "");
    setActions(t.actions || []);
  }
  function selectSmsTemplate(id: string) {
    setSmsTemplateId(id);
    if (id === CUSTOM_HTML) return;
    const t = smsTemplates.find((x) => x.id === id);
    if (!t) return;
    setSmsText(t.body || "");
  }
  function selectEmailTemplate(id: string) {
    setTemplateId(id);
    if (id === CUSTOM_HTML) return;
    const t = emailTemplates.find((x) => x.id === id);
    if (!t) return;
    setSubject(t.subject || "");
    setHtml(t.html || "");
  }

  function buildBody(): { body: Record<string, unknown>; contactList: string[] } {
    const segmentTags = segment.map((s) => s.trim().toLowerCase()).filter(Boolean);
    const contactList = contacts
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const phones = contactList.filter((c) => !c.includes("@"));
    const emails = contactList.filter((c) => c.includes("@"));

    const body: Record<string, unknown> = {
      projectId,
      channel,
      internalTitle: internalTitle.trim() || undefined,
      segmentTags,
      platforms: channel === "push" ? effectivePlatforms : undefined,
      phones: phones.length ? phones : undefined,
      emails: emails.length ? emails : undefined,
      type: transactional ? "transactional" : "marketing",
      data: contextData,
      scheduledAt: schedule && scheduleDate && scheduleTime ? new Date(`${scheduleDate}T${scheduleTime}`).toISOString() : null,
      sendWindowEnabled: sendWindow.sendWindowEnabled,
      sendDays: sendWindow.sendDays,
      sendTimeFrom: sendWindow.sendTimeFrom,
      sendTimeTo: sendWindow.sendTimeTo,
      sendWindowSubscriberTz: sendWindow.sendWindowSubscriberTz,
      spacingEnabled: sendWindow.spacingEnabled,
      spacingMinutes: Math.max(1, sendWindow.spacingAmount * sendWindow.spacingUnit),
    };
    if (channel === "push") {
      body.title = title;
      body.message = message;
      body.url = url;
      body.icon = icon;
      body.image = image;
      body.badge = badge;
      body.actions = actions.filter((a) => a.title.trim() && a.url.trim());
      body.templateId = pushTemplateId !== CUSTOM_HTML ? pushTemplateId : undefined;
    } else if (channel === "sms") {
      body.text = smsText;
      body.provider = smsProvider || undefined;
      body.templateId = smsTemplateId !== CUSTOM_HTML ? smsTemplateId : undefined;
    } else {
      body.subject = subject || undefined;
      body.provider = emailProvider || undefined;
      body.html = html;
      body.templateId = templateId !== CUSTOM_HTML ? templateId : undefined;
    }
    return { body, contactList };
  }

  // Та же проверка, что и в форме редактирования (EditCampaignForm) — единая
  // для отправки, черновика и теста, чтобы «Сохранить как черновик» не
  // создавала пустых записей, которые потом нельзя пересохранить при
  // редактировании (там та же проверка блокирует и обычное сохранение).
  function validate(): string | null {
    if (!internalTitle.trim()) return "Укажите название";
    if (contextError) return contextError;
    if (channel === "push" && platforms.length === 0) return "Выберите хотя бы одну платформу";
    if (sendWindowError(sendWindow)) return sendWindowError(sendWindow);
    if (channel === "push" && (!title.trim() || !message.trim())) return "Заполните заголовок и текст";
    if (channel === "push" && title.length > 80) return "Заголовок длиннее 80 символов";
    // Ссылки в тексте сократятся при отправке (см. lib/sender.ts), поэтому
    // лимит проверяем по оценке ПОСЛЕ сокращения, а не по сырой длине ввода —
    // длинную ссылку вписать можно, просто она не должна раздувать лимит.
    if (channel === "push" && withShortenedLinks(message).length > 200) return "Текст длиннее 200 символов";
    if (channel === "sms" && !smsText.trim()) return "Заполните текст SMS";
    if (channel === "email" && !html.trim()) return "Выберите шаблон или заполните HTML";
    if (channel === "email" && !transactional && !hasUnsubscribeTag(html))
      return 'Добавьте ссылку вида <a href="{{ unsubscribe_url }}">Отписаться</a> — обязательно для маркетинговой рассылки';
    return null;
  }

  async function send(e: React.FormEvent | null, forceNow = false) {
    e?.preventDefault();
    const err = validate();
    if (err) return toast(err, "bad");
    const willSchedule = schedule && !forceNow;
    if (willSchedule && (!scheduleDate || !scheduleTime)) return toast("Укажите дату и время отправки", "bad");

    const { body, contactList } = buildBody();
    if (forceNow) body.scheduledAt = null;

    // Точное число получателей прямо перед подтверждением — чтобы не узнать
    // о реальном охвате постфактум (особенно с пустыми контактами/сегментом:
    // это отправка всем известным/согласившимся, см. lib/sender.ts:
    // countAudience). Best-effort — если счётчик не ответил, просто не
    // показываем число, отправку это не блокирует.
    const countRes = await fetch("/api/admin/campaigns/audience-count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, channel, contacts: contactList, segmentTags: segment, platforms: body.platforms, type: body.type }),
    }).catch(() => null);
    const countJson = countRes && countRes.ok ? await countRes.json() : null;
    const audienceNote = typeof countJson?.count === "number" ? ` Уйдёт ${countJson.count} получателям.` : "";

    const ok = await confirm({
      title: willSchedule ? "Запланировать рассылку?" : "Отправить рассылку?",
      message: willSchedule
        ? `Сообщения уйдут получателям в указанное время.${audienceNote}`
        : `Сообщения уйдут получателям прямо сейчас — действие нельзя отменить.${audienceNote}`,
      confirmText: willSchedule ? "Запланировать" : "Отправить",
    });
    if (!ok) return;

    setBusy(true);

    const res = await fetch("/api/admin/campaigns/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(json.error || "Ошибка отправки", "bad");
      return;
    }
    if (json.scheduled) {
      toast(`Запланировано на ${new Date(json.at).toLocaleString("ru-RU")}`, "good");
    } else {
      toast(`Отправлено ${json.delivered} из ${json.total}, ошибок ${json.failed}`, "good");
    }
    router.push(`/admin/projects/${projectId}/campaigns`);
    router.refresh();
  }

  async function saveDraft() {
    const err = validate();
    if (err) return toast(err, "bad");
    setBusy(true);
    const { body } = buildBody();
    body.draft = true;

    const res = await fetch("/api/admin/campaigns/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(json.error || "Ошибка сохранения черновика", "bad");
      return;
    }
    toast("Черновик сохранён", "good");
    router.push(`/admin/projects/${projectId}/campaigns`);
    router.refresh();
  }

  // Вторая кнопка объединяет два разных действия под одной подписью —
  // «Запланировать», если включён тумблер (реальная отложенная рассылка,
  // не черновик), иначе «Сохранить как черновик» (тумблер в этом случае
  // игнорируется, дата не сохраняется).
  function saveOrSchedule() {
    if (schedule) return send(null, false);
    return saveDraft();
  }

  // Отсеивает из «Контакты» тех, кого не найти в базе, у кого не включён
  // нужный канал, или (если указан сегмент) кто не входит в этот сегмент —
  // до отправки, а не после. Контакт можно указать в любом формате (для SMS
  // — email той же identity и наоборот) — сервер сам находит соответствие
  // каналу. Сегмент здесь — ДОПОЛНИТЕЛЬНОЕ требование к введённым контактам,
  // не отдельный источник аудитории: без контактов кнопке нечего проверять
  // (сегмент сам по себе участвует в реальной отправке напрямую, минуя эту
  // кнопку).
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

  // Тестовая отправка на один контакт — не создаёт рассылку, только
  // проверяет как выглядит то, что уже заполнено в форме. Для push контакт
  // должен быть уже подписан (телефон/email резолвится в устройство), для
  // sms/email — идёт напрямую, без проверки сегмента/согласия.
  async function sendTest() {
    const err = validate();
    if (err) return toast(err, "bad");
    const testContact = await prompt({
      title: "Тестовая отправка",
      message: channel === "push" ? "Телефон или email уже подписанного получателя." : undefined,
      placeholder: channel === "sms" ? "+79991234567" : channel === "email" ? "you@example.ru" : "+79991234567 или you@example.ru",
      confirmText: "Отправить тест",
    });
    if (!testContact?.trim()) return;

    setTestBusy(true);
    const body: Record<string, unknown> = { projectId, channel, contact: testContact.trim(), data: contextData };
    if (channel === "push") {
      body.title = title;
      body.message = message;
      body.url = url;
      body.icon = icon;
      body.image = image;
      body.badge = badge;
      body.actions = actions.filter((a) => a.title.trim() && a.url.trim());
      body.templateId = pushTemplateId !== CUSTOM_HTML ? pushTemplateId : undefined;
    } else if (channel === "sms") {
      body.text = smsText;
      body.provider = smsProvider || undefined;
      body.templateId = smsTemplateId !== CUSTOM_HTML ? smsTemplateId : undefined;
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

  const smsTextShortened = withShortenedLinks(smsText);
  const segments = smsSegments(smsTextShortened);

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Новая рассылка</h1>

      <div className="mt-4">
        <form onSubmit={(e) => send(e, true)} className="flex flex-col gap-3">
          <div>
            <Label>
              Название <span className="text-bad">*</span>
            </Label>
            <Input value={internalTitle} onChange={(e) => setInternalTitle(e.target.value)} placeholder="Не показывается получателю" required />
          </div>

          <div className="flex items-end gap-4">
            <div className="flex-1">
              <Label>Канал</Label>
              <CustomSelect value={channel} onChange={(v) => setChannel(v as Channel)} options={channelOptions} className="w-full" />
            </div>
            <Toggle checked={transactional} onChange={setTransactional} label="Транзакционная" className="pb-2.5" />
          </div>

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
                <SearchSelect value={pushTemplateId} onChange={selectPushTemplate} options={pushTemplateOptions} className="w-full" />
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
              {providerOptions.sms.length === 0 ? (
                <p className="text-bad text-[13px] mt-0">
                  SMS не настроен — сначала добавьте Bytehand или SMSC.ru в разделе «Подключения».
                </p>
              ) : (
                <>
                  <div>
                    <Label>Шаблон</Label>
                    <SearchSelect value={smsTemplateId} onChange={selectSmsTemplate} options={smsTemplateOptions} className="w-full" />
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
            </>
          )}

          {channel === "email" && (
            <>
              {providerOptions.email.length === 0 ? (
                <p className="text-bad text-[13px] mt-0">
                  Email не настроен — сначала добавьте канал рассылок Haskimail или SMSC.ru в разделе «Подключения».
                </p>
              ) : (
                <>
                  <div>
                    <Label>Шаблон</Label>
                    <SearchSelect value={templateId} onChange={selectEmailTemplate} options={templateOptions} className="w-full" />
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
                  </div>
                </>
              )}
            </>
          )}

          <div>
            <Label>Сегмент по тегам</Label>
            <SegmentTagsInput value={segment} onChange={setSegment} options={segmentOptions} />
          </div>

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

          <SendWindowFields value={sendWindow} onChange={setSendWindow} projectTimezone={projectTimezone} />

          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || (channel === "sms" && providerOptions.sms.length === 0) || (channel === "email" && providerOptions.email.length === 0)}>
              {busy ? "Отправляем…" : "Отправить сейчас"}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={saveOrSchedule}>
              {busy ? "Сохраняем…" : schedule ? "Запланировать" : "Сохранить как черновик"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPreviewOpen(true)}>
              <IconEye size={15} stroke={1.8} />
              Превью
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={testBusy || (channel === "sms" && providerOptions.sms.length === 0) || (channel === "email" && providerOptions.email.length === 0)}
              onClick={sendTest}
            >
              {testBusy ? "Отправляем тест…" : "Отправить тест"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push(`/admin/projects/${projectId}/campaigns`)}>
              Отмена
            </Button>
          </div>
        </form>
      </div>

      {previewOpen && (
        <MessagePreviewModal label="Превью" content={previewContent} sampleData={contextData} projectId={projectId} onClose={() => setPreviewOpen(false)} />
      )}
    </main>
  );
}
