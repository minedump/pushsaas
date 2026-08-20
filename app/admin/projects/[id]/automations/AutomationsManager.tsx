"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconArrowRight } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, Input, Textarea, Label, Select, Toggle, useDialogs } from "@/app/ui";

type Automation = {
  id: string;
  type: string;
  is_enabled: boolean;
  delay_minutes?: number;
  title: string | null;
  body: string | null;
  click_url: string | null;
  config: {
    key?: string;
    trigger_event?: string;
    cancel_events?: string[];
    transactional?: boolean;
    phone_path?: string;
    status_field?: string;
    status_value?: string;
    order_id_path?: string;
    segment_path?: string;
    email_path?: string;
  } | null;
};

export default function AutomationsManager({
  projectId,
  welcome,
  events,
  custom,
}: {
  projectId: string;
  welcome: Automation | null;
  events: Automation[];
  custom: Automation[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [busy, setBusy] = useState(false);

  // ---------- welcome ----------
  const [w, setW] = useState({
    enabled: welcome?.is_enabled ?? false,
    title: welcome?.title ?? "Спасибо за подписку!",
    body: welcome?.body ?? "Будем присылать только важное 🙌",
    url: welcome?.click_url ?? "",
    delay: welcome?.delay_minutes ?? 0,
  });
  async function saveWelcome() {
    setBusy(true);
    const payload = {
      project_id: projectId, type: "welcome", is_enabled: w.enabled,
      title: w.title, body: w.body, click_url: w.url || null, delay_minutes: w.delay,
    };
    if (welcome) await supabase.from("automations").update(payload).eq("id", welcome.id);
    else await supabase.from("automations").insert(payload);
    setBusy(false);
    toast("Приветственный пуш сохранён", "good");
    router.refresh();
  }

  // ---------- event automations (abandoned cart & co) ----------
  const [ev, setEv] = useState({ trigger: "cart_updated", amount: 60, unit: 60, cancel: "order_placed, cart_cleared", title: "", body: "", url: "" });
  async function createEvent(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const cancel_events = ev.cancel.split(",").map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase.from("automations").insert({
      project_id: projectId,
      type: "event",
      is_enabled: true,
      delay_minutes: Math.max(1, ev.amount * ev.unit),
      title: ev.title,
      body: ev.body,
      click_url: ev.url || null,
      config: { trigger_event: ev.trigger.trim(), cancel_events },
    });
    setBusy(false);
    if (error) { toast(error.message, "bad"); return; }
    setEv({ trigger: "cart_updated", amount: 60, unit: 60, cancel: "order_placed, cart_cleared", title: "", body: "", url: "" });
    toast("Событийная автоматизация создана", "good");
    router.refresh();
  }
  async function toggleEnabled(a: Automation) {
    setBusy(true);
    await supabase.from("automations").update({ is_enabled: !a.is_enabled }).eq("id", a.id);
    setBusy(false);
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

  // ---------- webhook triggers (transactional or broadcast) ----------
  const empty = {
    key: "", title: "", body: "", url: "", transactional: true,
    phonePath: "client.phone", statusField: "fulfillment_status", statusValue: "shipped",
    orderIdPath: "number", segmentPath: "",
  };
  const [neu, setNeu] = useState(empty);
  async function createCustom(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const config = neu.transactional
      ? {
          key: neu.key.trim(),
          transactional: true,
          phone_path: neu.phonePath.trim() || undefined,
          status_field: neu.statusField.trim() || undefined,
          status_value: neu.statusValue.trim() || undefined,
          order_id_path: neu.orderIdPath.trim() || undefined,
        }
      : {
          key: neu.key.trim(),
          transactional: false,
          phone_path: neu.phonePath.trim() || undefined, // optional: target if phone present
          segment_path: neu.segmentPath.trim() || undefined,
        };
    await supabase.from("automations").insert({
      project_id: projectId, type: "custom", is_enabled: true,
      title: neu.title, body: neu.body, click_url: neu.url || null, config,
    });
    setBusy(false);
    setNeu(empty);
    toast("Автоматизация создана", "good");
    router.refresh();
  }

  return (
    <div className={`mt-4 ${busy ? "opacity-60" : ""}`}>
      {/* Welcome */}
      <Card>
        <div className="flex justify-between items-center mb-3">
          <strong>Приветственный пуш</strong>
          <Toggle checked={w.enabled} onChange={(v) => setW({ ...w, enabled: v })} label="Включён" />
        </div>
        <p className="text-ink-muted text-[13px] mt-0">Отправляется автоматически, когда новый посетитель подписывается на сайте.</p>
        <Label>Заголовок</Label>
        <Input value={w.title} onChange={(e) => setW({ ...w, title: e.target.value })} maxLength={80} />
        <div className="h-3" />
        <Label>Текст</Label>
        <Textarea value={w.body} onChange={(e) => setW({ ...w, body: e.target.value })} rows={2} maxLength={200} />
        <div className="h-3" />
        <Label>Ссылка при клике (необязательно)</Label>
        <Input value={w.url} onChange={(e) => setW({ ...w, url: e.target.value })} />
        <div className="h-3" />
        <Label>Отправить через (минут, 0 = сразу)</Label>
        <Input type="number" min={0} value={w.delay} onChange={(e) => setW({ ...w, delay: Number(e.target.value) })} className="w-32" />
        <Button className="mt-4" onClick={saveWelcome} disabled={busy}>Сохранить</Button>
      </Card>

      {/* Event automations */}
      <h2 className="text-base font-semibold mt-8">Событийные (брошенная корзина и др.)</h2>
      <p className="text-ink-muted text-[13px]">
        Ловим событие, ждём заданное время и, если не пришло «отменяющее» событие, шлём пуш.
        События сайт отправляет через <code className="font-mono">sendera.event(&apos;имя&apos;)</code>.
      </p>

      {events.map((a) => (
        <Card key={a.id} className="mt-3">
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap text-[13px]">
                <Badge tone="accent">{a.config?.trigger_event || "—"}</Badge>
                <IconArrowRight size={14} className="text-ink-faint" />
                <span className="text-ink-muted">{fmtDelay(a.delay_minutes || 0)}</span>
                <IconArrowRight size={14} className="text-ink-faint" />
                <span className="text-ink-muted">если не: {(a.config?.cancel_events || []).join(", ") || "—"}</span>
              </div>
              <div className="font-semibold mt-2">{a.title}</div>
              <div className="text-ink-muted text-[13px]">{a.body}</div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Toggle checked={a.is_enabled} onChange={() => toggleEnabled(a)} />
              <Button variant="secondary" size="sm" onClick={() => del(a.id, a.title || "автоматизацию")}>Удалить</Button>
            </div>
          </div>
        </Card>
      ))}

      <Card className="mt-3">
        <form onSubmit={createEvent}>
          <div className="font-semibold mb-3">Новая событийная автоматизация</div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <Label>Когда произошло</Label>
              <Input list="ev-presets" value={ev.trigger} onChange={(e) => setEv({ ...ev, trigger: e.target.value })} placeholder="cart_updated" required />
              <datalist id="ev-presets">
                <option value="cart_updated" />
                <option value="product_viewed" />
                <option value="checkout_started" />
              </datalist>
            </div>
            <div>
              <Label>Подождать</Label>
              <div className="flex gap-2">
                <Input type="number" min={1} value={ev.amount} onChange={(e) => setEv({ ...ev, amount: Number(e.target.value) })} className="w-20" />
                <Select value={ev.unit} onChange={(e) => setEv({ ...ev, unit: Number(e.target.value) })}>
                  <option value={1}>минут</option>
                  <option value={60}>часов</option>
                  <option value={1440}>дней</option>
                </Select>
              </div>
            </div>
          </div>
          <div className="h-3" />
          <Label>Если НЕ произошло (через запятую)</Label>
          <Input value={ev.cancel} onChange={(e) => setEv({ ...ev, cancel: e.target.value })} placeholder="order_placed, cart_cleared" />
          <div className="h-3" />
          <div className="text-[12px] text-ink-faint bg-surface-2 border border-border rounded-lg px-3 py-2">
            В заголовке и тексте — полноценный Liquid: <code className="font-mono">{"{{ ключ }}"}</code>, фильтры, условия, циклы.
            Напр. если событие шлёт <code className="font-mono">{'{ total: 4500, product: "Кроссовки" }'}</code>, то
            «Забыли {"{{ product }}"} за {"{{ total }}"} ₽» подставит значения. Данные обновляются каждым событием устройства.
          </div>
          <div className="h-3" />
          <Label>Заголовок пуша</Label>
          <Input value={ev.title} required onChange={(e) => setEv({ ...ev, title: e.target.value })} placeholder="Вы забыли {{ product }} в корзине 🛒" />
          <div className="h-3" />
          <Label>Текст</Label>
          <Textarea value={ev.body} required onChange={(e) => setEv({ ...ev, body: e.target.value })} rows={2} placeholder="Завершите заказ — товары ещё ждут вас" />
          <div className="h-3" />
          <Label>Ссылка при клике (необязательно)</Label>
          <Input value={ev.url} onChange={(e) => setEv({ ...ev, url: e.target.value })} placeholder="https://ваш-сайт/cart" />
          <Button className="mt-4" disabled={busy}>Создать</Button>
        </form>
      </Card>

      {/* Webhook triggers — transactional or broadcast */}
      <h2 className="text-base font-semibold mt-8">Вебхук-триггеры (заказы и рассылки)</h2>
      <p className="text-ink-muted text-[13px]">
        Запускаются вебхуком/API по ключу. <b>Транзакционные</b> — точечно клиенту по телефону из тела (статус, дедуп).{" "}
        <b>Рассылочные</b> — сегменту или всем. Ссылка в разделе <b>API</b> остаётся чистой; любое поле тела доступно в тексте как{" "}
        <code className="font-mono">{"{путь}"}</code>.
      </p>

      {custom.map((a) => (
        <Card key={a.id} className="mt-3">
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge tone="accent">{a.config?.key || "—"}</Badge>
                <Badge tone={a.config?.transactional ? "good" : "neutral"}>
                  {a.config?.transactional ? "транзакционная" : "рассылка"}
                </Badge>
              </div>
              <div className="font-semibold mt-1.5">{a.title}</div>
              <div className="text-ink-muted text-[13px]">{a.body}</div>
              <div className="text-ink-faint text-[12px] mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {a.config?.status_field && <span>статус: {a.config.status_field}={a.config.status_value}</span>}
                {a.config?.phone_path && <span>телефон: {a.config.phone_path}</span>}
                {a.config?.order_id_path && <span>дедуп: {a.config.order_id_path}</span>}
                {a.config?.segment_path && <span>сегмент: {a.config.segment_path}</span>}
              </div>
            </div>
            <Button variant="secondary" size="sm" className="h-fit shrink-0" onClick={() => del(a.id, a.title || "автоматизацию")}>Удалить</Button>
          </div>
        </Card>
      ))}

      <Card className="mt-3">
        <form onSubmit={createCustom}>
          <div className="flex justify-between items-center mb-3">
            <div className="font-semibold">Новый вебхук-триггер</div>
            <Toggle checked={neu.transactional} onChange={(v) => setNeu({ ...neu, transactional: v })} label="Транзакционная" />
          </div>

          <Label>Ключ (латиницей, для ссылки вебхука)</Label>
          <Input value={neu.key} required onChange={(e) => setNeu({ ...neu, key: e.target.value })} placeholder={neu.transactional ? "order_shipped" : "flash_sale"} />

          {neu.transactional ? (
            <>
              <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <Label>Поле статуса</Label>
                  <Input value={neu.statusField} onChange={(e) => setNeu({ ...neu, statusField: e.target.value })} placeholder="fulfillment_status" />
                </div>
                <div>
                  <Label>Значение статуса (когда слать)</Label>
                  <Input value={neu.statusValue} onChange={(e) => setNeu({ ...neu, statusValue: e.target.value })} placeholder="shipped" />
                </div>
                <div>
                  <Label>Путь к телефону получателя</Label>
                  <Input value={neu.phonePath} onChange={(e) => setNeu({ ...neu, phonePath: e.target.value })} placeholder="client.phone" />
                </div>
                <div>
                  <Label>Путь к номеру заказа (дедуп)</Label>
                  <Input value={neu.orderIdPath} onChange={(e) => setNeu({ ...neu, orderIdPath: e.target.value })} placeholder="number" />
                </div>
              </div>
              <p className="text-ink-faint text-[12px] mt-2">
                Шлём точечно по телефону; если телефона в теле нет — <b>пропускаем</b> (не рассылаем всем). Дедуп по «номер + статус».
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <Label>Путь к сегменту (необязательно)</Label>
                  <Input value={neu.segmentPath} onChange={(e) => setNeu({ ...neu, segmentPath: e.target.value })} placeholder="tag — пусто = всем" />
                </div>
                <div>
                  <Label>Путь к телефону (необязательно)</Label>
                  <Input value={neu.phonePath} onChange={(e) => setNeu({ ...neu, phonePath: e.target.value })} placeholder="если есть — отправим точечно" />
                </div>
              </div>
              <p className="text-ink-faint text-[12px] mt-2">
                Рассылка сегменту (тег из тела по пути или <code className="font-mono">?segment=</code>), пусто — всем.
                Если в теле окажется телефон — отправим точечно этому клиенту.
              </p>
            </>
          )}

          <div className="h-3" />
          <Label>Заголовок пуша</Label>
          <Input value={neu.title} required onChange={(e) => setNeu({ ...neu, title: e.target.value })} placeholder={neu.transactional ? "Заказ {number} отправлен 🚚" : "Распродажа началась 🔥"} />
          <div className="h-3" />
          <Label>Текст</Label>
          <Textarea value={neu.body} required onChange={(e) => setNeu({ ...neu, body: e.target.value })} rows={2} placeholder={neu.transactional ? "Трек-номер: {fields[name=Трек-номер].value}" : "Скидки до 50% только сегодня"} />
          <div className="h-3" />
          <Label>Ссылка при клике (необязательно)</Label>
          <Input value={neu.url} onChange={(e) => setNeu({ ...neu, url: e.target.value })} />
          <Button className="mt-4" disabled={busy}>Создать</Button>
        </form>
      </Card>
    </div>
  );
}

function fmtDelay(mins: number): string {
  if (mins % 1440 === 0 && mins >= 1440) return `${mins / 1440} дн`;
  if (mins % 60 === 0 && mins >= 60) return `${mins / 60} ч`;
  return `${mins} мин`;
}
