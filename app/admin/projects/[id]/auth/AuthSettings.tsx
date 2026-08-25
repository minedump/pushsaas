"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconPhone, IconRefresh, IconGripVertical } from "@tabler/icons-react";
import { Button, Card, Input, Label, Select, Textarea, Toggle, useDialogs } from "@/app/ui";
import CopyBox from "../CopyBox";
import IntegrationCard from "../IntegrationCard";
import { SMS_PROVIDERS, TELEGRAM_PROVIDERS, EMAIL_PROVIDERS } from "@/lib/otp/providers";

type ChannelKey = "push" | "email" | "telegram" | "sms";
const DEFAULT_ORDER: ChannelKey[] = ["push", "email", "telegram", "sms"];
const CHANNEL_TITLE: Record<ChannelKey, string> = { push: "Push-уведомление", email: "Email", telegram: "Telegram", sms: "SMS" };
const BUTTON_SIZES = ["s", "m", "l", "xl"] as const;

// На каждый канал может появляться больше одного провайдера (см.
// lib/otp/providers.ts) — растущий список, не меняем структуру страницы,
// когда добавляется следующая интеграция.
const PROVIDER_OPTIONS: Partial<Record<ChannelKey, { id: string; label: string }[]>> = {
  telegram: TELEGRAM_PROVIDERS,
  sms: SMS_PROVIDERS,
  email: EMAIL_PROVIDERS,
};

type Providers = Partial<Record<ChannelKey, string>>;

type Initial = {
  clientId: string;
  isEnabled: boolean;
  channels: Record<ChannelKey, boolean | undefined>;
  channelOrder: ChannelKey[];
  providers: Providers;
  hideNativeLoginButton: boolean;
  authButtonText: string;
  authButtonIcon: string;
  authButtonColor: string;
  authButtonSize: string;
  authButtonRounded: boolean;
  hasTelegram: boolean;
  hasBytehand: boolean;
  hasHaskimail: boolean;
  hasSmsc: boolean;
  hasEmailFrom: boolean;
};

