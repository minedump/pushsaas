"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconPhone, IconRefresh, IconGripVertical } from "@tabler/icons-react";
import { Button, Card, Input, Label, Select, Textarea, Toggle, useDialogs } from "@/app/ui";
import CopyBox from "../CopyBox";
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
  smsSender: string;
  emailFrom: string;
  hasTelegram: boolean;
  hasBytehand: boolean;
  hasHaskimail: boolean;
  hasSmsc: boolean;
};

export default function AuthSettings({
  projectId,
  projectDomain,
  issuer,
  appUrl,
  initial,
}: {
  projectId: string;
  projectDomain: string | null;
  issuer: string;
  appUrl: string;
  initial: Initial | null;
}) {
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
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
  const [smsSender, setSmsSender] = useState(initial?.smsSender || "");
  const [emailFrom, setEmailFrom] = useState(initial?.emailFrom || "");
  const [telegramToken, setTelegramToken] = useState("");
  const [bytehandKey, setBytehandKey] = useState("");
  const [haskimailToken, setHaskimailToken] = useState("");
  const [smscLogin, setSmscLogin] = useState("");
  const [smscPassword, setSmscPassword] = useState("");
  const [providers, setProviders] = useState<Providers>(initial?.providers || {});

  const hasSecret: Record<ChannelKey, boolean> = {
    push: true,
    email: providers.email === "smsc" ? (initial?.hasSmsc ?? false) : (initial?.hasHaskimail ?? false),
    telegram: providers.telegram === "smsc" ? (initial?.hasSmsc ?? false) : (initial?.hasTelegram ?? false),
    sms: providers.sms === "smsc" ? (initial?.hasSmsc ?? false) : (initial?.hasBytehand ?? false),
  };

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

  async function saveSettings() {
    // блокируем только если email-канал реально заработает (ключи нужного
    // провайдера уже есть или вводятся сейчас) — иначе это ложно ловило бы
    // любое сохранение у проектов, которые вообще не настраивали email
    const emailSecretReady =
      providers.email === "smsc" ? hasSecret.email || (smscLogin.trim() && smscPassword.trim()) : hasSecret.email || haskimailToken.trim();
    const emailWouldWork = channels.email !== false && emailSecretReady;
    if (emailWouldWork && !emailFrom.trim()) {
      toast("Укажите email-отправителя (From) — без него email-канал нельзя включить", "bad");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/admin/oidc/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        channels,
        channelOrder: order,
        providers,
        hideNativeLoginButton: hideLoginButton,
        smsSender,
        emailFrom,
        ...(telegramToken.trim() ? { telegramToken: telegramToken.trim() } : {}),
        ...(bytehandKey.trim() ? { bytehandKey: bytehandKey.trim() } : {}),
        ...(haskimailToken.trim() ? { haskimailToken: haskimailToken.trim() } : {}),
        ...(smscLogin.trim() ? { smscLogin: smscLogin.trim() } : {}),
        ...(smscPassword.trim() ? { smscPassword: smscPassword.trim() } : {}),
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return toast(json.error || "Ошибка", "bad");
    setTelegramToken("");
    setBytehandKey("");
    setSmscLogin("");
    setSmscPassword("");
    setHaskimailToken("");
    toast("Сохранено", "good");
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

  function dragStart(e: React.PointerEvent, key: ChannelKey) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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

  function dragEnd() {
    setDragKey(null);
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
      PushSaaS.identify({ phone: client.phone, email: client.email, name: client.name, insales_client_id: client.id });
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

      <h2 className="text-base font-semibold mt-7">Значения для админки InSales</h2>
      <p className="text-sm text-ink-muted mt-1">
        Магазин → Настройки → Авторизация покупателя → «Авторизация через OpenID Connect» → добавить приложение.
      </p>
      <Card className="mt-3">
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
      </Card>

      <h2 className="text-base font-semibold mt-8">Каскад отправки кода</h2>
      <p className="text-sm text-ink-muted mt-1">
        Первый в порядке канал среди <b>email</b>/<b>Telegram</b>/<b>SMS</b> определяет, что спрашивает страница входа
        первым — почту или телефон. Если с ним не вышло, спросим второе (телефон, если начали с почты, и наоборот) —
        один раз. Push отдельно: не спрашивает ничего, пробует достучаться до уже узнанного устройства раньше формы —
        поэтому имеет смысл всегда держать его первым.
      </p>
      <Card className="mt-3 flex flex-col gap-1.5">
        {order.map((key) => (
          <ChannelRow
            key={key}
            label={CHANNEL_TITLE[key]}
            hint={key === "email" ? emailChannelHint(providers.email, hasSecret.email, !!emailFrom.trim()) : channelHint(key, providers[key], hasSecret[key])}
            tone={key === "push" ? undefined : hasSecret[key] ? "good" : "warn"}
            on={channels[key] !== false}
            locked={!hasSecret[key] && channels[key] === false}
            onChange={(v) => setChannels((c) => ({ ...c, [key]: v }))}
            dragging={dragKey === key}
            rowRef={(el) => (rowRefs.current[key] = el)}
            onDragStart={(e) => dragStart(e, key)}
            onDragMove={(e) => dragMove(e, key)}
            onDragEnd={dragEnd}
            providerOptions={PROVIDER_OPTIONS[key]}
            provider={providers[key] || PROVIDER_OPTIONS[key]?.[0]?.id}
            onProviderChange={(p) => setProviders((prev) => ({ ...prev, [key]: p }))}
          />
        ))}

        <div className="h-2" />
        <div className="text-[12.5px] font-semibold text-ink-muted uppercase tracking-wide">Haskimail (email)</div>
        <div>
          <Label>Haskimail Server Token</Label>
          <Input
            type="password"
            value={haskimailToken}
            onChange={(e) => setHaskimailToken(e.target.value)}
            placeholder={initial.hasHaskimail ? "оставьте пустым — не менять" : "получить на haskimail.ru"}
          />
        </div>
        <div>
          <Label>Email-отправитель (From) — обязателен для email-канала</Label>
          <Input
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder="Магазин <noreply@ваш-домен.ru>"
          />
          <p className="text-[12px] text-ink-faint mt-1 mb-0">
            Домен в адресе должен быть верифицирован у провайдера (SPF + DKIM) — иначе письма не будут доставляться
            или уйдут в спам.
          </p>
        </div>

        <div className="h-2" />
        <div className="text-[12.5px] font-semibold text-ink-muted uppercase tracking-wide">Telegram Gateway (официальный)</div>
        <div>
          <Label>Telegram Gateway token</Label>
          <Input
            type="password"
            value={telegramToken}
            onChange={(e) => setTelegramToken(e.target.value)}
            placeholder={initial.hasTelegram ? "оставьте пустым — не менять" : "вставьте токен из Telegram Gateway"}
          />
        </div>

        <div className="h-2" />
        <div className="text-[12.5px] font-semibold text-ink-muted uppercase tracking-wide">Bytehand (SMS)</div>
        <div>
          <Label>Bytehand X-Service-Key</Label>
          <Input
            type="password"
            value={bytehandKey}
            onChange={(e) => setBytehandKey(e.target.value)}
            placeholder={initial.hasBytehand ? "оставьте пустым — не менять" : "X-Service-Key из кабинета Bytehand"}
          />
        </div>
        <div>
          <Label>Подпись SMS-отправителя</Label>
          <Input value={smsSender} onChange={(e) => setSmsSender(e.target.value)} placeholder="согласованная в Bytehand" />
        </div>

        <div className="h-2" />
        <div className="text-[12.5px] font-semibold text-ink-muted uppercase tracking-wide">SMSC.ru (SMS / Telegram / Email — один аккаунт)</div>
        <div>
          <Label>Login</Label>
          <Input
            value={smscLogin}
            onChange={(e) => setSmscLogin(e.target.value)}
            placeholder={initial.hasSmsc ? "оставьте пустым — не менять" : "логин аккаунта SMSC.ru"}
          />
        </div>
        <div>
          <Label>Password</Label>
          <Input
            type="password"
            value={smscPassword}
            onChange={(e) => setSmscPassword(e.target.value)}
            placeholder={initial.hasSmsc ? "оставьте пустым — не менять" : "пароль аккаунта SMSC.ru"}
          />
        </div>
        <p className="text-[12px] text-ink-faint mt-0 mb-0">
          Один и тот же логин/пароль — общий для всех трёх каналов; какой канал реально идёт через SMSC, выбирается
          провайдером в строке канала выше.
        </p>

        <div>
          <Button disabled={busy} onClick={saveSettings}>
            Сохранить настройки
          </Button>
        </div>
      </Card>

      <h2 className="text-base font-semibold mt-8">Кнопка входа InSales</h2>
      <p className="text-sm text-ink-muted mt-1">
        Отдельный скрипт (<code className="font-mono">/embed/{"{projectId}"}/auth-button.js</code>), не влияет на
        основной виджет. Управляет нативной ссылкой «Войти через {"{"}приложение{"}"}» на странице входа: можно скрыть
        целиком, либо задать свой текст, иконку, цвет и размер — тогда ссылка получает класс{" "}
        <code className="font-mono">.button</code> темы магазина и выглядит как родная кнопка.
      </p>
      <Card className="mt-3 flex flex-col gap-3">
        <div className="flex justify-between items-center gap-3">
          <div className="text-sm">Скрыть кнопку целиком</div>
          <Toggle checked={hideLoginButton} onChange={saveButtonVisibility} />
        </div>

        {!hideLoginButton && (
          <>
            <div className="h-px bg-border" />
            <div>
              <Label>Текст на кнопке</Label>
              <Input value={authButtonText} onChange={(e) => setAuthButtonText(e.target.value)} placeholder="оставьте пустым — родной текст InSales" />
            </div>
            <div>
              <Label>Иконка (SVG-разметка)</Label>
              <Textarea
                value={authButtonIcon}
                onChange={(e) => setAuthButtonIcon(e.target.value)}
                rows={3}
                placeholder='<svg width="16" height="16" ...>...</svg>'
                className="font-mono text-xs"
              />
            </div>
            <div className="flex gap-3">
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
            <div className="flex justify-between items-center gap-3">
              <div className="text-sm">Скруглить до пилюли</div>
              <Toggle checked={authButtonRounded} onChange={setAuthButtonRounded} />
            </div>
            <div>
              <Button size="sm" disabled={busy} onClick={saveButtonAppearance}>
                Сохранить внешний вид
              </Button>
            </div>
          </>
        )}
      </Card>

      <h2 className="text-base font-semibold mt-8">Обогащение профиля для авторизованных клиентов</h2>
      <p className="text-sm text-ink-muted mt-1">
        На странице, где покупатель уже авторизован в InSales, можно вызвать после подключения нашего сниппета:
      </p>
      <CopyBox text={embedSnippet} />
      <p className="text-[12.5px] text-ink-faint">
        <code className="font-mono">ajaxAPI</code> — собственный JS API InSales, доступен на страницах магазина.{" "}
        <code className="font-mono">PushSaaS.identify(...)</code> ничего не подделывает и не создаёт новую связку —
        имя обновится, только если это устройство уже честно подтвердило присланный телефон или email кодом; всегда
        безопасно (эндпоинт: <code className="font-mono">{appUrl}/api/public/identify</code>).
      </p>

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

function channelHint(key: ChannelKey, provider: string | undefined, has: boolean): string {
  if (key === "push") return "уже узнанные устройства — по телефону или по почте";
  if (provider === "smsc") return has ? "SMSC: логин/пароль сохранены" : "SMSC: нужны логин и пароль ниже";
  if (key === "telegram") return has ? "токен сохранён" : "нужен токен (см. docs/telegram-gateway.md)";
  return has ? "ключ сохранён" : "нужен X-Service-Key из кабинета Bytehand";
}

function emailChannelHint(provider: string | undefined, hasSecret: boolean, hasFrom: boolean): string {
  if (provider === "smsc") {
    if (!hasSecret && !hasFrom) return "SMSC: нужны логин/пароль и отправитель (From) ниже";
    if (!hasSecret) return "SMSC: нужны логин и пароль ниже";
    if (!hasFrom) return "нужен отправитель (From) ниже";
    return "SMSC: логин/пароль и отправитель заданы · код на введённый адрес";
  }
  if (!hasSecret && !hasFrom) return "нужен Server Token Haskimail и отправитель (From) ниже";
  if (!hasSecret) return "нужен Server Token Haskimail";
  if (!hasFrom) return "нужен отправитель (From) ниже — домен верифицирован у провайдера";
  return "ключ и отправитель заданы · код на введённый адрес";
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
  hint,
  tone,
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
  hint: string;
  tone?: "good" | "warn";
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
      className={`flex items-center justify-between gap-3 py-1.5 px-1.5 -mx-1.5 rounded-lg border transition-colors ${
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
      <div className="flex-1">
        <div className="text-[13.5px]">{label}</div>
        <div className="text-[12px] text-ink-faint flex items-center gap-1.5">
          {tone && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone === "good" ? "bg-good" : "bg-warn"}`} />}
          {hint}
        </div>
      </div>
      {providerOptions && providerOptions.length > 1 && (
        <Select value={provider} onChange={(e) => onProviderChange?.(e.target.value)} className="w-40 shrink-0">
          {providerOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      )}
      <div title={locked ? "Сначала сохраните ключ ниже" : undefined}>
        <Toggle checked={on} onChange={onChange} disabled={locked} />
      </div>
    </div>
  );
}
