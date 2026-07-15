"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconPhone, IconRefresh, IconGripVertical, IconAlertTriangle } from "@tabler/icons-react";
import { Button, Card, Input, Label, Toggle, useDialogs } from "@/app/ui";
import CopyBox from "../CopyBox";

type ChannelKey = "push" | "email" | "telegram" | "sms";
const DEFAULT_ORDER: ChannelKey[] = ["push", "email", "telegram", "sms"];
const CHANNEL_TITLE: Record<ChannelKey, string> = { push: "Push-уведомление", email: "Email", telegram: "Telegram Gateway", sms: "SMS (Bytehand)" };

type Initial = {
  clientId: string;
  isEnabled: boolean;
  channels: Record<ChannelKey, boolean | undefined>;
  channelOrder: ChannelKey[];
  requirePhoneVerification: boolean;
  smsSender: string;
  emailFrom: string;
  hasTelegram: boolean;
  hasBytehand: boolean;
  hasHaskimail: boolean;
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
  const [requireVerification, setRequireVerification] = useState(initial?.requirePhoneVerification ?? true);
  const [smsSender, setSmsSender] = useState(initial?.smsSender || "");
  const [emailFrom, setEmailFrom] = useState(initial?.emailFrom || "");
  const [telegramToken, setTelegramToken] = useState("");
  const [bytehandKey, setBytehandKey] = useState("");
  const [haskimailToken, setHaskimailToken] = useState("");

  const hasSecret: Record<ChannelKey, boolean> = {
    push: true,
    email: initial?.hasHaskimail ?? false,
    telegram: initial?.hasTelegram ?? false,
    sms: initial?.hasBytehand ?? false,
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
    setBusy(true);
    const res = await fetch("/api/admin/oidc/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        channels,
        channelOrder: order,
        requirePhoneVerification: requireVerification,
        smsSender,
        emailFrom,
        ...(telegramToken.trim() ? { telegramToken: telegramToken.trim() } : {}),
        ...(bytehandKey.trim() ? { bytehandKey: bytehandKey.trim() } : {}),
        ...(haskimailToken.trim() ? { haskimailToken: haskimailToken.trim() } : {}),
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return toast(json.error || "Ошибка", "bad");
    setTelegramToken("");
    setBytehandKey("");
    setHaskimailToken("");
    toast("Сохранено", "good");
    router.refresh();
  }

  async function toggleVerification(next: boolean) {
    if (!next) {
      const ok = await confirm({
        title: "Отключить подтверждение владения телефоном?",
        message:
          "Устройства покупателей, уже авторизованных в InSales, будут привязываться к номеру телефона без проверки кодом. " +
          "Это открывает риск угона аккаунта: чужое устройство, заявившее себя владельцем номера, начнёт получать коды входа этого номера. " +
          "Включайте только если доверяете своей теме/сайту.",
        confirmText: "Всё равно отключить",
        danger: true,
      });
      if (!ok) return;
    }
    setRequireVerification(next);
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

  const embedSnippet = `ajaxAPI.shop.client.get().done(function(client){
  if (!client.authorized || !client.phone) return;
  PushSaaS.subscribe();
  PushSaaS.identify({ phone: client.phone, email: client.email, name: client.name });
});`;

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
        Код идёт по каналам в заданном порядке, пока один не сработает. Перетащите канал за ручку, чтобы поменять
        приоритет. Канал нельзя включить, пока для него не сохранён ключ.
      </p>
      <Card className="mt-3 flex flex-col gap-1.5">
        {order.map((key) => (
          <ChannelRow
            key={key}
            label={CHANNEL_TITLE[key]}
            hint={channelHint(key, initial, hasSecret[key])}
            tone={key === "push" ? undefined : hasSecret[key] ? "good" : "warn"}
            on={channels[key] !== false}
            locked={!hasSecret[key] && channels[key] === false}
            onChange={(v) => setChannels((c) => ({ ...c, [key]: v }))}
            dragging={dragKey === key}
            rowRef={(el) => (rowRefs.current[key] = el)}
            onDragStart={(e) => dragStart(e, key)}
            onDragMove={(e) => dragMove(e, key)}
            onDragEnd={dragEnd}
          />
        ))}

        <div className="h-2" />
        <div>
          <Label>Haskimail Server Token (для email-канала)</Label>
          <Input
            type="password"
            value={haskimailToken}
            onChange={(e) => setHaskimailToken(e.target.value)}
            placeholder={initial.hasHaskimail ? "оставьте пустым — не менять" : "получить на haskimail.ru"}
          />
        </div>
        <div>
          <Label>Email-отправитель (From)</Label>
          <Input
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder="Магазин <noreply@ваш-домен.ru>"
          />
        </div>
        <div>
          <Label>Telegram Gateway token</Label>
          <Input
            type="password"
            value={telegramToken}
            onChange={(e) => setTelegramToken(e.target.value)}
            placeholder={initial.hasTelegram ? "оставьте пустым — не менять" : "вставьте токен из Telegram Gateway"}
          />
        </div>
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
          <Input
            value={smsSender}
            onChange={(e) => setSmsSender(e.target.value)}
            placeholder="согласованная в Bytehand"
          />
        </div>
        <div>
          <Button disabled={busy} onClick={saveSettings}>
            Сохранить настройки
          </Button>
        </div>
      </Card>

      <h2 className="text-base font-semibold mt-8">Подтверждение владения телефоном</h2>
      <Card className="mt-3">
        <div className="flex justify-between items-start gap-3">
          <div>
            <div className="text-sm">
              Перед тем как привязать устройство к номеру, требовать ввод кода из каскада выше.
            </div>
            <div className="text-[12.5px] text-ink-faint mt-1">
              Выключение позволяет привязывать устройство по данным из авторизованной сессии магазина (см. ниже),
              без кода — быстрее для клиента, но менее безопасно.
            </div>
          </div>
          <Toggle checked={requireVerification} onChange={toggleVerification} />
        </div>

        {!requireVerification && (
          <div className="mt-3 rounded-lg p-3 bg-bad-tint border border-border flex gap-2.5">
            <IconAlertTriangle size={18} stroke={1.8} className="text-bad shrink-0 mt-0.5" />
            <p className="text-[13px] text-bad m-0">
              Подтверждение выключено: любое устройство, назвавшее себя владельцем номера через{" "}
              <code className="font-mono">PushSaaS.identify()</code>, будет получать коды входа этого номера
              (риск угона аккаунта). Используйте только если полностью контролируете тему сайта.
            </p>
          </div>
        )}
      </Card>

      {!requireVerification && (
        <>
          <h2 className="text-base font-semibold mt-8">Подписка/переподписка для авторизованных клиентов</h2>
          <p className="text-sm text-ink-muted mt-1">
            На странице личного кабинета покупателя (где он уже авторизован в InSales) вызовите после подключения
            нашего сниппета:
          </p>
          <CopyBox text={embedSnippet} />
          <p className="text-[12.5px] text-ink-faint">
            <code className="font-mono">ajaxAPI</code> — собственный JS API InSales, доступен на страницах магазина.{" "}
            <code className="font-mono">PushSaaS.subscribe()</code> запрашивает разрешение на push,{" "}
            <code className="font-mono">PushSaaS.identify(...)</code> привязывает устройство к телефону/почте без
            кода (эндпоинт: <code className="font-mono">{appUrl}/api/public/identify</code>).
          </p>
        </>
      )}

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

function channelHint(key: ChannelKey, initial: Initial, has: boolean): string {
  if (key === "push") return "устройства, привязанные к номеру";
  if (key === "email") return has ? "ключ Haskimail сохранён · только для клиентов с известной почтой" : "нужен Server Token Haskimail · только для клиентов с известной почтой";
  if (key === "telegram") return has ? "токен сохранён" : "нужен токен (см. docs/telegram-gateway.md)";
  return has ? "ключ сохранён" : "нужен X-Service-Key из кабинета Bytehand";
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
      <div title={locked ? "Сначала сохраните ключ ниже" : undefined}>
        <Toggle checked={on} onChange={onChange} disabled={locked} />
      </div>
    </div>
  );
}
