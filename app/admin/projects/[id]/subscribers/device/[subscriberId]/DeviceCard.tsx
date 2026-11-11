"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconChevronLeft, IconPlayerStopFilled } from "@tabler/icons-react";
import { Badge, Button, Card, Input, Label, useDialogs } from "@/app/ui";
import { useProjectTz } from "../../../ProjectTimeProvider";
import { formatDateTime } from "@/lib/datetime";

const platformLabel: Record<string, string> = { ios: "iPhone", android: "Android", desktop: "Desktop", unknown: "—" };

type Device = {
  id: string;
  platform: string;
  isActive: boolean;
  paused: boolean;
  noPush: boolean;
  createdAt: string;
  timezone: string;
  name: string;
  ymClientId: string;
};
type EventRow = { id: string; label: string; detail: string; created_at: string };

// Карточка устройства без контакта: что о нём известно и ручная правка. Меняются имя (для подстановки
// {name} в push), часовой пояс и UUID метрики. Телефон, email и теги принадлежат контакту: устройство
// получает контакт, когда человек входит по коду (вручную привязать нельзя: привязка открывает
// устройству коды входа этого контакта).
export default function DeviceCard({ projectId, device, events }: { projectId: string; device: Device; events: EventRow[] }) {
  const router = useRouter();
  const tz = useProjectTz();
  const { toast } = useDialogs();
  const [name, setName] = useState(device.name);
  const [timezone, setTimezone] = useState(device.timezone);
  const [ymClientId, setYmClientId] = useState(device.ymClientId);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/admin/subscribers/device/${device.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name, timezone, ymClientId }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(json.error || "Не удалось сохранить", "bad");
    toast("Сохранено", "good");
    router.refresh();
  }

  const label = platformLabel[device.platform] || device.platform;

  return (
    <main className="max-w-4xl mx-auto">
      <Link href={`/admin/projects/${projectId}/subscribers`} className="inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink">
        <IconChevronLeft size={14} stroke={2} />
        Подписчики
      </Link>

      <div className="flex items-center gap-2 flex-wrap mt-2">
        <h1 className="text-2xl font-semibold m-0">Устройство без контакта</h1>
        <Badge tone="accent">{label}</Badge>
        {!device.isActive ? (
          <Badge tone="bad" dot>
            отвалилось
          </Badge>
        ) : device.noPush ? (
          <span className="inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full bg-warn-tint text-warn">
            <IconPlayerStopFilled size={10} />
            нет push-подписки
          </span>
        ) : device.paused ? (
          <Badge tone="warn" dot>
            на паузе
          </Badge>
        ) : (
          <Badge tone="good" dot>
            активно
          </Badge>
        )}
      </div>
      <p className="text-[13px] text-ink-muted mt-2 mb-0">
        Создано {formatDateTime(device.createdAt, tz)}.{" "}
        {device.noPush
          ? "Push на это устройство отправить нельзя: человек не подписан. Когда он подпишется, рассылка заработает сама."
          : "У устройства нет привязанного контакта: человек не входил по коду."}
      </p>

      <Card className="mt-4">
        <h2 className="text-sm font-semibold m-0 mb-3">Данные устройства</h2>
        <form onSubmit={save} className="flex flex-col gap-3">
          <div>
            <Label>Имя</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Как обращаться: подставляется в {{ name }} в push" />
          </div>
          <div>
            <Label>Часовой пояс</Label>
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Moscow" />
            <p className="text-[12.5px] text-ink-faint mt-1.5 mb-0">Название IANA. Нужен для окна отправки «по часовому поясу получателя». Пустое значение очищает.</p>
          </div>
          <div>
            <Label>UUID метрики</Label>
            <Input value={ymClientId} onChange={(e) => setYmClientId(e.target.value)} placeholder="ClientID Яндекс.Метрики" className="font-mono" />
            <p className="text-[12.5px] text-ink-faint mt-1.5 mb-0">По нему устройство находится при импорте «UUID метрики».</p>
          </div>
          <div className="flex gap-2">
            <Button disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</Button>
          </div>
        </form>
        <p className="text-[12.5px] text-ink-faint mt-3 mb-0">
          Телефон, email и теги принадлежат контакту, у этого устройства контакта нет. Он появится, когда человек войдёт по коду
          или оформит заказ, и данные устройства (UUID метрики, часовой пояс) перейдут на него.
        </p>
      </Card>

      <Card className="mt-4">
        <h2 className="text-sm font-semibold m-0 mb-2">События на сайте</h2>
        {events.length === 0 ? (
          <p className="text-[13px] text-ink-faint m-0">Событий пока нет.</p>
        ) : (
          <div className="grid gap-1.5">
            {events.map((e) => (
              <div key={e.id} className="flex items-baseline justify-between gap-3 text-[13px] border-t border-border pt-1.5 first:border-t-0 first:pt-0">
                <span className="min-w-0">
                  {e.label}
                  {e.detail && <span className="text-ink-faint"> · {e.detail}</span>}
                </span>
                <span className="text-ink-muted whitespace-nowrap">{formatDateTime(e.created_at, tz)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
