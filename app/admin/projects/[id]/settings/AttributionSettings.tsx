"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  initial,
}: {
  projectId: string;
  domain: string | null;
  webhookUrl: string;
  initial: { cookieName: string; windowDays: number };
}) {
  const router = useRouter();
  const { toast } = useDialogs();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);

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

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold mb-1">Атрибуция заказов к рассылкам</h2>
      <p className="text-[13px] text-ink-muted mt-0 mb-3">
        Добавьте вебхук ниже в настройках магазина — и заказы, оформленные после перехода по рассылке, начнут
        появляться в Аналитике и Рассылках.
      </p>

      <Card>
        <div className="text-[13.5px] font-semibold mb-3">Вебхук атрибуции</div>
        <CopyBox text={webhookUrl} />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="attr-cookie-name" className="text-[13px] text-ink-muted block mb-1">
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
            <label htmlFor="attr-window-days" className="text-[13px] text-ink-muted block mb-1">
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
        <p className="text-[12.5px] text-ink-faint mt-2 mb-0">
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

        <div className="flex gap-2 mt-3">
          <Button onClick={save}>Сохранить</Button>
        </div>
      </Card>
    </section>
  );
}
