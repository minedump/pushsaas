"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, Toggle, useDialogs } from "@/app/ui";

type Initial = {
  enabled: boolean;
  cookieName: string;
  windowDays: number;
};

// Компактные настройки атрибуции заказов (живут в разделе API рядом с
// эндпоинтом вебхука). Пути к номеру/сумме заказа захардкожены
// (number/total_price — формат вебхука InSales подтверждён реальным заказом).
export default function AttributionSettings({
  projectId,
  domain,
  initial,
}: {
  projectId: string;
  domain: string | null;
  initial: Initial;
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
      body: JSON.stringify({ projectId, enabled: s.enabled, cookieName: s.cookieName, windowDays: s.windowDays }),
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
    <Card className={`mt-3 ${busy ? "opacity-60" : ""}`}>
      <div className="flex justify-between items-center">
        <strong className="text-[13.5px]">Атрибуция включена</strong>
        <Toggle checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
      </div>

      {s.enabled && (
        <div className="mt-3">
          <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
      )}

      <Button size="sm" className="mt-3" disabled={busy} onClick={save}>
        Сохранить
      </Button>
    </Card>
  );
}
