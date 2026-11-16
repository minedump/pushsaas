"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh, IconGripVertical } from "@tabler/icons-react";
import { Button, Card, ColorField, CustomSelect, Input, Label, Toggle, useDialogs } from "@/app/ui";
import CopyBox from "../CopyBox";
import { SMS_PROVIDERS, TELEGRAM_PROVIDERS, EMAIL_PROVIDERS } from "@/lib/otp/providers";
import { DEFAULT_LOGIN_STYLE, LOGIN_SIZES, LOGIN_RADIUS_VALUES, type LoginStyleConfig, type LoginSize } from "@/lib/login-style";
import type { CornerRadius } from "@/lib/widget-config";
import LoginStylePreview from "./LoginStylePreview";

type ChannelKey = "push" | "email" | "telegram" | "sms";
const DEFAULT_ORDER: ChannelKey[] = ["push", "email", "telegram", "sms"];
const CHANNEL_TITLE: Record<ChannelKey, string> = { push: "Push", email: "Email", telegram: "Telegram", sms: "SMS" };
const BUTTON_SIZES = ["s", "m", "l", "xl"] as const;

const LOGIN_SIZE_LABEL: Record<LoginSize, string> = { s: "Маленький", m: "Средний", l: "Большой" };
const LOGIN_RADIUS_LABEL: Record<CornerRadius, string> = {
  none: "Без закругления",
  sm: "Маленькое закругление",
  md: "Среднее закругление",
  lg: "Большое закругление",
};
const LOGIN_BG_COLOR_PRESETS = ["#2c4a66", "#111827", "#2563eb", "#7c3aed", "#16a34a", "#ea580c", "#dc2626", "#0d9488"];
const LOGIN_TEXT_COLOR_PRESETS = ["#ffffff", "#0a0a0a", "#f5f5f5", "#374151"];

// На каждый канал может появляться больше одного провайдера (см.
// lib/otp/providers.ts) — растущий список, не меняем структуру страницы,
// когда добавляется следующая интеграция.
const PROVIDER_OPTIONS: Partial<Record<ChannelKey, { id: string; label: string }[]>> = {
  telegram: TELEGRAM_PROVIDERS,
  sms: SMS_PROVIDERS,
  email: EMAIL_PROVIDERS,
};

type Providers = Partial<Record<ChannelKey, string>>;
type OtpTemplates = Partial<Record<"push" | "sms" | "email", string | null>>;
type Template = { id: string; name: string; channel: "push" | "sms" | "email" };

type Initial = {
  clientId: string;
  // токен приложения виден всегда; null — у приложения, созданного до появления открытого хранения (нужно выпустить заново)
  clientSecret: string | null;
  isEnabled: boolean;
  channels: Record<ChannelKey, boolean | undefined>;
  channelOrder: ChannelKey[];
  providers: Providers;
  otpTemplates: OtpTemplates;
  authButtonColor: string;
  authButtonSize: string;
  authFailedUrl: string;
  loginStyle: LoginStyleConfig;
  hasTelegram: boolean;
  hasBytehand: boolean;
  hasHaskimail: boolean;
  hasSmsc: boolean;
  hasMts: boolean;
  hasEmailFrom: boolean;
};

// POST в API настроек. При сбое сети fetch бросает исключение — без перехвата тумблер
// оставался бы в новом положении, а кнопка «занята»; здесь сбой превращается в обычный
// ответ с ошибкой, и вызывающий код откатывает изменение и показывает сообщение.
async function apiPost(url: string, payload: unknown): Promise<Response> {
  try {
    return await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    return new Response(JSON.stringify({ error: "Нет соединения. Изменения не сохранены, попробуйте ещё раз." }), { status: 503 });
  }
}

