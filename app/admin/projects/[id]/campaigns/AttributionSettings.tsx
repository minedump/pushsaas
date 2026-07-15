"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, Toggle, useDialogs } from "@/app/ui";
import CopyBox from "../CopyBox";

type Initial = {
  enabled: boolean;
  cookieName: string;
  windowDays: number;
  orderIdPath: string;
  revenuePath: string;
};

// Отдельный блок настройки: связывает заказ с пушем, приведшим к нему, через
// first-party куку, которую ставит наш скрипт по клику на пуш. InSales сам
// капчурит в заказ ЛЮБУЮ куку, перечисленную в /admin2/checkout → «Список
// cookies, которые требуется сохранить при оформлении заказа», кладя её в
// order.cookies.<имя> — подтверждено реальным телом заказа. Поэтому путь к
// куке всегда `cookies.<имя>` и вводить его руками не нужно — только имя,
// одно и то же и здесь, и там.
export default function AttributionSettings({ projectId, initial }: { projectId: string; initial: Initial }) {
  const router = useRouter();
  const { toast } = useDialogs();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/admin/attribution/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        enabled: s.enabled,
        cookieName: s.cookieName,
        windowDays: s.windowDays,
        orderIdPath: s.orderIdPath,
        revenuePath: s.revenuePath,
      }),
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
    <Card className="mt-5">
      <div className="flex justify-between items-center mb-2">
        <strong>Атрибуция заказов к пушам</strong>
        <Toggle checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label="Включена" />
      </div>
      <p className="text-ink-muted text-[13px] mt-0">
        Модель — последний клик. Наш скрипт ставит покупателю куку по клику на пуш; если магазин настроит InSales
        сохранять эту куку в заказ (два шага ниже) — мы посчитаем заказ результатом кампании.
      </p>

      {s.enabled && (
        <div className="mt-3">
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <Label>Имя куки</Label>
              <Input value={s.cookieName} onChange={(e) => setS({ ...s, cookieName: e.target.value })} placeholder="pss_attr" />
            </div>
            <div>
              <Label>Окно атрибуции (дней)</Label>
              <Input type="number" min={1} value={s.windowDays} onChange={(e) => setS({ ...s, windowDays: Number(e.target.value) })} />
            </div>
          </div>

          <div className="mt-4 rounded-lg p-3 bg-accent-tint border border-border">
            <div className="text-[13px] font-semibold mb-1">Шаг в InSales — один раз</div>
            <p className="text-[13px] text-ink-muted mt-0 mb-2">
              Магазин → Настройки → <code className="font-mono">/admin2/checkout</code> → «Список cookies, которые
              требуется сохранить при оформлении заказа» → впишите то же имя, что и выше:
            </p>
            <CopyBox text={s.cookieName || "pss_attr"} />
            <p className="text-[12px] text-ink-faint mt-1 mb-0">
              InSales сам положит значение этой куки в заказ (<code className="font-mono">cookies.{s.cookieName || "pss_attr"}</code>) —
              путь заранее известен, отдельно указывать не нужно.
            </p>
          </div>

          <div className="h-3" />
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <Label>Путь к номеру заказа</Label>
              <Input value={s.orderIdPath} onChange={(e) => setS({ ...s, orderIdPath: e.target.value })} placeholder="number" />
            </div>
            <div>
              <Label>Путь к сумме заказа</Label>
              <Input value={s.revenuePath} onChange={(e) => setS({ ...s, revenuePath: e.target.value })} placeholder="total_price" />
            </div>
          </div>
          <p className="text-ink-faint text-[12px] mt-2">
            Значения по умолчанию (<code className="font-mono">number</code>, <code className="font-mono">total_price</code>) уже
            проверены на реальном заказе InSales — менять нужно только если тема считает деньги иначе.
          </p>
          <p className="text-ink-faint text-[12px] mt-1">
            Вебхук на создание/обновление заказа шлите на{" "}
            <code className="font-mono">POST /api/v1/attribute?key=wpk_ВАШ_КЛЮЧ</code> (см. раздел API).
          </p>
        </div>
      )}

      <Button size="sm" className="mt-3" disabled={busy} onClick={save}>
        Сохранить
      </Button>
    </Card>
  );
}
