"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, useDialogs } from "@/app/ui";
import IntegrationCard from "../IntegrationCard";

type Initial = {
  smsSender: string;
  emailFrom: string;
  hasTelegram: boolean;
  hasBytehand: boolean;
  hasHaskimail: boolean;
  hasHaskimailStream: boolean;
  hasHaskimailTransactionalStream: boolean;
  hasSmsc: boolean;
};

export default function IntegrationsSettings({ projectId, initial }: { projectId: string; initial: Initial }) {
  const router = useRouter();
  const { toast, confirm } = useDialogs();
  const [savingCard, setSavingCard] = useState<string | null>(null);

  // Общие поля — используются больше чем одним провайдером, показаны в
  // каждой карточке, где применимы (одно и то же состояние).
  const [emailFrom, setEmailFrom] = useState(initial.emailFrom);
  const [smsSender, setSmsSender] = useState(initial.smsSender);

  const [haskimailToken, setHaskimailToken] = useState("");
  const [haskimailTransactionalStream, setHaskimailTransactionalStream] = useState("");
  const [haskimailMarketingStream, setHaskimailMarketingStream] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [bytehandKey, setBytehandKey] = useState("");
  const [smscLogin, setSmscLogin] = useState("");
  const [smscPassword, setSmscPassword] = useState("");

  async function saveCard(card: string, payload: Record<string, unknown>, resetFields: () => void) {
    setSavingCard(card);
    const res = await fetch("/api/admin/oidc/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, ...payload }),
    });
    const json = await res.json().catch(() => ({}));
    setSavingCard(null);
    if (!res.ok) return toast(json.error || "Ошибка", "bad");
    resetFields();
    toast("Сохранено", "good");
    router.refresh();
  }

  const saveHaskimail = () =>
    saveCard(
      "haskimail",
      {
        emailFrom,
        ...(haskimailToken.trim() ? { haskimailToken: haskimailToken.trim() } : {}),
        ...(haskimailTransactionalStream.trim() ? { haskimailTransactionalStream: haskimailTransactionalStream.trim() } : {}),
        ...(haskimailMarketingStream.trim() ? { haskimailMarketingStream: haskimailMarketingStream.trim() } : {}),
      },
      () => {
        setHaskimailToken("");
        setHaskimailTransactionalStream("");
        setHaskimailMarketingStream("");
      }
    );

  const saveTelegram = () =>
    saveCard("telegram", { ...(telegramToken.trim() ? { telegramToken: telegramToken.trim() } : {}) }, () => setTelegramToken(""));

  const saveBytehand = () =>
    saveCard("bytehand", { smsSender, ...(bytehandKey.trim() ? { bytehandKey: bytehandKey.trim() } : {}) }, () => setBytehandKey(""));

  const saveSmsc = () =>
    saveCard(
      "smsc",
      {
        smsSender,
        emailFrom,
        ...(smscLogin.trim() ? { smscLogin: smscLogin.trim() } : {}),
        ...(smscPassword.trim() ? { smscPassword: smscPassword.trim() } : {}),
      },
      () => {
        setSmscLogin("");
        setSmscPassword("");
      }
    );

  // Сброс — явные пустые строки (не omit), чтобы сервер стёр значение, а не
  // оставил как есть. Только собственные поля карточки: общие (email/sms
  // отправитель) сброс не трогает — они принадлежат не одному провайдеру.
  async function resetCard(card: string, label: string, payload: Record<string, string>, resetFields: () => void) {
    const ok = await confirm({
      title: `Сбросить ${label}?`,
      message: "Сохранённые ключи будут удалены — канал перестанет работать, пока не настроите заново.",
      confirmText: "Сбросить",
      danger: true,
    });
    if (!ok) return;
    await saveCard(card, payload, resetFields);
  }

  const resetHaskimail = () =>
    resetCard(
      "haskimail",
      "Haskimail",
      { haskimailToken: "", haskimailTransactionalStream: "", haskimailMarketingStream: "" },
      () => {
        setHaskimailToken("");
        setHaskimailTransactionalStream("");
        setHaskimailMarketingStream("");
      }
    );

  const resetTelegram = () => resetCard("telegram", "Telegram Gateway", { telegramToken: "" }, () => setTelegramToken(""));

  const resetBytehand = () => resetCard("bytehand", "Bytehand", { bytehandKey: "" }, () => setBytehandKey(""));

  const resetSmsc = () =>
    resetCard("smsc", "SMSC.ru", { smscLogin: "", smscPassword: "" }, () => {
      setSmscLogin("");
      setSmscPassword("");
    });

  return (
    <section className="mt-5">
      <IntegrationCard title="Haskimail" badges={["EMAIL", "AUTH"]} configured={initial.hasHaskimail}>
        <div className={savingCard === "haskimail" ? "opacity-60" : ""}>
          <div>
            <Label>Server Token</Label>
            <Input
              type="password"
              value={haskimailToken}
              onChange={(e) => setHaskimailToken(e.target.value)}
              placeholder={initial.hasHaskimail ? "оставьте пустым — не менять" : "Server Token из кабинета Haskimail"}
            />
          </div>
          <div className="mt-3">
            <Label>ID транзакционного канала (необязательно)</Label>
            <Input
              value={haskimailTransactionalStream}
              onChange={(e) => setHaskimailTransactionalStream(e.target.value)}
              placeholder={initial.hasHaskimailTransactionalStream ? "оставьте пустым — не менять" : "например, 9936"}
            />
          </div>
          <div className="mt-3">
            <Label>ID канала рассылок</Label>
            <Input
              value={haskimailMarketingStream}
              onChange={(e) => setHaskimailMarketingStream(e.target.value)}
              placeholder={initial.hasHaskimailStream ? "оставьте пустым — не менять" : "например, 10380"}
            />
          </div>
          <div className="mt-3">
            <Label>Email-отправитель</Label>
            <Input value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} placeholder="Магазин <noreply@ваш-домен.ru>" />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            {initial.hasHaskimail && (
              <Button variant="secondary" size="sm" disabled={savingCard === "haskimail"} onClick={resetHaskimail}>
                Сбросить
              </Button>
            )}
            <Button size="sm" disabled={savingCard === "haskimail"} onClick={saveHaskimail}>
              Сохранить
            </Button>
          </div>
        </div>
      </IntegrationCard>

      <IntegrationCard title="Telegram Gateway" badges={["AUTH"]} configured={initial.hasTelegram}>
        <div className={savingCard === "telegram" ? "opacity-60" : ""}>
          <div>
            <Label>Telegram Gateway token</Label>
            <Input
              type="password"
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
              placeholder={initial.hasTelegram ? "оставьте пустым — не менять" : "вставьте токен из Telegram Gateway"}
            />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            {initial.hasTelegram && (
              <Button variant="secondary" size="sm" disabled={savingCard === "telegram"} onClick={resetTelegram}>
                Сбросить
              </Button>
            )}
            <Button size="sm" disabled={savingCard === "telegram"} onClick={saveTelegram}>
              Сохранить
            </Button>
          </div>
        </div>
      </IntegrationCard>

      <IntegrationCard title="Bytehand" badges={["SMS", "AUTH"]} configured={initial.hasBytehand}>
        <div className={savingCard === "bytehand" ? "opacity-60" : ""}>
          <div>
            <Label>Bytehand X-Service-Key</Label>
            <Input
              type="password"
              value={bytehandKey}
              onChange={(e) => setBytehandKey(e.target.value)}
              placeholder={initial.hasBytehand ? "оставьте пустым — не менять" : "X-Service-Key из кабинета Bytehand"}
            />
          </div>
          <div className="mt-3">
            <Label>SMS-отправитель</Label>
            <Input value={smsSender} onChange={(e) => setSmsSender(e.target.value)} placeholder="например, MYSHOP" />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            {initial.hasBytehand && (
              <Button variant="secondary" size="sm" disabled={savingCard === "bytehand"} onClick={resetBytehand}>
                Сбросить
              </Button>
            )}
            <Button size="sm" disabled={savingCard === "bytehand"} onClick={saveBytehand}>
              Сохранить
            </Button>
          </div>
        </div>
      </IntegrationCard>

      <IntegrationCard title="SMSC.ru" badges={["SMS", "EMAIL", "AUTH"]} configured={initial.hasSmsc}>
        <div className={savingCard === "smsc" ? "opacity-60" : ""}>
          <div>
            <Label>Логин (Login)</Label>
            <Input
              value={smscLogin}
              onChange={(e) => setSmscLogin(e.target.value)}
              placeholder={initial.hasSmsc ? "оставьте пустым — не менять" : "логин аккаунта SMSC.ru"}
            />
          </div>
          <div className="mt-3">
            <Label>Пароль (Password)</Label>
            <Input
              type="password"
              value={smscPassword}
              onChange={(e) => setSmscPassword(e.target.value)}
              placeholder={initial.hasSmsc ? "оставьте пустым — не менять" : "пароль аккаунта SMSC.ru"}
            />
          </div>
          <div className="mt-3">
            <Label>SMS-отправитель</Label>
            <Input value={smsSender} onChange={(e) => setSmsSender(e.target.value)} placeholder="например, MYSHOP" />
          </div>
          <div className="mt-3">
            <Label>Email-отправитель</Label>
            <Input value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} placeholder="Магазин <noreply@ваш-домен.ru>" />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            {initial.hasSmsc && (
              <Button variant="secondary" size="sm" disabled={savingCard === "smsc"} onClick={resetSmsc}>
                Сбросить
              </Button>
            )}
            <Button size="sm" disabled={savingCard === "smsc"} onClick={saveSmsc}>
              Сохранить
            </Button>
          </div>
        </div>
      </IntegrationCard>
    </section>
  );
}