export default function AuthSettings({
  projectId,
  projectDomain,
  logoUrl,
  issuer,
  templates,
  initial,
}: {
  projectId: string;
  projectDomain: string | null;
  logoUrl: string | null;
  issuer: string;
  templates: Template[];
  initial: Initial | null;
}) {
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [otpTemplates, setOtpTemplates] = useState<OtpTemplates>(initial?.otpTemplates || {});
  const [isEnabled, setIsEnabled] = useState(initial?.isEnabled ?? false);
  const [channels, setChannels] = useState(initial?.channels || { push: false, email: false, telegram: false, sms: false });
  const [order, setOrder] = useState<ChannelKey[]>(() => {
    const saved = initial?.channelOrder?.filter((c): c is ChannelKey => DEFAULT_ORDER.includes(c)) ?? [];
    const missing = DEFAULT_ORDER.filter((c) => !saved.includes(c));
    return [...saved, ...missing];
  });
  const [authButtonColor, setAuthButtonColor] = useState(initial?.authButtonColor || "");
  const [authButtonSize, setAuthButtonSize] = useState(initial?.authButtonSize || "");
  const [authFailedUrl, setAuthFailedUrl] = useState(initial?.authFailedUrl || "");
  const [loginStyle, setLoginStyle] = useState<LoginStyleConfig>(initial?.loginStyle || DEFAULT_LOGIN_STYLE);
  const [busyLoginStyle, setBusyLoginStyle] = useState(false);
  const [providers, setProviders] = useState<Providers>(initial?.providers || {});

  // Настроен ли конкретный провайдер (не канал) — ключи/токены теперь только
  // на странице «Подключения», здесь только читаем серверную истину.
  const providerConfigured: Record<string, boolean> = {
    telegram_gateway: initial?.hasTelegram ?? false,
    bytehand: initial?.hasBytehand ?? false,
    haskimail: initial?.hasHaskimail ?? false,
    smsc: initial?.hasSmsc ?? false,
    mts: initial?.hasMts ?? false,
  };

  // Только настроенные провайдеры канала — не показываем то, что нельзя
  // выбрать (нечем воспользоваться без ключа).
  function configuredOptionsFor(key: ChannelKey): { id: string; label: string }[] {
    return (PROVIDER_OPTIONS[key] || []).filter((o) => providerConfigured[o.id]);
  }

  // Сохранённый выбор, только если он всё ещё настроен — иначе первый
  // настроенный, иначе undefined (нет ни одной готовой интеграции на канал).
  function resolvedProvider(key: ChannelKey): string | undefined {
    const opts = configuredOptionsFor(key);
    const saved = providers[key];
    if (saved && opts.some((o) => o.id === saved)) return saved;
    return opts[0]?.id;
  }

  const hasSecret: Record<ChannelKey, boolean> = {
    push: true,
    email: !!resolvedProvider("email"),
    telegram: !!resolvedProvider("telegram"),
    sms: !!resolvedProvider("sms"),
  };

  // Готовность канала к включению — ключи/токены провайдеров теперь
  // настраиваются на отдельной странице «Подключения», так что здесь можно
  // смотреть только на серверную истину (hasSecret/hasEmailFrom), без учёта
  // «введено прямо сейчас, но не сохранено» — этой возможности здесь больше
  // нет физически.
  function channelReadiness(key: ChannelKey): { ok: boolean; message?: string } {
    if (key === "push") return { ok: true };
    if (key === "email" && !initial?.hasEmailFrom) {
      return { ok: false, message: "Сначала укажите email-отправителя (From) в разделе «Подключения»" };
    }
    if (!hasSecret[key]) {
      return { ok: false, message: "Сначала настройте интеграцию в разделе «Подключения»" };
    }
    return { ok: true };
  }

  // Общая точка сохранения каскада — тумблер канала, выбор провайдера и
  // порядок (drag) применяются сразу, без отдельной кнопки «Сохранить».
  // Каждый вызывающий сам решает, что из channels/order/providers у него
  // уже новое, остальное берёт текущим — сервер всё равно принимает только
  // то, что реально изменилось (см. /api/admin/oidc/settings).
  async function persistCascade(next: { channels?: typeof channels; order?: ChannelKey[]; providers?: Providers; otpTemplates?: OtpTemplates }) {
    setBusy(true);
    const res = await apiPost("/api/admin/oidc/settings", {
        projectId,
        channels: next.channels ?? channels,
        channelOrder: next.order ?? order,
        providers: next.providers ?? providers,
        otpTemplates: next.otpTemplates,
      });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast(json.error || "Ошибка", "bad");
      return false;
    }
    router.refresh();
    return true;
  }

  async function handleChannelToggle(key: ChannelKey, v: boolean) {
    if (v) {
      const r = channelReadiness(key);
      if (!r.ok) {
        toast(r.message || "Канал ещё не настроен", "bad");
        return;
      }
    }
    const prev = channels;
    const next = { ...channels, [key]: v };
    setChannels(next);
    const ok = await persistCascade({ channels: next });
    if (!ok) {
      setChannels(prev);
      return;
    }
    toast(v ? "Канал включён" : "Канал выключен", v ? "good" : "warn");
  }

  async function handleProviderChange(key: ChannelKey, providerId: string) {
    const prev = providers;
    const next = { ...providers, [key]: providerId };
    setProviders(next);
    const ok = await persistCascade({ providers: next });
    if (!ok) {
      setProviders(prev);
      return;
    }
    toast("Провайдер обновлён", "good");
  }

  // Push сам по себе никого не онбордит — работает только на уже узнанных
  // устройствах (см. tryRecognizeDevice), поэтому не считается «настроенным
  // каналом» для целей этой проверки. Нужен хотя бы один канал с кодом,
  // реально включённый И готовый (ключ уже сохранён или введён прямо сейчас).
  function loginReadiness(): { ok: boolean; message?: string } {
    const ready = (["email", "telegram", "sms"] as ChannelKey[]).some((ch) => channels[ch] === true && channelReadiness(ch).ok);
    if (!ready) {
      return {
        ok: false,
        message: "Сначала настройте и включите хотя бы один канал с кодом (Email, Telegram или SMS) — push один не подойдёт, он работает только для уже узнанных устройств.",
      };
    }
    return { ok: true };
  }

  async function saveEnabled(next: boolean) {
    if (next) {
      const r = loginReadiness();
      if (!r.ok) {
        toast(r.message || "Сначала настройте канал", "bad");
        return;
      }
    }
    setIsEnabled(next);
    setBusy(true);
    const res = await apiPost("/api/admin/oidc/settings", { projectId, isEnabled: next });
    setBusy(false);
    if (!res.ok) {
      setIsEnabled(!next);
      const j = await res.json().catch(() => ({}));
      toast(j.error || "Ошибка", "bad");
      return;
    }
    toast(next ? "Вход включён" : "Вход выключен", next ? "good" : "warn");
    router.refresh();
  }

  async function setup(regenerate = false) {
    if (regenerate && initial?.clientSecret) {
      const ok = await confirm({
        title: "Перевыпустить токен?",
        message: "Старый токен перестанет работать — его нужно будет заменить в настройках InSales.",
        confirmText: "Перевыпустить",
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    const res = await apiPost("/api/admin/oidc/setup", { projectId, regenerate });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return toast(json.error || "Ошибка", "bad");
    toast(regenerate ? "Токен перевыпущен" : "Токен выпущен", "good");
    router.refresh();
  }

  // Блок «Параметры входа»: шаблоны кода и страница возврата при неудачном входе, статус входа переключается сразу рычагом.
  // Без домена проекта адрес не отправляем: поле заблокировано, а сервер такой адрес не примет.
  async function saveSettingsForm() {
    setBusy(true);
    const res = await apiPost("/api/admin/oidc/settings", { projectId, otpTemplates, ...(projectDomain ? { authFailedUrl } : {}) });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error || "Ошибка", "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  // Блок «Кнопка входа»: только цвет и размер
  async function saveButtonAppearance() {
    setBusy(true);
    const res = await apiPost("/api/admin/oidc/settings", { projectId, authButtonColor, authButtonSize });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error || "Ошибка", "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  async function saveLoginStyle() {
    setBusyLoginStyle(true);
    const res = await apiPost("/api/admin/oidc/settings", { projectId, loginStyle });
    setBusyLoginStyle(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error || "Ошибка", "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  // Перетаскивание каналов: pointer events (мышь + тач), захват указателя на
  // «ручке». Без плавающего элемента — строка перескакивает в слот, когда
  // указатель пересекает середину соседней строки. Стабильно и без библиотек.
  const [dragKey, setDragKey] = useState<ChannelKey | null>(null);
  const rowRefs = useRef<Partial<Record<ChannelKey, HTMLDivElement | null>>>({});
  const orderBeforeDrag = useRef<ChannelKey[] | null>(null);

  const orderRef = useRef(order);
  orderRef.current = order;
  const dragCleanup = useRef<(() => void) | null>(null);

  // Слушаем движение и отпускание на window, а не на «ручке» с захватом указателя: когда строка
  // меняется местами с соседней, React переставляет её в DOM, и браузер снимает захват —
  // перетаскивание обрывалось на полпути (порядок на экране менялся, а сохранения не происходило).
  function dragStart(e: React.PointerEvent, key: ChannelKey) {
    e.preventDefault();
    dragCleanup.current?.();
    orderBeforeDrag.current = order;
    setDragKey(key);
    const move = (ev: PointerEvent) => dragMoveTo(key, ev.clientY);
    const up = () => {
      dragCleanup.current?.();
      void dragEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    dragCleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragCleanup.current = null;
    };
  }

  useEffect(() => () => dragCleanup.current?.(), []);

  function dragMoveTo(key: ChannelKey, y: number) {
    setOrder((o) => {
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
    // даём React применить последнее перемещение, прежде чем читать итоговый порядок
    await new Promise((r) => setTimeout(r, 0));
    const finalOrder = orderRef.current;
    const before = orderBeforeDrag.current;
    orderBeforeDrag.current = null;
    if (!before || before.join() === finalOrder.join()) return; // порядок не менялся — нечего сохранять
    const ok = await persistCascade({ order: finalOrder });
    if (!ok) {
      setOrder(before);
      return;
    }
    toast("Порядок сохранён", "good");
  }

  if (!initial) return null;

  const labelCls = "text-[13px] text-ink-muted block mb-1";
  const hintCls = "text-[12.5px] text-ink-faint mt-1.5 mb-0";

  return (
    <div className={busy ? "opacity-60" : ""}>
      <section className="mt-4 sm:mt-8">
        <h2 className="text-lg font-semibold mb-3">Приложение для авторизации</h2>

        <Card>
          <div className="text-base font-semibold mb-1">Данные приложения</div>
          <p className="text-[13px] text-ink-muted mt-0 mb-3">
            Добавьте их в InSales: Магазин → Настройки → Авторизация покупателя → «Авторизация через OpenID Connect» → добавить
            приложение.
          </p>
          <div className="flex flex-col gap-3">
            <div>
              <div className={labelCls}>Имя приложения</div>
              <CopyBox text="Авторизоваться" />
            </div>
            <div>
              <div className={labelCls}>ID приложения</div>
              <CopyBox text={initial.clientId} />
            </div>
            <div>
              <div className={labelCls}>API токен приложения</div>
              {initial.clientSecret ? (
                <CopyBox text={initial.clientSecret} />
              ) : (
                <p className="text-[13px] text-ink-muted mt-1 mb-0">
                  Токен не выпущен или выпущен до этого обновления и не может быть показан. Нажмите «Выпустить токен».
                </p>
              )}
            </div>
            <div>
              <div className={labelCls}>Issuer</div>
              <CopyBox text={issuer.replace(/^https:\/\//, "")} />
            </div>
            <div>
              <Button size="md" disabled={busy} onClick={() => setup(!!initial.clientSecret)}>
                <IconRefresh size={16} stroke={1.8} />
                {initial.clientSecret ? "Перевыпустить токен" : "Выпустить токен"}
              </Button>
            </div>
          </div>
        </Card>
      </section>

      <h2 className="text-base font-semibold mt-4 sm:mt-8">Каскад отправки кода</h2>
      <div className="mt-3 flex flex-col gap-1.5">
        {order.map((key) => (
          <ChannelRow
            key={key}
            label={CHANNEL_TITLE[key]}
            on={channels[key] === true}
            locked={key !== "push" && !channels[key] && !hasSecret[key]}
            onChange={(v) => handleChannelToggle(key, v)}
            dragging={dragKey === key}
            rowRef={(el) => (rowRefs.current[key] = el)}
            onDragStart={(e) => dragStart(e, key)}
            providerOptions={configuredOptionsFor(key)}
            provider={resolvedProvider(key)}
            onProviderChange={(p) => handleProviderChange(key, p)}
          />
        ))}
      </div>


      <section className="mt-4 sm:mt-8">
        <h2 className="text-lg font-semibold mb-3">Настройки входа</h2>

        <Card>
          <div className="text-base font-semibold mb-3">Параметры входа</div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] text-ink-muted">Статус входа</div>
              <Toggle checked={isEnabled} onChange={saveEnabled} disabled={busy} label={isEnabled ? "Вкл" : "Выкл"} />
            </div>

            {(["push", "sms", "email"] as const).map((key) => (
              <div key={key}>
                <div className={labelCls}>Шаблон кода: {CHANNEL_TITLE[key]}</div>
                <CustomSelect
                  value={otpTemplates[key] || ""}
                  onChange={(v) => setOtpTemplates({ ...otpTemplates, [key]: v || null })}
                  options={[
                    { value: "", label: "— простой текст —" },
                    ...templates.filter((t) => t.channel === key).map((t) => ({ value: t.id, label: t.name })),
                  ]}
                  ariaLabel={`Шаблон кода входа — ${CHANNEL_TITLE[key]}`}
                  className="w-full"
                />
              </div>
            ))}
            <div>
              <Label htmlFor="auth-failed-url">Страница при неудачном входе</Label>
              <Input
                id="auth-failed-url"
                type="url"
                inputMode="url"
                value={authFailedUrl}
                onChange={(e) => setAuthFailedUrl(e.target.value)}
                placeholder={projectDomain ? "https://site.ru/page/login" : "Укажите домен сайта в настройках проекта"}
                disabled={!projectDomain}
                className="w-full"
              />
              <p className={hintCls}>Страница вашего сайта. Пусто: стандартная страница входа магазина.</p>
            </div>
            <div>
              <Button size="md" disabled={busy} onClick={saveSettingsForm}>
                Сохранить
              </Button>
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-4 sm:mt-8">
        <h2 className="text-lg font-semibold mb-3">Кнопка входа</h2>

        <Card>
          <div className="text-base font-semibold mb-3">Внешний вид кнопки</div>
          <div className="flex flex-col gap-3">
            <div>
              <div className={labelCls}>Цвет кнопки</div>
              <ColorField value={authButtonColor} onChange={setAuthButtonColor} />
            </div>
            <div>
              <div className={labelCls}>Размер</div>
              <CustomSelect
                value={authButtonSize || "m"}
                onChange={setAuthButtonSize}
                options={BUTTON_SIZES.map((s) => ({ value: s, label: s.toUpperCase() }))}
                className="w-full"
              />
            </div>
            <div>
              <Button size="md" disabled={busy} onClick={saveButtonAppearance}>
                Сохранить
              </Button>
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-4 sm:mt-8">
        <h2 className="text-lg font-semibold mb-1">Оформление страницы входа</h2>
        <p className="text-[13px] text-ink-muted mt-0 mb-3">Внешний вид кнопки и поля ввода на странице входа (телефон, почта, код).</p>

        <div className="flex flex-col gap-4">
          <Card className={busyLoginStyle ? "opacity-60" : ""}>
            <div className="text-base font-semibold mb-3">Внешний вид</div>
            <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Размер кнопки</Label>
              <CustomSelect
                value={loginStyle.buttonSize}
                onChange={(v) => setLoginStyle({ ...loginStyle, buttonSize: v as LoginSize })}
                options={LOGIN_SIZES.map((s) => ({ value: s, label: LOGIN_SIZE_LABEL[s] }))}
                className="w-full"
              />
            </div>
            <div>
              <Label>Размер поля ввода</Label>
              <CustomSelect
                value={loginStyle.inputSize}
                onChange={(v) => setLoginStyle({ ...loginStyle, inputSize: v as LoginSize })}
                options={LOGIN_SIZES.map((s) => ({ value: s, label: LOGIN_SIZE_LABEL[s] }))}
                className="w-full"
              />
            </div>
          </div>
          <div>
            <Label>Скругление (кнопка и поле ввода)</Label>
            <CustomSelect
              value={loginStyle.borderRadius}
              onChange={(v) => setLoginStyle({ ...loginStyle, borderRadius: v as CornerRadius })}
              options={LOGIN_RADIUS_VALUES.map((r) => ({ value: r, label: LOGIN_RADIUS_LABEL[r] }))}
              className="w-full"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Цвет фона кнопки</Label>
              <ColorField
                value={loginStyle.buttonColor}
                onChange={(v) => setLoginStyle({ ...loginStyle, buttonColor: v })}
                presets={LOGIN_BG_COLOR_PRESETS}
              />
            </div>
            <div>
              <Label>Цвет текста кнопки</Label>
              <ColorField
                value={loginStyle.buttonTextColor}
                onChange={(v) => setLoginStyle({ ...loginStyle, buttonTextColor: v })}
                presets={LOGIN_TEXT_COLOR_PRESETS}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Цвет основного текста</Label>
              <ColorField
                value={loginStyle.textColor}
                onChange={(v) => setLoginStyle({ ...loginStyle, textColor: v })}
                presets={LOGIN_TEXT_COLOR_PRESETS}
              />
            </div>
            <div>
              <Label>Размер логотипа</Label>
              <CustomSelect
                value={loginStyle.logoSize}
                onChange={(v) => setLoginStyle({ ...loginStyle, logoSize: v as LoginSize })}
                options={LOGIN_SIZES.map((s) => ({ value: s, label: LOGIN_SIZE_LABEL[s] }))}
                className="w-full"
              />
            </div>
          </div>


              <div>
                <Button size="md" disabled={busyLoginStyle} onClick={saveLoginStyle}>
                  Сохранить оформление
                </Button>
              </div>
            </div>
          </Card>

          <LoginStylePreview config={loginStyle} logoUrl={logoUrl} />
        </div>
      </section>

      {!projectDomain && (
        <Card className="mt-4 sm:mt-8 border-warn bg-warn-tint">
          <p className="text-[13px] m-0">
            У проекта не указан домен сайта — привязка устройств к телефону (бесплатные push-коды) не будет работать,
            коды пойдут через Telegram/SMS. Укажите домен в настройках проекта.
          </p>
        </Card>
      )}
    </div>
  );
}

function ChannelRow({
  label,
  on,
  locked,
  onChange,
  dragging,
  rowRef,
  onDragStart,
  providerOptions,
  provider,
  onProviderChange,
}: {
  label: string;
  on: boolean;
  locked: boolean;
  onChange: (v: boolean) => void;
  dragging: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  onDragStart: (e: React.PointerEvent) => void;
  providerOptions?: { id: string; label: string }[];
  provider?: string;
  onProviderChange?: (id: string) => void;
}) {
  return (
    <div
      ref={rowRef}
      className={`flex items-center justify-between gap-3 min-h-[52px] py-1.5 px-3 rounded-lg border transition-colors ${
        dragging ? "bg-surface-2 shadow-sm select-none border-border-strong" : "border-border"
      }`}
    >
      <div
        onPointerDown={onDragStart}
        style={{ touchAction: "none" }}
        className={`p-1 -m-1 text-ink-faint hover:text-ink ${dragging ? "cursor-grabbing text-ink" : "cursor-grab"}`}
        aria-label="Перетащить для изменения приоритета"
        role="button"
      >
        <IconGripVertical size={16} stroke={1.8} />
      </div>
      <div className="flex-1 text-[13.5px]">{label}</div>
      {providerOptions && providerOptions.length > 0 && (
        <CustomSelect
          value={provider || ""}
          onChange={(v) => onProviderChange?.(v)}
          options={providerOptions.map((p) => ({ value: p.id, label: p.label }))}
          className="w-40 shrink-0"
        />
      )}
      <Toggle checked={on} onChange={onChange} disabled={locked} label={on ? "Вкл" : "Выкл"} />
    </div>
  );
}
