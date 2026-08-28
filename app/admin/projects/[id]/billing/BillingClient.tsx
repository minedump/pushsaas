"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PACKAGES } from "@/lib/packages";
import { Badge, Button, Card, useDialogs } from "@/app/ui";
import { friendlyError } from "@/lib/errors";

type Tariff = { id: string; name: string; price_rub: number; monthly_push_limit: number; subscriber_limit: number | null };
type Project = {
  id: string;
  tariff_id: string | null;
  tariff_pushes_remaining: number;
  package_pushes_remaining: number;
  remaining_pushes: number;
  current_period_end: string | null;
  is_active: boolean;
};

declare global {
  interface Window {
    cp?: { CloudPayments: new () => { pay: (t: string, o: object, cb: object) => void } };
  }
}

const PAYMENT_FAIL_REASONS: Record<string, string> = {
  "Insufficient Funds": "недостаточно средств на карте",
  "Do Not Honor": "банк отклонил операцию",
  "Invalid Card Number": "неверный номер карты",
  "Invalid Expiration Date": "неверный срок действия карты",
  "Expired Card": "истёк срок действия карты",
  "Incorrect CVV": "неверный код CVV",
  "Restricted Card": "операции по карте ограничены банком",
  "Lost Card": "карта заблокирована банком",
  "Stolen Card": "карта заблокирована банком",
  "Exceeds Withdrawal Limit": "превышен лимит операций по карте",
  "Transaction Not Permitted": "банк запретил операцию для этой карты",
  "Issuer Unavailable": "банк-эмитент временно недоступен",
  "3DSecure Authentication Failed": "не пройдена проверка 3-D Secure",
  "Time Out": "истекло время ожидания оплаты",
};

function translatePaymentFailReason(reason: string): string {
  const known = PAYMENT_FAIL_REASONS[reason];
  return known ? `Оплата не прошла: ${known}.` : "Оплата не прошла. Попробуйте другую карту или повторите позже.";
}

export default function BillingClient({
  project,
  tariffs,
  currentName,
  currentIsPaid,
  publicId,
}: {
  project: Project;
  tariffs: Tariff[];
  currentName: string;
  currentIsPaid: boolean;
  publicId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { confirm, toast } = useDialogs();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!publicId) return;
    if (window.cp) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://widget.cloudpayments.ru/bundles/cloudpayments.js";
    s.onload = () => setReady(true);
    document.body.appendChild(s);
  }, [publicId]);

  function pay(amount: number, description: string, data: object) {
    if (!window.cp) return;
    const widget = new window.cp.CloudPayments();
    widget.pay(
      "charge",
      { publicId, description, amount, currency: "RUB", accountId: project.id, invoiceId: `${project.id}-${Date.now()}`, data },
      {
        onSuccess: () => { toast("Оплата прошла. Баланс обновится в течение минуты.", "good"); setTimeout(() => router.refresh(), 2500); },
        onFail: (reason: string) => {
          if (reason === "User has cancelled") return; // закрыл окно оплаты сам — это не ошибка
          toast(translatePaymentFailReason(reason), "bad");
        },
      }
    );
  }

  async function unsubscribe() {
    const ok = await confirm({
      title: "Отписаться от тарифа?",
      message: "Остаток перейдёт в непрогораемый пакет, автосписания прекратятся.",
      confirmText: "Отписаться",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.rpc("unsubscribe_project", { p_project_id: project.id });
    setBusy(false);
    if (error) toast(friendlyError(error), "bad");
    else { toast("Вы вернулись на «Старт»", "good"); router.refresh(); }
  }

  const canPay = Boolean(publicId) && ready;

  return (
    <div className="mt-4">
      <Card>
        <div className="flex justify-between items-start flex-wrap gap-3">
          <div>
            <div className="text-ink-muted text-xs">Текущий тариф</div>
            <div className="text-xl font-bold">{currentName}</div>
            {project.current_period_end && (
              <div className="text-xs text-ink-faint">до {new Date(project.current_period_end).toLocaleDateString("ru-RU")}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[26px] font-bold">{project.remaining_pushes}</div>
            <div className="text-[11px] text-ink-faint">
              тариф {project.tariff_pushes_remaining} · пакет {project.package_pushes_remaining}
            </div>
            <Badge tone={project.is_active ? "good" : "bad"} dot className="mt-1.5">
              {project.is_active ? "активен" : "заблокирован"}
            </Badge>
          </div>
        </div>
        {currentIsPaid && (
          <Button variant="secondary" size="sm" className="mt-3.5" onClick={unsubscribe} disabled={busy}>
            Отписаться (вернуться на «Старт»)
          </Button>
        )}
      </Card>

      <h2 className="text-base font-semibold mt-8">Тарифы</h2>
      <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {tariffs.map((t) => {
          const isCurrent = t.id === project.tariff_id;
          return (
            <Card key={t.id} className={isCurrent ? "border-accent" : ""}>
              <div className="font-bold">{t.name}</div>
              <div className="text-[22px] font-bold mt-1">
                {t.price_rub > 0 ? `${t.price_rub} ₽` : "Бесплатно"}
                <span className="text-xs text-ink-faint font-normal">/мес</span>
              </div>
              <div className="text-[13px] text-ink-muted mt-1.5">
                {t.monthly_push_limit.toLocaleString("ru-RU")} пушей/мес
                {t.subscriber_limit ? ` · до ${t.subscriber_limit.toLocaleString("ru-RU")} подписчиков` : ""}
              </div>
              <Button
                className="mt-3.5 w-full"
                disabled={isCurrent || t.price_rub === 0 || !canPay}
                onClick={() => pay(t.price_rub, `Тариф ${t.name}`, { projectId: project.id, kind: "tariff", tariffId: t.id })}
              >
                {isCurrent ? "Текущий" : t.price_rub === 0 ? "Через «Отписаться»" : "Оплатить"}
              </Button>
            </Card>
          );
        })}
      </div>

      <h2 className="text-base font-semibold mt-8">
        Разовые пакеты <span className="text-xs text-ink-faint font-normal">(не сгорают)</span>
      </h2>
      <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        {PACKAGES.map((p) => (
          <Card key={p.pushes}>
            <div className="text-lg font-bold">{p.pushes.toLocaleString("ru-RU")}</div>
            <div className="text-xs text-ink-muted">пушей</div>
            <Button
              variant="secondary"
              className="mt-3 w-full"
              disabled={!canPay}
              onClick={() => pay(p.price, `Пакет ${p.pushes} пушей`, { projectId: project.id, kind: "package", pushes: p.pushes })}
            >
              {p.price} ₽
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