export default function AuthSettings({
  projectId,
  projectDomain,
  issuer,
  initial,
}: {
  projectId: string;
  projectDomain: string | null;
  issuer: string;
  initial: Initial | null;
}) {
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [isEnabled, setIsEnabled] = useState(initial?.isEnabled ?? false);
  const [channels, setChannels] = useState(initial?.channels || { push: true, email: true, telegram: true, sms: true });
  const [order, setOrder] = useState<ChannelKey[]>(() => {
    const saved = initial?.channelOrder?.filter((c): c is ChannelKey => DEFAULT_ORDER.includes(c)) ?? [];
    const missing = DEFAULT_ORDER.filter((c) => !saved.includes(c));
    return [...saved, ...missing];
  });
  const [hideLoginButton, setHideLoginButton] = useState(initial?.hideNativeLoginButton ?? false);
  const [authButtonText, setAuthButtonText] = useState(initial?.authButtonText || "");
  const [authButtonIcon, setAuthButtonIcon] = useState(initial?.authButtonIcon || "");
  const [authButtonColor, setAuthButtonColor] = useState(initial?.authButtonColor || "");
  const [authButtonSize, setAuthButtonSize] = useState(initial?.authButtonSize || "");
  const [authButtonRounded, setAuthButtonRounded] = useState(initial?.authButtonRounded ?? false);
  const [providers, setProviders] = useState<Providers>(initial?.providers || {});

  // Настроен ли конкретный провайдер (не канал) — ключи/токены теперь только
  // на странице «Подключения», здесь только читаем серверную истину.
  const providerConfigured: Record<string, boolean> = {
    telegram_gateway: initial?.hasTelegram ?? false,
    bytehand: initial?.hasBytehand ?? false,
    haskimail: initial?.hasHaskimail ?? false,
    smsc: initial?.hasSmsc ?? false,
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
  async function persistCascade(next: { channels?: typeof channels; order?: ChannelKey[]; providers?: Providers }) {
    setBusy(true);
    const res = await fetch("/api/admin/oidc/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        channels: next.channels ?? channels,
        channelOrder: next.order ?? order,
        providers: next.providers ?? providers,
      }),
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
    toast(v ? "Канал включён" : "Канал выключен", v ? "good" : "neutral");
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
    const ready = (["email", "telegram", "sms"] as ChannelKey[]).some((ch) => channels[ch] !== false && channelReadiness(ch).ok);
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
    const res = await fetch("/api/admin/oidc/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, isEnabled: next }),
    });
    setBusy(false);
    if (!res.ok) {
      setIsEnabled(!next);
      const j = await res.json().catch(() => ({}));
      toast(j.error || "Ошибка", "bad");
      return;
    }
    toast(next ? "Вход включён" : "Вход выключен", next ? "good" : "neutral");
    router.refresh();
  }

  async function setup(regenerate = false) {
    if (regenerate) {
      const ok = await confirm({
        title: "Перевыпустить секрет?",
        message: "Старый секрет перестанет работать — его нужно будет заменить в настройках InSales.",
        confirmText: "Перевыпустить",
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    const res = await fetch("/api/admin/oidc/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, regenerate }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return toast(json.error || "Ошибка", "bad");
    if (json.clientSecret) setFreshSecret(json.clientSecret);
    router.refresh();
  }

  async function saveButtonVisibility(next: boolean) {
    setHideLoginButton(next);
    setBusy(true);
    const res = await fetch("/api/admin/oidc/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, hideNativeLoginButton: next }),
    });
    setBusy(false);
    if (!res.ok) {
      setHideLoginButton(!next);
      const j = await res.json().catch(() => ({}));
      toast(j.error || "Ошибка", "bad");
      return;
    }
    router.refresh();
  }

  async function saveButtonAppearance() {
    setBusy(true);
    const res = await fetch("/api/admin/oidc/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        authButtonText,
        authButtonIcon,
        authButtonColor,
        authButtonSize,
        authButtonRounded,
      }),
    });
    setBusy(false);
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

  function dragStart(e: React.PointerEvent, key: ChannelKey) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    orderBeforeDrag.current = order;
    setDragKey(key);
  }

  function dragMove(e: React.PointerEvent, key: ChannelKey) {
    if (dragKey !== key) return;
    const y = e.clientY;
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
    const before = orderBeforeDrag.current;
    orderBeforeDrag.current = null;
    if (!before || before.join() === order.join()) return; // порядок не менялся — нечего сохранять
    const ok = await persistCascade({ order });
    if (!ok) {
      setOrder(before);
      return;
    }
    toast("Порядок сохранён", "good");
  }

  if (!initial) {
    return (
      <Card className="mt-5">
        <p className="text-sm text-ink-muted m-0">
          Нажмите кнопку — мы создадим OIDC-конфигурацию (client_id, ключ подписи, секрет) и покажем значения для
          вставки в админку InSales.
        </p>
        <Button className="mt-3" disabled={busy} onClick={() => setup(false)}>
          <IconPhone size={16} stroke={1.8} />
          Включить вход по телефону
        </Button>
      </Card>
    );
  }

  const embedSnippet = `(function waitForAjaxAPI(tries){
  if (window.ajaxAPI && ajaxAPI.shop) {
    ajaxAPI.shop.client.get().done(function(client){
      sendera.identify({ phone: client.phone, email: client.email, name: client.name, insales_client_id: client.id });
    });
  } else if (tries > 0) {
    setTimeout(function(){ waitForAjaxAPI(tries - 1); }, 200);
  }
})(25);`;

  return (
    <div className={busy ? "opacity-60" : ""}>
      {freshSecret && (
        <Card className="mt-5 border-good bg-good-tint">
          <div className="text-[13px] font-semibold mb-1.5">
            Секрет создан — скопируйте в InSales сейчас, больше он не покажется:
          </div>
          <code className="break-all text-[13px] font-mono">{freshSecret}</code>
        </Card>
      )}

      <h2 className="text-base font-semibold mt-8">Каскад отправки кода</h2>
      <div className="mt-3 flex flex-col gap-1.5">
        {order.map((key) => (
          <ChannelRow
            key={key}
            label={CHANNEL_TITLE[key]}
            on={channels[key] !== false}
            locked={key !== "push" && channels[key] === false && !hasSecret[key]}
            onChange={(v) => handleChannelToggle(key, v)}
            dragging={dragKey === key}
            rowRef={(el) => (rowRefs.current[key] = el)}
            onDragStart={(e) => dragStart(e, key)}
            onDragMove={(e) => dragMove(e, key)}
            onDragEnd={dragEnd}
            providerOptions={configuredOptionsFor(key)}
            provider={resolvedProvider(key)}
            onProviderChange={(p) => handleProviderChange(key, p)}
          />
        ))}
      </div>

      <h2 className="text-base font-semibold mt-8">Настройки</h2>

      <IntegrationCard title="Статус входа" configured={isEnabled}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            {isEnabled
              ? "Вход включён — покупатели видят кнопку и могут войти"
              : "Вход выключен — недоступен покупателям, даже если кнопка видна"}
          </div>
          <Toggle checked={isEnabled} onChange={saveEnabled} disabled={busy} label={isEnabled ? "Вкл" : "Выкл"} />
        </div>
        <p className="text-[12px] text-ink-faint mt-2 mb-0">
          Включайте, только когда выше настроен и включён хотя бы один канал с кодом (Email, Telegram или SMS) —
          push один не подойдёт, он работает только для уже узнанных устройств.
        </p>

        <div className="h-px bg-border my-3" />

        <p className="text-sm text-ink-muted mt-0">
          Значения для админки InSales: Магазин → Настройки → Авторизация покупателя → «Авторизация через OpenID
          Connect» → добавить приложение.
        </p>
        <Row label="ID приложения (client_id)" value={initial.clientId} mono />
        <Row label="API token приложения" value={freshSecret || "показан при создании (можно перевыпустить)"} mono={!!freshSecret} />
        <Row label="Issuer" value={issuer.replace(/^https:\/\//, "")} mono />
        <p className="text-[12.5px] text-ink-faint mt-2 mb-0">
          ⚠️ В поле Issuer у InSales уже подставлено «https://» — вводите адрес <b>без</b> протокола, иначе вход
          упадёт с ошибкой 500 (проверено).
        </p>
        <Button variant="secondary" size="sm" className="mt-3" disabled={busy} onClick={() => setup(true)}>
          <IconRefresh size={15} stroke={1.8} />
          Перевыпустить секрет
        </Button>
      </IntegrationCard>

      <IntegrationCard
        title="Кнопка входа InSales"
        configured={hideLoginButton || !!authButtonText || !!authButtonColor || !!authButtonIcon || authButtonRounded}
      >
        <p className="text-sm text-ink-muted mt-0">
          Отдельный скрипт (<code className="font-mono">/embed/{"{projectId}"}/auth-button.js</code>), не влияет на
          основной виджет. Управляет нативной ссылкой «Войти через {"{"}приложение{"}"}» на странице входа: можно
          скрыть целиком, либо задать свой текст, иконку, цвет и размер — тогда ссылка получает класс{" "}
          <code className="font-mono">.button</code> темы магазина и выглядит как родная кнопка.
        </p>
        <div className="flex justify-between items-center gap-3 mt-3">
          <div className="text-sm">Скрыть кнопку целиком</div>
          <Toggle checked={hideLoginButton} onChange={saveButtonVisibility} label={hideLoginButton ? "Вкл" : "Выкл"} />
        </div>

        {!hideLoginButton && (
          <>
            <div className="h-px bg-border my-3" />
            <div>
              <Label>Текст на кнопке</Label>
              <Input value={authButtonText} onChange={(e) => setAuthButtonText(e.target.value)} placeholder="оставьте пустым — родной текст InSales" />
            </div>
            <div className="mt-3">
              <Label>Иконка (SVG-разметка)</Label>
              <Textarea
                value={authButtonIcon}
                onChange={(e) => setAuthButtonIcon(e.target.value)}
                rows={3}
                placeholder='<svg width="16" height="16" ...>...</svg>'
                className="font-mono text-xs"
              />
            </div>
            <div className="flex gap-3 mt-3">
              <div className="flex-1">
                <Label>Цвет кнопки</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(authButtonColor) ? authButtonColor : "#2c4a66"}
                    onChange={(e) => setAuthButtonColor(e.target.value)}
                    className="w-9 h-9 shrink-0 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                  />
                  <Input value={authButtonColor} onChange={(e) => setAuthButtonColor(e.target.value)} placeholder="родной цвет темы" />
                </div>
              </div>
              <div className="w-32 shrink-0">
                <Label>Размер</Label>
                <Select value={authButtonSize} onChange={(e) => setAuthButtonSize(e.target.value)} className="w-full">
                  <option value="">Родной (m)</option>
                  {BUTTON_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex justify-between items-center gap-3 mt-3">
              <div className="text-sm">Скруглить до пилюли</div>
              <Toggle checked={authButtonRounded} onChange={setAuthButtonRounded} label={authButtonRounded ? "Вкл" : "Выкл"} />
            </div>
            <div className="mt-3">
              <Button size="sm" disabled={busy} onClick={saveButtonAppearance}>
                Сохранить внешний вид
              </Button>
            </div>
          </>
        )}
      </IntegrationCard>

      <IntegrationCard title="Обогащение профиля для авторизованных клиентов" configured>
        <p className="text-sm text-ink-muted mt-0">
          На странице, где покупатель уже авторизован в InSales, можно вызвать после подключения нашего сниппета:
        </p>
        <CopyBox text={embedSnippet} />
      </IntegrationCard>

      {!projectDomain && (
        <Card className="mt-5 border-warn bg-warn-tint">
          <p className="text-[13px] m-0">
            У проекта не указан домен сайта — привязка устройств к телефону (бесплатные push-коды) не будет работать,
            коды пойдут через Telegram/SMS. Укажите домен в настройках проекта.
          </p>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 py-1.5">
      <div className="w-56 shrink-0 text-[13px] text-ink-muted">{label}</div>
      <div className={`text-[13.5px] break-all ${mono ? "font-mono" : "text-ink-muted"}`}>{value}</div>
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
  onDragMove,
  onDragEnd,
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
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: () => void;
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
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        style={{ touchAction: "none" }}
        className={`p-1 -m-1 text-ink-faint hover:text-ink ${dragging ? "cursor-grabbing text-ink" : "cursor-grab"}`}
        aria-label="Перетащить для изменения приоритета"
        role="button"
      >
        <IconGripVertical size={16} stroke={1.8} />
      </div>
      <div className="flex-1 text-[13.5px]">{label}</div>
      {providerOptions && providerOptions.length > 0 && (
        <Select value={provider} onChange={(e) => onProviderChange?.(e.target.value)} className="w-40 shrink-0">
          {providerOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      )}
      <Toggle checked={on} onChange={onChange} disabled={locked} label={on ? "Вкл" : "Выкл"} />
    </div>
  );
}
