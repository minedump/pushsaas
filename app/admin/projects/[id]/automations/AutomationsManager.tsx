"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconArrowRight, IconPlus, IconGripVertical, IconPencil, IconEye, IconX } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, Input, Label, Select, SearchSelect, Toggle, useDialogs } from "@/app/ui";
import { cn } from "@/app/ui/cn";
import { SMS_PROVIDERS, EMAIL_PROVIDERS } from "@/lib/otp/providers";
import { SegmentTagsInput } from "../SegmentTagsInput";
import { SendWindowFields, sendWindowError } from "../SendWindowFields";
import { PlatformFilter, PLATFORM_VALUES } from "../PlatformFilter";
import { MessagePreviewModal, type PreviewContent } from "../MessagePreviewModal";
import { EventTrackingDocs } from "./EventTrackingDocs";
import { hasUnsubscribeTag } from "@/lib/unsubscribeTag";

type Channel = "push" | "sms" | "email";
const channelLabel: Record<Channel, string> = { push: "Push", sms: "SMS", email: "Email" };
const PROVIDER_OPTIONS: Partial<Record<Channel, { id: string; label: string }[]>> = { sms: SMS_PROVIDERS, email: EMAIL_PROVIDERS };
// Демо-контакт для превью — реального получателя на этом этапе ещё нет,
// подставляем правдоподобные значения, чтобы {{ name }}/{{ phone }} и т.п.
// в шаблоне отрендерились не пустотой.
const PREVIEW_SAMPLE = { name: "Иван Иванов", phone: "79991234567", email: "client@example.ru", tags: ["vip"] };
// Подсказки для «Когда произошло» — не закрытый список, любое своё имя
// события тоже валидно (см. EventTrackingDocs.tsx), поэтому SearchSelect
// с allowCustom, а не обычный select.
const EVENT_NAME_PRESETS = ["cart_updated", "favorite_updated", "product_viewed", "category_viewed", "checkout_started"].map((v) => ({ value: v, label: v }));

type Automation = {
  id: string;
  type: string;
  channel?: Channel | null;
  is_enabled: boolean;
  delay_minutes?: number;
  template_id?: string | null;
  provider?: string | null;
  segment_tags?: string[] | null;
  spacing_enabled?: boolean | null;
  spacing_minutes?: number | null;
  send_window_enabled?: boolean | null;
  send_days?: number[] | null;
  send_time_from?: string | null;
  send_time_to?: string | null;
  send_window_subscriber_tz?: boolean | null;
  name?: string | null;
  title: string | null;
  body: string | null;
  click_url: string | null;
  platforms?: string[] | null;
  cascade?: boolean | null;
  channel_templates?: Partial<Record<Channel, string>> | null;
  config: {
    key?: string;
    trigger_event?: string;
    cancel_events?: string[];
    transactional?: boolean;
    phone_path?: string;
    status_field?: string;
    status_value?: string;
    status_checks?: { field: string; op?: "contains" | "eq" | "gt" | "lt"; value: string }[];
    order_id_path?: string;
    segment_path?: string;
    email_path?: string;
    external_id_path?: string;
    list_fanout?: boolean;
    list_type?: string;
    product_id_path?: string;
    track_field_path?: string;
    track_mode?: "changed" | "increased" | "decreased";
  } | null;
};
type Template = {
  id: string;
  name: string;
  channel: Channel;
  title: string | null;
  body: string | null;
  url: string | null;
  icon_url: string | null;
  image_url: string | null;
  badge_url: string | null;
  actions: { title: string; url: string }[] | null;
  subject: string | null;
  html: string | null;
  context: Record<string, unknown> | null;
};

