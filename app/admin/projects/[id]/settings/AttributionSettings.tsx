"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, useDialogs } from "@/app/ui";
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
    <Card className="mt-4">
      <h2 className="text-base font-semibold m-0">Атрибуция заказов к рассылкам</h2>
      <p className="text-ink-muted text-[13px] mt-1">
        Заказы, оформленные после перехода по рассылке, сами появятся в Аналитике и Рассылках — ничего отдельно
        включать не нужно.
      </p>

      <div className="text-[13px] font-semibold mt-3">Вебхук на создание/обновление заказа</div>
      <CopyBox text={webhookUrl} />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Имя куки</Label>
          <Input value={s.cookieName} onChange={(e) => setS({ ...s, cookieName: e.target.value })} placeholder="pss_attr" />
        </div>
        <div>
          <Label>Окно атрибуции (дней)</Label>
          <Input type="number" min={1} value={s.windowDays} onChange={(e) => setS({ ...s, windowDays: Number(e.target.value) })} />
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

      <Button size="sm" className="mt-3" disabled={busy} onClick={save}>
        Сохранить
      </Button>
    </Card>
  );
}
