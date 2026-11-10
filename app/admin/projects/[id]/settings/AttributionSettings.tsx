"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { Button, Card, Input, useDialogs } from "@/app/ui";
import CopyBox from "../CopyBox";

// Атрибуция заказов к пушам — вебхук всегда живой по своему токену, никакого
// отдельного "включить" нет (см. lib/attribution.ts): нет заказов с этой
// кукой — отчёт просто показывает нули, это и есть штатное состояние, а не
// ошибка настройки. Токен генерируется один раз, при создании проекта (см.
// app/api/admin/projects/create) — перевыпуска здесь нет. Поля заказа
// (номер/сумма/оплата) захардкожены в /api/v1/attribute — подтверждены
// реальным заказом InSales, настраивать нечего.
export default function AttributionSettings({
  projectId,
  domain,
  webhookUrl,
  clientWebhookUrl,
  initialSmsField,
  initialFieldMap,
  knownKeys,
  initial,
}: {
  projectId: string;
  domain: string | null;
  webhookUrl: string;
  clientWebhookUrl: string;
  initialSmsField: string;
  initialFieldMap: { handle: string; key: string }[];
  knownKeys: string[];
  initial: { cookieName: string; windowDays: number };
}) {
  const router = useRouter();
  const { toast } = useDialogs();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [smsField, setSmsField] = useState(initialSmsField);
  const [smsBusy, setSmsBusy] = useState(false);
  const [fieldMap, setFieldMap] = useState<{ handle: string; key: string }[]>(initialFieldMap);

  async function saveSmsField() {
    if (smsBusy) return;
    setSmsBusy(true);
    const res = await fetch("/api/admin/attribution/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, clientSmsField: smsField, clientFieldMap: fieldMap }),
    });
    setSmsBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast(j.error || "Ошибка", "bad");
      return;
    }
    toast("Сохранено", "good");
    router.refresh();
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    const res = await fetch("/api/admin/attribution/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, cookieName: s.cookieName, windowDays: s.windowDays }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast(j.error || "Ошибка", "bad");
      return;
    }
    toast("Сохранено", "good");
    router.refresh();
  }

  // Оба вебхука оформлены одинаково: заголовок карточки → описание → адрес с копированием →
  // поля (подпись над полем, пояснение под полем) → кнопка «Сохранить».
  const labelCls = "text-[13px] text-ink-muted block mb-1";
  const hintCls = "text-[12.5px] text-ink-faint mt-2 mb-0";

  return (
    <section className="mt-4 sm:mt-8">
      <h2 className="text-lg font-semibold mb-1">Вебхуки магазина</h2>
      <p className="text-[13px] text-ink-muted mt-0 mb-3">Адреса, которые нужно добавить в настройках магазина: заказы и клиенты.</p>

      <Card>
        <div className="text-base font-semibold mb-1">Вебхук заказов</div>
        <p className="text-[13px] text-ink-muted mt-0 mb-3">
          Добавьте его в настройках магазина на события «заказ создан» и «заказ изменён». Вебхук получает все заказы магазина,
          включая изменения статуса: отменённые и возвращённые не считаются выручкой. Заказы, оформленные после перехода по
          рассылке, попадают в Аналитику и Рассылки, а все заказы питают RFM-теги и историю контакта.
        </p>
        <CopyBox text={webhookUrl} />

        <div className="mt-4 grid gap-4">
          <div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="attr-cookie-name" className={labelCls}>
                  Имя куки
                </label>
                <Input
                  id="attr-cookie-name"
                  value={s.cookieName}
                  onChange={(e) => setS({ ...s, cookieName: e.target.value })}
                  placeholder="pss_attr"
                />
              </div>
              <div>
                <label htmlFor="attr-window-days" className={labelCls}>
                  Окно атрибуции (дней)
                </label>
                <Input
                  id="attr-window-days"
                  type="number"
                  min={1}
                  value={s.windowDays}
                  onChange={(e) => setS({ ...s, windowDays: Number(e.target.value) })}
                />
              </div>
            </div>
            <p className={hintCls}>
              Впишите это же имя в InSales:{" "}
              {domain ? (
                <a href={`https://${domain}/admin2/checkout`} target="_blank" rel="noreferrer" className="text-accent">
                  Настройки оформления заказа
                </a>
              ) : (
                "Настройки оформления заказа"
              )}{" "}
              → «Список cookies, которые требуется сохранить при оформлении заказа».
            </p>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <Button onClick={save}>Сохранить</Button>
        </div>
      </Card>

      <Card className="mt-3">
        <div className="text-base font-semibold mb-1">Вебхук клиентов</div>
        <p className="text-[13px] text-ink-muted mt-0 mb-3">
          Добавьте его в настройках магазина на события «клиент зарегистрировался» и «клиент изменён». Новые клиенты попадут в
          контакты, имя, телефон, email и бонусы обновятся сами. Согласия на рассылки приходят оттуда же: на email из
          системного поля клиента «подписка», на SMS из дополнительного поля клиента. Любое изменение в личном кабинете
          магазина (подписался или отписался) меняет согласие на нужном канале.
        </p>
        <CopyBox text={clientWebhookUrl} />

        <div className="mt-4 grid gap-4">
          <div>
            <label htmlFor="client-sms-field" className={labelCls}>
              Поле клиента с согласием на SMS
            </label>
            <Input
              id="client-sms-field"
              value={smsField}
              onChange={(e) => setSmsField(e.target.value)}
              placeholder="Имя (handle) дополнительного поля клиента, например sms_consent"
            />
            <p className={hintCls}>Пока поле не указано, согласие на SMS вебхук клиентов не меняет.</p>
          </div>

          <div>
            <div className={labelCls}>Доп. поля клиента → поля контакта</div>
            <datalist id="client-known-keys">
              {knownKeys.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
            <div className="grid gap-2">
              {fieldMap.map((row, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-center">
                  <Input
                    aria-label="Поле в магазине"
                    value={row.handle}
                    onChange={(e) => setFieldMap(fieldMap.map((r, j) => (j === i ? { ...r, handle: e.target.value } : r)))}
                    placeholder="Поле в магазине (handle), например birthday"
                  />
                  <Input
                    aria-label="Поле контакта"
                    list="client-known-keys"
                    value={row.key}
                    onChange={(e) => setFieldMap(fieldMap.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
                    placeholder="Поле контакта: выберите или впишите новое"
                  />
                  <button
                    type="button"
                    onClick={() => setFieldMap(fieldMap.filter((_, j) => j !== i))}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-muted hover:text-ink transition-colors hover:bg-surface-2 cursor-pointer"
                    aria-label="Убрать поле"
                    title="Убрать поле"
                  >
                    <IconTrash size={16} stroke={1.8} />
                  </button>
                </div>
              ))}
            </div>
            <div className={fieldMap.length ? "mt-2" : ""}>
              <Button variant="secondary" size="sm" onClick={() => setFieldMap([...fieldMap, { handle: "", key: "" }])}>
                <IconPlus size={14} stroke={2} />
                Добавить доп. поле
              </Button>
            </div>
            <p className={hintCls}>
              Укажите имя поля в магазине и поле контакта у нас, куда сохранять его значение. Поле у нас можно выбрать из уже
              существующих или вписать новое: оно появится у контактов при первой записи значения. Поля, которых здесь нет, не
              сохраняются.
            </p>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <Button onClick={saveSmsField}>Сохранить</Button>
        </div>
      </Card>
    </section>
  );
}