export default function AutomationsManager({
  projectId,
  welcomes,
  templates,
  events,
  custom,
  priorityOrder,
  channelEnabled,
  channelProvider,
  hasBytehand,
  hasSmsc,
  hasHaskimail,
  segmentOptions,
  projectTimezone,
}: {
  projectId: string;
  welcomes: Automation[];
  templates: Template[];
  events: Automation[];
  custom: Automation[];
  priorityOrder: string[];
  channelEnabled: Record<string, boolean>;
  channelProvider: Record<string, string>;
  hasBytehand: boolean;
  hasSmsc: boolean;
  hasHaskimail: boolean;
  segmentOptions: string[];
  projectTimezone: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"welcome" | "event" | "custom">("welcome");

  // ---------- приоритет каналов welcome (если контакт активен сразу на
  // нескольких — шлём только по каналу с наивысшим приоритетом; порядок
  // всегда в силе, отдельного вкл/выкл нет — «включить» это отдельного
  // приветственного сообщения, см. Toggle на его карточке ниже) — то же
  // drag-переупорядочивание, что и «Каскад отправки кода» в Авторизации.
  const [pOrder, setPOrder] = useState<Channel[]>((priorityOrder as Channel[]).length === 3 ? (priorityOrder as Channel[]) : ["push", "sms", "email"]);
  const [dragKey, setDragKey] = useState<Channel | null>(null);
  const rowRefs = useRef<Partial<Record<Channel, HTMLDivElement | null>>>({});
  const orderBeforeDrag = useRef<Channel[] | null>(null);

  async function savePriority(order: Channel[]) {
    setBusy(true);
    await supabase.from("projects").update({ welcome_channel_priority: order }).eq("id", projectId);
    setBusy(false);
    router.refresh();
  }

  // Per-канал: быстро выключить welcome целиком (без удаления сообщений) +
  // через какое подключение слать sms/email — тот же принцип, что канал+
  // провайдер в «Каскаде отправки кода» (Авторизация), но для welcome.
  const [cEnabled, setCEnabled] = useState<Record<Channel, boolean>>({
    push: channelEnabled.push !== false,
    sms: channelEnabled.sms !== false,
    email: channelEnabled.email !== false,
  });
  const [cProvider, setCProvider] = useState<Partial<Record<Channel, string>>>(channelProvider);
  const providerConfigured: Record<string, boolean> = { bytehand: hasBytehand, smsc: hasSmsc, haskimail: hasHaskimail };
  function configuredProvidersFor(ch: Channel): { id: string; label: string }[] {
    return (PROVIDER_OPTIONS[ch] || []).filter((o) => providerConfigured[o.id]);
  }
  // Канал без единого настроенного подключения нельзя выбрать при создании/
  // редактировании приветственного сообщения — всё равно нечем будет
  // отправить (см. «Подключения»). Push всегда доступен (VAPID генерируется
  // при создании проекта, отдельного подключения не требует).
  const availableChannels: Channel[] = (["push", "sms", "email"] as Channel[]).filter(
    (ch) => ch === "push" || configuredProvidersFor(ch).length > 0
  );
  async function saveChannelConfig(enabled: Record<Channel, boolean>, provider: Partial<Record<Channel, string>>) {
    setBusy(true);
    await supabase.from("projects").update({ welcome_channel_enabled: enabled, welcome_channel_provider: provider }).eq("id", projectId);
    setBusy(false);
    router.refresh();
  }
  function toggleChannelEnabled(ch: Channel, v: boolean) {
    const next = { ...cEnabled, [ch]: v };
    setCEnabled(next);
    saveChannelConfig(next, cProvider);
  }
  function changeChannelProvider(ch: Channel, id: string) {
    const next = { ...cProvider, [ch]: id };
    setCProvider(next);
    saveChannelConfig(cEnabled, next);
  }
  function dragStart(e: React.PointerEvent, key: Channel) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    orderBeforeDrag.current = pOrder;
    setDragKey(key);
  }
  function dragMove(e: React.PointerEvent, key: Channel) {
    if (dragKey !== key) return;
    const y = e.clientY;
    setPOrder((o) => {
      const i = o.indexOf(key);
      const prev = o[i - 1];
      if (prev) {
        const r = rowRefs.current[prev]?.getBoundingClientRect();
        if (r && y < r.top + r.height / 2) {
          const next = [...o];
          [next[i - 1], next[i]] = [next[i], next[i - 1]];
          return next;
        }
      }
      const after = o[i + 1];
      if (after) {
        const r = rowRefs.current[after]?.getBoundingClientRect();
        if (r && y > r.top + r.height / 2) {
          const next = [...o];
          [next[i + 1], next[i]] = [next[i], next[i + 1]];
          return next;
        }
      }
      return o;
    });
  }
  async function dragEnd() {
    setDragKey(null);
    const before = orderBeforeDrag.current;
    orderBeforeDrag.current = null;
    if (!before || before.join() === pOrder.join()) return;
    await savePriority(pOrder);
  }

  // ---------- welcome (push/sms/email, template-based, несколько штук) ----------
  const [showCreateWelcome, setShowCreateWelcome] = useState(false);
  const [previewCreate, setPreviewCreate] = useState(false);
  const [w, setW] = useState<{
    name: string;
    channel: Channel;
    provider: string;
    amount: number;
    unit: number;
    templateId: string;
    platforms: string[];
    segmentTags: string[];
    spacingEnabled: boolean;
    spacingAmount: number;
    spacingUnit: number;
    sendWindowEnabled: boolean;
    sendDays: number[];
    sendTimeFrom: string;
    sendTimeTo: string;
    sendWindowSubscriberTz: boolean;
    cascade: boolean;
    channelTemplates: Partial<Record<Channel, string>>;
  }>({
    name: "",
    channel: "push",
    provider: "",
    amount: 0,
    unit: 1,
    templateId: "",
    platforms: PLATFORM_VALUES,
    segmentTags: [],
    spacingEnabled: false,
    spacingAmount: 60,
    spacingUnit: 1,
    sendWindowEnabled: false,
    sendDays: [1, 2, 3, 4, 5, 6, 0],
    sendTimeFrom: "09:00",
    sendTimeTo: "21:00",
    sendWindowSubscriberTz: false,
    cascade: false,
    channelTemplates: {},
  });
  const wTemplates = templates.filter((t) => t.channel === w.channel);
  const wTemplate = templates.find((t) => t.id === w.templateId);
  // Email без ссылки отписки в шаблоне отправлять нельзя — та же проверка,
  // что у обычных рассылок (см. sendWelcomeNow в lib/sender.ts, дублируется
  // здесь только для мгновенной обратной связи в форме). При каскаде — та же
  // проверка для email-шаблона внутри channelTemplates, если он задан.
  const wCascadeEmailTemplate = w.cascade && w.channelTemplates.email ? templates.find((t) => t.id === w.channelTemplates.email) : undefined;
  const wUnsubscribeMissing = w.cascade
    ? !!wCascadeEmailTemplate && !hasUnsubscribeTag(wCascadeEmailTemplate.html || "")
    : w.channel === "email" && !!wTemplate && !hasUnsubscribeTag(wTemplate.html || "");
  const wPreviewChannel: Channel = w.cascade ? pOrder.find((c) => w.channelTemplates[c]) || "push" : w.channel;
  const wPreviewTemplate = w.cascade ? templates.find((t) => t.id === w.channelTemplates[wPreviewChannel]) : wTemplate;
  const wPushApplicable = w.cascade ? !!w.channelTemplates.push : w.channel === "push";
  async function createWelcome(e: React.FormEvent) {
    e.preventDefault();
    if (!w.name.trim()) return toast("Укажите название", "bad");
    if (w.cascade ? !Object.keys(w.channelTemplates).length : !w.templateId) return toast("Выберите шаблон", "bad");
    if (wUnsubscribeMissing) return toast("В шаблоне нет ссылки отписки {{ unsubscribe_url }} — добавьте её в разделе «Шаблоны»", "bad");
    if (wPushApplicable && w.platforms.length === 0) return toast("Выберите хотя бы одну платформу", "bad");
    const wSendWindowErr = sendWindowError(w);
    if (wSendWindowErr) return toast(wSendWindowErr, "bad");
    setBusy(true);
    const { error } = await supabase.from("automations").insert({
      project_id: projectId,
      type: "welcome",
      name: w.name.trim(),
      channel: w.channel,
      provider: !w.cascade && w.provider ? w.provider : null,
      is_enabled: true,
      delay_minutes: Math.max(0, w.amount * w.unit),
      template_id: w.cascade ? null : w.templateId,
      cascade: w.cascade,
      channel_templates: w.cascade ? w.channelTemplates : {},
      platforms: wPushApplicable && w.platforms.length < PLATFORM_VALUES.length ? w.platforms : [],
      segment_tags: w.segmentTags,
      spacing_enabled: w.spacingEnabled,
      spacing_minutes: w.spacingEnabled ? Math.max(1, w.spacingAmount * w.spacingUnit) : null,
      send_window_enabled: w.sendWindowEnabled,
      send_days: w.sendWindowEnabled && w.sendDays.length ? w.sendDays : null,
      send_time_from: w.sendWindowEnabled ? w.sendTimeFrom : null,
      send_time_to: w.sendWindowEnabled ? w.sendTimeTo : null,
      send_window_subscriber_tz: w.sendWindowSubscriberTz,
    });
    setBusy(false);
    if (error) {
      toast(error.message, "bad");
      return;
    }
    setW({
      name: "",
      channel: "push",
      provider: "",
      amount: 0,
      unit: 1,
      templateId: "",
      platforms: PLATFORM_VALUES,
      segmentTags: [],
      spacingEnabled: false,
      spacingAmount: 60,
      spacingUnit: 1,
      sendWindowEnabled: false,
      sendDays: [1, 2, 3, 4, 5, 6, 0],
      sendTimeFrom: "09:00",
      sendTimeTo: "21:00",
      sendWindowSubscriberTz: false,
      cascade: false,
      channelTemplates: {},
    });
    setShowCreateWelcome(false);
    toast("Приветственное сообщение добавлено", "good");
    router.refresh();
  }

  // Редактирование существующего приветственного сообщения — та же форма,
  // что и создание, инлайн в карточке (см. рендер welcomes.map ниже).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewEdit, setPreviewEdit] = useState(false);
  const [ew, setEw] = useState<{
    name: string;
    channel: Channel;
    provider: string;
    amount: number;
    unit: number;
    templateId: string;
    platforms: string[];
    segmentTags: string[];
    isEnabled: boolean;
    spacingEnabled: boolean;
    spacingAmount: number;
    spacingUnit: number;
    sendWindowEnabled: boolean;
    sendDays: number[];
    sendTimeFrom: string;
    sendTimeTo: string;
    sendWindowSubscriberTz: boolean;
    cascade: boolean;
    channelTemplates: Partial<Record<Channel, string>>;
  }>({
    name: "",
    channel: "push",
    provider: "",
    amount: 0,
    unit: 1,
    templateId: "",
    platforms: PLATFORM_VALUES,
    segmentTags: [],
    isEnabled: true,
    spacingEnabled: false,
    spacingAmount: 60,
    spacingUnit: 1,
    sendWindowEnabled: false,
    sendDays: [1, 2, 3, 4, 5, 6, 0],
    sendTimeFrom: "09:00",
    sendTimeTo: "21:00",
    sendWindowSubscriberTz: false,
    cascade: false,
    channelTemplates: {},
  });
  const ewTemplate = templates.find((t) => t.id === ew.templateId);
  const ewCascadeEmailTemplate = ew.cascade && ew.channelTemplates.email ? templates.find((t) => t.id === ew.channelTemplates.email) : undefined;
  const ewUnsubscribeMissing = ew.cascade
    ? !!ewCascadeEmailTemplate && !hasUnsubscribeTag(ewCascadeEmailTemplate.html || "")
    : ew.channel === "email" && !!ewTemplate && !hasUnsubscribeTag(ewTemplate.html || "");
  // Превью каскадной карточки показывает шаблон канала с наивысшим
  // приоритетом среди настроенных в ней — тот, что реально уйдёт чаще всего.
  const ewPreviewChannel: Channel = ew.cascade ? pOrder.find((c) => ew.channelTemplates[c]) || "push" : ew.channel;
  const ewPreviewTemplate = ew.cascade ? templates.find((t) => t.id === ew.channelTemplates[ewPreviewChannel]) : ewTemplate;
  const ewPushApplicable = ew.cascade ? !!ew.channelTemplates.push : ew.channel === "push";
  function startEditWelcome(a: Automation) {
    const [amount, unit] = minutesToAmountUnit(a.delay_minutes || 0);
    const [spacingAmount, spacingUnit] = minutesToAmountUnit(a.spacing_minutes || 60);
    setEw({
      name: a.name || "",
      channel: (a.channel || "push") as Channel,
      provider: a.provider || "",
      amount,
      unit,
      templateId: a.template_id || "",
      platforms: a.platforms?.length ? a.platforms : PLATFORM_VALUES,
      segmentTags: a.segment_tags || [],
      isEnabled: a.is_enabled,
      spacingEnabled: !!a.spacing_enabled,
      spacingAmount,
      spacingUnit,
      sendWindowEnabled: !!a.send_window_enabled,
      sendDays: a.send_days?.length ? a.send_days : [1, 2, 3, 4, 5, 6, 0],
      sendTimeFrom: (a.send_time_from || "09:00").slice(0, 5),
      sendTimeTo: (a.send_time_to || "21:00").slice(0, 5),
      sendWindowSubscriberTz: !!a.send_window_subscriber_tz,
      cascade: !!a.cascade,
      channelTemplates: a.channel_templates || {},
    });
    setEditingId(a.id);
  }
  async function saveEditWelcome(id: string) {
    if (!ew.name.trim()) return toast("Укажите название", "bad");
    if (ew.cascade ? !Object.keys(ew.channelTemplates).length : !ew.templateId) return toast("Выберите шаблон", "bad");
    if (ewUnsubscribeMissing) return toast("В шаблоне нет ссылки отписки {{ unsubscribe_url }} — добавьте её в разделе «Шаблоны»", "bad");
    if (ewPushApplicable && ew.platforms.length === 0) return toast("Выберите хотя бы одну платформу", "bad");
    const ewSendWindowErr = sendWindowError(ew);
    if (ewSendWindowErr) return toast(ewSendWindowErr, "bad");
    setBusy(true);
    const { error } = await supabase
      .from("automations")
      .update({
        name: ew.name.trim(),
        channel: ew.channel,
        provider: !ew.cascade && ew.provider ? ew.provider : null,
        delay_minutes: Math.max(0, ew.amount * ew.unit),
        template_id: ew.cascade ? null : ew.templateId,
        cascade: ew.cascade,
        channel_templates: ew.cascade ? ew.channelTemplates : {},
        platforms: ewPushApplicable && ew.platforms.length < PLATFORM_VALUES.length ? ew.platforms : [],
        segment_tags: ew.segmentTags,
        is_enabled: ew.isEnabled,
        spacing_enabled: ew.spacingEnabled,
        spacing_minutes: ew.spacingEnabled ? Math.max(1, ew.spacingAmount * ew.spacingUnit) : null,
        send_window_enabled: ew.sendWindowEnabled,
        send_days: ew.sendWindowEnabled && ew.sendDays.length ? ew.sendDays : null,
        send_time_from: ew.sendWindowEnabled ? ew.sendTimeFrom : null,
        send_time_to: ew.sendWindowEnabled ? ew.sendTimeTo : null,
        send_window_subscriber_tz: ew.sendWindowSubscriberTz,
      })
      .eq("id", id);
    setBusy(false);
    if (error) {
      toast(error.message, "bad");
      return;
    }
    setEditingId(null);
    toast("Сохранено", "good");
    router.refresh();
  }
  // Контент для превью (MessagePreviewModal) — из выбранного шаблона,
  // sampleData = контекст шаблона + демо-контакт, как реально подставится
  // при отправке (см. sendWelcomeNow).
  function previewContentFor(tpl: Template | undefined, channel: Channel): PreviewContent {
    if (!tpl) return { channel };
    if (channel === "push") return { channel, title: tpl.title, body: tpl.body, url: tpl.url, icon_url: tpl.icon_url, image_url: tpl.image_url, badge_url: tpl.badge_url, actions: tpl.actions };
    if (channel === "sms") return { channel, body: tpl.body };
    return { channel, subject: tpl.subject, html: tpl.html };
  }

  // ---------- event automations (abandoned cart & co) — та же форма, что и
  // welcome (канал/шаблон/название/приоритет/сегмент/защита/окно), плюс
  // собственные поля триггера события (когда/подождать/если не произошло).
  const EVENT_DEFAULTS = {
    trigger: "cart_updated",
    amount: 60,
    unit: 1,
    cancel: "order_placed",
    name: "",
    channel: "push" as Channel,
    provider: "",
    templateId: "",
    platforms: PLATFORM_VALUES as string[],
    segmentTags: [] as string[],
    spacingEnabled: false,
    spacingAmount: 60,
    spacingUnit: 1,
    sendWindowEnabled: false,
    sendDays: [1, 2, 3, 4, 5, 6, 0] as number[],
    sendTimeFrom: "09:00",
    sendTimeTo: "21:00",
    sendWindowSubscriberTz: false,
    cascade: false,
    channelTemplates: {} as Partial<Record<Channel, string>>,
  };
  const [ev, setEv] = useState(EVENT_DEFAULTS);
  const eventTemplates = templates.filter((t) => t.channel === ev.channel);
  const evTemplate = templates.find((t) => t.id === ev.templateId);
  const evCascadeEmailTemplate = ev.cascade && ev.channelTemplates.email ? templates.find((t) => t.id === ev.channelTemplates.email) : undefined;
  const evUnsubscribeMissing = ev.cascade
    ? !!evCascadeEmailTemplate && !hasUnsubscribeTag(evCascadeEmailTemplate.html || "")
    : ev.channel === "email" && !!evTemplate && !hasUnsubscribeTag(evTemplate.html || "");
  const evPreviewChannel: Channel = ev.cascade ? pOrder.find((c) => ev.channelTemplates[c]) || "push" : ev.channel;
  const evPreviewTemplate = ev.cascade ? templates.find((t) => t.id === ev.channelTemplates[evPreviewChannel]) : evTemplate;
  const evPushApplicable = ev.cascade ? !!ev.channelTemplates.push : ev.channel === "push";
  async function createEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!ev.name.trim()) return toast("Укажите название", "bad");
    if (ev.cascade ? !Object.keys(ev.channelTemplates).length : !ev.templateId) return toast("Выберите шаблон", "bad");
    if (evUnsubscribeMissing) return toast("В шаблоне нет ссылки отписки {{ unsubscribe_url }} — добавьте её в разделе «Шаблоны»", "bad");
    if (evPushApplicable && ev.platforms.length === 0) return toast("Выберите хотя бы одну платформу", "bad");
    const evSendWindowErr = sendWindowError(ev);
    if (evSendWindowErr) return toast(evSendWindowErr, "bad");
    setBusy(true);
    const cancel_events = ev.cancel.split(",").map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase.from("automations").insert({
      project_id: projectId,
      type: "event",
      is_enabled: true,
      name: ev.name.trim(),
      channel: ev.channel,
      provider: !ev.cascade && ev.provider ? ev.provider : null,
      template_id: ev.cascade ? null : ev.templateId,
      cascade: ev.cascade,
      channel_templates: ev.cascade ? ev.channelTemplates : {},
      platforms: evPushApplicable && ev.platforms.length < PLATFORM_VALUES.length ? ev.platforms : [],
      delay_minutes: Math.max(1, ev.amount * ev.unit),
      config: { trigger_event: ev.trigger.trim(), cancel_events },
      segment_tags: ev.segmentTags,
      spacing_enabled: ev.spacingEnabled,
      spacing_minutes: ev.spacingEnabled ? Math.max(1, ev.spacingAmount * ev.spacingUnit) : null,
      send_window_enabled: ev.sendWindowEnabled,
      send_days: ev.sendWindowEnabled && ev.sendDays.length ? ev.sendDays : null,
      send_time_from: ev.sendWindowEnabled ? ev.sendTimeFrom : null,
      send_time_to: ev.sendWindowEnabled ? ev.sendTimeTo : null,
      send_window_subscriber_tz: ev.sendWindowSubscriberTz,
    });
    setBusy(false);
    if (error) { toast(error.message, "bad"); return; }
    setEv(EVENT_DEFAULTS);
    setShowCreateEvent(false);
    toast("Событийная автоматизация создана", "good");
    router.refresh();
  }

  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [previewEvent, setPreviewEvent] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [previewEditEvent, setPreviewEditEvent] = useState(false);
  const [eev, setEev] = useState(EVENT_DEFAULTS);
  const eevTemplates = templates.filter((t) => t.channel === eev.channel);
  const eevTemplate = templates.find((t) => t.id === eev.templateId);
  const eevCascadeEmailTemplate = eev.cascade && eev.channelTemplates.email ? templates.find((t) => t.id === eev.channelTemplates.email) : undefined;
  const eevUnsubscribeMissing = eev.cascade
    ? !!eevCascadeEmailTemplate && !hasUnsubscribeTag(eevCascadeEmailTemplate.html || "")
    : eev.channel === "email" && !!eevTemplate && !hasUnsubscribeTag(eevTemplate.html || "");
  const eevPreviewChannel: Channel = eev.cascade ? pOrder.find((c) => eev.channelTemplates[c]) || "push" : eev.channel;
  const eevPreviewTemplate = eev.cascade ? templates.find((t) => t.id === eev.channelTemplates[eevPreviewChannel]) : eevTemplate;
  const eevPushApplicable = eev.cascade ? !!eev.channelTemplates.push : eev.channel === "push";
  function startEditEvent(a: Automation) {
    const [amount, unit] = minutesToAmountUnit(a.delay_minutes || 0);
    const [spacingAmount, spacingUnit] = minutesToAmountUnit(a.spacing_minutes || 60);
    setEev({
      trigger: a.config?.trigger_event || "",
      amount,
      unit,
      cancel: (a.config?.cancel_events || []).join(", "),
      name: a.name || "",
      channel: (a.channel || "push") as Channel,
      provider: a.provider || "",
      templateId: a.template_id || "",
      platforms: a.platforms?.length ? a.platforms : PLATFORM_VALUES,
      segmentTags: a.segment_tags || [],
      spacingEnabled: !!a.spacing_enabled,
      spacingAmount,
      spacingUnit,
      sendWindowEnabled: !!a.send_window_enabled,
      sendDays: a.send_days?.length ? a.send_days : [1, 2, 3, 4, 5, 6, 0],
      sendTimeFrom: (a.send_time_from || "09:00").slice(0, 5),
      sendTimeTo: (a.send_time_to || "21:00").slice(0, 5),
      sendWindowSubscriberTz: !!a.send_window_subscriber_tz,
      cascade: !!a.cascade,
      channelTemplates: a.channel_templates || {},
    });
    setEditingEventId(a.id);
  }
  async function saveEditEvent(id: string) {
    if (!eev.name.trim()) return toast("Укажите название", "bad");
    if (eev.cascade ? !Object.keys(eev.channelTemplates).length : !eev.templateId) return toast("Выберите шаблон", "bad");
    if (eevUnsubscribeMissing) return toast("В шаблоне нет ссылки отписки {{ unsubscribe_url }} — добавьте её в разделе «Шаблоны»", "bad");
    if (eevPushApplicable && eev.platforms.length === 0) return toast("Выберите хотя бы одну платформу", "bad");
    const eevSendWindowErr = sendWindowError(eev);
    if (eevSendWindowErr) return toast(eevSendWindowErr, "bad");
    setBusy(true);
    const cancel_events = eev.cancel.split(",").map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase
      .from("automations")
      .update({
        name: eev.name.trim(),
        channel: eev.channel,
        provider: !eev.cascade && eev.provider ? eev.provider : null,
        template_id: eev.cascade ? null : eev.templateId,
        cascade: eev.cascade,
        channel_templates: eev.cascade ? eev.channelTemplates : {},
        platforms: eevPushApplicable && eev.platforms.length < PLATFORM_VALUES.length ? eev.platforms : [],
        delay_minutes: Math.max(1, eev.amount * eev.unit),
        config: { trigger_event: eev.trigger.trim(), cancel_events },
        segment_tags: eev.segmentTags,
        spacing_enabled: eev.spacingEnabled,
        spacing_minutes: eev.spacingEnabled ? Math.max(1, eev.spacingAmount * eev.spacingUnit) : null,
        send_window_enabled: eev.sendWindowEnabled,
        send_days: eev.sendWindowEnabled && eev.sendDays.length ? eev.sendDays : null,
        send_time_from: eev.sendWindowEnabled ? eev.sendTimeFrom : null,
        send_time_to: eev.sendWindowEnabled ? eev.sendTimeTo : null,
        send_window_subscriber_tz: eev.sendWindowSubscriberTz,
      })
      .eq("id", id);
    setBusy(false);
    if (error) { toast(error.message, "bad"); return; }
    setEditingEventId(null);
    toast("Сохранено", "good");
    router.refresh();
  }
  async function toggleEnabled(a: Automation) {
    setBusy(true);
    const next = !a.is_enabled;
    const { error } = await supabase.from("automations").update({ is_enabled: next }).eq("id", a.id);
    setBusy(false);
    if (error) return toast(error.message, "bad");
    toast(next ? "Включено" : "Выключено", "good");
    router.refresh();
  }
  async function del(id: string, label: string) {
    const ok = await confirm({ title: `Удалить «${label}»?`, danger: true, confirmText: "Удалить" });
    if (!ok) return;
    setBusy(true);
    await supabase.from("automations").delete().eq("id", id);
    setBusy(false);
    router.refresh();
  }

  // ---------- webhook triggers (транзакционные/по списку товара/рассылочные) ----------
  const CUSTOM_DEFAULTS = {
    key: "",
    name: "",
    mode: "phone" as "phone" | "segment" | "fanout",
    phonePath: "client.phone",
    emailPath: "",
    externalIdPath: "",
    statusChecks: [{ field: "fulfillment_status", op: "contains", value: "shipped" }] as {
      field: string;
      op: "contains" | "eq" | "gt" | "lt";
      value: string;
    }[],
    orderIdPath: "number",
    segmentPath: "",
    productIdPath: "product_id",
    listType: "any",
    trackFieldPath: "",
    trackMode: "changed" as "changed" | "increased" | "decreased",
    channel: "push" as Channel,
    provider: "",
    templateId: "",
    platforms: PLATFORM_VALUES as string[],
    cascade: false,
    channelTemplates: {} as Partial<Record<Channel, string>>,
    sendWindowEnabled: false,
    sendDays: [1, 2, 3, 4, 5, 6, 0] as number[],
    sendTimeFrom: "09:00",
    sendTimeTo: "21:00",
    sendWindowSubscriberTz: false,
    spacingEnabled: false,
    spacingAmount: 60,
    spacingUnit: 1,
  };
  const [showCreateCustom, setShowCreateCustom] = useState(false);
  const [neu, setNeu] = useState(CUSTOM_DEFAULTS);
  const neuTemplates = templates.filter((t) => t.channel === neu.channel);
  const neuTemplate = templates.find((t) => t.id === neu.templateId);
  const neuCascadeEmailTemplate = neu.cascade && neu.channelTemplates.email ? templates.find((t) => t.id === neu.channelTemplates.email) : undefined;
  const neuUnsubscribeMissing = neu.cascade
    ? !!neuCascadeEmailTemplate && !hasUnsubscribeTag(neuCascadeEmailTemplate.html || "")
    : neu.channel === "email" && !!neuTemplate && !hasUnsubscribeTag(neuTemplate.html || "");
  const neuPushApplicable = neu.cascade ? !!neu.channelTemplates.push : neu.channel === "push";
  function buildCustomRow(v: typeof CUSTOM_DEFAULTS): Record<string, unknown> {
    const config: Record<string, unknown> = { key: v.key.trim(), transactional: v.mode === "phone" };
    const statusChecks = v.statusChecks
      .filter((c) => c.field.trim() && c.value.trim())
      .map((c) => ({ field: c.field.trim(), op: c.op || "contains", value: c.value.trim() }));
    if (v.mode === "phone") {
      config.phone_path = v.phonePath.trim() || undefined;
      config.email_path = v.emailPath.trim() || undefined;
      config.external_id_path = v.externalIdPath.trim() || undefined;
      config.status_checks = statusChecks;
      config.order_id_path = v.orderIdPath.trim() || undefined;
    } else if (v.mode === "segment") {
      config.status_checks = statusChecks;
      config.segment_path = v.segmentPath.trim() || undefined;
    } else {
      config.list_fanout = true;
      config.product_id_path = v.productIdPath.trim() || "product_id";
      config.list_type = v.listType;
      config.status_checks = statusChecks;
      config.track_field_path = v.trackFieldPath.trim() || undefined;
      config.track_mode = v.trackFieldPath.trim() ? v.trackMode : undefined;
    }
    return {
      name: v.name.trim() || null,
      channel: v.cascade ? null : v.channel,
      provider: !v.cascade && v.provider ? v.provider : null,
      template_id: v.cascade ? null : v.templateId,
      cascade: v.cascade,
      channel_templates: v.cascade ? v.channelTemplates : {},
      platforms: (v.cascade ? !!v.channelTemplates.push : v.channel === "push") && v.platforms.length < PLATFORM_VALUES.length ? v.platforms : [],
      send_window_enabled: v.sendWindowEnabled,
      send_days: v.sendWindowEnabled && v.sendDays.length ? v.sendDays : null,
      send_time_from: v.sendWindowEnabled ? v.sendTimeFrom : null,
      send_time_to: v.sendWindowEnabled ? v.sendTimeTo : null,
      send_window_subscriber_tz: v.sendWindowSubscriberTz,
      spacing_enabled: v.spacingEnabled,
      spacing_minutes: v.spacingEnabled ? Math.max(1, v.spacingAmount * v.spacingUnit) : null,
      config,
    };
  }
  async function createCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!neu.name.trim()) return toast("Укажите внутреннее название", "bad");
    if (!neu.key.trim()) return toast("Укажите ключ", "bad");
    if (neu.cascade ? !Object.keys(neu.channelTemplates).length : !neu.templateId) return toast("Выберите шаблон", "bad");
    if (neuUnsubscribeMissing) return toast("В шаблоне нет ссылки отписки {{ unsubscribe_url }} — добавьте её в разделе «Шаблоны»", "bad");
    if (neuPushApplicable && neu.platforms.length === 0) return toast("Выберите хотя бы одну платформу", "bad");
    const neuSendWindowErr = sendWindowError(neu);
    if (neuSendWindowErr) return toast(neuSendWindowErr, "bad");
    setBusy(true);
    const { error } = await supabase.from("automations").insert({
      project_id: projectId,
      type: "custom",
      is_enabled: true,
      ...buildCustomRow(neu),
    });
    setBusy(false);
    if (error) return toast(error.message, "bad");
    setNeu(CUSTOM_DEFAULTS);
    setShowCreateCustom(false);
    toast("Автоматизация создана", "good");
    router.refresh();
  }

  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [cust, setCust] = useState(CUSTOM_DEFAULTS);
  const custTemplates = templates.filter((t) => t.channel === cust.channel);
  const custTemplate = templates.find((t) => t.id === cust.templateId);
  const custCascadeEmailTemplate = cust.cascade && cust.channelTemplates.email ? templates.find((t) => t.id === cust.channelTemplates.email) : undefined;
  const custUnsubscribeMissing = cust.cascade
    ? !!custCascadeEmailTemplate && !hasUnsubscribeTag(custCascadeEmailTemplate.html || "")
    : cust.channel === "email" && !!custTemplate && !hasUnsubscribeTag(custTemplate.html || "");
  const custPushApplicable = cust.cascade ? !!cust.channelTemplates.push : cust.channel === "push";
  function startEditCustom(a: Automation) {
    const spacingTotal = a.spacing_minutes || 60;
    const [spacingAmount, spacingUnit] = minutesToAmountUnit(spacingTotal);
    setCust({
      key: a.config?.key || "",
      name: a.name || "",
      mode: a.config?.list_fanout ? "fanout" : a.config?.transactional ? "phone" : "segment",
      phonePath: a.config?.phone_path || "",
      emailPath: a.config?.email_path || "",
      externalIdPath: a.config?.external_id_path || "",
      statusChecks: a.config?.status_checks?.length
        ? a.config.status_checks.map((c) => ({
            field: c.field,
            op: (["contains", "eq", "gt", "lt"] as const).includes(c.op as never) ? (c.op as "contains" | "eq" | "gt" | "lt") : "contains",
            value: c.value,
          }))
        : a.config?.status_field
          ? [{ field: a.config.status_field, op: "contains" as const, value: a.config.status_value || "" }]
          : [],
      orderIdPath: a.config?.order_id_path || "",
      segmentPath: a.config?.segment_path || "",
      productIdPath: a.config?.product_id_path || "product_id",
      listType: a.config?.list_type || "any",
      trackFieldPath: a.config?.track_field_path || "",
      trackMode: a.config?.track_mode || "changed",
      channel: (a.channel || "push") as Channel,
      provider: a.provider || "",
      templateId: a.template_id || "",
      platforms: a.platforms?.length ? a.platforms : PLATFORM_VALUES,
      cascade: !!a.cascade,
      channelTemplates: a.channel_templates || {},
      sendWindowEnabled: !!a.send_window_enabled,
      sendDays: a.send_days?.length ? a.send_days : [1, 2, 3, 4, 5, 6, 0],
      sendTimeFrom: (a.send_time_from || "09:00").slice(0, 5),
      sendTimeTo: (a.send_time_to || "21:00").slice(0, 5),
      sendWindowSubscriberTz: !!a.send_window_subscriber_tz,
      spacingEnabled: !!a.spacing_enabled,
      spacingAmount,
      spacingUnit,
    });
    setEditingCustomId(a.id);
  }
  async function saveEditCustom(id: string) {
    if (!cust.name.trim()) return toast("Укажите внутреннее название", "bad");
    if (!cust.key.trim()) return toast("Укажите ключ", "bad");
    if (cust.cascade ? !Object.keys(cust.channelTemplates).length : !cust.templateId) return toast("Выберите шаблон", "bad");
    if (custUnsubscribeMissing) return toast("В шаблоне нет ссылки отписки {{ unsubscribe_url }} — добавьте её в разделе «Шаблоны»", "bad");
    if (custPushApplicable && cust.platforms.length === 0) return toast("Выберите хотя бы одну платформу", "bad");
    const custSendWindowErr = sendWindowError(cust);
    if (custSendWindowErr) return toast(custSendWindowErr, "bad");
    setBusy(true);
    const { error } = await supabase.from("automations").update(buildCustomRow(cust)).eq("id", id);
    setBusy(false);
    if (error) return toast(error.message, "bad");
    setEditingCustomId(null);
    toast("Сохранено", "good");
    router.refresh();
  }

  // Общее тело формы триггерной автоматизации (создание и правка) — режим
  // получателя (одному по телефону / по списку товара / сегменту-всем),
  // канал+шаблон (или каскад), окно отправки/защита от наложения — тот же
  // порядок полей, что у событийной. Контент — только через шаблон, свой
  // текст здесь не поддержан (сегмент/broadcast без identity, для него
  // каскад тоже не поддержан — один фиксированный канал на всю рассылку).
  function renderCustomFields(v: typeof CUSTOM_DEFAULTS, setV: (v: typeof CUSTOM_DEFAULTS) => void) {
    const vTemplates = templates.filter((t) => t.channel === v.channel);
    const vProviderOpts = configuredProvidersFor(v.channel);
    const vPushApplicable = v.cascade ? !!v.channelTemplates.push : v.channel === "push";
    const statusChecksBlock = (
      <>
        <Label>Условия (все — по И; для «содержит» — несколько значений через запятую по ИЛИ)</Label>
        <div className="flex flex-col gap-2">
          {v.statusChecks.map((check, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={check.field}
                onChange={(e) => {
                  const next = v.statusChecks.slice();
                  next[i] = { ...next[i], field: e.target.value };
                  setV({ ...v, statusChecks: next });
                }}
                placeholder="fulfillment_status"
                className="flex-1"
              />
              <Select
                value={check.op}
                onChange={(e) => {
                  const next = v.statusChecks.slice();
                  next[i] = { ...next[i], op: e.target.value as typeof check.op };
                  setV({ ...v, statusChecks: next });
                }}
                className="w-32 shrink-0"
              >
                <option value="contains">Содержит</option>
                <option value="eq">Равно</option>
                <option value="gt">Больше</option>
                <option value="lt">Меньше</option>
              </Select>
              <Input
                value={check.value}
                onChange={(e) => {
                  const next = v.statusChecks.slice();
                  next[i] = { ...next[i], value: e.target.value };
                  setV({ ...v, statusChecks: next });
                }}
                placeholder={check.op === "contains" ? "собран, отправлен" : check.op === "eq" ? "shipped" : "999"}
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setV({ ...v, statusChecks: v.statusChecks.filter((_, j) => j !== i) })}
              >
                <IconX size={15} stroke={2} />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={() => setV({ ...v, statusChecks: [...v.statusChecks, { field: "", op: "contains", value: "" }] })}
          >
            <IconPlus size={15} stroke={2} />
            Добавить условие
          </Button>
        </div>
      </>
    );
    return (
      <>
        <Label>Внутреннее название <span className="text-bad">*</span></Label>
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Для себя — получателям не видно" required />
        <div className="h-3" />
        <Label>Ключ (латиницей, для ссылки вебхука) <span className="text-bad">*</span></Label>
        <Input value={v.key} required onChange={(e) => setV({ ...v, key: e.target.value })} placeholder="order_shipped" />
        <div className="h-3" />
        <Toggle checked={v.cascade} onChange={(checked) => setV({ ...v, cascade: checked })} label="Каскадная отправка" />
        <div className="h-3" />
        {v.cascade ? (
          <CascadeChannelTemplates
            value={v.channelTemplates}
            onChange={(ct) => setV({ ...v, channelTemplates: ct })}
            templates={templates}
            availableChannels={availableChannels}
          />
        ) : (
          <>
            <Label>Канал</Label>
            <Select value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value as Channel, provider: "", templateId: "" })} className="w-full">
              {availableChannels.map((c) => (
                <option key={c} value={c}>
                  {channelLabel[c]}
                </option>
              ))}
            </Select>
          </>
        )}
        <div className="h-3" />
        {!v.cascade && vProviderOpts.length > 1 && (
          <>
            <Label>Через</Label>
            <Select value={v.provider || vProviderOpts[0]?.id} onChange={(e) => setV({ ...v, provider: e.target.value })} className="w-full">
              {vProviderOpts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
            <div className="h-3" />
          </>
        )}
        {!v.cascade && (
          <>
            <Label>Шаблон <span className="text-bad">*</span></Label>
            {vTemplates.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint m-0">Нет шаблонов канала {channelLabel[v.channel]} — создайте в разделе «Шаблоны».</p>
            ) : (
              <SearchSelect
                value={v.templateId}
                onChange={(id) => setV({ ...v, templateId: id })}
                options={vTemplates.map((t) => ({ value: t.id, label: t.name }))}
                placeholder="Выберите шаблон"
                className="w-full"
              />
            )}
            <div className="h-3" />
          </>
        )}

        <Label>Получатель</Label>
        <Select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as typeof v.mode })} className="w-full">
          <option value="phone">Одному контакту (по телефону/email/ID из тела)</option>
          <option value="fanout">По списку товара (избранное/корзина/свой список)</option>
          <option value="segment">Сегменту или всем</option>
        </Select>
        <div className="h-3" />

        {v.mode === "phone" && (
          <>
            {statusChecksBlock}
            <div className="h-3" />
            <div className="flex flex-col gap-3">
              <div>
                <Label>Путь к телефону получателя</Label>
                <Input value={v.phonePath} onChange={(e) => setV({ ...v, phonePath: e.target.value })} placeholder="client.phone" />
              </div>
              <div>
                <Label>Путь к email получателя (если телефона нет)</Label>
                <Input value={v.emailPath} onChange={(e) => setV({ ...v, emailPath: e.target.value })} placeholder="client.email" />
              </div>
              <div>
                <Label>Путь к внешнему ID получателя (если ни телефона, ни email нет)</Label>
                <Input value={v.externalIdPath} onChange={(e) => setV({ ...v, externalIdPath: e.target.value })} placeholder="client.id" />
              </div>
              <div>
                <Label>Путь к номеру заказа (дедуп)</Label>
                <Input value={v.orderIdPath} onChange={(e) => setV({ ...v, orderIdPath: e.target.value })} placeholder="number" />
              </div>
            </div>
          </>
        )}
        {v.mode === "fanout" && (
          <>
            {statusChecksBlock}
            <div className="h-3" />
            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <Label>Путь к id товара в теле</Label>
                <Input value={v.productIdPath} onChange={(e) => setV({ ...v, productIdPath: e.target.value })} placeholder="product_id" />
              </div>
              <div>
                <Label>Список</Label>
                <SearchSelect
                  allowCustom
                  value={v.listType}
                  onChange={(val) => setV({ ...v, listType: val })}
                  options={[
                    { value: "any", label: "any" },
                    { value: "favorite", label: "favorite" },
                    { value: "cart", label: "cart" },
                  ]}
                  placeholder="any"
                  emptyText="Впишите своё имя списка"
                  className="w-full"
                />
              </div>
            </div>
            <div className="h-3" />
            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <Label>Поле для отслеживания изменения</Label>
                <Input value={v.trackFieldPath} onChange={(e) => setV({ ...v, trackFieldPath: e.target.value })} placeholder="stock, price" />
              </div>
              {!!v.trackFieldPath.trim() && (
                <div>
                  <Label>Отправлять, когда значение</Label>
                  <Select value={v.trackMode} onChange={(e) => setV({ ...v, trackMode: e.target.value as typeof v.trackMode })} className="w-full">
                    <option value="changed">изменилось (в любую сторону)</option>
                    <option value="increased">выросло (например появился остаток)</option>
                    <option value="decreased">снизилось (например упала цена)</option>
                  </Select>
                </div>
              )}
            </div>
          </>
        )}
        {v.mode === "segment" && (
          <>
            {statusChecksBlock}
            <div className="h-3" />
            <Label>Путь к сегменту</Label>
            <Input value={v.segmentPath} onChange={(e) => setV({ ...v, segmentPath: e.target.value })} placeholder="tag — пусто = всем" />
          </>
        )}
        <div className="h-3" />
        {vPushApplicable && (
          <>
            <Label>
              Платформы <span className="text-bad">*</span>
            </Label>
            <PlatformFilter value={v.platforms} onChange={(pv) => setV({ ...v, platforms: pv })} />
            <div className="h-3" />
          </>
        )}

        <SendWindowFields value={v} onChange={(sw) => setV({ ...v, ...sw })} projectTimezone={projectTimezone} />
      </>
    );
  }

  return (
    <div className={`mt-4 ${busy ? "opacity-60" : ""}`}>
      <div className="inline-flex gap-1 p-1 rounded-lg bg-surface-2 border border-border mb-5 flex-wrap">
        <TabButton active={tab === "welcome"} onClick={() => setTab("welcome")}>
          Приветственные
        </TabButton>
        <TabButton active={tab === "event"} onClick={() => setTab("event")}>
          Событийные
        </TabButton>
        <TabButton active={tab === "custom"} onClick={() => setTab("custom")}>
          Триггерные
        </TabButton>
      </div>

      {(
        <>
          <h2 className="text-base font-semibold">Приоритет каналов</h2>
          <p className="text-ink-muted text-[13px] mt-0">
            Определяет, каким каналом уйдёт карточка с включённой «Каскадной отправкой» (Приветственные/Событийные/Триггерные) — среди
            каналов, заданных в самой карточке, побеждает первый активный отсюда (сверху). Обычные (не каскадные) карточки этот порядок
            не учитывают — у них канал и провайдер задаются прямо в карточке.
          </p>
          <div className="flex flex-col gap-1.5 mt-3 mb-8">
            {pOrder.map((ch) => {
              const providerOpts = configuredProvidersFor(ch);
              const provider = cProvider[ch] && providerOpts.some((o) => o.id === cProvider[ch]) ? cProvider[ch] : providerOpts[0]?.id;
              return (
                <div
                  key={ch}
                  ref={(el) => {
                    rowRefs.current[ch] = el;
                  }}
                  className={`flex items-center gap-3 min-h-[52px] py-1.5 px-3 rounded-lg border transition-colors ${
                    dragKey === ch ? "bg-surface-2 shadow-sm select-none border-border-strong" : "border-border"
                  }`}
                >
                  <div
                    onPointerDown={(e) => dragStart(e, ch)}
                    onPointerMove={(e) => dragMove(e, ch)}
                    onPointerUp={dragEnd}
                    onPointerCancel={dragEnd}
                    style={{ touchAction: "none" }}
                    className={`p-1 -m-1 text-ink-faint hover:text-ink ${dragKey === ch ? "cursor-grabbing text-ink" : "cursor-grab"}`}
                    aria-label="Перетащить для изменения приоритета"
                    role="button"
                  >
                    <IconGripVertical size={16} stroke={1.8} />
                  </div>
                  <div className="flex-1 text-[13.5px]">{channelLabel[ch]}</div>
                  {providerOpts.length > 0 && (
                    <Select value={provider} onChange={(e) => changeChannelProvider(ch, e.target.value)} className="w-40 shrink-0">
                      {providerOpts.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Toggle checked={cEnabled[ch]} onChange={(v) => toggleChannelEnabled(ch, v)} label={cEnabled[ch] ? "Вкл" : "Выкл"} />
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "welcome" && (
        <>
      {/* Welcome */}
      <h2 className="text-base font-semibold">Приветственные рассылки</h2>
      <p className="text-ink-muted text-[13px] mt-0">
        Отправляется автоматически, когда контакт становится «Активным» по каналу — можно завести несколько, на разные каналы и с разной
        задержкой.
      </p>

      {welcomes.map((a) => {
        const tpl = templates.find((t) => t.id === a.template_id);
        const ch = (a.channel || "push") as Channel;

        if (editingId === a.id) {
          const eTemplates = templates.filter((t) => t.channel === ew.channel);
          return (
            <Card key={a.id} className="mt-3">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold">Изменить приветственное сообщение</div>
                <Toggle checked={ew.isEnabled} onChange={(v) => setEw({ ...ew, isEnabled: v })} label={ew.isEnabled ? "Вкл" : "Выкл"} />
              </div>
              <Label>Внутреннее название <span className="text-bad">*</span></Label>
              <Input value={ew.name} onChange={(e) => setEw({ ...ew, name: e.target.value })} placeholder="Для себя — получателям не видно" required />
              <div className="h-3" />
              <Toggle checked={ew.cascade} onChange={(v) => setEw({ ...ew, cascade: v })} label="Каскадная отправка" />
              <div className="h-3" />
              {ew.cascade ? (
                <CascadeChannelTemplates
                  value={ew.channelTemplates}
                  onChange={(v) => setEw({ ...ew, channelTemplates: v })}
                  templates={templates}
                  availableChannels={availableChannels}
                />
              ) : (
                <>
                  <Label>Канал</Label>
                  <Select value={ew.channel} onChange={(e) => setEw({ ...ew, channel: e.target.value as Channel, provider: "", templateId: "" })} className="w-full">
                    {availableChannels.map((c) => (
                      <option key={c} value={c}>
                        {channelLabel[c]}
                      </option>
                    ))}
                  </Select>
                </>
              )}
              <div className="h-3" />
              {!ew.cascade && configuredProvidersFor(ew.channel).length > 1 && (
                <>
                  <Label>Через</Label>
                  <Select value={ew.provider || configuredProvidersFor(ew.channel)[0]?.id} onChange={(e) => setEw({ ...ew, provider: e.target.value })} className="w-full">
                    {configuredProvidersFor(ew.channel).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <div className="h-3" />
                </>
              )}
              {!ew.cascade && (
                <>
                  <Label>Шаблон <span className="text-bad">*</span></Label>
                  {eTemplates.length === 0 ? (
                    <p className="text-[12.5px] text-ink-faint m-0">
                      Нет шаблонов канала {channelLabel[ew.channel]} — создайте в разделе «Шаблоны».
                    </p>
                  ) : (
                    <SearchSelect
                      value={ew.templateId}
                      onChange={(id) => setEw({ ...ew, templateId: id })}
                      options={eTemplates.map((t) => ({ value: t.id, label: t.name }))}
                      placeholder="Выберите шаблон"
                      className="w-full"
                    />
                  )}
                  <div className="h-3" />
                </>
              )}
              <Label>Отправить через (0 = сразу)</Label>
              <div className="flex gap-2">
                <Input type="number" min={0} value={ew.amount} onChange={(e) => setEw({ ...ew, amount: Number(e.target.value) })} className="w-20" />
                <Select value={ew.unit} onChange={(e) => setEw({ ...ew, unit: Number(e.target.value) })} className="flex-1">
                  <option value={1}>минут</option>
                  <option value={60}>часов</option>
                  <option value={1440}>дней</option>
                </Select>
              </div>
              <div className="h-3" />
              {ewPushApplicable && (
                <>
                  <Label>
                    Платформы <span className="text-bad">*</span>
                  </Label>
                  <PlatformFilter value={ew.platforms} onChange={(v) => setEw({ ...ew, platforms: v })} />
                  <div className="h-3" />
                </>
              )}
              <Label>Сегмент по тегам</Label>
              <SegmentTagsInput value={ew.segmentTags} onChange={(tags) => setEw({ ...ew, segmentTags: tags })} options={segmentOptions} />
              <div className="h-3" />
              <SendWindowFields value={ew} onChange={(sw) => setEw({ ...ew, ...sw })} projectTimezone={projectTimezone} />
              {ewUnsubscribeMissing && (
                <p className="text-[11px] text-bad mt-1 mb-0">
                  В шаблоне нет ссылки отписки <code>{"{{ unsubscribe_url }}"}</code> — добавьте её в разделе «Шаблоны».
                </p>
              )}
              <div className="flex items-center gap-2 mt-4">
                <Button
                  disabled={busy || !ew.name.trim() || (ew.cascade ? !Object.keys(ew.channelTemplates).length : !ew.templateId) || ewUnsubscribeMissing}
                  onClick={() => saveEditWelcome(a.id)}
                >
                  Сохранить
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPreviewEdit(true)} disabled={!ewPreviewTemplate}>
                  <IconEye size={15} stroke={1.8} />
                  Превью
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditingId(null)}>
                  Отмена
                </Button>
              </div>
              {previewEdit && ewPreviewTemplate && (
                <MessagePreviewModal
                  label={ewPreviewTemplate.name}
                  content={previewContentFor(ewPreviewTemplate, ewPreviewChannel)}
                  sampleData={{ ...(ewPreviewTemplate.context || {}), ...PREVIEW_SAMPLE }}
                  onClose={() => setPreviewEdit(false)}
                />
              )}
            </Card>
          );
        }

        return (
          <Card key={a.id} className="mt-3">
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-[13px]">
                  {a.cascade ? (
                    <Badge tone="accent">Каскад</Badge>
                  ) : (
                    <Badge tone="accent">{channelLabel[ch]}</Badge>
                  )}
                  {!!a.segment_tags?.length && <Badge tone="neutral">сегмент: {a.segment_tags.join(", ")}</Badge>}
                  {a.spacing_enabled && !!a.spacing_minutes && <Badge tone="neutral">защита {fmtDelay(a.spacing_minutes)}</Badge>}
                  {a.send_window_enabled && (
                    <Badge tone="neutral">
                      {fmtSendWindow(a.send_days, a.send_time_from, a.send_time_to)}
                      {a.send_window_subscriber_tz ? " (пояс подписчика)" : ""}
                    </Badge>
                  )}
                  <IconArrowRight size={14} className="text-ink-faint" />
                  <span className="text-ink-muted">{a.delay_minutes ? `${fmtDelay(a.delay_minutes)} после активности` : "сразу"}</span>
                </div>
                <div className="font-semibold mt-2">{a.name || "Без названия"}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Toggle checked={a.is_enabled} onChange={() => toggleEnabled(a)} label={a.is_enabled ? "Вкл" : "Выкл"} />
                <Button variant="secondary" size="sm" onClick={() => startEditWelcome(a)}>
                  <IconPencil size={14} stroke={1.8} />
                  Изменить
                </Button>
                <Button variant="secondary" size="sm" onClick={() => del(a.id, a.name || tpl?.name || "приветственное сообщение")}>
                  Удалить
                </Button>
              </div>
            </div>
          </Card>
        );
      })}

      {showCreateWelcome ? (
      <Card className="mt-3">
        <form onSubmit={createWelcome}>
          <div className="font-semibold mb-3">Новое приветственное сообщение</div>
          <Label>Внутреннее название <span className="text-bad">*</span></Label>
          <Input value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} placeholder="Для себя — получателям не видно" required />
          <div className="h-3" />
          <Toggle checked={w.cascade} onChange={(v) => setW({ ...w, cascade: v })} label="Каскадная отправка" />
          <div className="h-3" />
          {w.cascade ? (
            <CascadeChannelTemplates
              value={w.channelTemplates}
              onChange={(v) => setW({ ...w, channelTemplates: v })}
              templates={templates}
              availableChannels={availableChannels}
            />
          ) : (
            <>
              <Label>Канал</Label>
              <Select value={w.channel} onChange={(e) => setW({ ...w, channel: e.target.value as Channel, provider: "", templateId: "" })} className="w-full">
                {availableChannels.map((c) => (
                  <option key={c} value={c}>
                    {channelLabel[c]}
                  </option>
                ))}
              </Select>
            </>
          )}
          <div className="h-3" />
          {!w.cascade && configuredProvidersFor(w.channel).length > 1 && (
            <>
              <Label>Через</Label>
              <Select value={w.provider || configuredProvidersFor(w.channel)[0]?.id} onChange={(e) => setW({ ...w, provider: e.target.value })} className="w-full">
                {configuredProvidersFor(w.channel).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <div className="h-3" />
            </>
          )}
          {!w.cascade && (
            <>
              <Label>Шаблон <span className="text-bad">*</span></Label>
              {wTemplates.length === 0 ? (
                <p className="text-[12.5px] text-ink-faint m-0">
                  Нет шаблонов канала {channelLabel[w.channel]} — создайте в разделе «Шаблоны».
                </p>
              ) : (
                <SearchSelect
                  value={w.templateId}
                  onChange={(id) => setW({ ...w, templateId: id })}
                  options={wTemplates.map((t) => ({ value: t.id, label: t.name }))}
                  placeholder="Выберите шаблон"
                  className="w-full"
                />
              )}
              <div className="h-3" />
            </>
          )}
          <Label>Отправить через (0 = сразу)</Label>
          <div className="flex gap-2">
            <Input type="number" min={0} value={w.amount} onChange={(e) => setW({ ...w, amount: Number(e.target.value) })} className="w-20" />
            <Select value={w.unit} onChange={(e) => setW({ ...w, unit: Number(e.target.value) })} className="flex-1">
              <option value={1}>минут</option>
              <option value={60}>часов</option>
              <option value={1440}>дней</option>
            </Select>
          </div>
          <div className="h-3" />
          {wPushApplicable && (
            <>
              <Label>
                Платформы <span className="text-bad">*</span>
              </Label>
              <PlatformFilter value={w.platforms} onChange={(v) => setW({ ...w, platforms: v })} />
              <div className="h-3" />
            </>
          )}
          <Label>Сегмент по тегам</Label>
          <SegmentTagsInput value={w.segmentTags} onChange={(tags) => setW({ ...w, segmentTags: tags })} options={segmentOptions} />
          <div className="h-3" />
          <SendWindowFields value={w} onChange={(sw) => setW({ ...w, ...sw })} projectTimezone={projectTimezone} />
          {wUnsubscribeMissing && (
            <p className="text-[11px] text-bad mt-1 mb-0">
              В шаблоне нет ссылки отписки <code>{"{{ unsubscribe_url }}"}</code> — добавьте её в разделе «Шаблоны».
            </p>
          )}
          <div className="flex items-center gap-2 mt-4">
            <Button disabled={wUnsubscribeMissing || (w.cascade && !Object.keys(w.channelTemplates).length)}>Создать</Button>
            <Button type="button" variant="secondary" onClick={() => setPreviewCreate(true)} disabled={!wPreviewTemplate}>
              <IconEye size={15} stroke={1.8} />
              Превью
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowCreateWelcome(false)}>
              Отмена
            </Button>
          </div>
        </form>
        {previewCreate && wPreviewTemplate && (
          <MessagePreviewModal
            label={wPreviewTemplate.name}
            content={previewContentFor(wPreviewTemplate, wPreviewChannel)}
            sampleData={{ ...(wPreviewTemplate.context || {}), ...PREVIEW_SAMPLE }}
            onClose={() => setPreviewCreate(false)}
          />
        )}
      </Card>
      ) : (
        <Button variant="secondary" className="mt-3" onClick={() => setShowCreateWelcome(true)}>
          <IconPlus size={15} stroke={2} />
          Приветственная рассылка
        </Button>
      )}
        </>
      )}

      {tab === "event" && (
        <>
      {/* Event automations */}
      <h2 className="text-base font-semibold">Событийные рассылки</h2>
      <p className="text-ink-muted text-[13px]">
        Отправляется автоматически, когда происходит отслеживаемое событие и до истечения задержки не пришло «отменяющее».
      </p>

      {events.map((a) => {
        const tpl = templates.find((t) => t.id === a.template_id);
        const ch = (a.channel || "push") as Channel;

        if (editingEventId === a.id) {
          return (
            <Card key={a.id} className="mt-3">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold">Изменить событийную автоматизацию</div>
                <Toggle checked={a.is_enabled} onChange={() => toggleEnabled(a)} label={a.is_enabled ? "Вкл" : "Выкл"} />
              </div>
              <Label>Внутреннее название <span className="text-bad">*</span></Label>
              <Input value={eev.name} onChange={(e) => setEev({ ...eev, name: e.target.value })} placeholder="Для себя — получателям не видно" required />
              <div className="h-3" />
              <Toggle checked={eev.cascade} onChange={(v) => setEev({ ...eev, cascade: v })} label="Каскадная отправка" />
              <div className="h-3" />
              {eev.cascade ? (
                <CascadeChannelTemplates
                  value={eev.channelTemplates}
                  onChange={(v) => setEev({ ...eev, channelTemplates: v })}
                  templates={templates}
                  availableChannels={availableChannels}
                />
              ) : (
                <>
                  <Label>Канал</Label>
                  <Select value={eev.channel} onChange={(e) => setEev({ ...eev, channel: e.target.value as Channel, provider: "", templateId: "" })} className="w-full">
                    {availableChannels.map((c) => (
                      <option key={c} value={c}>
                        {channelLabel[c]}
                      </option>
                    ))}
                  </Select>
                </>
              )}
              <div className="h-3" />
              {!eev.cascade && configuredProvidersFor(eev.channel).length > 1 && (
                <>
                  <Label>Через</Label>
                  <Select value={eev.provider || configuredProvidersFor(eev.channel)[0]?.id} onChange={(e) => setEev({ ...eev, provider: e.target.value })} className="w-full">
                    {configuredProvidersFor(eev.channel).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <div className="h-3" />
                </>
              )}
              {!eev.cascade && (
                <>
                  <Label>Шаблон <span className="text-bad">*</span></Label>
                  {eevTemplates.length === 0 ? (
                    <p className="text-[12.5px] text-ink-faint m-0">
                      Нет шаблонов канала {channelLabel[eev.channel]} — создайте в разделе «Шаблоны».
                    </p>
                  ) : (
                    <SearchSelect
                      value={eev.templateId}
                      onChange={(id) => setEev({ ...eev, templateId: id })}
                      options={eevTemplates.map((t) => ({ value: t.id, label: t.name }))}
                      placeholder="Выберите шаблон"
                      className="w-full"
                    />
                  )}
                  <div className="h-3" />
                </>
              )}
              <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <Label>Когда произошло <span className="text-bad">*</span></Label>
                  <SearchSelect
                    allowCustom
                    value={eev.trigger}
                    onChange={(val) => setEev({ ...eev, trigger: val })}
                    options={EVENT_NAME_PRESETS}
                    placeholder="cart_updated"
                    emptyText="Впишите своё имя события"
                    className="w-full"
                  />
                </div>
                <div>
                  <Label>Подождать</Label>
                  <div className="flex gap-2">
                    <Input type="number" min={1} value={eev.amount} onChange={(e) => setEev({ ...eev, amount: Number(e.target.value) })} className="w-20" />
                    <Select value={eev.unit} onChange={(e) => setEev({ ...eev, unit: Number(e.target.value) })} className="flex-1">
                      <option value={1}>минут</option>
                      <option value={60}>часов</option>
                      <option value={1440}>дней</option>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="h-3" />
              <Label>Если НЕ произошло (через запятую)</Label>
              <Input value={eev.cancel} onChange={(e) => setEev({ ...eev, cancel: e.target.value })} placeholder="order_placed" />
              <div className="h-3" />
              <EventTrackingDocs />
              <div className="h-3" />
              {eevPushApplicable && (
                <>
                  <Label>
                    Платформы <span className="text-bad">*</span>
                  </Label>
                  <PlatformFilter value={eev.platforms} onChange={(v) => setEev({ ...eev, platforms: v })} />
                  <div className="h-3" />
                </>
              )}
              <Label>Сегмент по тегам</Label>
              <SegmentTagsInput value={eev.segmentTags} onChange={(tags) => setEev({ ...eev, segmentTags: tags })} options={segmentOptions} />
              <div className="h-3" />
              <SendWindowFields
                value={eev}
                onChange={(v) => setEev({ ...eev, ...v })}
                projectTimezone={projectTimezone}
              />
              {eevUnsubscribeMissing && (
                <p className="text-[11px] text-bad mt-1 mb-0">
                  В шаблоне нет ссылки отписки <code>{"{{ unsubscribe_url }}"}</code> — добавьте её в разделе «Шаблоны».
                </p>
              )}
              <div className="flex items-center gap-2 mt-4">
                <Button
                  disabled={busy || !eev.name.trim() || (eev.cascade ? !Object.keys(eev.channelTemplates).length : !eev.templateId) || eevUnsubscribeMissing}
                  onClick={() => saveEditEvent(a.id)}
                >
                  Сохранить
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPreviewEditEvent(true)} disabled={!eevPreviewTemplate}>
                  <IconEye size={15} stroke={1.8} />
                  Превью
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditingEventId(null)}>
                  Отмена
                </Button>
              </div>
              {previewEditEvent && eevPreviewTemplate && (
                <MessagePreviewModal
                  label={eevPreviewTemplate.name}
                  content={previewContentFor(eevPreviewTemplate, eevPreviewChannel)}
                  sampleData={{ ...(eevPreviewTemplate.context || {}), ...PREVIEW_SAMPLE }}
                  onClose={() => setPreviewEditEvent(false)}
                />
              )}
            </Card>
          );
        }

        return (
          <Card key={a.id} className="mt-3">
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-[13px]">
                  {a.cascade ? (
                    <Badge tone="accent">Каскад</Badge>
                  ) : (
                    <Badge tone="accent">{channelLabel[ch]}</Badge>
                  )}
                  {!!a.segment_tags?.length && <Badge tone="neutral">сегмент: {a.segment_tags.join(", ")}</Badge>}
                  {a.spacing_enabled && !!a.spacing_minutes && <Badge tone="neutral">защита {fmtDelay(a.spacing_minutes)}</Badge>}
                  {a.send_window_enabled && (
                    <Badge tone="neutral">
                      {fmtSendWindow(a.send_days, a.send_time_from, a.send_time_to)}
                      {a.send_window_subscriber_tz ? " (пояс подписчика)" : ""}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[13px] mt-1.5">
                  <Badge tone="accent">{a.config?.trigger_event || "—"}</Badge>
                  <IconArrowRight size={14} className="text-ink-faint" />
                  <span className="text-ink-muted">{fmtDelay(a.delay_minutes || 0)}</span>
                  <IconArrowRight size={14} className="text-ink-faint" />
                  <span className="text-ink-muted">если не: {(a.config?.cancel_events || []).join(", ") || "—"}</span>
                </div>
                <div className="font-semibold mt-2">{a.name || "Без названия"}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Toggle checked={a.is_enabled} onChange={() => toggleEnabled(a)} label={a.is_enabled ? "Вкл" : "Выкл"} />
                <Button variant="secondary" size="sm" onClick={() => startEditEvent(a)}>
                  <IconPencil size={14} stroke={1.8} />
                  Изменить
                </Button>
                <Button variant="secondary" size="sm" onClick={() => del(a.id, a.name || tpl?.name || "автоматизацию")}>
                  Удалить
                </Button>
              </div>
            </div>
          </Card>
        );
      })}

      {showCreateEvent ? (
      <Card className="mt-3">
        <form onSubmit={createEvent}>
          <div className="font-semibold mb-3">Новая событийная автоматизация</div>
          <Label>Внутреннее название <span className="text-bad">*</span></Label>
          <Input value={ev.name} onChange={(e) => setEv({ ...ev, name: e.target.value })} placeholder="Для себя — получателям не видно" required />
          <div className="h-3" />
          <Toggle checked={ev.cascade} onChange={(v) => setEv({ ...ev, cascade: v })} label="Каскадная отправка" />
          <div className="h-3" />
          {ev.cascade ? (
            <CascadeChannelTemplates
              value={ev.channelTemplates}
              onChange={(v) => setEv({ ...ev, channelTemplates: v })}
              templates={templates}
              availableChannels={availableChannels}
            />
          ) : (
            <>
              <Label>Канал</Label>
              <Select value={ev.channel} onChange={(e) => setEv({ ...ev, channel: e.target.value as Channel, provider: "", templateId: "" })} className="w-full">
                {availableChannels.map((c) => (
                  <option key={c} value={c}>
                    {channelLabel[c]}
                  </option>
                ))}
              </Select>
            </>
          )}
          <div className="h-3" />
          {!ev.cascade && configuredProvidersFor(ev.channel).length > 1 && (
            <>
              <Label>Через</Label>
              <Select value={ev.provider || configuredProvidersFor(ev.channel)[0]?.id} onChange={(e) => setEv({ ...ev, provider: e.target.value })} className="w-full">
                {configuredProvidersFor(ev.channel).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <div className="h-3" />
            </>
          )}
          {!ev.cascade && (
            <>
              <Label>Шаблон <span className="text-bad">*</span></Label>
              {eventTemplates.length === 0 ? (
                <p className="text-[12.5px] text-ink-faint m-0">
                  Нет шаблонов канала {channelLabel[ev.channel]} — создайте в разделе «Шаблоны».
                </p>
              ) : (
                <SearchSelect
                  value={ev.templateId}
                  onChange={(id) => setEv({ ...ev, templateId: id })}
                  options={eventTemplates.map((t) => ({ value: t.id, label: t.name }))}
                  placeholder="Выберите шаблон"
                  className="w-full"
                />
              )}
              <div className="h-3" />
            </>
          )}
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <Label>Когда произошло <span className="text-bad">*</span></Label>
              <SearchSelect
                allowCustom
                value={ev.trigger}
                onChange={(val) => setEv({ ...ev, trigger: val })}
                options={EVENT_NAME_PRESETS}
                placeholder="cart_updated"
                emptyText="Впишите своё имя события"
                className="w-full"
              />
            </div>
            <div>
              <Label>Подождать</Label>
              <div className="flex gap-2">
                <Input type="number" min={1} value={ev.amount} onChange={(e) => setEv({ ...ev, amount: Number(e.target.value) })} className="w-20" />
                <Select value={ev.unit} onChange={(e) => setEv({ ...ev, unit: Number(e.target.value) })} className="flex-1">
                  <option value={1}>минут</option>
                  <option value={60}>часов</option>
                  <option value={1440}>дней</option>
                </Select>
              </div>
            </div>
          </div>
          <div className="h-3" />
          <Label>Если НЕ произошло (через запятую)</Label>
          <Input value={ev.cancel} onChange={(e) => setEv({ ...ev, cancel: e.target.value })} placeholder="order_placed" />
          <div className="h-3" />
          <EventTrackingDocs />
          <div className="h-3" />
          {evPushApplicable && (
            <>
              <Label>
                Платформы <span className="text-bad">*</span>
              </Label>
              <PlatformFilter value={ev.platforms} onChange={(v) => setEv({ ...ev, platforms: v })} />
              <div className="h-3" />
            </>
          )}
          <Label>Сегмент по тегам</Label>
          <SegmentTagsInput value={ev.segmentTags} onChange={(tags) => setEv({ ...ev, segmentTags: tags })} options={segmentOptions} />
          <div className="h-3" />
          <SendWindowFields value={ev} onChange={(v) => setEv({ ...ev, ...v })} projectTimezone={projectTimezone} />
          {evUnsubscribeMissing && (
            <p className="text-[11px] text-bad mt-1 mb-0">
              В шаблоне нет ссылки отписки <code>{"{{ unsubscribe_url }}"}</code> — добавьте её в разделе «Шаблоны».
            </p>
          )}
          <div className="flex items-center gap-2 mt-4">
            <Button disabled={evUnsubscribeMissing || (ev.cascade && !Object.keys(ev.channelTemplates).length)}>Создать</Button>
            <Button type="button" variant="secondary" onClick={() => setPreviewEvent(true)} disabled={!evPreviewTemplate}>
              <IconEye size={15} stroke={1.8} />
              Превью
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowCreateEvent(false)}>
              Отмена
            </Button>
          </div>
        </form>
        {previewEvent && evPreviewTemplate && (
          <MessagePreviewModal
            label={evPreviewTemplate.name}
            content={previewContentFor(evPreviewTemplate, evPreviewChannel)}
            sampleData={{ ...(evPreviewTemplate.context || {}), ...PREVIEW_SAMPLE }}
            onClose={() => setPreviewEvent(false)}
          />
        )}
      </Card>
      ) : (
        <Button variant="secondary" className="mt-3" onClick={() => setShowCreateEvent(true)}>
          <IconPlus size={15} stroke={2} />
          Событийная рассылка
        </Button>
      )}
        </>
      )}

      {tab === "custom" && (
        <>
      {/* Webhook triggers — транзакционные / по списку товара / рассылочные */}
      <h2 className="text-base font-semibold">Триггерные рассылки</h2>
      <p className="text-ink-muted text-[13px]">
        Отправляется автоматически по вызову вебхука/API с ключом автоматизации — тело вебхука доступно в шаблоне как Liquid{" "}
        <code className="font-mono">{"{{ путь }}"}</code>.
      </p>

      {custom.map((a) => {
        const modeLabel = a.config?.list_fanout ? "по списку товара" : a.config?.transactional ? "одному контакту" : "сегмент/все";

        if (editingCustomId === a.id) {
          return (
            <Card key={a.id} className="mt-3">
              <div className="font-semibold mb-3">Изменить триггерную автоматизацию</div>
              {renderCustomFields(cust, setCust)}
              {custUnsubscribeMissing && (
                <p className="text-[11px] text-bad mt-1 mb-0">
                  В шаблоне нет ссылки отписки <code>{"{{ unsubscribe_url }}"}</code> — добавьте её в разделе «Шаблоны».
                </p>
              )}
              <div className="flex items-center gap-2 mt-4">
                <Button disabled={busy} onClick={() => saveEditCustom(a.id)}>Сохранить</Button>
                <Button type="button" variant="secondary" onClick={() => setEditingCustomId(null)}>Отмена</Button>
              </div>
            </Card>
          );
        }

        return (
          <Card key={a.id} className="mt-3">
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="accent">{a.config?.key || "—"}</Badge>
                  <Badge tone="neutral">{modeLabel}</Badge>
                  {a.cascade && <Badge tone="accent">Каскад</Badge>}
                  {!a.cascade && (a.template_id || a.channel) && <Badge tone="accent">{channelLabel[(a.channel || "push") as Channel]}</Badge>}
                  {a.spacing_enabled && !!a.spacing_minutes && <Badge tone="neutral">защита {fmtDelay(a.spacing_minutes)}</Badge>}
                  {a.send_window_enabled && <Badge tone="neutral">{fmtSendWindow(a.send_days, a.send_time_from, a.send_time_to)}</Badge>}
                </div>
                <div className="font-semibold mt-1.5">{a.title || (a.cascade ? "Каскад по шаблонам" : templates.find((t) => t.id === a.template_id)?.name || "Без названия")}</div>
                {a.body && <div className="text-ink-muted text-[13px]">{a.body}</div>}
                <div className="text-ink-faint text-[12px] mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  {!!a.config?.status_checks?.length && (
                    <span>
                      условия:{" "}
                      {a.config.status_checks
                        .map((c) => `${c.field}${{ contains: "⊇", eq: "=", gt: ">", lt: "<" }[c.op || "contains"]}${c.value}`)
                        .join(" И ")}
                    </span>
                  )}
                  {!a.config?.status_checks?.length && a.config?.status_field && (
                    <span>статус: {a.config.status_field}={a.config.status_value}</span>
                  )}
                  {a.config?.phone_path && <span>телефон: {a.config.phone_path}</span>}
                  {a.config?.order_id_path && <span>дедуп: {a.config.order_id_path}</span>}
                  {a.config?.segment_path && <span>сегмент: {a.config.segment_path}</span>}
                  {a.config?.list_fanout && <span>товар: {a.config.product_id_path} · список: {a.config.list_type}</span>}
                  {a.config?.track_field_path && (
                    <span>
                      следим: {a.config.track_field_path} (
                      {{ changed: "изменилось", increased: "выросло", decreased: "снизилось" }[a.config.track_mode || "changed"]})
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="secondary" size="sm" onClick={() => startEditCustom(a)}>
                  <IconPencil size={14} stroke={1.8} />
                  Изменить
                </Button>
                <Button variant="secondary" size="sm" onClick={() => del(a.id, a.title || "автоматизацию")}>Удалить</Button>
              </div>
            </div>
          </Card>
        );
      })}

      {showCreateCustom ? (
        <Card className="mt-3">
          <form onSubmit={createCustom}>
            <div className="font-semibold mb-3">Новый вебхук-триггер</div>
            {renderCustomFields(neu, setNeu)}
            {neuUnsubscribeMissing && (
              <p className="text-[11px] text-bad mt-1 mb-0">
                В шаблоне нет ссылки отписки <code>{"{{ unsubscribe_url }}"}</code> — добавьте её в разделе «Шаблоны».
              </p>
            )}
            <div className="flex items-center gap-2 mt-4">
              <Button disabled={busy}>Создать</Button>
              <Button type="button" variant="secondary" onClick={() => setShowCreateCustom(false)}>Отмена</Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button variant="secondary" className="mt-3" onClick={() => setShowCreateCustom(true)}>
          <IconPlus size={15} stroke={2} />
          Триггерная рассылка
        </Button>
      )}
        </>
      )}
    </div>
  );
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABEL: Record<number, string> = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 0: "Вс" };

// "Пн-Пт 9:00–21:00" / "Вс 9:00–21:00" (дни не подряд перечисляются через
// запятую) — компактная сводка окна отправки для бейджа на карточке.
function fmtSendWindow(days: number[] | null | undefined, from: string | null | undefined, to: string | null | undefined): string {
  const dayPart = (() => {
    if (!days?.length) return "";
    const ordered = DAY_ORDER.filter((d) => days.includes(d));
    if (ordered.length === 7) return "";
    const isRange = ordered.length > 1 && ordered.every((d, i) => i === 0 || DAY_ORDER[DAY_ORDER.indexOf(ordered[i - 1]) + 1] === d);
    if (isRange && ordered.length > 2) return `${DAY_LABEL[ordered[0]]}-${DAY_LABEL[ordered[ordered.length - 1]]} `;
    return `${ordered.map((d) => DAY_LABEL[d]).join(",")} `;
  })();
  const timePart = from && to ? `${from.slice(0, 5)}-${to.slice(0, 5)}` : "";
  return `${dayPart}${timePart}`.trim();
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-md text-[13px] font-medium cursor-pointer transition-colors",
        active ? "bg-accent-tint text-accent" : "text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

// Каскадная отправка — вместо одного канала+шаблона выбор шаблона под КАЖДЫЙ
// канал в одной карточке; реальный канал резолвится в момент отправки по
// общему «Приоритету каналов» (см. resolveCascadeChannel в lib/sender.ts) —
// так волна физически не может уйти дважды по разным каналам.
function CascadeChannelTemplates({
  value,
  onChange,
  templates,
  availableChannels,
}: {
  value: Partial<Record<Channel, string>>;
  onChange: (v: Partial<Record<Channel, string>>) => void;
  templates: Template[];
  availableChannels: Channel[];
}) {
  return (
    <div className="flex flex-col gap-2">
      {availableChannels.map((ch) => {
        const chTemplates = templates.filter((t) => t.channel === ch);
        return (
          <div key={ch}>
            <Label>{channelLabel[ch]}</Label>
            {chTemplates.length === 0 ? (
              <p className="text-[12px] text-ink-faint m-0">Нет шаблонов канала {channelLabel[ch]}.</p>
            ) : (
              <SearchSelect
                value={value[ch] || ""}
                onChange={(id) => onChange({ ...value, [ch]: id || undefined })}
                options={[{ value: "", label: "Не использовать" }, ...chTemplates.map((t) => ({ value: t.id, label: t.name }))]}
                placeholder="Не использовать"
                className="w-full"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function fmtDelay(mins: number): string {
  if (mins % 1440 === 0 && mins >= 1440) return `${mins / 1440} дн`;
  if (mins % 60 === 0 && mins >= 60) return `${mins / 60} ч`;
  return `${mins} мин`;
}

// Раскладывает минуты на [число, множитель] для пары полей "число + единица"
// (минут/часов/дней) — используется и для задержки, и для окна наложения.
function minutesToAmountUnit(mins: number): [number, number] {
  if (mins > 0 && mins % 1440 === 0) return [mins / 1440, 1440];
  if (mins > 0 && mins % 60 === 0) return [mins / 60, 60];
  return [mins, 1];
}
